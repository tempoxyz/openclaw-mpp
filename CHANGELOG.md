# openclaw-mpp

## 0.2.7

### Patch Changes

- 6a258d2: Route `mpp_fetch` through OpenClaw's guarded fetch transport.
- c8bcb1d: Print the complete Tempo Wallet approval URL during CLI setup.

## 0.2.6

### Patch Changes

- fec0dc2: Persist reusable Tempo session channels across gateway restarts.

## 0.2.5

### Patch Changes

- e71297c: Stream partial response bodies from the `mpp_fetch` tool.
- 9cbeffe: Resume pending Tempo Wallet access key publication during setup.
- ac7347b: Require payment dependency versions that support requested-chain routing, sponsored access-key gas estimation, and retrying unaccepted session opens.

## 0.2.4

### Patch Changes

- 0fa2401: Returned generic fetch response data from the `mpp_fetch` tool.

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
