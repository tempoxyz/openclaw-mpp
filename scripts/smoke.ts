import { createRequire } from 'node:module'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

import { Credential, Store } from 'mppx'
import { Mppx as ClientMppx } from 'mppx/client'
import { Mppx as ServerMppx, tempo as serverTempo } from 'mppx/server'
import { createClient, defineChain, http as viemHttp, parseUnits } from 'viem'
import { Account as TempoAccount, Actions, Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'

import plugin from '../src/index.ts'
import { startTempoLocalnet } from './localnet.ts'

const require = createRequire(import.meta.url)

type Scenario = 'free' | 'charge' | 'session'
type FetchTool = {
  execute: (_toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<{
    details?: { status?: number; body?: string }
  }>
}
type Evidence = {
  authorization: boolean
  scenario: Exclude<Scenario, 'free'>
  status: number
  surface: 'http'
}

const secretKey = 'test-secret-key-test-secret-key-32'
const faucetKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const payerKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const serverKey = '0x7c8521182941a4a7478407e42d391fc14b0220e76f0d2a40f8a6e4ea8d9151d2'

const faucet = TempoAccount.fromSecp256k1(faucetKey)
const payer = TempoAccount.fromSecp256k1(payerKey)
const serverAccount = TempoAccount.fromSecp256k1(serverKey)
const evidence: Evidence[] = []

async function main() {
  const versions = readVersions()
  const { localnet, rpcUrl } = await startTempoLocalnet()
  const chain = defineChain({
    ...tempoLocalnet,
    rpcUrls: { default: { http: [rpcUrl] } },
  })
  const faucetClient = createClient({
    account: faucet,
    chain,
    transport: viemHttp(rpcUrl),
  })
  const serverClient = createClient({
    account: serverAccount,
    chain,
    transport: viemHttp(rpcUrl),
  })

  let server: Awaited<ReturnType<typeof createHttpServer>> | undefined

  try {
    await Actions.token.transferSync(faucetClient, {
      account: faucet,
      amount: parseUnits('100', 6),
      feeToken: Addresses.pathUsd,
      to: payer.address,
      token: Addresses.pathUsd,
    })
    await Actions.token.transferSync(faucetClient, {
      account: faucet,
      amount: parseUnits('25', 6),
      feeToken: Addresses.pathUsd,
      to: serverAccount.address,
      token: Addresses.pathUsd,
    })

    const payment = ServerMppx.create({
      methods: [
        serverTempo({
          account: serverAccount,
          currency: Addresses.pathUsd,
          getClient: () => serverClient,
          recipient: serverAccount.address,
          store: Store.memory(),
        }),
      ],
      realm: 'openclaw-mpp-smoke',
      secretKey,
    })
    server = await createHttpServer(payment)

    const { logs, tool } = registerPlugin({
      allowedOrigins: [new URL(server.url).origin],
      privateKey: payerKey,
      rpcUrl,
    })

    const globalFetch = await runGlobalFetchChecks(server.url)
    const mppFetch = await runToolChecks(tool, server.url)

    console.log(JSON.stringify({ versions, logs, globalFetch, mppFetch, evidence }, null, 2))
  } finally {
    await server?.close()
    await localnet.stop()
    ClientMppx.restore()
  }
}

function registerPlugin(config: Record<string, unknown>) {
  const logs: string[] = []
  let tool: FetchTool | undefined

  plugin.register({
    logger: {
      info(message: string) {
        logs.push(`info: ${message}`)
      },
      warn(message: string) {
        logs.push(`warn: ${message}`)
      },
    },
    pluginConfig: config,
    registerTool(value: FetchTool & { name: string }) {
      if (value.name === 'mpp_fetch') tool = value
    },
    registrationMode: 'full',
  } as never)

  if (!tool) throw new Error('mpp_fetch was not registered.')
  return { logs, tool }
}

async function runGlobalFetchChecks(baseUrl: string) {
  const results: Record<Scenario, unknown> = { free: undefined, charge: undefined, session: undefined }
  for (const scenario of ['free', 'charge', 'session'] as const) {
    const response = await fetch(`${baseUrl}/${scenario}`)
    results[scenario] = { body: await response.json(), status: response.status }
  }
  return results
}

async function runToolChecks(tool: FetchTool, baseUrl: string) {
  const results: Record<Scenario, unknown> = { free: undefined, charge: undefined, session: undefined }
  for (const scenario of ['free', 'charge', 'session'] as const) {
    const response = await tool.execute('smoke', { url: `${baseUrl}/${scenario}` })
    results[scenario] = {
      body: response.details?.body ? JSON.parse(response.details.body) : undefined,
      status: response.details?.status,
    }
  }
  return results
}

async function createHttpServer(payment: ServerMppx.Mppx) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const scenario = url.pathname.slice(1) as Scenario
      if (!['free', 'charge', 'session'].includes(scenario)) {
        res.writeHead(404)
        res.end('not found')
        return
      }

      if (scenario !== 'free') {
        const result = await ServerMppx.toNodeListener(
          scenario === 'charge'
            ? payment.charge({ amount: '1' })
            : payment.session({ amount: '1', suggestedDeposit: '50', unitType: 'request' }),
        )(req, res)
        evidence.push({
          authorization: hasPaymentAuthorization(req.headers.authorization),
          scenario,
          status: result.status,
          surface: 'http',
        })
        if (result.status === 402) return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, scenario }))
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(error instanceof Error ? error.stack : String(error))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    async close() {
      server.closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
    url: `http://127.0.0.1:${port}`,
  }
}

function hasPaymentAuthorization(header: string | undefined) {
  return Boolean(header && Credential.extractPaymentScheme(header))
}

function readVersions() {
  return {
    mppx: readPackageVersion('mppx'),
    openclaw: readPackageVersion('openclaw'),
    viem: readPackageVersion('viem'),
  }
}

function readPackageVersion(name: string) {
  let directory = dirname(require.resolve(name))
  for (;;) {
    const packageJson = join(directory, 'package.json')
    if (existsSync(packageJson)) {
      const parsed = JSON.parse(readFileSync(packageJson, 'utf8')) as { name?: string; version?: string }
      if (parsed.name === name && parsed.version) return parsed.version
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`Could not find package.json for ${name}`)
    directory = parent
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
