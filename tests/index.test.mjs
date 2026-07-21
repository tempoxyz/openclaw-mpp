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

test('mpp_fetch streams response body updates', async () => {
  let mppFetch
  plugin.register({
    pluginConfig: { enabled: false },
    registerCli() {},
    registerTool(tool) {
      if (tool.name === 'mpp_fetch') mppFetch = tool
    },
    registrationMode: 'tools',
  })
  const encoder = new TextEncoder()
  let finish
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('first'))
          finish = () => {
            controller.enqueue(encoder.encode(' second'))
            controller.close()
          }
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    )
  const updates = []
  let resolveFirstUpdate
  const firstUpdate = new Promise((resolve) => {
    resolveFirstUpdate = resolve
  })

  const execution = mppFetch.execute(
    'call',
    { url: 'https://example.com/events' },
    undefined,
    (update) => {
      updates.push(update)
      resolveFirstUpdate(update)
    },
  )
  const partial = await firstUpdate

  assert.equal(partial.details.body, 'first')
  finish()

  const result = await execution
  assert.equal(result.details.body, 'first second')
  assert.equal(updates.at(-1).details.body, 'first second')
})
