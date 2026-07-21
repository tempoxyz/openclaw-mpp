# openclaw-mpp

## 0.2.3

### Patch Changes

- ebc4cff: Keep free requests available when wallet status checks fail and avoid repeating wallet checks for a cached payment client.

## 0.2.2

### Patch Changes

- 08ca272: Allow free HTTP requests to run without a configured payment account while leaving paid Challenges untouched.
- b410507: Make wallet status chain-aware, default status to mainnet, and publish newly authorized access keys before reporting them ready.

## 0.2.1

### Patch Changes

- 649afa2: Improved ClawHub distribution, package discoverability, and first-payment onboarding.
- 2a397ec: Added public repository metadata and hardened release checks.
- 744b3ac: Improved installation, wallet setup, and development documentation.
- 744b3ac: Added automatic Tempo challenge routing and network-specific access-key setup.
- bd64d89: Delegated access-key readiness and selection to the Tempo Accounts SDK.
