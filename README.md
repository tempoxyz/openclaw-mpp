# OpenClaw MPP plugin

Official MPP plugin for OpenClaw.

This repository is private while the integration is being developed and tested.
The package is also marked private until the plugin UX is ready for ClawHub review.

## v0 goal

Make OpenClaw HTTP requests payment-aware without changing OpenClaw core.

The first version should:

- load on gateway startup
- install `mppx` payment-aware fetch for the gateway process
- expose an explicit `mpp_fetch` tool for requests that should use the payment-aware fetch directly
- support Tempo charge and session challenges
- require an allowlist of origins before paying
- support a development private key while wallet setup is being designed

## Local development

```bash
pnpm install
pnpm build
pnpm check
openclaw plugins install --link .
openclaw plugins enable mpp
MPP_PRIVATE_KEY=0x... MPP_ALLOWED_ORIGINS=https://mpp.dev openclaw gateway restart
```

## Implementation plan

1. Validate the package shape with OpenClaw locally.
2. Smoke test `mpp_fetch` against free HTTP, Tempo charge, and Tempo session endpoints.
3. Confirm startup `Mppx.create(...)` covers fetch calls made by OpenClaw/plugin code after the plugin loads.
4. Add `wallet.tempo.xyz` setup for Tempo access keys.
5. Add optional EVM/x402 support with `evm.charge`.
6. Remove the private package guard and publish behind ClawHub review only after the local UX works end to end.
