import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { normalizeConfig } from '../dist/mpp.js'

const originalTempoPrivateKey = process.env.TEMPO_PRIVATE_KEY
const originalAllowedOrigins = process.env.MPP_ALLOWED_ORIGINS
const key = `0x${'1'.repeat(64)}`

afterEach(() => {
  restoreEnv('TEMPO_PRIVATE_KEY', originalTempoPrivateKey)
  restoreEnv('MPP_ALLOWED_ORIGINS', originalAllowedOrigins)
})

test('normalizes environment configuration', () => {
  process.env.TEMPO_PRIVATE_KEY = key
  process.env.MPP_ALLOWED_ORIGINS = 'https://mpp.dev, https://api.example.com '

  assert.deepEqual(normalizeConfig(undefined), {
    allowedOrigins: ['https://mpp.dev', 'https://api.example.com'],
    enabled: true,
    tempoPrivateKey: key,
  })
})

test('plugin allowed origins override environment origins', () => {
  process.env.TEMPO_PRIVATE_KEY = key
  process.env.MPP_ALLOWED_ORIGINS = 'https://env.example.com'

  assert.deepEqual(
    normalizeConfig({
      allowedOrigins: ['https://config.example.com'],
      enabled: false,
    }),
    {
      allowedOrigins: ['https://config.example.com'],
      enabled: false,
      tempoPrivateKey: key,
    },
  )
})

test('ignores malformed private keys', () => {
  process.env.TEMPO_PRIVATE_KEY = '0x123'

  assert.equal(normalizeConfig(undefined).tempoPrivateKey, undefined)
})

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
