import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { createMppx, normalizeConfig } from '../dist/mpp.js'

const originalTempoPrivateKey = process.env.TEMPO_PRIVATE_KEY
const originalFetch = globalThis.fetch
const key = `0x${'1'.repeat(64)}`

afterEach(() => {
  restoreEnv('TEMPO_PRIVATE_KEY', originalTempoPrivateKey)
  globalThis.fetch = originalFetch
})

test('normalizes environment configuration', () => {
  process.env.TEMPO_PRIVATE_KEY = key

  assert.deepEqual(normalizeConfig(undefined), {
    enabled: true,
    tempoPrivateKey: key,
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
      tempoPrivateKey: key,
    },
  )
})

test('ignores malformed private keys', () => {
  process.env.TEMPO_PRIVATE_KEY = '0x123'

  assert.equal(normalizeConfig(undefined).tempoPrivateKey, undefined)
})

test('installs payment-aware fetch', async () => {
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ headers: requestHeaders(input, init) })
    return new Response('ok')
  }

  createMppx({
    tempoPrivateKey: key,
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
