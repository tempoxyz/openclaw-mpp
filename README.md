# OpenClaw MPP plugin

Official MPP plugin for OpenClaw.

```bash
openclaw plugins install @tempoxyz/openclaw-mpp
openclaw mpp setup
```

Setup opens [Tempo Wallet](https://wallet.tempo.xyz) to authorize a seven-day access
key with a 10 USDC spending limit. The key stays in the local Tempo Wallet store.
Customize the policy with `--expires`, `--limit`, or `--no-deposit`:

```bash
openclaw mpp setup --expires 24h --limit USDC=25 --no-deposit
openclaw mpp status
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

## Use a private key

Set `TEMPO_PRIVATE_KEY` before starting OpenClaw to use a Tempo private key instead:

```bash
TEMPO_PRIVATE_KEY=0x... openclaw gateway run
```

## Local development

```bash
pnpm install
pnpm build
pnpm check
openclaw plugins install --link .
openclaw plugins enable mpp
openclaw gateway run
```

The default wallet source is Tempo. The plugin reads authorized access keys from
the Tempo Wallet store. An optional configuration can select a specific key or
storage path:

```json
{
  "enabled": true,
  "wallet": {
    "type": "tempo",
    "accessKey": "0x...",
    "storagePath": "~/.tempo/wallet/store.json"
  }
}
```

The `mpp_wallet_setup` and `mpp_wallet_status` tools expose the same setup flow to
agents. Gateway startup only hydrates existing keys and never opens setup flows.
