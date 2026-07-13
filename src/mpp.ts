import { Mppx, tempo } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'

export type PluginConfig = {
  enabled?: boolean
  tempoPrivateKey?: `0x${string}`
}

type MppxClient = ReturnType<typeof Mppx.create>
type PaymentFetch = typeof globalThis.fetch & {
  [originalFetch]?: typeof globalThis.fetch
}

const originalFetch = Symbol('mpp.openclaw.originalFetch')

let cached:
  | {
      client: MppxClient
      key: string
    }
  | undefined

export function normalizeConfig(input: Record<string, unknown> | undefined): PluginConfig {
  const envTempoPrivateKey = process.env.TEMPO_PRIVATE_KEY

  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : true,
    tempoPrivateKey: readHexKey(envTempoPrivateKey),
  }
}

export function createMppx(config: PluginConfig) {
  if (config.enabled === false) throw new Error('MPP is disabled.')
  if (!config.tempoPrivateKey) {
    throw new Error('Configure TEMPO_PRIVATE_KEY in the OpenClaw gateway environment.')
  }

  const key = JSON.stringify({
    tempoPrivateKey: config.tempoPrivateKey,
  })

  if (cached?.key === key) return cached.client

  const fetch = unwrapFetch(globalThis.fetch)
  const account = privateKeyToAccount(config.tempoPrivateKey)
  const client = Mppx.create({
    fetch,
    methods: [tempo({ account, mode: 'push' })],
    polyfill: false,
  })
  ;(client.fetch as PaymentFetch)[originalFetch] = fetch

  globalThis.fetch = client.fetch

  cached = { client, key }
  return client
}

function readHexKey(value: unknown): `0x${string}` | undefined {
  if (typeof value !== 'string') return undefined
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return undefined
  return value as `0x${string}`
}

function unwrapFetch(fetch: typeof globalThis.fetch) {
  return (fetch as PaymentFetch)[originalFetch] ?? fetch
}
