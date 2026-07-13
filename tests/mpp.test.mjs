import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { createMppx, getWalletStatus, normalizeConfig, selectAccessKey, setupWallet } from '../dist/mpp.js'

const originalTempoPrivateKey = process.env.TEMPO_PRIVATE_KEY
const originalFetch = globalThis.fetch
const key = `0x${'1'.repeat(64)}`
const rootA = `0x${'a'.repeat(40)}`
const rootB = `0x${'b'.repeat(40)}`
const accessKeyA = `0x${'2'.repeat(40)}`
const accessKeyB = `0x${'3'.repeat(40)}`

afterEach(() => {
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

test('ignores malformed private keys', () => {
  process.env.TEMPO_PRIVATE_KEY = '0x123'

  assert.deepEqual(normalizeConfig(undefined), {
    enabled: true,
    wallet: { type: 'tempo' },
  })
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

test('requires a payment source', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-'))

  await assert.rejects(
    createMppx({
      wallet: {
        type: 'tempo',
        storagePath: join(storageDir, 'wallet.json'),
      },
    }),
    /Connect Tempo Wallet/,
  )
})

test('selects access keys for the active Tempo account', () => {
  const state = {
    accessKeys: [
      { access: rootB, address: accessKeyB, chainId: 4217 },
      { access: rootA, address: accessKeyA, chainId: 4217 },
    ],
    accounts: [{ address: rootA }, { address: rootB }],
    activeAccount: 0,
    chainId: 4217,
  }

  assert.equal(selectAccessKey(state), accessKeyA)
  assert.equal(selectAccessKey({ ...state, activeAccount: 1 }), accessKeyB)
  assert.throws(() => selectAccessKey(state, accessKeyB), /not available locally/)
})

test('reports Tempo Wallet status from local storage', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'openclaw-mpp-wallet-'))
  const storagePath = join(storageDir, 'wallet.json')
  await writeWalletStore(storagePath, {
    accessKeys: [
      { access: rootB, address: accessKeyB, chainId: 4217, keyType: 'secp256k1' },
      { access: rootA, address: accessKeyA, chainId: 4217, keyType: 'secp256k1' },
    ],
    accounts: [{ address: rootA }, { address: rootB }],
    activeAccount: 0,
    chainId: 4217,
  })

  const status = await getWalletStatus({
    wallet: {
      type: 'tempo',
      storagePath,
    },
  })

  assert.deepEqual(status, {
    accessKey: accessKeyA,
    account: rootA,
    activeAccessKeys: 1,
    chainId: 4217,
    message: 'Tempo Wallet access key ready.',
    ready: true,
    source: 'wallet',
    wallet: 'tempo',
  })
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

  const status = await getWalletStatus({
    wallet: {
      accessKey: accessKeyB,
      type: 'tempo',
      storagePath,
    },
  })

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
  globalThis.fetch = async (input, init) => {
    calls.push({ headers: requestHeaders(input, init) })
    return new Response('ok')
  }

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
})

function requestHeaders(input, init) {
  return new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
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
