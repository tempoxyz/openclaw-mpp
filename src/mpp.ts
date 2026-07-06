import { Mppx, tempo } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'

export type PluginConfig = {
  allowedOrigins?: string[]
  enabled?: boolean
  tempoPrivateKey?: `0x${string}`
}

type MppxClient = ReturnType<typeof Mppx.create>

let cached:
  | {
      client: MppxClient
      key: string
    }
  | undefined

export function normalizeConfig(input: Record<string, unknown> | undefined): PluginConfig {
  const envTempoPrivateKey = process.env.TEMPO_PRIVATE_KEY
  const envOrigins = process.env.MPP_ALLOWED_ORIGINS

  return {
    allowedOrigins: readStringArray(input?.allowedOrigins) ?? readOriginEnv(envOrigins),
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
    allowedOrigins: config.allowedOrigins ?? [],
    tempoPrivateKey: config.tempoPrivateKey,
  })

  if (cached?.key === key) return cached.client

  const account = privateKeyToAccount(config.tempoPrivateKey)
  const client = Mppx.create({
    ...(config.allowedOrigins?.length
      ? { acceptPaymentPolicy: { origins: config.allowedOrigins } }
      : {}),
    methods: [tempo({ account })],
  })

  cached = { client, key }
  return client
}

function readHexKey(value: unknown): `0x${string}` | undefined {
  if (typeof value !== 'string') return undefined
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return undefined
  return value as `0x${string}`
}

function readOriginEnv(value: string | undefined) {
  if (!value) return undefined
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length ? items : undefined
}
