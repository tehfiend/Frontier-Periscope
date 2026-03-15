# Plan: Hackathon Remaining Work

**Status:** Draft
**Created:** 2026-03-15
**Module:** multi

## Overview

The EVE Frontier x Sui Hackathon ("A Toolkit for Civilization") runs March 11-31, 2026, with an $80K prize pool. Community voting follows April 1-15, judging April 15-22, and winners announced April 24. With 16 days remaining (March 15 to March 31), this plan provides a comprehensive audit of every module, plan, and deliverable to map what has been built, what remains, and what the critical path to a compelling hackathon submission looks like.

The project has made substantial progress: 13 Move contracts written and 12 published to Sui testnet, a 107-file Periscope SPA with 29 views (28 routes + root layout), a working gas station API, a governance system with 4-tier organizations and claims deployed on-chain, and a full chain-shared package with TX builders for every contract. The monorepo infrastructure is solid (Turborepo, pnpm, Biome, 5 shared packages). However, the project has never had a verified end-to-end build (`pnpm build` has not been confirmed to succeed), the market/currency system (Plan 06) has not been implemented in contracts yet, and several Periscope features are UI shells awaiting chain integration or data population.

The hackathon theme is "A Toolkit for Civilization." The strongest submission angle is the governance organization system (Plan 04, complete) combined with the closed-loop economy (Plan 06, active) and the Periscope intel tool. The critical path is: verify build, publish `governance_ext` treasury contract, implement Plan 06 gas station token endpoint, wire the Finance view to chain, and polish for a demo recording.

## Current State — Module Audit

### contracts/ — 13 Move Packages

All contracts are located in `contracts/` with one `sources/` directory each.

| Contract | Published | Package ID | Notes |
|----------|-----------|-----------|-------|
| `turret_shoot_all` | Yes | `0x4ad1a1...3294b9` | Simplest turret, 1 source file |
| `turret_priority` | Yes | `0xbbca3a...bbb5ef` | Customizable turret priorities via code generation |
| `gate_acl` | Yes | `0x7e0ad0...9ad44c` | ACL-based gate control + config object |
| `gate_tribe` | Yes | `0x7ce73c...fd3298` | Tribe-based gate filtering |
| `gate_toll` | Yes | `0xcef451...e1f6a8` | Toll gate extension |
| `gate_unified` | Yes | `0x364f68...36210f` | Groups + per-gate config + toll (most capable gate) |
| `exchange` | Yes | `0x72928e...48315d` | Order book DEX (lacks `match_orders()`) |
| `ssu_market` | Yes | `0xdb9df1...c8885` | SSU vending machine (sell-only, no buy orders or `buy_and_withdraw`) |
| `bounty_board` | Yes | `0xf55f78...1b4bf` | Generic bounty escrow (works with any `Coin<T>`) |
| `lease` | Yes | `0x9920af...bc7ce` | SSU rental system |
| `token_template` | Yes | `0x38e749...65ccf` | Template token (init creates TreasuryCap) |
| `governance` | Yes | `0x8bef45...a578cb` | 4-tier Organization + ClaimsRegistry, 9 tests |
| `governance_ext` | **No** | empty | `treasury.move` written, depends on `governance`. NOT yet published. |

**Key gaps:**
- `governance_ext` not published (needed for OrgTreasury)
- `ssu_market` needs upgrade for buy orders + `buy_and_withdraw<T>()` (Plan 06)
- `exchange` lacks `match_orders()` (deferred, not critical for hackathon)

### apps/periscope/ — Frontier Periscope Intel Tool (107 source files)

The primary deliverable. 29 views across 28 routes, IndexedDB with 13 schema versions, dark theme SPA.

