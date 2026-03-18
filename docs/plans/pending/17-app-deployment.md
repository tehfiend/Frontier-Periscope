# Plan: App Deployment & Data Strategy

**Status:** Draft
**Created:** 2026-03-17
**Module:** cross-cutting (all apps)

## Overview

The TehFrontier monorepo contains 7 apps with fundamentally different deployment profiles. Three are in-game dApps (permissions-dapp, ssu-dapp, ssu-market-dapp) designed to run inside EVE Frontier's CEF-based in-game browser, loaded by URL with query parameters. Two are server-side services (api, gas-station) requiring Node.js + persistent state. One is a full-stack web app (web, Next.js). One is a standalone intel tool (periscope) that bundles 21 MB of extracted game data and uses browser-only APIs (File System Access, IndexedDB, Service Worker).

This plan addresses three questions: (1) whether to bundle the 21 MB of static game data extracted from the client, (2) whether to add a self-service extraction feature so users can extract data themselves, and (3) what deployment strategy best fits each app type. The goal is a deployable setup that minimizes friction for end users while keeping the apps functional across their different runtime requirements.

## Current State

### App Inventory

| App | Type | Build Output | Env Vars | External Dependencies |
|-----|------|-------------|----------|----------------------|
| **periscope** | Vite SPA + PWA | 24 MB (3 MB JS + 21 MB data) | None | Sui RPC, World API, gas-station (optional) |
| **web** | Next.js 15 SSR | 74 MB (.next/) | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUI_NETWORK` | api server |
| **api** | Hono + tRPC | Node.js dist | `DATABASE_URL`, `API_PORT`, `JWT_SECRET`, `CORS_ORIGIN` | PostgreSQL (Redis in docker-compose but not used by code) |
| **gas-station** | Express | Node.js dist | `GAS_STATION_PRIVATE_KEY`, `SUI_GRAPHQL_URL`, `GAS_STATION_PORT` | Sui RPC |
| **permissions-dapp** | Vite SPA | Static dist/ | None | Sui RPC (via dapp-kit) |
| **ssu-dapp** | Vite SPA | Static dist/ | `VITE_OBJECT_ID` (optional, URL params preferred) | Sui RPC, World API |
| **ssu-market-dapp** | Vite SPA | Static dist/ | `VITE_MARKET_CONFIG_ID`, `VITE_COIN_TYPE` (optional) | Sui RPC, World API |

### Static Data Breakdown (Periscope)

All files live in `apps/periscope/public/data/` and are committed to git. They are extracted from the EVE Frontier game client using two Python scripts.

**Stellar data** (from `scripts/extract_static_data.py`, reads starmapcache.pickle + FSD .static files):

| File | Size | Records | Used By |
|------|------|---------|---------|
| stellar_systems.json | 5.0 MB | ~24,000 solar systems | DataInitializer -> IndexedDB, Star Map |
| stellar_regions.json | 312 KB | ~100 regions | DataInitializer -> IndexedDB |
| stellar_constellations.json | 648 KB | ~1,100 constellations | DataInitializer -> IndexedDB |
| stellar_jumps.json | 212 KB | ~50,000 directed edges | DataInitializer -> IndexedDB, Pathfinder |
| stellar_labels.json | 612 KB | Name lookup for all entities | Not directly referenced (names are embedded in other stellar files) |

**Game data** (from `scripts/extract_game_data.py`, reads FSDBinary via game .pyd loaders):

| File | Size | Records | Used By |
|------|------|---------|---------|
| types.json | 11 MB | ~5,000 types | TypeSearchInput, SsuInventoryPanel (lazy fetch) |
| spacecomponents.json | 2.4 MB | Component data by type | Not directly referenced in app code |
| groups.json | 328 KB | ~300 groups | Not directly referenced |
| marketgroups.json | 272 KB | Market group tree | Not directly referenced |
| blueprints.json | 160 KB | ~100 blueprints | Blueprints view (lazy fetch) |
| facilities.json | 32 KB | ~20 facilities | Not directly referenced |
| categories.json | 8 KB | ~10 categories | Not directly referenced |
| typematerials.json | 4 KB | ~5 entries | Not directly referenced |
| extraction_meta.json | 4 KB | Metadata | Reference only |

**Total: 21 MB raw, ~6 MB after gzip/brotli** (JSON compresses well, ~70-75% reduction).

### Data Loading Flow

1. On first load, `DataInitializer.tsx` fetches stellar_*.json from `/data/`, bulk-inserts into Dexie (IndexedDB), stores a cache key
2. On subsequent loads, the cache key exists and data is skipped
3. `types.json` and `blueprints.json` are fetched lazily by specific views
4. Game types are also fetched from the World API (`worldApi.ts`) and stored in IndexedDB -- this is a runtime fallback that doesn't require bundled data

### Extraction Scripts

- `scripts/extract_static_data.py` -- Reads pickle/FSD files from the game's ResFiles directory. Requires the game client installed. Accepts `--resfiles PATH` and `--output PATH` arguments. No Python package dependencies (stdlib only).
- `scripts/extract_game_data.py` -- Uses the game client's own `.pyd` loader modules to decode FSDBinary data. **Requires Python 3.12** specifically (matching the game's python312.dll) and the game client at `C:\CCP\EVE Frontier`. Cannot be run without the game installed.

### Browser API Dependencies (Periscope)

- **File System Access API** (`window.showDirectoryPicker`) -- used for log watcher (reads game logs), auto-backup (writes JSON backups). Chromium-only, not available in Firefox/Safari.
- **IndexedDB** (via Dexie) -- primary data store, 17 schema versions, ~40 tables
- **Service Worker** (via vite-plugin-pwa + Workbox) -- caches static assets and data files for offline access
- **Web Crypto** -- UUID generation, HLC sync

### Existing Docker Setup

`docker/docker-compose.yml` provides PostgreSQL 17 and Redis 7 for the api server. No Dockerfiles exist for any app.

### In-Game Browser Constraints

The three dApp apps (permissions-dapp, ssu-dapp, ssu-market-dapp) are designed to load inside the game's CEF 122 (Chromium 122) browser. They receive context via URL parameters (`?itemId=...&tenant=...`). They connect to the player's EVE Vault wallet via `@mysten/dapp-kit-react`. These must be hosted at stable, publicly accessible URLs.

## Target State

A deployment configuration where:

1. **Static SPAs** (periscope, permissions-dapp, ssu-dapp, ssu-market-dapp) can be deployed to any static hosting provider with zero server-side runtime
2. **Server apps** (api, gas-station) can be deployed as Docker containers or to PaaS providers
3. **Web app** (web) can be deployed to Vercel or as a Docker container
4. **Static game data** has a clear strategy: bundled for convenience, with an optional self-extraction path for users running from source
5. Build outputs are optimized for each deployment target (compression, chunking, CDN caching)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Bundle static data by default | Yes -- keep in public/data/ | 21 MB raw / ~6 MB compressed is acceptable for a PWA that caches after first load. The data is already committed to git and the PWA service worker caches it for offline use. Removing it would break first-load for anyone without the game installed. |
| Git-track data files | Yes, continue tracking | The data changes rarely (only on game client updates). 21 MB is within GitHub's comfort zone. Alternative (git-lfs or separate download) adds friction for contributors. |
| Compress data files at build time | No -- rely on host compression | Vercel and Netlify auto-apply gzip/brotli to all responses. Pre-compression is only useful for self-hosted nginx (which can be added later with a simple gzip_static directive). Avoid adding vite-plugin-compression complexity for now. |
| Self-extraction in browser | No -- keep as scripts only | The extract_game_data.py script requires game-client .pyd files that only work with Python 3.12 on Windows. There's no way to replicate this in a browser. The extract_static_data.py reads binary pickle files which also can't run in-browser. |
| Periscope deployment target | Static hosting (Vercel/Netlify/GitHub Pages) | Pure SPA with no server-side requirements. PWA capabilities (offline, install) work on any static host. |
| In-game dApps deployment target | Static hosting with stable URLs | Must be accessible from the game client's browser. No server requirements. |
| Server apps deployment target | Docker + cloud VPS or PaaS | Require Node.js runtime, env vars, and (for api) database connectivity. |
| Tauri/Electron desktop app | Deferred | Periscope's File System Access API usage already provides file access. A desktop wrapper would add maintenance burden without clear benefit -- the PWA install prompt already gives an app-like experience. Revisit if users need features impossible in a browser (systray, global hotkeys). |

## Implementation Phases

### Phase 1: Static App Build Optimization

Optimize all Vite SPA builds for production deployment.

1. Add `base: '/'` explicitly to all Vite configs (ensures asset paths work on any static host)
2. Create `vercel.json` for each static app with SPA routing (rewrites `/*` -> `/index.html`) and cache headers:
   - Hashed assets (JS/CSS in /assets/): `max-age=31536000, immutable`
   - Data JSON files (/data/): `max-age=604800` (7 days, matching PWA cache)
   - HTML: `no-cache`
3. Create `netlify.toml` for each static app with equivalent `[[redirects]]` and `[[headers]]`
4. Verify all static SPAs build cleanly with `pnpm build` and produce correct `dist/` output
5. Test each app locally with `vite preview` to verify routing and asset loading

### Phase 2: Dockerize Server Apps

Create Dockerfiles for api and gas-station. Key challenge: these are monorepo workspace packages that depend on internal packages (chain-shared, shared, sui-client, db). The Dockerfiles must handle pnpm workspace resolution.

1. Create root `.dockerignore` to exclude node_modules, .git, dist, contracts, apps/periscope/public/data, apps/web/.next
2. Create `docker/Dockerfile.api` -- multi-stage build:
   - Stage 1 (deps): Node 22 alpine, corepack enable pnpm, copy root package.json + pnpm-lock.yaml + pnpm-workspace.yaml + all package.json files, run `pnpm install --frozen-lockfile`
   - Stage 2 (build): Copy source for api + its workspace deps (packages/shared, packages/db, packages/tsconfig), run `pnpm --filter @tehfrontier/api build`
   - Stage 3 (runtime): Copy built output + node_modules, set CMD to `node dist/index.js`
3. Create `docker/Dockerfile.gas-station` -- same multi-stage pattern, deps are packages/chain-shared + packages/tsconfig
4. Update `docker/docker-compose.yml` to add api and gas-station services with healthchecks and `depends_on: postgres`
5. Create `docker/docker-compose.prod.yml` override: env_file references, no exposed ports for postgres/redis, restart policies

### Phase 3: Web App Deployment Config

Configure the Next.js web app for production.

1. Add `output: 'standalone'` to `next.config.ts` for Docker deployment (creates minimal standalone server)
2. Create `docker/Dockerfile.web` using Next.js standalone output pattern
3. Add Vercel-specific config (`vercel.json`) as an alternative deployment target
4. Update `docker-compose.yml` to include the web service

### Phase 4: Deployment Documentation

Document deployment procedures for all apps (hosting configs already created in Phase 1 and Phase 3).

1. Create `docs/DEPLOY.md` covering:
   - Prerequisites (Node 22+, pnpm 9.15+, Docker for server apps)
   - How to build each app (`pnpm build` or `turbo run build --filter=...`)
   - Vercel deployment steps (link repo, set root directory per app)
   - Netlify deployment steps (build command, publish dir)
   - Self-hosted nginx config example (static apps behind reverse proxy + Docker for servers)
   - Environment variable reference for each app
2. Add a `deploy` task to `turbo.json` that depends on `build` (no-op task, just for documenting the dependency)
3. Update `.env.example` to include all env vars across all apps with comments explaining each

### Phase 5: Data Extraction Documentation & Tooling

Make data extraction accessible to contributors.

1. Add `--help` output and docstring improvements to both extraction scripts
2. Create a helper script `scripts/extract_all.sh` that runs both extractors in sequence with progress output
3. Add a check in the periscope build that warns if data files are missing or stale (compare extraction_meta.json timestamp)
4. Document the extraction process: prerequisites (Python 3.12, game client), paths, expected output

## File Summary

| File | Action | Description |
|------|--------|-------------|
| apps/periscope/vite.config.ts | Modify | Add explicit base path |
| apps/permissions-dapp/vite.config.ts | Modify | Add explicit base path |
| apps/ssu-dapp/vite.config.ts | Modify | Add explicit base path |
| apps/ssu-market-dapp/vite.config.ts | Modify | Add explicit base path |
| apps/periscope/vercel.json | Create | SPA routing + cache headers for Vercel |
| apps/periscope/netlify.toml | Create | SPA routing + redirects for Netlify |
| apps/permissions-dapp/vercel.json | Create | SPA routing for Vercel |
| apps/permissions-dapp/netlify.toml | Create | SPA routing for Netlify |
| apps/ssu-dapp/vercel.json | Create | SPA routing for Vercel |
| apps/ssu-dapp/netlify.toml | Create | SPA routing for Netlify |
| apps/ssu-market-dapp/vercel.json | Create | SPA routing for Vercel |
| apps/ssu-market-dapp/netlify.toml | Create | SPA routing for Netlify |
| .dockerignore | Create | Exclude node_modules, .git, data files, etc. |
| docker/Dockerfile.api | Create | Multi-stage Node.js build for api server |
| docker/Dockerfile.gas-station | Create | Multi-stage Node.js build for gas-station |
| docker/Dockerfile.web | Create | Next.js standalone build |
| docker/docker-compose.yml | Modify | Add api, gas-station, web services |
| docker/docker-compose.prod.yml | Create | Production overrides (env_file, no DB ports) |
| apps/web/next.config.ts | Modify | Add output: 'standalone' |
| apps/web/vercel.json | Create | Vercel config for Next.js |
| docs/DEPLOY.md | Create | Unified deployment documentation |
| scripts/extract_all.sh | Create | Wrapper script for both extractors |
| turbo.json | Modify | Add deploy task (depends on build) |
| .env.example | Modify | Add all env vars with comments |

## Open Questions

### 1. Should unused data files be removed from the bundle?

Several extracted files are not directly loaded by any Periscope view or component: spacecomponents.json (2.4 MB), stellar_labels.json (612 KB), groups.json (328 KB), marketgroups.json (272 KB), facilities.json (32 KB), categories.json (8 KB), typematerials.json (4 KB), extraction_meta.json (4 KB). Total unused: ~3.7 MB raw. The app only actively uses: stellar_systems.json, stellar_regions.json, stellar_constellations.json, stellar_jumps.json (loaded by DataInitializer), plus types.json and blueprints.json (lazy-fetched by views).

- **Option A: Remove unused files from public/data/, keep in extraction output** -- Pros: Reduces bundle by ~3.7 MB raw (~1 MB compressed). Cleaner deployment. Cons: Some files may be used by future features; would need a separate extraction output dir.
- **Option B: Keep all files, add lazy loading for any future use** -- Pros: Data is already there, no maintenance cost to keep it. The PWA service worker does NOT auto-cache these (workbox globPatterns only matches `**/*.{js,css,html,svg,png,woff2}`, not JSON; only the runtimeCaching pattern `/\/data\/.*\.json$/` applies, and it's CacheFirst so files are only cached on first access). Cons: Slightly larger deploy; files consume hosting bandwidth only if accessed.
- **Recommendation:** Option B for now. Since the PWA only caches JSON files on-demand (runtimeCaching, not globPatterns), unused files don't cost bandwidth unless fetched. The 3.7 MB affects hosting storage but not user experience. Revisit if we add features that need to actively cache all data on first load, or if the unused files grow significantly.

### 2. Should the gas station URL be configurable at deploy time?

Currently `gasStationUrl` is hardcoded to `http://localhost:3100` for stillness and `undefined` for utopia in `apps/periscope/src/chain/config.ts`. This means a deployed Periscope instance can't connect to a remote gas station without code changes.

