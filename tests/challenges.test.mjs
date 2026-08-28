import assert from 'node:assert/strict'
import { test } from 'node:test'
import { orderTempoChargeChallenges } from '../dist/challenges.js'

const mach = '0x20c000000000000000000000f37de3740ADec032'
const pathUsd = '0x20c0000000000000000000000000000000000000'
const usdc = '0x20c000000000000000000000b9537d11c60e8b50'

function candidate(currency, index, methodDetails) {
  return {
    challenge: {
      intent: 'charge',
      method: 'tempo',
      request: {
        amount: '1000000',
        currency,
        methodDetails: { chainId: 4217, ...methodDetails },
      },
    },
    index,
  }
}

function balances(values) {
  return async ({ token }) => values[token.toLowerCase()]
}

test('skips currencies outside the connected access key', async () => {
  const offered = [candidate(mach, 0), candidate(usdc, 1)]

  const ordered = await orderTempoChargeChallenges(offered, {
    allowedTokens: [usdc],
    getBalance: balances({
      [mach.toLowerCase()]: 2_000_000n,
      [usdc.toLowerCase()]: 2_000_000n,
    }),
  })

  assert.deepEqual(ordered, [offered[1]])
})

test('rejects a sole charge outside the connected access key', async () => {
  const ordered = await orderTempoChargeChallenges([candidate(mach, 0)], {
    allowedTokens: [usdc],
    getBalance: async () => 2_000_000n,
  })

  assert.deepEqual(ordered, [])
})

test('uses a funded USDC fallback when MACH is not funded', async () => {
  const offered = [candidate(mach, 0), candidate(usdc, 1)]

  const ordered = await orderTempoChargeChallenges(offered, {
    getBalance: balances({
      [mach.toLowerCase()]: 0n,
      [usdc.toLowerCase()]: 2_000_000n,
    }),
  })

  assert.deepEqual(ordered, [offered[1], offered[0]])
})

test('keeps a funded MACH offer first when stablecoin gas is available', async () => {
  const offered = [candidate(mach, 0), candidate(usdc, 1)]

  const ordered = await orderTempoChargeChallenges(offered, {
    getBalance: balances({
      [mach.toLowerCase()]: 2_000_000n,
      [pathUsd.toLowerCase()]: 1n,
      [usdc.toLowerCase()]: 2_000_000n,
    }),
  })

  assert.deepEqual(ordered, offered)
})

test('does not require local gas funds for sponsored MACH', async () => {
  const offered = [candidate(mach, 0, { feePayer: true }), candidate(usdc, 1)]

  const ordered = await orderTempoChargeChallenges(offered, {
    getBalance: balances({
      [mach.toLowerCase()]: 2_000_000n,
      [pathUsd.toLowerCase()]: 0n,
      [usdc.toLowerCase()]: 2_000_000n,
    }),
  })

  assert.deepEqual(ordered, offered)
})

test('preserves server order when balances cannot be read', async () => {
  const offered = [candidate(mach, 0), candidate(usdc, 1)]

  const ordered = await orderTempoChargeChallenges(offered, {
    getBalance: async () => undefined,
  })

  assert.deepEqual(ordered, offered)
})

test('does not reorder mixed payment intents', async () => {
  const offered = [
    { ...candidate(usdc, 0), challenge: { ...candidate(usdc, 0).challenge, intent: 'session' } },
    candidate(mach, 1),
  ]
  let reads = 0

  const ordered = await orderTempoChargeChallenges(offered, {
    getBalance: async () => {
      reads++
      return 0n
    },
  })

  assert.deepEqual(ordered, offered)
  assert.equal(reads, 0)
})
