# OpenClaw MPP plugin

Official MPP plugin for OpenClaw.

```bash
openclaw plugins install @tempoxyz/openclaw-mpp
```

## v0 goal

Make finite OpenClaw HTTP responses payment-aware without changing OpenClaw core.

The first version should:

- load on gateway startup
- install `mppx` payment-aware fetch for finite gateway HTTP responses
- expose an explicit `mpp_fetch` tool for requests that should use the payment-aware fetch directly
- support free requests, Tempo charge, and non-streaming Tempo session challenges
- support a gateway `TEMPO_PRIVATE_KEY` or an existing Tempo Wallet access key

Paid session streams are out of scope for v0.

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

## Implementation plan

1. Validate the package shape with OpenClaw locally.
2. Confirm startup `Mppx.create(...)` covers fetch calls made by OpenClaw/plugin code after the plugin loads.
3. Add `wallet.tempo.xyz` setup for Tempo access keys.
4. Add optional EVM/x402 support with `evm.charge`.
5. Publish behind ClawHub review only after the local UX works end to end.
