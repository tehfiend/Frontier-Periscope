# Frontier Periscope

Peer into the frontier. Organizational toolkit and real-time monitoring platform for [EVE Frontier](https://evefrontier.com).

Frontier Periscope gives non-technical players access to blockchain data and extends Smart Assemblies with custom economies, diplomacy systems, and shared infrastructure. The whole thing runs entirely in your browser with no backend server. All your data stays local and every chain interaction goes directly through public Sui and EVE Frontier endpoints.

Currently targeting **Cycle 5** (Sui testnet). Support will be updated as future cycles release.

## Getting Started

Open **[app.frontierperiscope.com](https://app.frontierperiscope.com)** in Chrome or Edge. No installation required -- the app runs entirely in your browser.

For on-chain features (wallet connection, transaction signing, extension deployment), install the [EVE Vault](https://github.com/evefrontier/evevault/releases) browser extension. The app is fully usable without it for read-only features like star map, standings, killmails, and log analysis.

> **Tip:** Click the install icon in the address bar to add Periscope as a standalone desktop app.

### Browser Requirements

**Chrome or Edge required.** The Sonar local channel uses the File System Access API to watch game log files in real time -- this API is not available in Firefox or Safari.

## Features

- **Custom Currencies & Markets** -- The only project in the hackathon that lets players create their own custom currencies, and it does it entirely in the browser through in-browser Move bytecode patching. No CLI, no gas station, nothing. These tokens trade through on-chain order book markets deployed to any Smart Storage Unit. All trades use atomic escrow so items and payment move together in a single transaction, zero trust required. Markets can be open or standings-gated, controlling who can mint, trade, or place buy orders.
- **Standings & Diplomacy** -- Manage relationships with players and tribes through on-chain registries on a seven-point scale. Standings feed into everything else. They control who can access your gates, trade at your SSUs, how your turrets pick targets, and who gets access to your storage units. Subscribe to allied registries for federated diplomacy across groups.
- **Gate Tolls & Treasuries** -- Gates can charge tolls in any custom currency with configurable standing thresholds for free passage. Toll revenue routes to shared treasury wallets that support multiple admins and multi-currency balances. Collect tolls, fund operations, control spending.
- **Private Maps** -- Share structure locations with your organization without exposing them on chain. Invite-based encryption uses X25519 sealed boxes with keys derived from wallet signatures, so there's no local key storage at all. Or use standings-gated maps where visibility is controlled by registry thresholds.
- **Sonar** -- Real-time event monitoring from two channels: blockchain polling via Sui GraphQL and local game log tailing via File System Access API. Tracks combat, trades, fuel levels, gate activity, structure changes, mining efficiency, DPS, and more. The log analyzer detects mining runs, calculates ore-per-minute rates, spots cargo-full events, and tracks live DPS dealt and received with per-encounter breakdowns. Configurable watchlists with distinct alert sounds -- cargo full plays a warning alarm, getting attacked triggers a threat pulse, and combat events tell you who shot first.
- **Structures** -- Monitor and manage owned deployables with fuel expiration tracking, extension deployment, and location resolution from both public reveals and private maps.
- **Star Map & Navigation** -- 3D WebGL solar system visualization with jump route planning. Route by fewest jumps, shortest distance, or prefer gates, with waypoints, avoidance lists, and fuel consumption estimates.
- **Killmails** -- Combat event tracking and threat assessment across the cluster.

Seven Move smart contracts are deployed on testnet covering markets, treasuries, standings, gate tolls, turret priority, and SSU integration.

## Why This Exists

This project started as a hackathon entry and grew into something I use every day in EVE Frontier. I didn't write a single line of code by hand. Every line was generated through AI-assisted development using [Claude Code](https://claude.ai/claude-code). 100% vibe coded, from the first commit to the latest feature.

One of the big goals here is to show EVE Frontier players who have no coding background that they CAN build tools on the Frontier blockchain. You don't need to be a software developer. If you can describe what you want clearly enough, AI can help you build it. The barrier to entry has never been lower.

That's also why this project is open source. Not just for transparency, but so anyone can learn from it, fork it, and build their own tools. If Periscope does something you like, take it. If it doesn't do what you need, change it.

## Privacy

Periscope is fully client-side. No backend, no accounts, no tracking. All data is stored locally in your browser's IndexedDB and the app communicates directly with public Sui and EVE Frontier endpoints. The hosted version at app.frontierperiscope.com serves only static files -- nothing passes through the server.

## Development

Want to run Periscope locally or contribute? The project is a monorepo managed by [Turborepo](https://turbo.build/).

| Package | Description |
|---------|-------------|
| `apps/periscope` | Main SPA -- React 19, TanStack Router, Tailwind CSS 4, Three.js |
| `packages/chain-shared` | Sui contract types, transaction builders, and config |
| `packages/sui-client` | Sui GraphQL client wrapper for event polling |
| `packages/tsconfig` | Shared TypeScript configurations |

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- [pnpm](https://pnpm.io/) 9.15.4 (auto-installed via corepack)

### Setup

```bash
git clone https://github.com/tehfiend/Frontier-Periscope.git
cd Frontier-Periscope
corepack enable
pnpm install
pnpm dev
```

Opens at [http://localhost:5173](http://localhost:5173).

### Production Build

```bash
pnpm build
pnpm preview
```

### Deployment

The build output (`apps/periscope/dist/`) is a fully static site. Deploy to any static hosting provider -- no environment variables or API keys needed.

**Cloudflare Pages:**

1. Connect this repo in the [Cloudflare Pages dashboard](https://dash.cloudflare.com/?to=/:account/pages)
2. Set build command to `pnpm build`, output directory to `apps/periscope/dist`, and `NODE_VERSION` to `22`
3. Deploy -- SPA routing is handled via the included `_redirects` file

## License

MIT
