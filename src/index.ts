import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
} from 'openclaw/plugin-sdk/plugin-entry'
import { Type, type Static } from 'typebox'
import { registerCli } from './cli.js'
import {
  beginWalletSetup,
  closeMppx,
  enablePaymentAwareFetch,
  getWalletStatus,
  normalizeConfig,
} from './mpp.js'
import { parseTempoNetwork } from './network.js'
import { resolveSetupPolicy } from './setup.js'

const configSchema = buildJsonPluginConfigSchema({
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: {
      type: 'boolean',
      description: 'Enable payment-aware fetch at startup.',
    },
    wallet: {
      type: 'object',
      additionalProperties: false,
      description: 'Wallet source used to pay MPP challenges.',
      properties: {
        type: {
          type: 'string',
          enum: ['tempo'],
          description: 'Wallet provider.',
        },
        accessKey: {
          type: 'string',
          pattern: '^0x[0-9a-fA-F]{40}$',
          description: 'Specific Tempo Wallet access key address to use.',
        },
        privateKey: {
          type: 'string',
          pattern: '^0x[0-9a-fA-F]{64}$',
          description: 'Tempo private key. Prefer TEMPO_PRIVATE_KEY for local use.',
        },
        storagePath: {
          type: 'string',
          description: 'Path to the Tempo Wallet store.',
        },
      },
    },
  },
})

const requestInitSchema = Type.Object(
  {
    body: Type.Optional(Type.String()),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    method: Type.Optional(Type.String()),
    url: Type.String({ description: 'HTTP URL to fetch.' }),
  },
  { additionalProperties: false },
)
const walletSetupSchema = Type.Object(
  {
    expires: Type.Optional(
      Type.String({ description: 'Access key lifetime, such as 24h or 7d.' }),
    ),
    limit: Type.Optional(
      Type.String({ description: 'USDC spending limit, such as USDC=25.' }),
    ),
    network: Type.Optional(
      Type.Union([Type.Literal('mainnet'), Type.Literal('testnet')], {
        description: 'Tempo network for the access key.',
      }),
    ),
    showDeposit: Type.Optional(
      Type.Boolean({ description: 'Show the Tempo Wallet deposit flow during setup.' }),
    ),
  },
  { additionalProperties: false },
)
const walletStatusSchema = Type.Object(
  {
    network: Type.Optional(Type.Union([Type.Literal('mainnet'), Type.Literal('testnet')])),
  },
  { additionalProperties: false },
)

type FetchInput = Static<typeof requestInitSchema>
type WalletSetupInput = Static<typeof walletSetupSchema>

export default definePluginEntry({
  id: 'mpp',
  name: 'MPP',
  description: 'Makes OpenClaw HTTP requests payment-aware with MPP.',
  configSchema,
  register(api) {
    registerCli(api)

    if (api.registrationMode === 'full' && api.pluginConfig?.enabled !== false) {
      api.registerService({
        id: 'mpp',
        async start() {
          try {
            const enabled = await enablePaymentAwareFetch(normalizeConfig(api.pluginConfig))
            if (enabled) api.logger.info('MPP payment-aware fetch initialized.')
            else api.logger.info('MPP free fetch initialized; connect a wallet to pay Challenges.')
          } catch (error) {
            api.logger.warn(`MPP payment-aware fetch could not initialize. ${formatError(error)}`)
          }
        },
        stop: closeMppx,
      })
    }

    api.registerTool({
      name: 'mpp_fetch',
      label: 'MPP fetch',
      description: 'Fetch an HTTP URL with MPP payment handling.',
      parameters: requestInitSchema,
      async execute(_toolCallId, params, signal) {
        signal?.throwIfAborted()
        const input = readFetchInput(params)
        await enablePaymentAwareFetch(normalizeConfig(api.pluginConfig))
        const response = await fetch(input.url, {
          body: input.body,
          headers: input.headers,
          method: input.method,
          signal,
        })

        const text = await response.text()
        const headers = Object.fromEntries(response.headers.entries())

        return {
          content: [{ type: 'text', text }],
          details: {
            body: text,
            headers,
            status: response.status,
            url: response.url,
          },
        }
      },
    })

    api.registerTool({
      name: 'mpp_wallet_status',
      label: 'MPP wallet status',
      description: 'Show the configured MPP payment account and access key.',
      parameters: walletStatusSchema,
      async execute(_toolCallId, params, signal) {
        signal?.throwIfAborted()
        const status = await getWalletStatus(
          normalizeConfig(api.pluginConfig),
          readNetwork(params),
        )
        return jsonToolResult(status)
      },
    })

    api.registerTool({
      name: 'mpp_wallet_setup',
      label: 'MPP wallet setup',
      description: 'Connect Tempo Wallet and authorize an access key for MPP payments.',
      parameters: walletSetupSchema,
      async execute(_toolCallId, params, signal) {
        signal?.throwIfAborted()
        const config = normalizeConfig(api.pluginConfig)
        const status = await beginWalletSetup(
          config,
          resolveSetupPolicy(readWalletSetupInput(params)),
        )
        return jsonToolResult(status)
      },
    })
  },
})

function readFetchInput(params: unknown): FetchInput {
  if (!params || typeof params !== 'object') {
    throw new Error('mpp_fetch params must be an object.')
  }

  const value = params as Record<string, unknown>
  if (typeof value.url !== 'string') throw new Error('mpp_fetch requires a URL.')

  return {
    body: typeof value.body === 'string' ? value.body : undefined,
    headers: readHeaders(value.headers),
    method: typeof value.method === 'string' ? value.method : undefined,
    url: value.url,
  }
}

function readHeaders(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const headers: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') headers[key] = item
  }

  return Object.keys(headers).length ? headers : undefined
}

function readWalletSetupInput(params: unknown): WalletSetupInput {
  if (!params || typeof params !== 'object') return {}
  const value = params as Record<string, unknown>
  return {
    expires: typeof value.expires === 'string' ? value.expires : undefined,
    limit: typeof value.limit === 'string' ? value.limit : undefined,
    network: readNetwork(value),
    showDeposit: typeof value.showDeposit === 'boolean' ? value.showDeposit : undefined,
  }
}

function readNetwork(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  return parseTempoNetwork((value as Record<string, unknown>).network)
}

function jsonToolResult(details: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(details) }],
    details,
  }
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
