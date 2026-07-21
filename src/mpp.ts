import { Provider as TempoProvider, Storage as TempoStorage } from 'accounts/cli'
import type { Store as TempoStore } from 'accounts'
import { Mppx, tempo } from 'mppx/client'
import { toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Actions } from 'viem/tempo'
import { usdce } from 'viem/tokens'
import {
  tempoChains,
  tempoNetworks,
  type TempoNetwork,
} from './network.js'

export type PluginConfig = {
  enabled?: boolean
  wallet: WalletConfig
}

type WalletConfig = TempoWalletConfig
type TempoWalletConfig = {
  type: 'tempo'
  privateKey?: `0x${string}`
  accessKey?: `0x${string}`
  storagePath?: string
}
type WalletSource = {
  parameters: Partial<TempoParameters>
}
export type WalletStatus = {
  accessKey?: `0x${string}`
  account?: `0x${string}`
  activeAccessKeys?: number
  chainId?: number
  message: string
  network: TempoNetwork
  publication?: 'pending' | 'published'
  ready: boolean
  requestedAccessKey?: `0x${string}`
  setup?: 'failed' | 'pending'
  setupUrl?: string
  source: 'privateKey' | 'wallet'
  wallet: 'tempo'
}

type MppxClient = ReturnType<typeof Mppx.create>
type TempoParameters = NonNullable<Parameters<typeof tempo>[0]>
type TempoProviderInstance = Pick<
  TempoProvider.create.ReturnType,
  'getAccessKeyStatus' | 'getAccount' | 'getMppxParameters' | 'request'
> & { store: TempoStoreInstance }
type TempoStoreInstance = {
  accessKeys: {
    get: (options: {
      accessKey: `0x${string}`
      account: `0x${string}`
      chainId: number
    }) => Promise<{ address: `0x${string}` } | undefined>
    list: (options: {
      account: `0x${string}`
      chainId: number
    }) => TempoStore.State['accessKeys']
  }
  getState: () => TempoStore.State
  persist: {
    hasHydrated: () => boolean
    rehydrate: () => Promise<void>
  }
  setState: (state: Partial<TempoStore.State>) => void
}
type TempoProviderOptions = Pick<
  TempoProvider.create.Options,
  'host' | 'open' | 'pollIntervalMs' | 'timeoutMs'
> & {
  providerFactory?: typeof TempoProvider.create
}
export type WalletSetupOptions = TempoProviderOptions & {
  expiry?: number
  limits?: readonly { limit: `0x${string}`; token: `0x${string}` }[]
  network?: TempoNetwork
  showDeposit?: boolean | { amount?: string; displayName?: string; token?: string }
}

const defaultAccessKeyTtlSeconds = 7 * 24 * 60 * 60

let cached: { client: MppxClient; key: string } | undefined

class PaymentAccountUnavailableError extends Error {}

let pendingSetup:
  | {
      error?: string
      key: string
      opened: Promise<string>
      setupUrl?: string
      status: WalletStatus
    }
  | undefined

export function normalizeConfig(input: Record<string, unknown> | undefined): PluginConfig {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : true,
    wallet: readWalletConfig(input?.wallet),
  }
}

export async function createMppx(
  config: PluginConfig,
  options: TempoProviderOptions = {},
) {
  if (config.enabled === false) throw new Error('MPP is disabled.')
  const key = mppxKey(config.wallet)

  if (cached?.key === key) return cached.client
  if (cached) closeMppx()

  const source = await resolveWalletSource(config, options)
  const client = Mppx.create({
    methods: [tempo(source.parameters)],
  })

  cached = { client, key }
  return client
}

export async function enablePaymentAwareFetch(
  config: PluginConfig,
  options: TempoProviderOptions = {},
) {
  if (config.enabled === false) {
    closeMppx()
    return false
  }
  try {
    await createMppx(config, options)
    return true
  } catch (error) {
    if (!(error instanceof PaymentAccountUnavailableError)) throw error
    closeMppx()
    return false
  }
}

