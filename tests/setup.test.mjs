import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSetupPolicy } from '../dist/setup.js'

const usdc = '0x20c000000000000000000000b9537d11c60e8b50'

test('uses a seven-day 10 USDC policy by default', () => {
  assert.deepEqual(resolveSetupPolicy({}, 1_700_000_000_000), {
    expiry: 1_700_604_800,
    limits: [{ limit: '0x989680', token: usdc }],
    showDeposit: {
      amount: '10',
      displayName: 'OpenClaw',
      token: 'USDC',
    },
  })
})

test('accepts setup policy overrides', () => {
  assert.deepEqual(
    resolveSetupPolicy(
      {
        expires: '24h',
        limit: 'USDC=25.50',
        showDeposit: false,
      },
      1_700_000_000_000,
    ),
    {
      expiry: 1_700_086_400,
      limits: [{ limit: '0x1851960', token: usdc }],
      showDeposit: false,
    },
  )
})

test('rejects invalid setup policies', () => {
  assert.throws(() => resolveSetupPolicy({ expires: 'forever' }), /positive duration/)
  assert.throws(() => resolveSetupPolicy({ limit: 'PATH=10' }), /USDC=<amount>/)
})
