# OpenClaw MPP plugin

Official [MPP](https://mpp.dev) plugin for OpenClaw. It installs a payment-aware fetch in the
Gateway so fetch-backed HTTP and MCP calls can satisfy payment challenges automatically.

## Install

```bash
openclaw plugins install openclaw-mpp
openclaw mpp setup
openclaw gateway restart
```

Run `openclaw mpp status` to inspect the connected payment account.

## Connect a wallet

### Tempo Wallet

`openclaw mpp setup` uses the Tempo Accounts SDK to open a
[Tempo Wallet](https://wallet.tempo.xyz) approval flow. Your wallet authorizes a seven-day
access key with a 10 USDC spending limit; your wallet's root private key is never shared with
OpenClaw.

Customize the access key policy or create one for Tempo testnet:

```bash
openclaw mpp setup --expires 24h --limit USDC=25 --no-deposit
openclaw mpp setup --network testnet
openclaw mpp status --network testnet
```

Authorize an access key for each network the agent uses. Payment challenges select the matching
network automatically.

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