**Views — Fully Functional (have real logic, DB queries, UI):**
| View | Lines | Key Features |
|------|-------|-------------|
| `Dashboard.tsx` | 141 | Stat cards (systems, players, killmails), quick actions |
| `StarMap.tsx` | 371 | React Three Fiber 3D map, 24K systems, route plotting |
| `Logs.tsx` | 1864 | Full log analyzer (mining/combat/travel/chat), live watcher |
| `JumpPlanner.tsx` | 719 | Route planning with Dijkstra pathfinding |
| `GovernanceDashboard.tsx` | 539 | Org creation, 4 tier panels, wired to chain TX |
| `GovernanceClaims.tsx` | 483 | Claims + nicknames, wired to chain TX |
| `GovernanceTurrets.tsx` | 351 | Public/private mode, gas station build+deploy |
| `GovernanceFinance.tsx` | 1171 | Currency creation via gas station, deposit TreasuryCap, mint/burn/bounty UI |
| `GovernanceTrade.tsx` | 1467 | Sell orders + buy orders tabs, SSU market management |
| `Locations.tsx` | 432 | Location bookmarking and notes |
| `Settings.tsx` | 635 | DB management, encryption, backup, polling config |
| `PeerSync.tsx` | 598 | WebRTC P2P sync configuration |
| `Manifest.tsx` | 482 | Chain data cache (characters, tribes) |
| `Permissions.tsx` | 383 | Permission groups, policies, sync status |
| `Deployables.tsx` | 377 | Owned deployables table |
| `Assemblies.tsx` | 333 | Assembly intel table |
| `Targets.tsx` | 323 | Watchlist with target tracking |
| `Intel.tsx` | 313 | Chat intel channel monitoring |
| `Players.tsx` | 309 | Known players table |
| `Radar.tsx` | 311 | Real-time radar watches |
| `Blueprints.tsx` | 300 | Blueprint BOM calculator |
| `OPSEC.tsx` | 287 | OPSEC score and recommendations |
| `Notes.tsx` | 253 | Free-form notes with linked entities |
| `Extensions.tsx` | 276 | Extension templates (legacy, still accessible) |
| `TurretConfig.tsx` | 283 | Turret config (legacy, redirects to /governance/turrets) |
| `Assets.tsx` | 216 | Asset inventory |
| `Workers.tsx` | 186 | Background worker status |
| `Setup.tsx` | 105 | First-launch setup wizard |

**Key infrastructure:**
- 15 hooks (useActiveCharacter, useOwnedAssemblies, useExtensionDeploy, useSponsoredTransaction, useLogWatcher, useKillmailMonitor, useRadar, usePeerSync, useTaskWorker, useKeyboardShortcuts, useNotifications, usePermissionGroups, usePermissionSync, useAssemblyPolicies, useBetrayalResponse)
- 10 lib modules (pathfinder, logParser, logFileAccess, encryption, chatLinkParser, autoBackup, dataExport, worldApi, constants, taskWorker)
- 9 chain modules (client, config, queries, transactions, sync, permissions, inventory, manifest, index)
- 8 sync modules (hlc, peerManager, signaling, syncEngine, webrtcConnection, encryptionP2P, types, index)
- DB: 13 versions, ~35 tables, CRDT sync fields on all intel tables

**Status assessment:** The Periscope app is feature-rich. The main gaps:
- GovernanceFinance (1171 lines) references treasury functions from `chain-shared/treasury.ts` that require `governance_ext` to be published. The gas station `/build-token` call and OrgTreasury deposit/mint/burn flows will fail at runtime until `governance_ext` packageId is filled.
- GovernanceTrade (1467 lines) references both `ssu-market.ts` functions (OrgMarket, buy orders) and `treasury.ts` functions (`buildFundBuyOrder`). The OrgMarket/buy-order functions call Move functions that do NOT exist in the currently deployed `ssu_market` contract. The sell-order tab may work with existing `ssu_market`, but the buy-order tab requires a contract upgrade. Even the sell-order tab needs testing since `buy_and_withdraw<T>()` is not in the deployed contract.
- Both views will COMPILE (chain-shared TS exports exist) but will FAIL AT RUNTIME until contracts are deployed/upgraded.

### apps/gas-station/ — Gas Station API (5 source files)

| File | Lines | Status |
|------|-------|--------|
| `index.ts` | 183 | Express server, 5 endpoints: POST /build-turret, POST /build-governance-turret, POST /build-token, POST /sponsor, GET /health |
| `buildTurret.ts` | 163 | Turret build pipeline: generate source, sui move build, sui client publish |
| `buildToken.ts` | 194 | Token build pipeline: same pattern as turret, includes source generation with mint/burn bootstrap |
| `sponsor.ts` | 112 | TX sponsorship: validate targets against allowed package whitelist, co-sign |
| `config.ts` | 83 | Allowed package config: static whitelist from CONTRACT_ADDRESSES + dynamic additions |

