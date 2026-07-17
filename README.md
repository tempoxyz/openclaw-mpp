# OpenClaw MPP plugin

Official MPP plugin for OpenClaw.

```bash
openclaw plugins install @tempoxyz/openclaw-mpp
openclaw mpp setup
openclaw gateway run
```

## Connect a wallet

### Tempo Wallet

`openclaw mpp setup` uses the Tempo Accounts SDK to print a
[Tempo Wallet](https://wallet.tempo.xyz) approval link. Your main wallet authorizes a
seven-day access key with a 10 USDC spending limit; its private key is never shared with OpenClaw.
Tempo Wallet setup currently targets Tempo mainnet.
Customize the policy with `--expires`, `--limit`, or `--no-deposit`:

```bash
openclaw mpp setup --expires 24h --limit USDC=25 --no-deposit
openclaw mpp status
```

Restart a running gateway after setup.

### Tempo Wallet with a selected access key

To use a specific key already authorized in the local Tempo Wallet store, configure its
address in `openclaw.json`:

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

## Supported requests

The plugin installs a payment-aware fetch when the gateway starts. Calls made through
`globalThis.fetch` support:

- free HTTP requests
- Tempo charge and session challenges
- paid SSE session streams
- fetch-backed MCP tool calls

The explicit `mpp_fetch` tool uses the same payment-aware fetch. OpenClaw's built-in
`web_fetch` and managed MCP transports use separate HTTP clients and are not covered yet.

The `mpp_wallet_setup` and `mpp_wallet_status` tools let agents start the same setup flow
and inspect the configured payment account. Gateway startup only loads existing wallet
configuration and never opens an authorization flow.

## Local development

```bash
pnpm install
pnpm build
pnpm check
openclaw plugins install --link .
openclaw plugins enable mpp
openclaw gateway run
```
