# Frontier Periscope

Intel and monitoring tool for [EVE Frontier](https://evefrontier.com) -- built for the EVE Frontier hackathon. Vibe coded with [Claude Code](https://claude.ai/claude-code).

Currently targeting **Cycle 5** (Sui testnet). Support will be updated as future cycles release.

## Getting Started

Open **[app.frontierperiscope.com](https://app.frontierperiscope.com)** in Chrome or Edge. No installation required -- the app runs entirely in your browser.

For on-chain features (wallet connection, transaction signing, extension deployment), install the [EVE Vault](https://github.com/evefrontier/evevault/releases) browser extension. The app is fully usable without it for read-only features like log analysis, star map, and standings management.

> **Tip:** Click the install icon in the address bar to add Periscope as a standalone desktop app.

### Browser Requirements

**Chrome or Edge required.** The Sonar local channel uses the File System Access API to watch game log files in real time -- this API is not available in Firefox or Safari.

## Features

- **Sonar** -- Real-time event monitoring from both on-chain data and local game logs, with configurable watchlists and per-target ping alerts
- **Structures** -- Manage owned deployables and assemblies with fuel tracking, extension deployment, and L-point resolution
- **Star Map** -- 3D WebGL solar system visualization with jump route planning
- **Extensions** -- Standings-based extension deployment for gates, turrets, and SSUs with registry integration
- **Manifest** -- Local cache of on-chain characters, tribes, and public structure locations
- **Private Maps** -- Encrypted location sharing via X25519 sealed-box and standings-based access modes
- **Standings** -- Contact and tribe standings management with on-chain registry subscriptions
- **Market** -- Trading interface for in-game markets
- **Killmails** -- Combat event tracking and threat assessment

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
