import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { Provider as TempoProvider } from 'accounts/cli'
import { Handler } from 'accounts/server'
import { KeyAuthorization } from 'ox/tempo'
import { Account } from 'viem/tempo'
import { tempo, tempoModerato } from 'viem/tempo/chains'
import {
  beginWalletSetup,
  closeMppx,
  createMppx,
  enablePaymentAwareFetch,
  getWalletStatus,
  normalizeConfig,
  setupWallet,
} from '../dist/mpp.js'
import { resolveSetupPolicy } from '../dist/setup.js'

const originalTempoPrivateKey = process.env.TEMPO_PRIVATE_KEY
const originalFetch = globalThis.fetch
const key = `0x${'1'.repeat(64)}`
const rootA = `0x${'a'.repeat(40)}`
const rootB = `0x${'b'.repeat(40)}`
const accessPrivateKeyA = `0x${'2'.repeat(64)}`
const accessKeyA = Account.fromSecp256k1(accessPrivateKeyA).address
const accessKeyB = `0x${'3'.repeat(40)}`
const root = Account.fromSecp256k1(`0x${'9'.repeat(64)}`)
const publishRequests = []

afterEach(async () => {
  await closeMppx()
  publishRequests.length = 0
  restoreEnv('TEMPO_PRIVATE_KEY', originalTempoPrivateKey)
  globalThis.fetch = originalFetch
})

test('normalizes environment configuration', () => {
  process.env.TEMPO_PRIVATE_KEY = key

  assert.deepEqual(normalizeConfig(undefined), {
    enabled: true,
    wallet: {
      privateKey: key,
      type: 'tempo',
    },
  })
})

test('plugin config can disable initialization', () => {
  process.env.TEMPO_PRIVATE_KEY = key

  assert.deepEqual(
    normalizeConfig({
      enabled: false,
    }),
    {
      enabled: false,
      wallet: {
        privateKey: key,
        type: 'tempo',
      },
    },
  )
})

test('rejects malformed private keys', () => {
  process.env.TEMPO_PRIVATE_KEY = '0x123'

  assert.throws(() => normalizeConfig(undefined), /TEMPO_PRIVATE_KEY/)
  delete process.env.TEMPO_PRIVATE_KEY
  assert.throws(
    () => normalizeConfig({ wallet: { privateKey: '0x123', type: 'tempo' } }),
    /wallet.privateKey/,
  )
})

test('normalizes wallet configuration', () => {
  const accessKey = `0x${'2'.repeat(40)}`

  assert.deepEqual(
    normalizeConfig({
      wallet: {
        accessKey,
        type: 'tempo',
        storagePath: '/tmp/tempo-wallet.json',
      },
    }),
    {
      enabled: true,
      wallet: {
        accessKey,
        type: 'tempo',
        storagePath: '/tmp/tempo-wallet.json',
      },
    },
  )
})

test('explicit Tempo Wallet configuration does not use the environment private key', () => {
  process.env.TEMPO_PRIVATE_KEY = key

  assert.deepEqual(
    normalizeConfig({
      wallet: {
        accessKey: accessKeyA,
        type: 'tempo',
      },
    }),
    {
      enabled: true,
      wallet: {
        accessKey: accessKeyA,
        type: 'tempo',
      },
    },
  )
})

test('rejects ambiguous wallet configuration', () => {
  assert.throws(
    () =>
      normalizeConfig({
        wallet: {
          accessKey: accessKeyA,
          privateKey: key,
          type: 'tempo',
        },
      }),
    /either wallet.accessKey or wallet.privateKey/,
  )
})

test('requires a payment source', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-'))

  await assert.rejects(
    createMppx({
      wallet: {
        type: 'tempo',
        storagePath: join(storageDir, 'wallet.json'),
      },
    }),
    /openclaw mpp setup/,
  )
})

test('allows free requests without a payment source', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-free-'))
  const rawFetch = async () => new Response('free', { status: 200 })
  globalThis.fetch = rawFetch

  const enabled = await enablePaymentAwareFetch({
    wallet: {
      type: 'tempo',
      storagePath: join(storageDir, 'wallet.json'),
    },
  })
  const response = await fetch('https://api.example.com/free')

  assert.equal(enabled, false)
  assert.equal(globalThis.fetch, rawFetch)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'free')
})

test('returns an unpaid Challenge without a payment source', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-unpaid-'))
  const rawFetch = async () =>
    new Response('payment required', {
      headers: { 'www-authenticate': 'Payment realm="api.example.com"' },
      status: 402,
    })
  globalThis.fetch = rawFetch

  const enabled = await enablePaymentAwareFetch({
    wallet: {
      type: 'tempo',
      storagePath: join(storageDir, 'wallet.json'),
    },
  })
  const response = await fetch('https://api.example.com/paid')

  assert.equal(enabled, false)
  assert.equal(response.status, 402)
  assert.equal(response.headers.get('www-authenticate'), 'Payment realm="api.example.com"')
})

