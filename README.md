# MPP for OpenClaw

[![npm](https://img.shields.io/npm/v/openclaw-mpp)](https://www.npmjs.com/package/openclaw-mpp)
[![CI](https://github.com/tempoxyz/openclaw-mpp/actions/workflows/ci.yml/badge.svg)](https://github.com/tempoxyz/openclaw-mpp/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/openclaw-mpp)](./LICENSE)

Give OpenClaw access to pay-per-use APIs without managing a separate API key or
subscription for every service. The plugin installs a payment-aware fetch in the Gateway
so HTTP and MCP calls can handle MPP HTTP 402 charges and streaming sessions using a
capped, expiring Tempo Wallet access key.

Maintained by [Tempo](https://tempo.xyz), the team behind
[MPP](https://mpp.dev).

## Quick start

> [!IMPORTANT]
> Tempo Wallet setup uses Tempo mainnet and authorizes real USDC spending. The default
> access key expires after seven days and has a total 10 USDC spending limit.

Install from ClawHub, connect Tempo Wallet, and restart the active gateway:

```bash
openclaw plugins install clawhub:openclaw-mpp
openclaw mpp setup
openclaw gateway restart
```

Verify both the wallet and the live gateway runtime:

```bash
openclaw mpp status
openclaw plugins inspect mpp --runtime --json
```

During OpenClaw's registry transition, npm remains available as an explicit fallback:

```bash
openclaw plugins install npm:openclaw-mpp
```

## Make a first paid request

Send this prompt through OpenClaw:

```text
Use mpp_fetch to GET https://mpp.dev/api/ping/paid and report the HTTP status and payment receipt.
```

This test spends real USDC. A successful request returns HTTP 200 and includes the payment
receipt in the tool result. If OpenClaw selects its built-in `web_fetch` tool instead,
explicitly ask it to use `mpp_fetch`; built-in `web_fetch` is not payment-aware.

## Connect a wallet

### Tempo Wallet

`openclaw mpp setup` uses the Tempo Accounts SDK to open a
[Tempo Wallet](https://wallet.tempo.xyz) approval flow. Your wallet authorizes a seven-day
access key with a 10 USDC spending limit; your wallet's root private key is never shared with
OpenClaw. Mainnet is the default. After approval, setup publishes the access key on the selected
network with a zero-value USDC self-transfer so it is ready before the command completes.

Customize the access key policy or create one for Tempo testnet:

```bash
openclaw mpp setup --expires 24h --limit USDC=25 --no-deposit
openclaw mpp setup --network testnet
openclaw mpp status --network testnet
```

Authorize an access key for each network the agent uses. The Accounts SDK selects the matching
access key from each payment Challenge's chain ID, so one gateway can handle mainnet and testnet
without a network switch. Restart a running gateway after setup with `openclaw gateway restart`.

### Existing access key

To select an access key already stored by Tempo Wallet, add its address to `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "mpp": {
        "config": {
          "wallet": {
            "type": "tempo",
            "accessKey": "0x..."
          }
        }
      }
    }
  }
}
```

### Private key

Set `TEMPO_PRIVATE_KEY` before starting OpenClaw to use a Tempo private key directly:

```bash
TEMPO_PRIVATE_KEY=0x... openclaw gateway run
```

## What it provides

The Gateway payment-aware fetch supports:

- free HTTP requests
- Tempo charge and session challenges
- paid SSE session streams
- fetch-backed MCP tool calls

The `mpp_fetch` tool uses the same fetch explicitly. OpenClaw's built-in `web_fetch` and managed
MCP transports use separate HTTP clients and are not covered yet.

Free requests do not require a configured wallet. Without a payment account, protected endpoints
return their original HTTP 402 Challenge without a payment retry.

The `mpp_wallet_setup` and `mpp_wallet_status` tools let an agent start wallet setup and inspect
mainnet or testnet access keys. If the active tool profile filters plugin tools, add `mpp` to the
existing `tools.alsoAllow` list. Gateway startup only loads existing wallet configuration and
never opens an authorization flow.

## Development

```bash
pnpm install
pnpm test
pnpm check
pnpm lint
pnpm pack --dry-run
openclaw plugins install --link .
```

## Package

- Plugin id: `mpp`
- Package: [`openclaw-mpp`](https://www.npmjs.com/package/openclaw-mpp)
- Minimum OpenClaw host: `2026.6.11`

## Security

Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).

## License

MIT