- **Option A: Make it a VITE env var (`VITE_GAS_STATION_URL`)** -- Pros: Configurable per deployment. Standard Vite pattern. Cons: Requires rebuild per deployment target; breaks "build once, deploy anywhere."
- **Option B: Make it a runtime setting stored in IndexedDB** -- Pros: User-configurable, no rebuild needed. Cons: Requires a settings UI for it; new users won't know what to enter.
- **Option C: Use both -- env var as default, runtime override in Settings** -- Pros: Best of both worlds. Deployers set the default; power users can override. Cons: Slightly more code.
- **Recommendation:** Option C. Add `VITE_GAS_STATION_URL` as an env var with fallback to current hardcoded value, and add an override field in the Settings view. The settings-stored value takes precedence if set.

### 3. Which static hosting provider should be the primary target?

- **Option A: Vercel** -- Pros: Zero-config for Next.js (web app), good Vite SPA support, generous free tier, edge CDN, preview deployments. Cons: Vendor lock-in for Next.js features (middleware, ISR); free tier has bandwidth limits.
- **Option B: Netlify** -- Pros: Excellent static site support, form handling, split testing, generous free tier. Cons: Slightly worse Next.js support; same bandwidth limits.
- **Option C: GitHub Pages** -- Pros: Free, integrates with GitHub repo, no account needed. Cons: No server-side anything, custom domain setup is manual, no deploy previews, 100 MB limit per repo (data files are 21 MB).
- **Option D: Self-hosted (VPS + nginx)** -- Pros: Full control, no vendor limits, co-locate with API/DB. Cons: Maintenance burden, no auto-deploy, manual SSL.
- **Recommendation:** Option A (Vercel) for the primary static apps (periscope, dApps) and the web app (Next.js). Also create Netlify and nginx configs so users can choose. For server apps (api, gas-station), Docker on a VPS since they need persistent state and private keys.