for (const [network, chain] of Object.entries({ mainnet: tempo, testnet: tempoModerato })) {
  test(`authorizes and hydrates a scoped ${network} access key`, async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-setup-'))
    const config = {
      enabled: false,
      wallet: {
        type: 'tempo',
        storagePath: join(storageDir, 'wallet.json'),
      },
    }
    const server = await createCodeAuthServer()
    const policy = resolveSetupPolicy({ network }, Date.now())

    try {
      const pending = await beginWalletSetup(config, {
        ...policy,
        host: `${server.url}/cli-auth`,
        pollIntervalMs: 10,
        providerFactory: createTestTempoProvider,
        timeoutMs: 2_000,
      })

      assert.equal(pending.ready, false)
      assert.equal(pending.setup, 'pending')
      assert.match(pending.setupUrl, new RegExp(`^${server.url}/cli-auth\\?code=`))

      const request = await approveDeviceCode(pending.setupUrl, server.url)
      assert.equal(request.expiry, policy.expiry)
      assert.equal(Number(request.chainId), chain.id)
      assert.deepEqual(request.limits, [
        { limit: '0x989680', token: policy.limits[0].token },
      ])
      assert.deepEqual(request.showDeposit, policy.showDeposit)

      const ready = await waitForWallet(config, network, {
        providerFactory: createTestTempoProvider,
      })
      assert.equal(ready.ready, true)
      assert.equal(ready.account, root.address)
      assert.equal(ready.network, network)
      assert.equal(ready.publication, 'published')
      assert.match(ready.accessKey, /^0x[0-9a-fA-F]{40}$/)
      assert.equal(publishRequests.length, 1)
      assert.equal(Number(BigInt(publishRequests[0].params[0].chainId)), chain.id)
      assert.equal(publishRequests[0].params[0].calls.length, 1)
      assert.equal(publishRequests[0].params[0].feeToken, undefined)

      const hydrated = await getWalletStatus(config, network, {
        providerFactory: createTestTempoProvider,
      })
      assert.equal(hydrated.accessKey, ready.accessKey)
    } finally {
      await server.close()
    }
  })
}

test('reports Tempo Wallet status from local storage', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-wallet-'))
  const storagePath = join(storageDir, 'wallet.json')
  await writeWalletStore(storagePath, {
    accessKeys: [
      { access: rootB, address: accessKeyB, chainId: 4217, keyType: 'secp256k1' },
      {
        access: rootA,
        address: accessKeyA,
        chainId: 4217,
        expiry: Math.floor(Date.now() / 1_000) + 3_600,
        keyType: 'secp256k1',
        privateKey: accessPrivateKeyA,
      },
    ],
    accounts: [{ address: rootA }, { address: rootB }],
    activeAccount: 0,
    chainId: 4217,
  })

  const status = await getWalletStatus(
    {
      wallet: {
        type: 'tempo',
        storagePath,
      },
    },
    'mainnet',
    { providerFactory: createTestTempoProvider },
  )

  assert.deepEqual(status, {
    accessKey: accessKeyA,
    account: rootA,
    activeAccessKeys: 1,
    chainId: 4217,
    message: 'Tempo Wallet access key ready.',
    network: 'mainnet',
    publication: 'published',
    ready: true,
    source: 'wallet',
    wallet: 'tempo',
  })
})

test('defaults status to mainnet and selects access keys by network', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-wallet-'))
  const storagePath = join(storageDir, 'wallet.json')
  const testnetPrivateKey = `0x${'5'.repeat(64)}`
  const testnetAccessKey = Account.fromSecp256k1(testnetPrivateKey).address
  await writeWalletStore(storagePath, {
    accessKeys: [
      {
        access: rootA,
        address: accessKeyA,
        chainId: 4217,
        keyType: 'secp256k1',
        privateKey: accessPrivateKeyA,
      },
      {
        access: rootA,
        address: testnetAccessKey,
        chainId: 42431,
        keyType: 'secp256k1',
        privateKey: testnetPrivateKey,
      },
    ],
    accounts: [{ address: rootA }],
    activeAccount: 0,
    chainId: 42431,
  })
  const config = { wallet: { type: 'tempo', storagePath } }

  const mainnet = await getWalletStatus(config, 'mainnet', {
    providerFactory: createTestTempoProvider,
  })
  const testnet = await getWalletStatus(config, 'testnet', {
    providerFactory: createTestTempoProvider,
  })

  assert.equal(mainnet.network, 'mainnet')
  assert.equal(mainnet.chainId, 4217)
  assert.equal(mainnet.accessKey, accessKeyA)
  assert.equal(testnet.network, 'testnet')
  assert.equal(testnet.chainId, 42431)
  assert.equal(testnet.accessKey, testnetAccessKey)
})