**Status:** Fully implemented for its current scope. All 5 endpoints are registered and coded. The `/build-token` endpoint uses source generation (not bytecode patching), matching the proven turret build pattern. Not yet tested end-to-end (requires gas station running with `GAS_STATION_PRIVATE_KEY`). Gas station URL is configured in Periscope for Stillness (`http://localhost:3100`) but not for Utopia.

### apps/web/ — Next.js Frontend (10 source files)

Scaffold only. 4 page stubs (8 lines each: governance, trading, claims, alliances). Homepage has 4 dashboard cards linking to stubs. API connection via tRPC client.

**Status:** Unused shell. All real UI work is in Periscope. Not part of hackathon deliverable.

### apps/api/ — Hono API Server (6 source files)

Scaffold only. Single auth router with TODO comments for JWT verification and signature verification. No business logic.

**Status:** Unused shell. Periscope operates client-side (IndexedDB, direct chain queries). Not part of hackathon deliverable.

### apps/permissions-dapp/ — Permissions Management dApp (5 source files)

| File | Lines | Status |
|------|-------|--------|
| `App.tsx` | 123 | Assembly selector + ACL editor integration |
| `AclEditor.tsx` | 294 | Read/write ACL config from chain |
| `AdminPanel.tsx` | 285 | Admin/admin-tribe management |
| `AssemblySelector.tsx` | 55 | Object ID input + auto-discover |

**Status:** Functional standalone dApp for managing gate ACLs directly from wallet. Uses chain-shared. Has a built `dist/` directory (previously compiled). Could be submitted as a secondary tool alongside Periscope.

### packages/chain-shared/ — Move Contract Types & TX Builders (13 source files)

| File | Description | Status |
|------|-------------|--------|
| `config.ts` | Contract addresses per tenant | Complete; `governanceExt.packageId` empty |
| `types.ts` | 178 lines of TypeScript interfaces | Complete |
| `governance.ts` | Org + claims TX builders | Complete, wired to Periscope |
| `treasury.ts` | OrgTreasury TX builders | Written, awaits `governance_ext` publish |
| `turret-priority.ts` | Turret source generator + org config | Complete |
| `ssu-market.ts` | Market TX builders | Extended with OrgMarket/buy order builders, awaits contract upgrade |
| `exchange.ts` | DEX TX builders | Complete (no match_orders) |
| `bounty.ts` | Bounty TX builders | Complete |
| `token-factory.ts` | Bytecode patching (legacy) | `TEMPLATE_BYTECODES` is null — superseded by gas station source generation |
| `gate-toll.ts` | Toll config TX builders | Complete |
| `lease.ts` | Lease TX builders | Complete |
| `permissions.ts` | Permission query helpers | Complete |
| `index.ts` | Barrel exports | Complete |

### packages/shared/ — Shared Zod Schemas (6 files)

| File | Status |
|------|--------|
| `schemas/governance.ts` | Rewritten for 4-tier model |
| `schemas/claims.ts` | Rewritten for chain claims + nicknames |
| `schemas/auth.ts` | Basic auth schemas |
| `schemas/trading.ts` | Trading contract schemas |
| `schemas/alliances.ts` | Alliance schemas (placeholder) |
| `index.ts` | Barrel exports |

### packages/db/ — Drizzle ORM (8 files)

PostgreSQL schema for the server-side app (web + api). Tables: auth, governance, trading, claims, alliances, chain. **Not used by Periscope** (which uses IndexedDB). Only relevant if web/api apps are part of the submission.

**Status:** Schema defined, not actively used.

### packages/sui-client/ — Sui SDK Wrapper (3 files)

`createSuiClient()` factory + `pollEvents()` helper. Used by Periscope chain modules.

**Status:** Complete and functional.

### packages/tsconfig/ — Shared TS Configs (3 JSON files)

Base, library, and nextjs configs.

**Status:** Complete.

## Plan Status Summary

