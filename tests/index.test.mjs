import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import plugin from '../dist/index.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('mpp_fetch returns the fetch response to the agent', async () => {
  let mppFetch
  plugin.register({
    pluginConfig: { enabled: false },
    registerCli() {},
    registerTool(tool) {
      if (tool.name === 'mpp_fetch') mppFetch = tool
    },
    registrationMode: 'tools',
  })
  globalThis.fetch = async () =>
    new Response('created', {
      headers: { 'x-result': 'ok' },
      status: 201,
      statusText: 'Created',
    })

  const result = await mppFetch.execute('call', { url: 'https://example.com' })

  assert.deepEqual(result.details, {
    body: 'created',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'x-result': 'ok',
    },
    ok: true,
    redirected: false,
    status: 201,
    statusText: 'Created',
    type: 'default',
    url: '',
  })
  assert.equal(result.content[0].text, JSON.stringify(result.details))
})
