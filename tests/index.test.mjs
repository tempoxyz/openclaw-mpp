import assert from 'node:assert/strict'
import { afterEach, mock, test } from 'node:test'
import { Challenge } from 'mppx'
import plugin from '../dist/index.js'
import { closeMppx } from '../dist/mpp.js'

const originalFetch = globalThis.fetch
const privateKey = `0x${'1'.repeat(64)}`

afterEach(async () => {
  await closeMppx()
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
  globalThis.fetch = mock.fn(async () =>
    new Response('created', {
      headers: { 'x-result': 'ok' },
      status: 201,
      statusText: 'Created',
    }))

  const result = await mppFetch.execute('call', { url: 'https://1.1.1.1' })

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

test('mpp_fetch blocks private network targets', async () => {
  let mppFetch
  let fetched = false
  plugin.register({
    pluginConfig: { enabled: false },
    registerCli() {},
    registerTool(tool) {
      if (tool.name === 'mpp_fetch') mppFetch = tool
    },
    registrationMode: 'tools',
  })
  globalThis.fetch = mock.fn(async () => {
    fetched = true
    return new Response('private')
  })

  await assert.rejects(
    mppFetch.execute('call', { url: 'http://127.0.0.1/secret' }),
    /Blocked hostname|private|loopback/i,
  )
  assert.equal(fetched, false)
})

test('mpp_fetch pays a 402 challenge through the guarded fetch', async () => {
  let mppFetch
  plugin.register({
    pluginConfig: { wallet: { privateKey, type: 'tempo' } },
    registerCli() {},
    registerTool(tool) {
      if (tool.name === 'mpp_fetch') mppFetch = tool
    },
    registrationMode: 'tools',
  })
  const challenge = Challenge.from({
    id: 'test-charge',
    intent: 'charge',
    method: 'tempo',
    realm: '1.1.1.1',
    request: {
      amount: '0',
      currency: `0x${'2'.repeat(40)}`,
      methodDetails: { chainId: 4217 },
      recipient: `0x${'3'.repeat(40)}`,
    },
  })
  const requests = []
  globalThis.fetch = mock.fn(async (input, init) => {
    requests.push(new Request(input, init))
    if (requests.length === 1)
      return new Response('payment required', {
        headers: { 'www-authenticate': Challenge.serialize(challenge) },
        status: 402,
      })
    return new Response('paid', { status: 200 })
  })

  const result = await mppFetch.execute('call', { url: 'https://1.1.1.1/paid' })

  assert.equal(result.details.body, 'paid')
  assert.equal(requests.length, 2)
  assert.match(requests[0].headers.get('accept-payment'), /tempo\/charge/)
  assert.match(requests[1].headers.get('authorization'), /^Payment /)
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
  globalThis.fetch = mock.fn(async () =>
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
    ))
  const updates = []
  let resolveFirstUpdate
  const firstUpdate = new Promise((resolve) => {
    resolveFirstUpdate = resolve
  })

  const execution = mppFetch.execute(
    'call',
    { url: 'https://1.1.1.1/events' },
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

test('mpp_fetch leaves stream lifetime to the caller', async () => {
  let mppFetch
  plugin.register({
    pluginConfig: { enabled: false },
    registerCli() {},
    registerTool(tool) {
      if (tool.name === 'mpp_fetch') mppFetch = tool
    },
    registrationMode: 'tools',
  })
  let fetchSignal
  globalThis.fetch = mock.fn(async (_input, init) => {
    fetchSignal = init?.signal
    return new Response('stream complete')
  })

  const result = await mppFetch.execute('call', { url: 'https://1.1.1.1/events' })

  assert.equal(result.details.body, 'stream complete')
  assert.equal(fetchSignal, undefined)
})
