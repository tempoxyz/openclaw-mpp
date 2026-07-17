import { parseUnits, toHex } from 'viem'
import { tempo } from 'viem/tempo/chains'
import { usdce } from 'viem/tokens'

export type SetupInput = {
  expires?: string
  limit?: string
  showDeposit?: boolean
}

export type SetupPolicy = {
  expiry: number
  limits: readonly [{ limit: `0x${string}`; token: `0x${string}` }]
  showDeposit: false | {
    amount: string
    displayName: string
    token: string
  }
}

const defaultExpiry = '7d'
const defaultLimit = 'USDC=10'
const tempoUsdc = usdce.addresses[tempo.id]

export function resolveSetupPolicy(input: SetupInput = {}, now = Date.now()): SetupPolicy {
  const amount = parseLimit(input.limit ?? defaultLimit)
  return {
    expiry: Math.floor(now / 1_000) + parseDuration(input.expires ?? defaultExpiry),
    limits: [{ limit: toHex(parseUnits(amount, usdce.decimals)), token: tempoUsdc }],
    showDeposit:
      input.showDeposit === false
        ? false
        : {
            amount,
            displayName: 'OpenClaw',
            token: 'USDC',
          },
  }
}

function parseDuration(value: string) {
  const match = /^(\d+)(m|h|d)$/.exec(value)
  if (!match || Number(match[1]) === 0)
    throw new Error('Expiry must use a positive duration such as 30m, 24h, or 7d.')

  const units = { d: 86_400, h: 3_600, m: 60 } as const
  const unit = units[match[2] as keyof typeof units]
  return Number(match[1]) * unit
}

function parseLimit(value: string) {
  const match = /^USDC=(\d+(?:\.\d{1,6})?)$/i.exec(value)
  if (!match || Number(match[1]) <= 0)
    throw new Error('Limit must use USDC=<amount>, for example USDC=25.')
  return match[1]!
}
