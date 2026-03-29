# Frontier Periscope

Peer into the frontier -- organizational toolkit for [EVE Frontier](https://evefrontier.com).

Frontier Periscope is a comprehensive organizational platform for EVE Frontier players and groups. Create custom currencies and run player-driven markets. Deploy standings registries that control who can use your gates, turrets, and storage units. Share encrypted maps with trusted allies. Pool resources in shared treasury wallets. Monitor territory with real-time sonar alerts. Navigate the cluster with a 3D star map and jump planner. Everything runs locally in your browser -- no backend, no accounts, no tracking.

Currently targeting **Cycle 5** (Sui testnet). Support will be updated as future cycles release.

## Getting Started

Open **[app.frontierperiscope.com](https://app.frontierperiscope.com)** in Chrome or Edge. No installation required -- the app runs entirely in your browser.

For on-chain features (wallet connection, transaction signing, extension deployment), install the [EVE Vault](https://github.com/evefrontier/evevault/releases) browser extension. The app is fully usable without it for read-only features like star map, standings, killmails, and log analysis.

> **Tip:** Click the install icon in the address bar to add Periscope as a standalone desktop app.

### Browser Requirements

**Chrome or Edge required.** The Sonar local channel uses the File System Access API to watch game log files in real time -- this API is not available in Firefox or Safari.

## Features

- **Custom Currencies & Markets** -- Create your own token economy. Publish custom currencies, manage markets, and trade on player-run exchanges. Power your organization with its own medium of exchange.
- **Standings & Diplomacy** -- Manage shared infrastructure access between cooperating groups. On-chain standings registries control who can use your gates, turrets, and storage units. Define friend-or-foe rules and subscribe to allied registries.
- **Private Maps** -- Encrypted location sharing for secure coordination. Share structure positions only with trusted allies using sealed-box cryptography. Standings-based access modes let you control visibility through your registries.
- **Treasury** -- Shared multi-user wallet for organizations. Pool resources, collect gate toll revenue in custom currencies, and manage group finances with admin-controlled access.
- **Sonar** -- Real-time event monitoring across on-chain data and local game logs. Configurable watchlists with per-target ping alerts track activity in your territory.
- **Structures** -- Manage owned deployables and assemblies with fuel tracking, extension deployment, and location resolution from both public reveals and private maps.
- **Star Map & Navigation** -- 3D WebGL solar system visualization with jump route planning. Search systems, plot routes, and explore the cluster.
- **Killmails** -- Combat event tracking and threat assessment across the cluster.

## Why This Exists

This project started as a hackathon entry and grew into something I use every day in EVE Frontier. Here's the thing -- I didn't write a single line of code by hand. Every line was generated through AI-assisted development using [Claude Code](https://claude.ai/claude-code). 100% vibe coded, from the first commit to the latest feature.

One of the core intentions behind this project is to show EVE Frontier players who have no coding background that they CAN build tools on the Frontier blockchain. You don't need to be a software developer. If you can describe what you want clearly enough, AI can help you build it. The barrier to entry has never been lower.

That's also why this project is open source. Not just for transparency, but so anyone can learn from it, fork it, modify it, and build their own tools. If Periscope does something you like, take it. If it doesn't do what you need, change it. The whole point is to lower the barrier.

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