test('keeps a ready network usable when another publication fails', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-wallet-'))
  const storagePath = join(storageDir, 'wallet.json')
  const testnetPrivateKey = `0x${'5'.repeat(64)}`
  const testnetAccessKey = Account.fromSecp256k1(testnetPrivateKey).address
  await writeWalletStore(storagePath, {
    accessKeys: [
      {
        access: rootA,
        address: accessKeyA,
        chainId: tempo.id,
        keyType: 'secp256k1',
        privateKey: accessPrivateKeyA,
      },
      {
        access: rootA,
        address: testnetAccessKey,
        chainId: tempoModerato.id,
        keyAuthorization: {},
        keyType: 'secp256k1',
        privateKey: testnetPrivateKey,
      },
    ],
    accounts: [{ address: rootA }],
    activeAccount: 0,
    chainId: tempo.id,
  })

  const enabled = await enablePaymentAwareFetch(
    { wallet: { type: 'tempo', storagePath } },
    { providerFactory: createTestTempoProviderWithFailedTestnetPublication },
  )

  assert.equal(enabled, true)
  assert.equal(publishRequests.length, 1)
  assert.equal(Number(BigInt(publishRequests[0].params[0].chainId)), tempoModerato.id)
})

test('ignores expired Tempo Wallet access keys', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-wallet-'))
  const storagePath = join(storageDir, 'wallet.json')
  await writeWalletStore(storagePath, {
    accessKeys: [
      {
        access: rootA,
        address: accessKeyA,
        chainId: 4217,
        expiry: 1,
        keyType: 'secp256k1',
      },
    ],
    accounts: [{ address: rootA }],
    activeAccount: 0,
    chainId: 4217,
  })

  const status = await getWalletStatus(
    { wallet: { type: 'tempo', storagePath } },
    'mainnet',
    { providerFactory: createTestTempoProvider },
  )

  assert.equal(status.ready, false)
  assert.equal(status.activeAccessKeys, 0)
})

test('reports missing configured Tempo Wallet access key', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-wallet-'))
  const storagePath = join(storageDir, 'wallet.json')
  await writeWalletStore(storagePath, {
    accessKeys: [{ access: rootB, address: accessKeyB, chainId: 4217, keyType: 'secp256k1' }],
    accounts: [{ address: rootA }, { address: rootB }],
    activeAccount: 0,
    chainId: 4217,
  })

  const status = await getWalletStatus(
    {
      wallet: {
        accessKey: accessKeyB,
        type: 'tempo',
        storagePath,
      },
    },
    'mainnet',
    { providerFactory: createTestTempoProvider },
  )

  assert.equal(status.ready, false)
  assert.equal(status.message, 'Configured Tempo Wallet access key is not available locally.')
  assert.equal(status.activeAccessKeys, 0)
})

test('does not create a replacement for a missing configured access key', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-wallet-'))
  const storagePath = join(storageDir, 'wallet.json')
  await writeWalletStore(storagePath, {
    accessKeys: [{ access: rootB, address: accessKeyB, chainId: 4217, keyType: 'secp256k1' }],
    accounts: [{ address: rootA }, { address: rootB }],
    activeAccount: 0,
    chainId: 4217,
  })

  await assert.rejects(
    setupWallet({
      wallet: {
        accessKey: accessKeyB,
        type: 'tempo',
        storagePath,
      },
    }),
    /Remove wallet.accessKey to create a new key/,
  )
})

test('installs payment-aware fetch', async () => {
  const calls = []
  const rawFetch = async (input, init) => {
    calls.push({ headers: requestHeaders(input, init) })
    return new Response('ok')
  }
  globalThis.fetch = rawFetch

  await createMppx({
    wallet: {
      privateKey: key,
      type: 'tempo',
    },
  })

  const response = await fetch('https://pay.example.com/paid')

  assert.equal(response.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers.has('accept-payment'), true)
  await closeMppx()
  assert.equal(globalThis.fetch, rawFetch)
})

