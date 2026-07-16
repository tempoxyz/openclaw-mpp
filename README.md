# OpenClaw MPP plugin

Official MPP plugin for OpenClaw.

```bash
openclaw plugins install @tempoxyz/openclaw-mpp
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

## Local development

```bash
pnpm install
pnpm build
pnpm check
openclaw plugins install --link .
openclaw plugins enable mpp
TEMPO_PRIVATE_KEY=0x... openclaw gateway run
```

The default wallet source is Tempo. Without `TEMPO_PRIVATE_KEY`, the plugin reads
the Tempo Wallet store and uses an existing access key:

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

Use the `mpp_wallet_status` tool to check whether the configured wallet can pay
MPP challenges. Use `mpp_wallet_setup` to explicitly create a Tempo Wallet
access key; startup only hydrates existing keys and never opens setup flows.