| Plan | Location | Status | Completion | Remaining |
|------|----------|--------|------------|-----------|
| 01 — Project Setup | `archive/` | Complete | 100% | None |
| 02 — Phases 0-5 | `superseded/` | Superseded | ~40% | Superseded by Plans 03, 04, 06 |
| 03 — Turret Config + Sponsored TX | `archive/` | Complete | 100% | None (all 3 milestones done) |
| 04 — Governance System | `archive/` | Complete | ~95% | Step 13 cleanup (low priority): delete `TenantSwitcher.tsx`, redirect `/extensions` |
| 05 — Governance Phase 2 | `pending/` | Draft | 0% | All 5 workstreams (post-hackathon) |
| 06 — Market & Currency System | `active/` | Active | ~40% | gas station token endpoint written, treasury.move written, ssu_market needs upgrade, GovernanceTrade/Finance views coded but awaiting contract deployment |
| **07 — Hackathon Remaining Work** | `pending/` | **This plan** | — | — |

## Remaining Work

### Critical Path (must-have for hackathon)

These items are required for a functional demo submission.

1. **Build verification** (~1 hour) — Run `pnpm install && pnpm build` and fix any compilation errors. This has never been verified. All downstream work depends on this.
   - Files: potentially any file with TS errors
   - Risk: moderate — 107+ source files, many cross-package imports

2. **Publish `governance_ext` to testnet** (~30 min) — `treasury.move` is written and compiles (`sui move build` in `contracts/governance_ext/`). Publish it and fill `governanceExt.packageId` in `packages/chain-shared/src/config.ts`.
   - Files: `packages/chain-shared/src/config.ts` (fill packageId for stillness + utopia)
   - Dependency: `contracts/governance_ext/Move.toml` already depends on published `governance` package
   - Command: `cd contracts/governance_ext && sui client publish --skip-dependency-verification --json`

3. **Test gas station `/build-token` end-to-end** (~1 hour) — Start gas station locally with `GAS_STATION_PRIVATE_KEY`, call `/build-token` with test params, verify packageId + treasuryCapId returned.
   - Files: `apps/gas-station/src/index.ts` (route already registered at line 74)
   - Verify: `apps/gas-station/src/buildToken.ts` generates valid Move source, `sui move build` succeeds, `sui client publish` returns objectChanges with TreasuryCap

4. **Wire GovernanceFinance view to chain** (~2 hours) — The view (1171 lines) is already coded with gas station calls, OrgTreasury deposit, mint/burn. After items 2-3 complete, test the full flow: create currency via gas station, deposit TreasuryCap into OrgTreasury, mint tokens, burn tokens.
   - Files: `apps/periscope/src/views/GovernanceFinance.tsx` (may need minor fixes after testing)
   - Dependency: governance_ext published, gas station running

5. **Demo recording** (~2-3 hours) — Record screen captures of key flows:
   - Organization creation + tier management (GovernanceDashboard)
   - System claims (GovernanceClaims)
   - Turret priority configuration + build via gas station (GovernanceTurrets)
   - Currency creation + OrgTreasury + mint/burn (GovernanceFinance)
   - Star Map 3D navigation
   - Log Analyzer with live log parsing
   - Periscope dashboard overview
   - Files: None (screen recording)

6. **Hackathon submission** (~1 hour) — README with setup instructions, demo video upload, submission page.
   - Files: May need a `README.md` update or creation at project root

### High Value (should-have)

These items significantly strengthen the submission but are not blocking.

7. **SSU Market contract upgrade for buy orders** (~4-6 hours) — Upgrade deployed `ssu_market` to add `OrgMarket`, `create_org_market()`, `create_buy_order()`, `confirm_buy_order_fill()`, `buy_and_withdraw<T>()`. This is the core of Plan 06 Phase 2.
   - Files: `contracts/ssu_market/sources/ssu_market.move` (major additions)
   - Risk: UpgradeCap must exist for `ssu_market` package. Verify with `sui client object <UpgradeCap-ID>`.
   - Dependency: GovernanceTrade view already coded assuming these functions exist

