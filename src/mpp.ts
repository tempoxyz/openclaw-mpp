import { Provider as TempoProvider, Storage as TempoStorage } from 'accounts/cli'
import { Mppx, tempo } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'
import { tempo as tempoChain } from 'viem/tempo/chains'

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
  cacheKey: {
    source: 'tempo'
    accessKey?: `0x${string}`
    chainId?: number
    privateKey?: `0x${string}`
    storagePath?: string
  }
  parameters: Partial<TempoParameters>
}
export type WalletStatus = {
  accessKey?: `0x${string}`
  account?: `0x${string}`
  activeAccessKeys?: number
  chainId?: number
  message: string
  ready: boolean
  requestedAccessKey?: `0x${string}`
  source: 'privateKey' | 'wallet'
  wallet: 'tempo'
}

type MppxClient = ReturnType<typeof Mppx.create>
type TempoParameters = NonNullable<Parameters<typeof tempo>[0]>
type PaymentFetch = typeof globalThis.fetch & {
  [originalFetch]?: typeof globalThis.fetch
}
type StoredAccessKey = {
  access?: string
  address?: string
  chainId?: number
}
type StoredAccount = {
  address: string
}
type TempoStore = {
  getState: () => {
    accessKeys: readonly StoredAccessKey[]
    accounts: readonly StoredAccount[]
    activeAccount: number
    chainId: number
  }
  persist?: {
    hasHydrated?: () => boolean
    rehydrate?: () => Promise<void> | void
  }
  setState: (state: { chainId: number }) => void
}
type TempoProviderInstance = {
  getAccount: () => TempoParameters['account']
  getMppxParameters: (options: { accessKey?: `0x${string}` }) => Partial<TempoParameters>
  request: (request: {
    method: 'wallet_authorizeAccessKey'
    params: [{ expiry: number; showDeposit?: boolean | undefined }]
  }) => Promise<{
    keyAuthorization: { address?: string | undefined; keyId?: string | undefined }
    rootAddress: string
  }>
  store: TempoStore
}

const originalFetch = Symbol('mpp.openclaw.originalFetch')
const defaultAccessKeyTtlSeconds = 24 * 60 * 60

let cached:
  | {
      client: MppxClient
      key: string
    }
  | undefined

export function normalizeConfig(input: Record<string, unknown> | undefined): PluginConfig {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : true,
    wallet: readWalletConfig(input?.wallet),
  }
}

export async function createMppx(config: PluginConfig) {
  if (config.enabled === false) throw new Error('MPP is disabled.')
  const source = await resolveWalletSource(config)
  const key = JSON.stringify(source.cacheKey)

  if (cached?.key === key) return cached.client

  const fetch = unwrapFetch(globalThis.fetch)
  const client = Mppx.create({
    fetch,
    methods: [tempo({ ...source.parameters, mode: 'push' })],
    polyfill: false,
  })
  ;(client.fetch as PaymentFetch)[originalFetch] = fetch

  globalThis.fetch = client.fetch

  cached = { client, key }
  return client
}

export async function getWalletStatus(config: PluginConfig): Promise<WalletStatus> {
  const wallet = config.wallet
  if (wallet.privateKey) {
    const account = privateKeyToAccount(wallet.privateKey)
    return {
      account: account.address,
      message: 'Tempo private key configured.',
      ready: true,
      source: 'privateKey',
      wallet: 'tempo',
    }
  }

  const provider = await createTempoProvider(wallet)
  return getTempoWalletStatus(provider, wallet)
}

export async function setupWallet(
  config: PluginConfig,
  options: { showDeposit?: boolean | undefined } = {},
): Promise<WalletStatus> {
  const wallet = config.wallet
  if (wallet.privateKey) return getWalletStatus(config)

  const provider = await createTempoProvider(wallet)
  const status = getTempoWalletStatus(provider, wallet)
  if (wallet.accessKey) {
    if (status.ready) return status
    throw new Error(
      'Configured Tempo Wallet access key is not available locally. Remove wallet.accessKey to create a new key.',
    )
  }

  const parameters = {
    expiry: Math.floor(Date.now() / 1000) + defaultAccessKeyTtlSeconds,
    ...(typeof options.showDeposit === 'boolean' ? { showDeposit: options.showDeposit } : {}),
  }
  await provider.request({
    method: 'wallet_authorizeAccessKey',
    params: [parameters],
  })

  return getTempoWalletStatus(provider, wallet)
}

async function resolveWalletSource(config: PluginConfig): Promise<WalletSource> {
  const wallet = config.wallet
  if (wallet.privateKey)
    return {
      cacheKey: {
        privateKey: wallet.privateKey,
        source: 'tempo',
      },
      parameters: {
        account: privateKeyToAccount(wallet.privateKey),
      },
    }

  const provider = await createTempoProvider(wallet)
  const accessKey = selectAccessKey(provider.store.getState(), wallet.accessKey)
  return {
    cacheKey: {
      accessKey,
      chainId: tempoChain.id,
      source: 'tempo',
      storagePath: wallet.storagePath ?? 'default',
    },
    parameters: {
      account: provider.getAccount(),
      ...provider.getMppxParameters({ accessKey }),
    },
  }
}