export function closeMppx() {
  if (!cached) return
  cached = undefined
  Mppx.restore()
}

export async function getWalletStatus(
  config: PluginConfig,
  network: TempoNetwork = 'mainnet',
  options: TempoProviderOptions = {},
): Promise<WalletStatus> {
  const wallet = config.wallet
  if (wallet.privateKey) {
    const account = privateKeyToAccount(wallet.privateKey)
    return {
      account: account.address,
      chainId: tempoNetworks[network].id,
      message: 'Tempo private key configured.',
      network,
      ready: true,
      source: 'privateKey',
      wallet: 'tempo',
    }
  }

  const pending = pendingSetup?.key === setupKey(wallet, network) ? pendingSetup : undefined
  if (pending?.error)
    return {
      ...pending.status,
      message: pending.error,
      setup: 'failed',
    }
  if (pending)
    return {
      ...pending.status,
      message: pending.setupUrl
        ? 'Approve the access key in Tempo Wallet.'
        : 'Creating a Tempo Wallet authorization request.',
      setup: 'pending',
      ...(pending.setupUrl ? { setupUrl: pending.setupUrl } : {}),
  }

  const provider = await createTempoProvider(wallet, options)
  return getTempoWalletStatus(provider, wallet, network)
}

export async function setupWallet(
  config: PluginConfig,
  options: WalletSetupOptions = {},
): Promise<WalletStatus> {
  const wallet = config.wallet
  if (wallet.privateKey) return getWalletStatus(config, options.network, options)

  const network = options.network ?? 'mainnet'
  const provider = await createTempoProvider(wallet, options, tempoNetworks[network].id)
  const status = await getTempoWalletStatus(provider, wallet, network)
  if (status.accessKey && status.publication === 'pending')
    return publishTempoAccessKey(provider, wallet, network, status)
  if (wallet.accessKey) {
    if (status.ready) return status
    throw new Error(
      'Configured Tempo Wallet access key is not available locally. Remove wallet.accessKey to create a new key.',
    )
  }

  const parameters = {
    expiry: options.expiry ?? Math.floor(Date.now() / 1000) + defaultAccessKeyTtlSeconds,
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.showDeposit !== undefined ? { showDeposit: options.showDeposit } : {}),
  }
  await provider.request({
    method: 'wallet_authorizeAccessKey',
    params: [parameters],
  })

  return publishTempoAccessKey(
    provider,
    wallet,
    network,
    await getTempoWalletStatus(provider, wallet, network),
  )
}

export async function beginWalletSetup(
  config: PluginConfig,
  options: WalletSetupOptions = {},
): Promise<WalletStatus> {
  const network = options.network ?? 'mainnet'
  const status = await getWalletStatus(config, network, options)
  if (status.ready) return status

  const key = setupKey(config.wallet, network)
  if (pendingSetup?.error) pendingSetup = undefined
  if (pendingSetup && pendingSetup.key !== key)
    throw new Error('Tempo Wallet setup is already in progress.')
  if (pendingSetup) {
    const setupUrl = pendingSetup.setupUrl ?? (await pendingSetup.opened)
    return { ...status, message: 'Approve the access key in Tempo Wallet.', setup: 'pending', setupUrl }
  }

  let resolveOpened!: (url: string) => void
  const opened = new Promise<string>((resolve) => (resolveOpened = resolve))
  pendingSetup = { key, opened, status }

  const completion = setupWallet(config, {
    ...options,
    open(url) {
      if (pendingSetup?.key === key) pendingSetup.setupUrl = url
      resolveOpened(url)
    },
  })
  void completion
    .then(async (result) => {
      if (config.enabled !== false && result.ready) await createMppx(config)
      if (pendingSetup?.key === key) pendingSetup = undefined
    })
    .catch((error) => {
      if (pendingSetup?.key === key) pendingSetup.error = formatError(error)
    })

  const setupUrl = await Promise.race([
    opened,
    completion.then(
      () => '',
      (error) => Promise.reject(error),
    ),
  ])
  if (!setupUrl) return getWalletStatus(config, network, options)
  return {
    ...status,
    message: 'Approve the access key in Tempo Wallet.',
    setup: 'pending',
    setupUrl,
  }
}