8. **Token factory bytecode extraction** (~1 hour) — Extract compiled bytecodes from `contracts/token_template/build/` and embed in `packages/chain-shared/src/token-factory.ts`. This makes the standalone `buildPublishToken()` function work without the gas station.
   - Files: `packages/chain-shared/src/token-factory.ts` (replace null with actual bytecodes)
   - Note: Not critical if gas station `/build-token` works, but useful as fallback

9. **Permissions dApp build + smoke test** (~1 hour) — Verify `apps/permissions-dapp/` builds and renders. This is a standalone tool that could be submitted alongside Periscope as a "companion dApp for admins."
   - Files: `apps/permissions-dapp/` (build, test)

10. **Cross-view navigation polish** (~2 hours) — Ensure navigation between views works smoothly (e.g., Players -> "Add to tier", Killmails -> "Mark hostile", GovernanceDashboard -> "Go to Turrets/Finance/Claims").
    - Files: Various view files in `apps/periscope/src/views/`

### Nice to Have (stretch goals)

11. **Exchange `match_orders()` implementation** (~4-6 hours) — Add order matching to the DEX contract. Not needed for core demo but would showcase a full trading loop.
    - Files: `contracts/exchange/sources/exchange.move`

12. **Bounty board UI in GovernanceFinance** (~2 hours) — GovernanceFinance already has `buildFundBounty` import and "posting-bounty" status. Wire the bounty posting flow.
    - Files: `apps/periscope/src/views/GovernanceFinance.tsx`

13. **P2P sync demo** (~3 hours) — Show two Periscope instances syncing intel via WebRTC. The sync engine (`apps/periscope/src/sync/`) is written but untested.
    - Files: `apps/periscope/src/sync/`, `apps/periscope/src/views/PeerSync.tsx`

14. **Lazy-load remaining views** (~1 hour) — Currently only StarMap, Logs, and PeerSync are lazy-loaded. Lazy-load all governance views (heavy imports).
    - Files: `apps/periscope/src/router.tsx`

15. **Delete legacy files** (~15 min) — Remove `TenantSwitcher.tsx` (dead code), redirect `/extensions` to `/governance`.
    - Files: `apps/periscope/src/components/TenantSwitcher.tsx`, `apps/periscope/src/router.tsx`

## Implementation Phases

### Phase 1: Build Verification & Contract Deployment (Day 1)

1. Run `pnpm install && pnpm build` from project root. Fix all TypeScript compilation errors.
2. Run `sui move build` in `contracts/governance_ext/`. Fix any Move compilation errors. Note: `treasury.move` is 139 lines with no Move tests (unlike `governance` which has 9 tests). Consider adding basic tests before publishing, or publish without tests if time-constrained.
3. Publish `governance_ext` to testnet: `sui client publish --skip-dependency-verification --json`.
5. Extract `packageId` from publish output, fill `governanceExt.packageId` in `packages/chain-shared/src/config.ts` for both `stillness` and `utopia`.
6. Verify `pnpm build` still passes after config change.

### Phase 2: Gas Station Token Pipeline (Day 2)

1. Configure gas station environment: set `GAS_STATION_PRIVATE_KEY` in `.env` or environment.
2. Start gas station: `pnpm --filter @tehfrontier/gas-station dev` (or build + start).
3. Test `/health` endpoint — verify wallet balance.
4. Test `/build-token` with curl: `curl -X POST http://localhost:3100/build-token -H 'Content-Type: application/json' -d '{"symbol":"TEST","name":"Test Token","description":"test","decimals":9,"senderAddress":"0xa4dee9..."}'`.
5. Verify response includes `packageId`, `coinType`, `treasuryCapId`.
6. Test `/sponsor` with a sample transaction if needed.

### Phase 3: End-to-End Flow Testing (Days 3-4)

1. Start Periscope dev server: `pnpm --filter @tehfrontier/periscope dev`.
2. Start gas station alongside.
3. Test GovernanceDashboard: create org, add tier members, verify chain TX execution.
4. Test GovernanceFinance: create currency via gas station, deposit TreasuryCap, mint tokens, burn tokens.
5. Test GovernanceTurrets: build turret priority via gas station, deploy to owned turret.
6. Test GovernanceClaims: create claim, update weight, remove claim.
7. Fix any runtime errors discovered during testing.
8. If time permits: test GovernanceTrade sell order flow.

