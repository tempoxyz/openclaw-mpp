import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
} from 'openclaw/plugin-sdk/plugin-entry'
import { Type } from 'typebox'
import { createMppx, normalizeConfig } from './mpp.js'

const configSchema = buildJsonPluginConfigSchema({
  type: 'object',
  additionalProperties: false,
  properties: {
    allowedOrigins: {
      type: 'array',
      description: 'Origins this plugin may pay.',
      items: { type: 'string' },
    },
    enabled: {
      type: 'boolean',
      description: 'Enable payment-aware fetch at startup.',
    },
    privateKey: {
      type: 'string',
      description: 'Development-only Tempo account private key.',
    },
    rpcUrl: {
      type: 'string',
      description: 'Optional Tempo RPC URL override.',
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

type FetchInput = {
  body?: string
  headers?: Record<string, string>
  method?: string
  url: string
}

export default definePluginEntry({
  id: 'mpp',
  name: 'MPP',
  description: 'Makes OpenClaw HTTP requests payment-aware with MPP.',
  configSchema,
  register(api) {
    const config = normalizeConfig(api.pluginConfig)

    if (api.registrationMode === 'full' && config.enabled !== false) {
      try {
        createMppx(config)
        api.logger.info('MPP payment-aware fetch initialized.')
      } catch (error) {
        api.logger.warn(formatError(error))
      }
    }

    api.registerTool({
      name: 'mpp_fetch',
      label: 'MPP fetch',
      description: 'Fetch an HTTP URL with MPP payment handling.',
      parameters: requestInitSchema,
      async execute(_toolCallId, params, signal) {
        signal?.throwIfAborted()
        const input = readFetchInput(params)
        createMppx(normalizeConfig(api.pluginConfig))
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

function formatError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