async function resolveWalletSource(
  config: PluginConfig,
  options: TempoProviderOptions = {},
): Promise<WalletSource> {
  const wallet = config.wallet
  if (wallet.privateKey)
    return {
      parameters: {
        account: privateKeyToAccount(wallet.privateKey),
      },
    }

  const provider = await createTempoProvider(wallet, options)
  const results = await Promise.allSettled(
    (Object.keys(tempoNetworks) as TempoNetwork[]).map(async (network) => {
      const status = await getTempoWalletStatus(provider, wallet, network)
      if (status.accessKey && status.publication === 'pending')
        return publishTempoAccessKey(provider, wallet, network, status)
      return status
    }),
  )
  const statuses = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
  const ready = statuses.find((status) => status.ready)
  if (!ready) {
    const failure = results.find((result) => result.status === 'rejected')
    throw new PaymentAccountUnavailableError(
      failure?.status === 'rejected'
        ? formatError(failure.reason)
        : statuses.find((status) => status.accessKey)?.message ?? statuses[0]!.message,
    )
  }
  return {
    parameters: {
      account: provider.getAccount(),
      ...provider.getMppxParameters(wallet.accessKey ? { accessKey: wallet.accessKey } : {}),
    },
  }
}

async function createTempoProvider(
  wallet: TempoWalletConfig,
  options: TempoProviderOptions = {},
  chainId?: number,
) {
  const provider = (options.providerFactory ?? TempoProvider.create)({
    chains: tempoChains,
    host: options.host,
    mpp: false,
    open: options.open,
    pollIntervalMs: options.pollIntervalMs,
    storage: wallet.storagePath
      ? TempoStorage.filesystem({ path: wallet.storagePath })
      : TempoStorage.filesystem(),
    timeoutMs: options.timeoutMs,
  }) as TempoProviderInstance
  if (!provider.store.persist.hasHydrated()) await provider.store.persist.rehydrate()
  if (chainId !== undefined) provider.store.setState({ chainId })
  return provider
}

async function getTempoWalletStatus(
  provider: TempoProviderInstance,
  wallet: TempoWalletConfig,
  network: TempoNetwork,
): Promise<WalletStatus> {
  const state = provider.store.getState()
  const chainId = tempoNetworks[network].id
  const account = state.accounts[state.activeAccount]?.address as `0x${string}` | undefined
  if (!account)
    return {
      chainId,
      message: 'Run `openclaw mpp setup` or provide `TEMPO_PRIVATE_KEY`.',
      network,
      ready: false,
      ...(wallet.accessKey ? { requestedAccessKey: wallet.accessKey } : {}),
      source: 'wallet',
      wallet: 'tempo',
    }

  const accessKeys = await availableAccessKeys(provider, account, chainId)
  const selected = accessKeys.find(
    ({ key }) => !wallet.accessKey || sameAddress(key.address, wallet.accessKey),
  )
  const accessKey = selected?.key.address
  const publication = selected?.publication

  return {
    account,
    activeAccessKeys: accessKeys.length,
    ...(accessKey ? { accessKey } : {}),
    chainId,
    message: publication === 'published'
      ? 'Tempo Wallet access key ready.'
      : publication === 'pending'
        ? 'Tempo Wallet access key pending publication.'
      : wallet.accessKey
        ? 'Configured Tempo Wallet access key is not available locally.'
        : 'Create a Tempo Wallet access key with mpp_wallet_setup.',
    network,
    ...(publication ? { publication } : {}),
    ready: publication === 'published',
    ...(wallet.accessKey ? { requestedAccessKey: wallet.accessKey } : {}),
    source: 'wallet',
    wallet: 'tempo',
  }
}

