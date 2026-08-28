import { mach } from 'mppx/tempo'
import type { Address } from 'viem'
import { pathusd, usdce } from 'viem/tokens'
import { tempoNetworks } from './network.js'

type PaymentChallengeCandidate = {
  challenge: {
    intent: string
    method: string
    request: unknown
  }
}

export type BalanceReader = (parameters: {
  chainId: number
  token: Address
}) => Promise<bigint | undefined>

type ChargeSelectionPolicy = {
  allowedTokens?: readonly Address[] | undefined
  getBalance: BalanceReader
}

type RankedCandidate<candidate> = {
  candidate: candidate
  position: number
  rank: number
}

/** Orders Tempo charge offers by access-key authorization and available balances. */
export async function orderTempoChargeChallenges<
  candidate extends PaymentChallengeCandidate,
>(
  candidates: readonly candidate[],
  policy: ChargeSelectionPolicy,
): Promise<readonly candidate[]> {
  if (
    candidates.length === 0 ||
    !candidates.every(
      ({ challenge }) => challenge.method === 'tempo' && challenge.intent === 'charge',
    )
  )
    return candidates

  const authorized = candidates.filter(({ challenge }) => {
    if (!policy.allowedTokens) return true
    const currency = readCurrency(challenge.request)
    return (
      currency !== undefined &&
      policy.allowedTokens.some((token) => sameAddress(token, currency))
    )
  })
  if (authorized.length === 0) return []
  if (authorized.length === 1) return authorized

  const balanceReads = new Map<string, Promise<bigint | undefined>>()
  const getBalance: BalanceReader = (parameters) => {
    const key = `${parameters.chainId}:${parameters.token.toLowerCase()}`
    const existing = balanceReads.get(key)
    if (existing) return existing
    const pending = policy.getBalance(parameters)
    balanceReads.set(key, pending)
    return pending
  }

  const ranked = await Promise.all(
    authorized.map(async (candidate, position): Promise<RankedCandidate<candidate>> => ({
      candidate,
      position,
      rank: await chargeRank(candidate.challenge.request, getBalance),
    })),
  )
  ranked.sort((left, right) => left.rank - right.rank || left.position - right.position)
  return ranked.map(({ candidate }) => candidate)
}

async function chargeRank(request: unknown, getBalance: BalanceReader): Promise<number> {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return 1
  const { amount, currency, methodDetails } = request as Record<string, unknown>
  if (
    typeof amount !== 'string' ||
    !/^\d+$/.test(amount) ||
    typeof currency !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(currency)
  )
    return 1

  const chainId = readChainId(methodDetails) ?? tempoNetworks.mainnet.id
  const amountRaw = BigInt(amount)
  if (amountRaw === 0n) return 0

  const paymentBalance = await getBalance({ chainId, token: currency as Address })
  if (paymentBalance === undefined) return 1
  if (paymentBalance < amountRaw) return 2

  const sponsored = readFeePayer(methodDetails)
  const machAddress = tokenAddress(mach.addresses, chainId)
  if (!machAddress || !sameAddress(currency, machAddress) || sponsored) {
    return !sponsored && paymentBalance === amountRaw ? 2 : 0
  }

  const feeTokens = [
    tokenAddress(pathusd.addresses, chainId),
    tokenAddress(usdce.addresses, chainId),
  ].filter((token): token is Address => token !== undefined)
  const feeBalances = await Promise.all(
    feeTokens.map((token) => getBalance({ chainId, token })),
  )
  if (feeBalances.some((balance) => balance !== undefined && balance > 0n)) return 0
  return feeBalances.some((balance) => balance === undefined) ? 1 : 2
}

function readCurrency(request: unknown): Address | undefined {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return undefined
  const currency = (request as Record<string, unknown>).currency
  return typeof currency === 'string' && /^0x[0-9a-fA-F]{40}$/.test(currency)
    ? (currency as Address)
    : undefined
}

function readChainId(methodDetails: unknown): number | undefined {
  if (!methodDetails || typeof methodDetails !== 'object' || Array.isArray(methodDetails))
    return undefined
  const chainId = (methodDetails as Record<string, unknown>).chainId
  return typeof chainId === 'number' && Number.isInteger(chainId) ? chainId : undefined
}

function readFeePayer(methodDetails: unknown): boolean {
  return Boolean(
    methodDetails &&
      typeof methodDetails === 'object' &&
      !Array.isArray(methodDetails) &&
      (methodDetails as Record<string, unknown>).feePayer === true,
  )
}

function tokenAddress(
  addresses: Readonly<Partial<Record<number, Address>>>,
  chainId: number,
): Address | undefined {
  return addresses[chainId]
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase()
}