async function createTempoProvider(wallet: TempoWalletConfig) {
  const provider = TempoProvider.create({
    chains: [tempoChain],
    mpp: false,
    storage: wallet.storagePath
      ? TempoStorage.filesystem({ path: wallet.storagePath })
      : TempoStorage.filesystem(),
  }) as TempoProviderInstance
  await hydrateStore(provider.store)
  provider.store.setState({ chainId: tempoChain.id })
  return provider
}

async function hydrateStore(store: TempoStore) {
  if (!store.persist?.rehydrate || store.persist.hasHydrated?.()) return
  await store.persist.rehydrate()
}

export function selectAccessKey(
  state: ReturnType<TempoStore['getState']>,
  requestedAccessKey: `0x${string}` | undefined,
) {
  const account = state.accounts[state.activeAccount]?.address
  if (!account)
    throw new Error('Connect Tempo Wallet or configure a Tempo private key before enabling MPP.')

  const accessKey = findAccessKey(state, account, requestedAccessKey)

  if (!accessKey?.address) {
    if (requestedAccessKey)
      throw new Error(`Tempo Wallet access key ${requestedAccessKey} is not available locally.`)
    throw new Error('Create a Tempo Wallet access key before enabling MPP payments.')
  }

  return accessKey.address as `0x${string}`
}

function getTempoWalletStatus(
  provider: TempoProviderInstance,
  wallet: TempoWalletConfig,
): WalletStatus {
  const state = provider.store.getState()
  const account = state.accounts[state.activeAccount]?.address as `0x${string}` | undefined
  if (!account)
    return {
      chainId: state.chainId,
      message: 'Connect Tempo Wallet or run mpp_wallet_setup.',
      ready: false,
      ...(wallet.accessKey ? { requestedAccessKey: wallet.accessKey } : {}),
      source: 'wallet',
      wallet: 'tempo',
    }

  const accessKeys = state.accessKeys.filter((key) => isMatchingAccessKey(key, account))
  const accessKey = findAccessKey(state, account, wallet.accessKey)?.address as
    | `0x${string}`
    | undefined

  return {
    account,
    activeAccessKeys: accessKeys.length,
    ...(accessKey ? { accessKey } : {}),
    chainId: state.chainId,
    message: accessKey
      ? 'Tempo Wallet access key ready.'
      : wallet.accessKey
        ? 'Configured Tempo Wallet access key is not available locally.'
        : 'Create a Tempo Wallet access key with mpp_wallet_setup.',
    ready: Boolean(accessKey),
    ...(wallet.accessKey ? { requestedAccessKey: wallet.accessKey } : {}),
    source: 'wallet',
    wallet: 'tempo',
  }
}

function findAccessKey(
  state: ReturnType<TempoStore['getState']>,
  account: string,
  requestedAccessKey: `0x${string}` | undefined,
) {
  return state.accessKeys.find((key) => {
    if (!isMatchingAccessKey(key, account)) return false
    if (requestedAccessKey) return sameAddress(key.address!, requestedAccessKey)
    return true
  }) as StoredAccessKey | undefined
}

function isMatchingAccessKey(key: StoredAccessKey, account: string) {
  if (!key.address) return false
  if (key.chainId !== undefined && key.chainId !== tempoChain.id) return false
  if (!key.access || !sameAddress(key.access, account)) return false
  return true
}

function readPrivateKey(value: unknown): `0x${string}` | undefined {
  if (typeof value !== 'string') return undefined
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return undefined
  return value as `0x${string}`
}

function readWalletConfig(value: unknown): WalletConfig {
  const env = readEnvWalletConfig()
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { type: 'tempo', ...env }

  const input = value as Record<string, unknown>
  const type = input.type === undefined || input.type === 'tempo' ? 'tempo' : undefined
  if (!type) throw new Error(`Unsupported wallet type "${String(input.type)}".`)

  const accessKey = readAddress(input.accessKey)
  const privateKey = readPrivateKey(input.privateKey) ?? env.privateKey
  const storagePath = typeof input.storagePath === 'string' ? input.storagePath : undefined

  return {
    type,
    ...(accessKey ? { accessKey } : {}),
    ...(privateKey ? { privateKey } : {}),
    ...(storagePath ? { storagePath } : {}),
  }
}

function readEnvWalletConfig(): Partial<TempoWalletConfig> {
  const privateKey = readPrivateKey(process.env.TEMPO_PRIVATE_KEY)
  return privateKey ? { privateKey } : {}
}

function readAddress(value: unknown): `0x${string}` | undefined {
  if (typeof value !== 'string') return undefined
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return undefined
  return value as `0x${string}`
}

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase()
}

function unwrapFetch(fetch: typeof globalThis.fetch) {
  return (fetch as PaymentFetch)[originalFetch] ?? fetch
}
