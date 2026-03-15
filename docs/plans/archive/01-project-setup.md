# TehFrontier — Project Setup Plan

**Status:** ARCHIVED (2026-03-14) — Phase 1 scaffold fully implemented. All apps, packages, docker configs, and root configs exist. Phases 2-6 were superseded by Plan 02 and later Plan 04.

## Context

TehFrontier is a governance, trading, and claims management system for EVE Frontier. It serves spreadsheet-like data, interfaces with the Sui blockchain and EVE Frontier APIs, and enables player organizations to establish territorial claims, trade, and cooperate. This plan covers initializing the full project stack.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Monorepo** | Turborepo + pnpm | Matches EVE Vault conventions, fast builds |
| **Frontend** | Next.js 16 (App Router) | Turbopack, React 19, Server Components |
| **Backend** | Hono + tRPC v11 | 14KB HTTP framework, end-to-end type safety |
| **Database** | PostgreSQL 17 + Drizzle ORM | SQL-like TS schema, auto migrations |
| **Data Tables** | TanStack Table v8 | Headless, MIT, 30KB, spreadsheet-like |
| **UI** | shadcn/ui + Tailwind CSS v4 | Own the components, full style control |
| **State** | Zustand (UI) + TanStack Query (server) | Minimal, same as EVE Vault |
| **Sui Integration** | @mysten/sui + @evefrontier/dapp-kit | Official SDKs |
| **Auth** | Sui wallet signature (Sign-In With Sui) | Wallet IS the auth, no 3rd party needed |
| **Forms** | React Hook Form + Zod | Shared validation schemas across stack |
| **Jobs** | BullMQ + Redis | Event polling, market snapshots, scheduled tasks |
| **Charts** | Recharts | Market data visualization |
| **Linter** | Biome | Replaces ESLint+Prettier, 35x faster |
| **Deploy** | Docker Compose + Nginx | Self-hosted VPS, no K8s overhead |

## Project Structure

```
TehFrontier/
├── apps/
│   ├── web/                    # Next.js 16 frontend
│   │   └── src/
│   │       ├── app/            # App Router pages
│   │       │   ├── governance/ # Proposals, voting
│   │       │   ├── trading/    # Contracts, market data
│   │       │   ├── claims/     # Territory claims
│   │       │   ├── alliances/  # Alliances, agreements
│   │       │   └── api/trpc/   # tRPC handler
│   │       ├── components/     # UI components (shadcn + domain)
│   │       ├── hooks/          # Custom React hooks
│   │       └── lib/            # tRPC client, Sui helpers, utils
│   └── api/                    # Hono backend
│       └── src/
│           ├── trpc/routers/   # governance, trading, claims, alliances, auth, chain
│           ├── services/       # Business logic
│           ├── jobs/           # BullMQ workers (event sync, market snapshots)
│           └── ws/             # WebSocket subscriptions
├── packages/
│   ├── db/                     # Drizzle ORM schema + migrations
│   │   └── src/schema/         # governance, trading, claims, alliances, chain, auth
│   ├── sui-client/             # Shared Sui integration (queries, transactions, events)
│   ├── shared/                 # Types + Zod validators
│   └── tsconfig/               # Shared TS configs
├── docker/
│   ├── docker-compose.yml      # postgres, redis, api, web, worker, nginx
│   └── docker-compose.dev.yml  # Dev overrides with hot reload
└── docs/                       # EVE Frontier reference docs (already present)
```

## Database Schema (Key Tables)

**Auth:** `users` (sui_address, character_id, tribe_id), `sessions`
**Governance:** `organizations`, `org_members`, `proposals`, `votes`
**Trading:** `trade_contracts`, `market_snapshots`
**Claims:** `claims` (system_id, claim_type, network_node_id), `claim_disputes`
**Alliances:** `alliances`, `alliance_members`, `agreements`
**Chain Cache:** `synced_events`, `smart_objects_cache`

## Auth Flow

1. User connects EVE Vault via `useConnection()` hook
2. Frontend requests challenge nonce from API
3. User signs nonce with wallet → sends to API
4. API verifies Sui signature → creates session → returns JWT
5. API queries chain for user's Smart Character → links identity

## Sui Integration

- **Reads:** SuiClient (single objects), Sui GraphQL (filtered queries), Event polling (indexing)
- **Writes:** PTB builders in `packages/sui-client/src/transactions.ts`, signed via EVE Vault
- **Sponsored:** `useSponsoredTransaction()` for standard assembly operations
- **Indexing:** BullMQ workers poll events every 30s, cache objects every 5min

## Implementation Steps

### Phase 1: Scaffold (this session)
1. Initialize Turborepo monorepo with pnpm workspaces
2. Create `packages/tsconfig` with shared configs
3. Create `packages/shared` with initial types
4. Create `packages/db` with Drizzle + auth schema
5. Create `apps/api` with Hono + tRPC + auth router
6. Create `apps/web` with Next.js 16 + shadcn/ui + tRPC client
7. Create `packages/sui-client` with client factory
8. Docker Compose for PostgreSQL + Redis
9. Root configs: turbo.json, biome.json, pnpm-workspace.yaml, .env.example
10. Initialize git repo

### Phase 2: Governance (next session)
- Organizations, members, proposals, votes CRUD
- TanStack Table views, proposal forms, real-time vote updates

### Phase 3: Claims
- Claims CRUD, map view, on-chain verification, disputes

### Phase 4: Trading
- Trade contracts, market snapshots, price charts

### Phase 5: Alliances & Enforcement
- Alliances, agreements, cross-feature integration

### Phase 6: Deep Chain Integration
- Full event indexing, smart object cache, on-chain governance execution

## Verification

After Phase 1 scaffold:
1. `pnpm install` succeeds with no errors
2. `pnpm build` compiles all packages and apps
3. `docker compose up` starts postgres + redis + api + web
4. Next.js loads at localhost:3000
5. API responds at localhost:4000
6. tRPC type inference works from api → web
7. Drizzle migrations run against PostgreSQL

## Key Dependencies (Reference Files)

- `docs/EVE_Frontier_Documentation_Reference.md` — Contract interfaces, dApp Kit SDK
- `docs/EVE_Frontier_GitHub_Reference.md` — Package names, repo structure
- `docs/EVE_Frontier_Game_Reference.md` — Game mechanics context for schema design