### Phase 4: Polish & Demo (Days 5-7)

1. Fix any remaining UI issues found during testing.
2. Prepare demo script — ordered list of features to show.
3. Record demo video (screen capture with narration).
4. Write/update README with:
   - Project description (governance toolkit for EVE Frontier)
   - Setup instructions (prerequisites, env vars, commands)
   - Architecture overview (monorepo, Sui contracts, Periscope SPA)
   - Demo video link
5. Submit to hackathon.

### Phase 5: Stretch Goals (Days 8-16, if ahead of schedule)

1. SSU Market upgrade for buy orders (item 7).
2. Wire GovernanceTrade to upgraded contract.
3. Token factory bytecode extraction (item 8).
4. Permissions dApp verification (item 9).
5. Bounty board integration in GovernanceFinance (item 12).
6. Lazy-load optimization (item 14).
7. Legacy cleanup (item 15).

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/chain-shared/src/config.ts` | MODIFY | Fill `governanceExt.packageId` after publishing |
| `contracts/governance_ext/sources/treasury.move` | VERIFY | Compile and publish to testnet |
| `apps/gas-station/src/buildToken.ts` | VERIFY | End-to-end test of token build pipeline |
| `apps/gas-station/src/index.ts` | VERIFY | Confirm `/build-token` route is registered |
| `apps/periscope/src/views/GovernanceFinance.tsx` | TEST/FIX | Runtime test of full currency lifecycle |
| `apps/periscope/src/views/GovernanceTrade.tsx` | TEST/FIX | Runtime test (may need contract deployment first) |
| `apps/periscope/src/views/GovernanceDashboard.tsx` | TEST | Verify org creation + tier management |
| `apps/periscope/src/views/GovernanceClaims.tsx` | TEST | Verify claims CRUD |
| `apps/periscope/src/views/GovernanceTurrets.tsx` | TEST | Verify turret build + deploy |
| `apps/periscope/src/router.tsx` | OPTIONAL | Add lazy loading for governance views |
| `apps/periscope/src/components/TenantSwitcher.tsx` | OPTIONAL DELETE | Dead code (no imports) |
| `contracts/ssu_market/sources/ssu_market.move` | STRETCH | Add buy orders + buy_and_withdraw (Plan 06) |
| `packages/chain-shared/src/token-factory.ts` | STRETCH | Embed compiled template bytecodes |

## Open Questions

1. **Has `pnpm build` ever succeeded?** This is the single biggest unknown. The project has 107+ TypeScript files across 10 packages/apps with many cross-package imports. Build failures could cascade. This should be the very first thing attempted.

2. **Does the gas station wallet have sufficient SUI balance?** Last known: 1.78 SUI. Token publishing + treasury deployment could consume significant gas. May need faucet top-up.

3. **Are UpgradeCaps available for deployed contracts?** Plan 06 requires upgrading `ssu_market`. If the UpgradeCap was destroyed or transferred, the contract is immutable and a new package must be published instead. Check: `sui client objects --json | grep UpgradeCap`.

4. **Is the hackathon submission format determined?** Need to confirm: video required? README? Live demo? GitHub repo link? This affects Phase 4 preparation.

## Deferred

- **Plan 05 (Governance Phase 2)** — All 5 workstreams (gates, finance expansion, trade, claims improvements, alliances/voting). Post-hackathon.
- **Plan 06 Phase 2-3 (Market & Currency advanced)** — SSU market upgrade, bounty integration, exchange matching. Partially stretch goals for hackathon, fully deferred if behind schedule.
- **apps/web/ and apps/api/** — Server-side stack. Not part of hackathon deliverable. Periscope handles everything client-side.
- **packages/db/** — PostgreSQL schema. Only relevant if web/api become active.
- **P2P sync production testing** — Sync engine is written but untested in multi-instance scenarios.
- **SuiGrpcClient migration** — `queryOrganization()` uses deprecated JSON-RPC SuiClient. Deadline is Jul 2026.
- **Exchange order matching** — DEX without matching is limited. Stretch goal.
- **Gate integration with governance tiers** — Requires CCP clarification on parameter passing. Plan 05 Phase 2a.
