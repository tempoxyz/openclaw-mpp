import { Mppx, tempo } from 'mppx/client'
import { createClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoTestnet } from 'viem/chains'

export type PluginConfig = {
  allowedOrigins?: string[]
  enabled?: boolean
  privateKey?: `0x${string}`
  rpcUrl?: string
}

type MppxClient = ReturnType<typeof Mppx.create>

let cached:
  | {
      client: MppxClient
      key: string
    }
  | undefined

export function normalizeConfig(input: Record<string, unknown> | undefined): PluginConfig {
  const envPrivateKey = process.env.MPP_PRIVATE_KEY
  const envOrigins = process.env.MPP_ALLOWED_ORIGINS
  const envRpcUrl = process.env.MPP_RPC_URL

  return {
    allowedOrigins: readStringArray(input?.allowedOrigins) ?? readOriginEnv(envOrigins),
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : true,
    privateKey:
      readHexKey(input?.privateKey) ??
      readHexKey(envPrivateKey),
    rpcUrl: readUrl(input?.rpcUrl) ?? readUrl(envRpcUrl),
  }
}

export function createMppx(config: PluginConfig) {
  if (config.enabled === false) throw new Error('MPP is disabled.')
  if (!config.privateKey) {
    throw new Error('Configure plugins.entries.mpp.config.privateKey or MPP_PRIVATE_KEY.')
  }
  if (!config.allowedOrigins?.length) {
    throw new Error('Configure plugins.entries.mpp.config.allowedOrigins or MPP_ALLOWED_ORIGINS.')
  }

  const key = JSON.stringify({
    allowedOrigins: config.allowedOrigins ?? [],
    privateKey: config.privateKey,
    rpcUrl: config.rpcUrl,
  })

  if (cached?.key === key) return cached.client

  const account = privateKeyToAccount(config.privateKey)
  const rpcUrl = config.rpcUrl
  const client = Mppx.create({
    acceptPaymentPolicy: { origins: config.allowedOrigins },
    methods: [
      tempo({
        account,
        ...(rpcUrl
          ? {
              getClient: ({ chainId }) =>
                createClient({
                  account,
                  chain: {
                    ...tempoTestnet,
                    id: chainId ?? tempoTestnet.id,
                    rpcUrls: { default: { http: [rpcUrl] } },
                  },
                  transport: http(rpcUrl),
                }),
            }
          : {}),
      }),
    ],
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

function readUrl(value: unknown) {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.href
  } catch {
    return undefined
  }
}
