import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeSetupUrl } from '../dist/cli.js'

test('writes the complete wallet setup URL to CLI output', () => {
  const writes = []
  const url = 'https://wallet.tempo.xyz/api/auth/cli?code=device-secret'

  writeSetupUrl(url, { write: (value) => writes.push(value) })

  assert.equal(
    writes.join(''),
    `\nOpen Tempo Wallet to approve this access key:\n\n${url}\n\n`,
  )
})