async function availableAccessKeys(
  provider: TempoProviderInstance,
  account: `0x${string}`,
  chainId: number,
) {
  const keys = provider.store.accessKeys.list({ account, chainId })
  const accounts = await Promise.all(
    keys.map((key) =>
      provider.store.accessKeys.get({
        accessKey: key.address,
        account,
        chainId: key.chainId,
      }),
    ),
  )
  const localKeys = keys.filter((_, index) => accounts[index])
  const publications = await Promise.all(
    localKeys.map((key) =>
      provider.getAccessKeyStatus({
        accessKey: key.address,
        address: account,
        chainId,
      }),
    ),
  )
  return localKeys.flatMap((key, index) => {
    const publication = publications[index]
    if (publication !== 'pending' && publication !== 'published') return []
    return [{ key, publication }]
  })
}

async function publishTempoAccessKey(
  provider: TempoProviderInstance,
  wallet: TempoWalletConfig,
  network: TempoNetwork,
  status: WalletStatus,
) {
  if (status.ready) return status
  if (!status.account || !status.accessKey || status.publication !== 'pending')
    throw new Error(status.message)

  const chainId = tempoNetworks[network].id
  const token = usdce.addresses[chainId]
  const call = Actions.token.transfer.call({
    amount: 0n,
    to: status.account,
    token,
  })
  await provider.request({
    method: 'eth_sendTransactionSync',
    params: [{ calls: [call], chainId: toHex(chainId) }],
  })

  const published = await getTempoWalletStatus(provider, wallet, network)
  if (!published.ready)
    throw new Error(`Tempo Wallet access key was not published on ${network}.`)
  return published
}

function readPrivateKey(
  value: unknown,
  name = 'wallet.privateKey',
): `0x${string}` | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`${name} must be a 32-byte hex private key.`)
  return value as `0x${string}`
}

function readWalletConfig(value: unknown): WalletConfig {
  if (value === undefined) return { type: 'tempo', ...readEnvWalletConfig() }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('wallet must be an object.')

  const input = value as Record<string, unknown>
  const type = input.type === undefined || input.type === 'tempo' ? 'tempo' : undefined
  if (!type) throw new Error(`Unsupported wallet type "${String(input.type)}".`)

  const accessKey = readAddress(input.accessKey)
  const privateKey = readPrivateKey(input.privateKey)
  const storagePath = typeof input.storagePath === 'string' ? input.storagePath : undefined
  if (accessKey && privateKey)
    throw new Error('Configure either wallet.accessKey or wallet.privateKey, not both.')

  return {
    type,
    ...(accessKey ? { accessKey } : {}),
    ...(privateKey ? { privateKey } : {}),
    ...(storagePath ? { storagePath } : {}),
  }
}

function readEnvWalletConfig(): Partial<TempoWalletConfig> {
  const privateKey = readPrivateKey(process.env.TEMPO_PRIVATE_KEY, 'TEMPO_PRIVATE_KEY')
  return privateKey ? { privateKey } : {}
}

function readAddress(value: unknown): `0x${string}` | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error('wallet.accessKey must be a 20-byte hex address.')
  return value as `0x${string}`
}

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase()
}

function walletKey(wallet: TempoWalletConfig) {
  return JSON.stringify({
    accessKey: wallet.accessKey,
    privateKey: wallet.privateKey,
    storagePath: wallet.storagePath ?? 'default',
  })
}

function mppxKey(wallet: TempoWalletConfig) {
  return JSON.stringify(
    wallet.privateKey
      ? { privateKey: wallet.privateKey, source: 'tempo' }
      : {
          accessKey: wallet.accessKey,
          source: 'tempo',
          storagePath: wallet.storagePath ?? 'default',
        },
  )
}

function setupKey(wallet: TempoWalletConfig, network: TempoNetwork) {
  return `${walletKey(wallet)}:${network}`
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
