import { Mppx, tempo } from 'mppx/client'

type TempoParameters = NonNullable<Parameters<typeof tempo>[0]>
type SessionManager = ReturnType<typeof tempo.session.manager>

export function createPaymentClient(parameters: TempoParameters, rawFetch: typeof fetch) {
  const methods = tempo(parameters)
  const client = Mppx.create({ fetch: rawFetch, methods: [methods], polyfill: false })
  const probe = Mppx.create({
    fetch: rawFetch,
    maxPaymentRetries: 0,
    methods: [methods],
    polyfill: false,
  })
  const sessionManagerPools = new Map<string, SessionManager[]>()
  const busySessionManagers = new WeakSet<SessionManager>()
  let paymentQueue = Promise.resolve()

  const enqueuePayment = <result>(run: () => Promise<result>) => {
    const result = paymentQueue.then(run, run)
    paymentQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const acquireSessionManager = (request: Request) => {
    const url = new URL(request.url)
    const key = `${request.method}:${url.origin}${url.pathname}`
    const pool = sessionManagerPools.get(key) ?? []
    let manager = pool.find((candidate) => !busySessionManagers.has(candidate))

    if (!manager) {
      const managerParameters = {
        account: parameters.account,
        fetch: rawFetch,
        getClient: parameters.getClient,
        resolveAccount: parameters.resolveAccount,
      }
      manager = tempo.session.manager(managerParameters)
      pool.push(manager)
      sessionManagerPools.set(key, pool)
    }

    busySessionManagers.add(manager)
    return {
      manager,
      release: () => busySessionManagers.delete(manager),
    }
  }

  const paymentFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const mcp = await isMcpRequest(request)
    const requestInit = await toRequestInit(request, mcp)

    if (mcp) return enqueuePayment(() => client.fetch(request.url, requestInit))

    const response = await probe.fetch(request.url, requestInit)
    if (!(await probe.transport.isPaymentRequired(response, requestInit))) return response

    const challenges = await probe.transport.getChallenges?.(response, requestInit)
    const session = challenges?.some(
      (challenge) => challenge.method === 'tempo' && challenge.intent === 'session',
    )
    if (!session) return enqueuePayment(() => client.fetch(request.url, requestInit))
    if (!acceptsEventStream(request))
      return enqueuePayment(async () => {
        const { manager, release } = acquireSessionManager(request)
        try {
          return await manager.fetch(request.url, requestInit)
        } finally {
          release()
        }
      })

    const abortController = new AbortController()
    const abort = () => abortController.abort(request.signal.reason)
    if (request.signal.aborted) abort()
    else request.signal.addEventListener('abort', abort, { once: true })

    let events: AsyncIterable<string>
    let releaseManager: () => void
    try {
      ;({ events, release: releaseManager } = await enqueuePayment(async () => {
        const { manager, release } = acquireSessionManager(request)
        try {
          return {
            events: await manager.sse(request.url, {
              ...requestInit,
              signal: abortController.signal,
            }),
            release,
          }
        } catch (error) {
          release()
          throw error
        }
      }))
    } catch (error) {
      request.signal.removeEventListener('abort', abort)
      throw error
    }

    const iterator = events[Symbol.asyncIterator]()
    const encoder = new TextEncoder()
    let active = true
    const cleanup = () => {
      if (!active) return
      active = false
      request.signal.removeEventListener('abort', abort)
      releaseManager()
    }

    return new Response(
      new ReadableStream({
        async pull(controller) {
          try {
            const event = await iterator.next()
            if (event.done) {
              cleanup()
              controller.close()
              return
            }
            controller.enqueue(encoder.encode(encodeSseData(event.value)))
          } catch (error) {
            cleanup()
            controller.error(error)
          }
        },
        async cancel() {
          cleanup()
          abortController.abort()
          await iterator.return?.()
        },
      }),
      {
        headers: {
          'cache-control': 'no-cache',
          'content-type': 'text/event-stream',
        },
      },
    )
  }

  return {
    ...client,
    async close() {
      const managers = [...sessionManagerPools.values()].flat()
      sessionManagerPools.clear()
      for (const manager of managers) await manager.close().catch(() => undefined)
    },
    fetch: paymentFetch,
  }
}

async function toRequestInit(request: Request, textBody: boolean): Promise<RequestInit> {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null
  return {
    body: hasBody
      ? textBody
        ? await request.clone().text()
        : await request.clone().arrayBuffer()
      : undefined,
    cache: request.cache,
    credentials: request.credentials,
    headers: request.headers,
    integrity: request.integrity,
    keepalive: request.keepalive,
    method: request.method,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  }
}

async function isMcpRequest(request: Request) {
  if (request.headers.has('mcp-method') || request.headers.has('mcp-session-id')) return true
  if (request.method !== 'POST') return false
  const accept = request.headers.get('accept')?.toLowerCase() ?? ''
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return false
  try {
    const value = JSON.parse(await request.clone().text())
    const messages = Array.isArray(value) ? value : [value]
    return messages.some(
      (message) => message?.jsonrpc === '2.0' && typeof message?.method === 'string',
    )
  } catch {
    return false
  }
}

function acceptsEventStream(request: Request) {
  return request.headers.get('accept')?.toLowerCase().includes('text/event-stream') ?? false
}

function encodeSseData(value: string) {
  return `${value
    .split(/\r?\n/)
    .map((line) => `data: ${line}\n`)
    .join('')}\n`
}
