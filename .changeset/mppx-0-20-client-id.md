---
'openclaw-mpp': patch
---

Updated `mppx` to 0.20.1, `accounts` to 0.21.1 and `viem` to 2.58.0. Tempo Wallet setup now uses
the Tempo Wallet device-code flow and connects the wallet and authorizes the access key in one
approval. Tempo charges now set `openclaw-mpp` as the MPP attribution client ID, and the install
instructions pass `--accept-capabilities` for OpenClaw 2026.11 and later.