test('preserves Request method and body', async () => {
  let received
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    received = {
      body: await request.text(),
      method: request.method,
    }
    return new Response('ok')
  }
  await createMppx({ wallet: { privateKey: key, type: 'tempo' } })

  const response = await fetch(
    new Request('https://pay.example.com/free', {
      body: 'hello',
      method: 'POST',
    }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(received, { body: 'hello', method: 'POST' })
})

test('passes through free SSE responses', async () => {
  const upstream = new Response('event: update\nid: 7\nretry: 1000\ndata: hello\n\n', {
    headers: {
      'content-type': 'text/event-stream',
      'x-upstream': 'preserved',
    },
  })
  globalThis.fetch = async () => upstream
  await createMppx({ wallet: { privateKey: key, type: 'tempo' } })

  const response = await fetch('https://stream.example.com/free', {
    headers: { accept: 'text/event-stream' },
  })

  assert.equal(response.status, 200)
  assert.equal(response, upstream)
  assert.equal(response.headers.get('x-upstream'), 'preserved')
  assert.equal(await response.text(), 'event: update\nid: 7\nretry: 1000\ndata: hello\n\n')
})

function requestHeaders(input, init) {
  return new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
}

function createTestTempoProvider(options) {
  const provider = TempoProvider.create(options)
  const request = provider.request.bind(provider)

  provider.getAccessKeyStatus = async ({ accessKey, address, chainId }) => {
    const record = provider.store.accessKeys
      .list({ account: address, chainId })
      .find((key) => !accessKey || key.address.toLowerCase() === accessKey.toLowerCase())
    if (!record) return 'missing'
    return record.keyAuthorization ? 'pending' : 'published'
  }
  provider.request = async (input, options) => {
    if (input.method !== 'eth_sendTransactionSync') return request(input, options)

    publishRequests.push(input)
    const chainId = input.params[0].chainId
      ? Number(BigInt(input.params[0].chainId))
      : provider.store.getState().chainId
    provider.store.setState({
      accessKeys: provider.store
        .getState()
        .accessKeys.map((key) =>
          key.chainId === chainId ? { ...key, keyAuthorization: undefined } : key,
        ),
    })
    return { status: '0x1', transactionHash: `0x${'4'.repeat(64)}` }
  }

  return provider
}

function createTestTempoProviderWithFailedTestnetPublication(options) {
  const provider = createTestTempoProvider(options)
  const request = provider.request.bind(provider)

  provider.request = async (input, requestOptions) => {
    const chainId = input.params?.[0]?.chainId
    if (
      input.method === 'eth_sendTransactionSync' &&
      chainId &&
      Number(BigInt(chainId)) === tempoModerato.id
    ) {
      publishRequests.push(input)
      throw new Error('Testnet publication failed.')
    }
    return request(input, requestOptions)
  }

  return provider
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function writeWalletStore(path, state) {
  await writeFile(
    path,
    JSON.stringify({
      'tempo-cli.store': {
        state,
        version: 0,
      },
    }),
  )
}

async function approveDeviceCode(setupUrl, serverUrl) {
  const code = new URL(setupUrl).searchParams.get('code')
  const response = await originalFetch(`${serverUrl}/cli-auth/pending/${code}`)
  assert.equal(response.status, 200)
  const pending = await response.json()
  const limits = pending.limits?.map(({ limit, token }) => ({ limit: BigInt(limit), token }))
  const signed = await root.signKeyAuthorization(
    {
      accessKeyAddress: pending.accessKeyAddress,
      keyType: pending.keyType,
    },
    {
      chainId: BigInt(pending.chainId),
      expiry: pending.expiry,
      ...(limits ? { limits } : {}),
    },
  )
  const keyAuthorization = KeyAuthorization.toRpc(signed)
  const authorized = await originalFetch(`${serverUrl}/cli-auth`, {
    body: JSON.stringify({
      accountAddress: root.address,
      code,
      keyAuthorization: {
        ...keyAuthorization,
        address: keyAuthorization.keyId,
      },
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  assert.equal(authorized.status, 200, await authorized.text())
  return pending
}

async function createCodeAuthServer() {
  const handler = Handler.codeAuth({
    chains: [tempo, tempoModerato],
    path: '/cli-auth',
    policy: {
      validate({ expiry, limits }) {
        return {
          expiry,
          ...(limits ? { limits } : {}),
        }
      },
    },
    rateLimit: false,
  })
  const server = createServer(handler.listener)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to start auth server.')

  return {
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    url: `http://127.0.0.1:${address.port}`,
  }
}

async function waitForWallet(config, network, options) {
  const timeout = Date.now() + 5_000
  let status
  while (Date.now() < timeout) {
    status = await getWalletStatus(config, network, options)
    if (status.ready) return status
    if (status.setup === 'failed') throw new Error(status.message)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for wallet setup: ${JSON.stringify(status)}`)
}