### 4. Should we create a unified deployment script?

- **Option A: Per-app deploy scripts** -- Pros: Simple, each app owns its deployment. Cons: Deploying everything requires running multiple scripts.
- **Option B: Unified `scripts/deploy.sh` with subcommands** -- Pros: Single entry point, consistent patterns. Cons: More complex script, harder to maintain.
- **Option C: Turbo-based deploy task** -- Pros: Leverages existing build system, parallelism. Cons: Turbo doesn't natively do deployment; would be shelling out anyway.
- **Recommendation:** Option A. Each app gets a simple deploy config (vercel.json, Dockerfile, etc.) that works with the provider's CLI or CI. A root-level `DEPLOY.md` documents the process for each. Turbo handles the build; provider handles the deploy.

## Deferred

- **Tauri/Electron desktop wrapper** -- The PWA install prompt already provides an app-like experience. Revisit if users need systray integration, global hotkeys, or native file watchers that bypass File System Access API limitations.
- **CDN for static game data** -- If data files grow significantly (e.g., adding map images, 3D assets), consider hosting them on a CDN (R2, S3) with versioned paths rather than bundling in the app.
- **CI/CD pipeline** -- GitHub Actions workflows for automated build + deploy. Depends on choosing a hosting provider first (Open Question 3).
- **Multi-tenant deployment** -- Currently the stillness/utopia tenant configs are compile-time. If more tenants appear, may need a runtime config fetch.
- **Data update automation** -- When the game client updates (new cycle/patch), the extraction scripts need to be re-run manually with updated RESFILE_PATHS hashes. Consider a script that auto-detects the installed game version and maps the correct hashes.
