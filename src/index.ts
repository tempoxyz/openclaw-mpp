import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
} from 'openclaw/plugin-sdk/plugin-entry'
import { Type } from 'typebox'
import { registerCli } from './cli.js'
import {
  beginWalletSetup,
  closeMppx,
  createMppx,
  getWalletStatus,
  normalizeConfig,
} from './mpp.js'
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
          description: 'Specific Tempo Wallet access key address to use.',
        },
        privateKey: {
          type: 'string',
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
    showDeposit: Type.Optional(
      Type.Boolean({ description: 'Show the Tempo Wallet deposit flow during setup.' }),
    ),
  },
  { additionalProperties: false },
)
const emptySchema = Type.Object({}, { additionalProperties: false })

type FetchInput = {
  body?: string
  headers?: Record<string, string>
  method?: string
  url: string
}
type WalletSetupInput = {
  expires?: string
  limit?: string
  showDeposit?: boolean
}

export default definePluginEntry({
  id: 'mpp',
  name: 'MPP',
  description: 'Makes OpenClaw HTTP requests payment-aware with MPP.',
  configSchema,
  register(api) {
    registerCli(api)
    const config = normalizeConfig(api.pluginConfig)

    if (api.registrationMode === 'full' && config.enabled !== false) {
      api.registerService({
        id: 'mpp',
        async start() {
          try {
            await createMppx(config)
            api.logger.info('MPP payment-aware fetch initialized.')
          } catch (error) {
            api.logger.warn(`MPP is installed but has no payment account. ${formatError(error)}`)
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
        await createMppx(normalizeConfig(api.pluginConfig))
        const response = await fetch(input.url, {
          body: input.body,
          headers: input.headers,
          method: input.method,
        })

        const contentType = response.headers.get('content-type') ?? ''
        const text = contentType.includes('application/json')
          ? JSON.stringify(await response.json())
          : await response.text()
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
      description: 'Show whether the configured MPP wallet can pay challenges.',
      parameters: emptySchema,
      async execute(_toolCallId, _params, signal) {
        signal?.throwIfAborted()
        const status = await getWalletStatus(normalizeConfig(api.pluginConfig))
        return jsonToolResult(status)
      },
    })

    api.registerTool({
      name: 'mpp_wallet_setup',
      label: 'MPP wallet setup',
      description: 'Create a Tempo Wallet access key for MPP payments.',
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
    showDeposit: typeof value.showDeposit === 'boolean' ? value.showDeposit : undefined,
  }
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
