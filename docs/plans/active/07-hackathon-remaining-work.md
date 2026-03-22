# Plan: Hackathon Remaining Work

**Status:** Active
**Created:** 2026-03-15
**Updated:** 2026-03-21 (v10: Plan status fixes, Plans 22-24 added. 10 days remaining)
**Module:** multi

## Overview

The EVE Frontier x Sui Hackathon ("A Toolkit for Civilization") runs March 11-31, 2026, with an $80K prize pool. Community voting follows April 1-15, judging April 15-22, and winners announced April 24. With 12 days remaining (March 19 to March 31), this plan maps what has been built, what remains, and the critical path to a compelling hackathon submission.

The project has made substantial progress: 16 Move packages (13 project contracts + 2 CCP world packages + token_template, all project contracts published to Sui testnet), a 112-file Periscope SPA with 27 views, a standalone SSU dApp (with two-card layout, inventory transfers, and Market tab) and SSU Market dApp, governance.move still deployed on-chain (org claims still work via deployed package), and a full chain-shared package with TX builders for every contract. The monorepo infrastructure is solid (Turborepo, pnpm, Biome, 4 shared packages). Since v8: Plans 20 (Consolidate dApps) and 21 (Market Architecture Simplification) fully executed -- 3 contracts deleted (governance_ext, currency_market, governance sources), 1 new contract published (market), ssu_market republished with SsuConfig architecture, chain-shared rewritten for unified Market<T>, Periscope views consolidated (~2600 LOC removed), ssu-dapp Market tab added, full code review with fixes. All feature implementation is done.

**Standalone-first approach:** Periscope is a fully client-side SPA -- no backend server required. Currency creation uses in-browser WASM bytecode patching (`buildPublishToken` via `@mysten/move-bytecode-template`), all governance TX builders run in-browser, and the user's wallet (EVE Vault) handles signing and gas. The gas station is an **optional enhancement** for custom turret package compilation only -- it is not on the critical path.

The hackathon theme is "A Toolkit for Civilization." The strongest submission angle is the unified Market<T> economy system (Plan 21) combined with the Periscope intel tool, the standalone SSU dApps (with SsuConfig-linked Market tab and full inter-slot transfers), and the shared ACL registry (Plan 16). All 24 feature plans are either complete/archived, ready for execution, or deferred. The critical path is now: **test standalone E2E flows -> polish UI -> record demo -> submit.**

## Current State -- Module Audit

### contracts/ -- 16 Move Packages (13 project + 2 CCP world + token_template)

All contracts are located in `contracts/` with one `sources/` directory each.

| Contract | Published | Package ID | Notes |
|----------|-----------|-----------|-------|
| `turret_shoot_all` | Yes | `0x4ad1a1...3294b9` | Simplest turret, 1 source file |
| `turret_priority` | Yes | `0xbbca3a...bbb5ef` | Customizable turret priorities via code generation |
| `gate_acl` | Yes | `0x7e0ad0...9ad44c` (Stillness), `0x44ff83...3af4583` (Utopia) | ACL-based gate control + config object. Re-published against Utopia world package with shared ACL support (plan 16). |
| `gate_tribe` | Yes | `0x7ce73c...fd3298` | Tribe-based gate filtering |
| `gate_toll` | Yes | `0xcef451...e1f6a8` | Toll gate extension |
| `gate_unified` | Yes | `0x364f68...36210f` | Groups + per-gate config + toll (most capable gate) |
| `exchange` | Yes | `0x72928e...48315d` | Order book DEX (lacks `match_orders()`) |
| `ssu_market` | Yes | `0x40576ea9e07fa8516abc4820a24be12b0ad7678d181afba5710312d2a0ca6e48` | SSU extension (Stillness). SsuConfig + transfers + trade execution. Depends on market + world_stillness. |
| `ssu_market_utopia` | Yes | `0xf6e9699d86cd58580dd7d4ea73f8d42841c72b4f23d9de71d2988baabc5f25a0` | SSU extension (Utopia). Same code, depends on market + world_utopia. |
| `bounty_board` | Yes | `0xf55f78...1b4bf` | Generic bounty escrow (works with any `Coin<T>`) |
| `lease` | Yes | `0x9920af...bc7ce` | SSU rental system |
| `token_template` | Yes | `0x38e749...65ccf` | Template token. init() creates Market<T> on publish. |
| `governance` | Yes | `0x8bef45...a578cb` | 4-tier Organization + ClaimsRegistry, 9 tests |
| `acl_registry` | Yes | `0x3b1cde...3ffc3b55` | Shared ACL objects for cross-player gate configuration (plan 16). |
| `market` | Yes | `0x1755ea...a055f4` | Unified Market<T>: treasury + order book + authorization. New in Plan 21. |
| `world_utopia` | N/A (CCP) | `0xd12a70...043f75` | Local copy of CCP's World package (Utopia). Build dependency for `ssu_market_utopia`. |
| `world_stillness` | N/A (CCP) | `0x28b497...27448c` | Local copy of CCP's World package (Stillness). Build dependency for `ssu_market`. Created during Plan 19 Phase 2 to resolve Stillness address correctly. |

**Key gaps:**
- `exchange` lacks `match_orders()` (deferred, not critical for hackathon)

### apps/periscope/ -- Frontier Periscope Intel Tool (112 source files)

The primary deliverable. 27 views across 31 routes (including redirects), IndexedDB with 19 schema versions, dark theme SPA. **Fully standalone -- no backend required.**

**Views -- Fully Functional (have real logic, DB queries, UI):**
| View | Lines | Key Features |
|------|-------|-------------|
| `Dashboard.tsx` | 141 | Stat cards (systems, players, killmails), quick actions |
| `StarMap.tsx` | 371 | React Three Fiber 3D map, 24K systems, route plotting |
| `Logs.tsx` | ~1540 | Log analyzer (mining/combat/travel/structures/chat tabs). LiveTab removed -- absorbed into Sonar Log Feed. |
| `Sonar.tsx` | 655 | **Restructured (plan 15).** Tabbed: Pings (filtered alerts with audio/notification), Log Feed (live stats + activity), Chain Feed (on-chain inventory events). |
| `Bridge.tsx` | 340 | Curated dashboard from Sonar data (location tracking, SSU activity) |
| `Killmails.tsx` | 184 | Killmail intel with chain sync |
| `JumpPlanner.tsx` | 719 | Route planning with Dijkstra pathfinding |
| `GovernanceClaims.tsx` | 487 | Claims + nicknames, wired to chain TX |
| `GovernanceTurrets.tsx` | 355 | Public/private mode, turret build+deploy (requires gas station) |
| `Finance.tsx` | 1296 | Market<T> management: currency creation (WASM bytecode), mint/burn, authorized minter management. Replaces GovernanceFinance.tsx. |
| `Locations.tsx` | 395 | Location bookmarking and notes. Uses shared `SystemSearch` component. |
| `Settings.tsx` | 721 | DB management, encryption, backup, polling config |
| `Manifest.tsx` | 482 | Chain data cache (characters, tribes) + server switcher |
| `Permissions.tsx` | 376 | Permission groups, policies, sync status |
| `Deployables.tsx` | 1284 | **Updated (plan 14).** Unified deployables + assemblies grid with Location column and inline LocationEditor (system/planet/L-point picker). |
| `Targets.tsx` | 323 | Watchlist with target tracking |
| `Intel.tsx` | 313 | Chat intel channel monitoring |
| `Players.tsx` | 309 | Known players table |
| `Blueprints.tsx` | 300 | Blueprint BOM calculator |
| `OPSEC.tsx` | 287 | OPSEC score and recommendations |
| `Notes.tsx` | 253 | Free-form notes with linked entities |
| `Extensions.tsx` | 480 | Extension templates |
| `TurretConfig.tsx` | 292 | Turret config (legacy, redirects to GovernanceTurrets) |
| `Assets.tsx` | 224 | Asset inventory |
| `Wallet.tsx` | 301 | SUI balance, coin balances, faucet link |
| `Workers.tsx` | 186 | Background worker status |
| `Setup.tsx` | 105 | First-launch setup wizard |

**Changes since last update (v8 -> v9):**
- Plans 20 (Consolidate dApps) and 21 (Market Architecture Simplification) fully executed
- 3 contracts deleted: governance_ext, currency_market, governance (sources only -- org.move claims still work via deployed package)
- 1 new contract published: `market` at `0x1755eaaebe4335fcf5f467dfaab73ba21047bdfbda1d97425e6a2cb961a055f4` (unified Market<T>)
- `ssu_market` (both tenants) republished with SsuConfig architecture, trade execution via Market<T>
- chain-shared rewritten: governance.ts/treasury.ts/currency-market.ts deleted; market.ts/claims.ts created; ssu-market.ts rewritten for SsuConfig
- Periscope: GovernanceDashboard + GovernanceTrade deleted (~2600 LOC removed). Finance.tsx replaces GovernanceFinance.tsx. ACL components added to Permissions view.
- ssu-dapp: Two-card layout (SsuInfoCard + ContentTabs), Market tab with sell listings + buy orders, SellDialog
- Full code review completed with fixes: authorized list dedup, fee overflow prevention, query cache keys, loading states

**Changes since last update (v7 -> v8):**
- Plan 19 (SSU Inventory Transfers) fully implemented and archived (commits `834bc05`, `637411e`, `534cdeb`)
- Both `ssu_market` contracts upgraded: Stillness v4 (tx `AynqR7yz...`), Utopia v2 (tx `CbJEYpmE...`)
- 7 new transfer functions added to both contracts: `admin_to_escrow`, `admin_from_escrow`, `admin_to_player`, `admin_escrow_to_player`, `admin_escrow_to_self`, `player_to_escrow`, `player_to_owner`
- `contracts/world_stillness/` created as local World dependency for Stillness contract builds
- ssu-dapp TransferDialog fully wired: market-routed transfers, admin PTBs (no cap borrow), player PTBs (cap borrow + market deposit)
- New ssu-dapp hooks: `useSsuConfig.ts`, `useCharacterSearch.ts`
- Updated `packages/chain-shared/src/config.ts` with new `ssuMarket.packageId` values for both tenants

**Changes from v6 -> v7:**
- Server apps removed: `apps/api/`, `apps/gas-station/`, `apps/web/`, `packages/db/` deleted from monorepo (commit `8e9e117`). Project is now 4 SPAs + 3 packages.
- P2P sync feature removed from Periscope (`PeerSync.tsx` deleted, commit `0061f5d`)
- `useSponsoredTransaction` hook removed from Periscope (gas station no longer in codebase)
- SSU dApp inter-slot transfers landed: `TransferDialog.tsx` replaces `TransferPanel.tsx` + `DepositWithdrawPanel.tsx`, new hooks (`useCharacterName.ts`, `useOwnerCharacter.ts`)
- Cloudflare Pages deployment config added for ssu-dapp (`_headers`, `_redirects`, `docs/cloudflare-pages-setup.md`)
- Plan 19 (ssu-inventory-transfers) created for extending TransferDialog with market extension support (now complete, archived)
- Periscope renamed to "Frontier Periscope" in HTML title

**Standalone features (no gas station needed):**
- All intel views (Dashboard, StarMap, Sonar, Bridge, Killmails, Logs, JumpPlanner, Intel, Players, Targets, etc.)
- GovernanceClaims -- claims CRUD (in-browser TX)
- Finance -- currency creation via buildPublishToken() (in-browser WASM), Market<T> mint/burn/authorized management
- SSU dApp Market tab -- sell listings, buy from listing, create buy orders (requires SsuConfig with linked Market)
- Wallet -- SUI + token balances, faucet link
- Extension authorization -- authorizing pre-published extensions on assemblies

**Gas station dependent (removed from codebase):**
- ~~GovernanceTurrets -- custom turret package compilation + publish (requires `/build-turret`)~~ Gas station removed. GovernanceTurrets still shows turret config UI but cannot build/publish without gas station.
- ~~Sponsored transactions -- `useSponsoredTransaction` hook~~ Removed.

**Status assessment:** Finance.tsx uses `buildPublishToken()` from `token-factory.ts` which does in-browser bytecode patching. Bytecodes are embedded as base64 in `TEMPLATE_BYTECODES_B64`. The full currency lifecycle works without any server. SSU dApp Market tab is functional with SsuConfig-linked Market<T> on both tenants.

### apps/ssu-market-dapp/ -- SSU Market Trading dApp

Standalone Vite + React dApp for SSU marketplace interactions. Deployed at port 3200. Uses `@mysten/dapp-kit-react` with EVE Vault. Components: `MarketView`, `OwnerView`, `BuyerView`, `ListingCard`, `ListingForm`. Has hooks for market config, listings, inventory, and sign+execute. **Updated (plan 16):** Now includes `MarketBrowser`, `MarketDetail`, `PostSellListing`, `PostBuyOrder` components for browsing and interacting with currency markets. Routes between SSU market mode (`?configId=`) and currency market mode (`?marketId=`).

### apps/ssu-dapp/ -- Default SSU Viewer -- COMPLETE

Standalone dApp with two-card layout: SsuInfoCard (header + inline metadata edit) + ContentTabs (Inventory / Market). Inventory tab has transfer dialog + sell button. Market tab shows sell listings (admin edit/cancel, buyer browse/buy) and buy orders. Uses SsuConfig hook for market detection. Full market extension inter-slot transfers.

### apps/permissions-dapp/ -- Permissions Management dApp

Functional standalone ACL editor with EVE Vault config. **Updated (plan 16 phase 4):** Now includes tabbed navigation between "Assembly ACL" (existing inline ACL editor) and "Shared ACLs" (new browser + create/edit form with bulk update, admin management). Uses chain-shared `acl-registry.ts` builders.

### Removed Apps (no longer in codebase)

- **apps/gas-station/** -- Removed (commit `8e9e117`). Custom turret compilation is no longer available. Token publishing uses in-browser WASM instead.
- **apps/web/** -- Removed (commit `8e9e117`). Unused scaffold.
- **apps/api/** -- Removed (commit `8e9e117`). Unused scaffold.
- **packages/db/** -- Removed (commit `8e9e117`). No server-side DB needed.

### Other Modules

- **packages/chain-shared/** -- Complete. Rewritten for unified Market<T> architecture (Plan 21). Old modules (governance.ts, treasury.ts, currency-market.ts) deleted. New modules: market.ts (Market<T> builders + queries), claims.ts (extracted from governance.ts). ssu-market.ts rewritten for SsuConfig. All package IDs populated.
- **packages/sui-client/** -- Complete. Migrated from JSON-RPC to GraphQL (plan 09).
- **packages/shared/, tsconfig/** -- Complete.

## Plan Status Summary

| Plan | Location | Status | Completion | Remaining |
|------|----------|--------|------------|-----------|
| 01 -- Project Setup | `archive/` | Complete | 100% | None |
| 02 -- Phases 0-5 | `superseded/` | Superseded | ~40% | Superseded by Plans 03, 04, 06 |
| 03 -- Turret Config + Sponsored TX | `archive/` | Complete | 100% | None |
| 04 -- Governance System | `archive/` | Complete | ~95% | Cleanup only (low priority) |
| 05 -- Governance Phase 2 | `superseded/` | Draft | 0% | Post-hackathon |
| 06 -- Market & Currency System | `archive/` | Complete | 100% | None |
| **07 -- Hackathon Remaining Work** | `active/` | **This plan** | -- | -- |
| 08 -- Trade Page Improvements | `archive/` | Complete | 100% | None |
| 09 -- GraphQL Migration | `archive/` | Complete | 100% | None |
| 10 -- Server Switch + Wallet Streamline | `archive/` | Complete | 100% | None |
| 11 -- Deployables Merge | `archive/` | Complete | 100% | None |
| 12 -- SSU dApp | `archive/` | Complete | 100% | None |
| 13 -- Sonar & Bridge | `archive/` | Complete | 100% | None |
| 14 -- Structure Locations | `archive/` | Complete | 100% | None |
| 15 -- Sonar Restructure | `archive/` | Complete | 100% | None |
| 16 -- ACL Market Standardization | `archive/` | Complete | 100% | Contracts published, dApp UIs done |
| 17 -- App Deployment | `pending/` | Partially Superseded | ~20% | Cloudflare Pages approach chosen; server app phases moot |
| 18 -- Solar System Data | `archive/` | Complete | 100% | None |
| **19 -- SSU Inventory Transfers** | `archive/` | Complete | 100% | None |
| 20 -- Consolidate dApps | `archive/` | Complete | 100% | None |
| 21 -- Market Architecture | `archive/` | Complete | 100% | None |
| 22 -- Market Buy Order Improvements | `active/` | Ready | ~0% | Adds buy order timestamps, original_quantity, fee fix, bigint pricing, is_public on SsuConfig |
| 23 -- Private Map System | `active/` | Ready | ~0% | Encrypted location sharing via on-chain maps with invite-based key distribution |
| 24 -- Manifest Public Locations | `active/` | Ready | ~0% | Cache LocationRevealedEvent data in Periscope manifest |

## Remaining Work

### Critical Path (must-have for hackathon)

These items are required for a functional standalone demo.

1. ~~**Build verification**~~ **DONE** -- Build passes.

2. ~~**Publish `governance_ext` to testnet**~~ **DONE** -- Published at `0x670b84...bec349`.

3. ~~**UI polish: ServerSwitcher + Wallet + lazy-load + cleanup**~~ **DONE** -- ServerSwitcher moved to Manifest, Wallet view created, 9 views lazy-loaded, TenantSwitcher deleted.

4. ~~**Fix pre-existing TS errors**~~ **DONE** -- GovernanceFinance `signAndExecute` API fixed, GovernanceTurrets/TurretConfig owner type fixed.

5. ~~**Embed token_template bytecodes**~~ **DONE** -- Bytecodes embedded as base64 in `packages/chain-shared/src/token-factory.ts` (`TEMPLATE_BYTECODES_B64`). `buildPublishToken()` uses `atob()` to decode and patch bytecodes in-browser.

6. ~~**Publish `acl_registry` and `currency_market` to testnet**~~ **DONE** -- Both contracts published. `acl_registry` at `0x3b1cde...3ffc3b55`, `currency_market` at `0x07d963...5cf035a6`. Config updated with real package IDs. `gate_acl` re-published against Utopia world package at `0x44ff83...3af4583`.

7. **Test standalone E2E flows** (~2-3 hours) -- Start Periscope dev server, connect EVE Vault, test these flows without any gas station:
   - Finance: create currency (in-browser), manage authorized minters, mint tokens, burn tokens
   - GovernanceClaims: create claim, update weight, remove claim
   - Wallet: verify SUI balance displays, token balances after mint
   - Sonar: verify Pings tab filtering, Log Feed with live stats, Chain Feed with on-chain events
   - Deployables: verify Location column editing with planet/L-point picker
   - SSU dApp: open with `?tenant=&itemId=` params, verify inventory display + owner transfers + market extension transfers (admin: owner<->escrow, owner->player, escrow->player; player: to escrow, to owner; character search for new player transfers)
   - SSU Market dApp: open with `?configId=`, verify listings and buy flow; test currency market browser
   - Permissions dApp: test shared ACL creation and browsing
   - Fix any runtime errors discovered
   - Files: Various `apps/periscope/src/views/Finance.tsx`, `apps/periscope/src/views/GovernanceClaims.tsx`, `apps/ssu-dapp/`, `apps/ssu-market-dapp/`, `apps/permissions-dapp/`

8. **Demo recording** (~2-3 hours) -- Record screen captures of key flows:
   - System claims (GovernanceClaims)
   - Currency creation + Market<T> management + mint/burn (Finance)
   - SSU dApp Market tab -- sell listings, buy orders
   - Star Map 3D navigation
   - Sonar tabbed interface (Pings with alerts, Log Feed, Chain Feed)
   - Structure location recording in Deployables
   - Shared ACL creation + gate binding (Permissions dApp)
   - Currency market browsing (SSU Market dApp)
   - SSU dApp inventory viewing + owner transfers + market extension inter-slot transfers
   - Wallet view with balances
   - Periscope dashboard overview

9. **Hackathon submission** (~1 hour) -- README with setup instructions, demo video upload, submission page.
   - Files: `README.md` at project root

### High Value (should-have)

These items significantly strengthen the submission but are not blocking.

10. ~~**SSU Market contract upgrade on-chain**~~ **DONE (alternative approach)** -- Instead of upgrading `ssu_market` (Stillness), a new `ssu_market_utopia` (v3) was published at `0x53c2bf...17501` with escrow-based sell orders, OrgMarket, buy orders, and `buy_and_withdraw<T>()`. 650 lines. Now superseded by Plan 21 (unified Market<T> + SsuConfig architecture).

11. **Cross-view navigation polish** (~2 hours) -- Ensure navigation between views works smoothly (e.g., Players -> "Add to tier", Killmails -> "Mark hostile", Finance -> "Go to Claims").
    - Files: Various view files in `apps/periscope/src/views/`

12. **Deploy dApps to hosting** (~1 hour) -- Get Periscope, SSU dApp, SSU Market dApp, and Permissions dApp hosted at public URLs. Cloudflare Pages config exists for ssu-dapp (`docs/cloudflare-pages-setup.md`); replicate for other apps.
    - Depends on: Cloudflare account setup, push to main

13. ~~**Archive completed plans**~~ **DONE** -- Plans 10, 12, 14, 15, 16, 18, 19 moved to `docs/plans/archive/`.

### Nice to Have (stretch goals)

14. ~~**Gas station turret pipeline**~~ **REMOVED** -- Gas station removed from codebase.

15. **Exchange `match_orders()` implementation** (~4-6 hours) -- Add order matching to the DEX contract.
    - Files: `contracts/exchange/sources/exchange.move`

16. **Bounty board UI in Finance** (~2 hours) -- Wire the bounty posting flow (imports and status already exist).
    - Files: `apps/periscope/src/views/Finance.tsx`


## Implementation Phases

### Phase 1: Build Verification & Contract Deployment (Day 1) -- COMPLETE

1. ~~Build passes.~~ **DONE**
2. ~~`governance_ext` published.~~ **DONE**
3. ~~Config updated.~~ **DONE**

### Phase 2: Standalone Token Factory (Day 2) -- COMPLETE

1. ~~Run `sui move build` in `contracts/token_template/` to ensure compiled bytecodes exist.~~ **DONE** -- Build output exists.
2. ~~Extract the compiled module bytecodes from the build output.~~ **DONE**
3. ~~Embed bytecodes in `packages/chain-shared/src/token-factory.ts` (replace `null`).~~ **DONE** -- `TEMPLATE_BYTECODES_B64` contains base64-encoded bytecodes.
4. ~~Verify `pnpm build` still passes.~~ **DONE**
5. ~~Smoke test: `buildPublishToken()` returns a valid `Transaction` object.~~ **DONE** (tested via multiple fix commits)

### Phase 3: Feature Implementation (Days 3-7) -- COMPLETE

All tracked feature plans have been implemented:

1. ~~Sonar & Bridge system (plan 13).~~ **DONE** -- Implemented and archived.
2. ~~SSU dApp phases 3-4: owner inventory transfers + polish (plan 12).~~ **DONE** -- Partial stack support, error decoder, responsive layout.
3. ~~ACL Registry + Currency Market contracts (plan 16, phases 1-2).~~ **DONE** -- `acl_registry.move` and `currency_market.move` written. `gate_acl` upgraded with shared ACL support.
4. ~~ACL Registry + Currency Market dApp UIs (plan 16, phases 3-4).~~ **DONE** -- chain-shared TX builders, permissions-dapp shared ACL tab, ssu-market-dapp currency market browser.
5. ~~Solar system planet data extraction (plan 18).~~ **DONE** -- `stellar_systems.json` augmented, `celestials.json` created, Dexie V18 table, L-point computation utilities.
6. ~~Sonar restructure into tabbed UI (plan 15, all 6 phases).~~ **DONE** -- Radar DB cleanup, hook consolidation at Layout level, extracted shared components, Pings/Log Feed/Chain Feed tabs, alert system.
7. ~~Structure location recording (plan 14).~~ **DONE** -- SystemSearch component, Location column in Deployables with inline editor, DB V19 with systemId index.
8. ~~Deployables merge (plan 11).~~ **DONE** -- Archived.
9. ~~GraphQL migration (plan 09).~~ **DONE** -- Archived.
10. ~~Server switch + wallet streamline (plan 10).~~ **DONE** -- Wallet auto-connect, ServerSwitcher deleted, CharacterSwitcher simplified.

### Phase 4: Contract Publishing & E2E Testing (Days 8-10) -- IN PROGRESS

1. ~~Publish `acl_registry` to Sui testnet, update `packages/chain-shared/src/config.ts` with real package ID.~~ **DONE** -- `0x3b1cde...3ffc3b55`.
2. ~~Publish `currency_market` to Sui testnet, update config.~~ **DONE** -- `0x07d963...5cf035a6`.
3. ~~Re-publish `gate_acl` upgrade (shared ACL support).~~ **DONE** -- Re-published against Utopia world package at `0x44ff83...3af4583`.
4. Start Periscope dev server: `pnpm --filter @tehfrontier/periscope dev`.
5. Connect EVE Vault wallet.
6. Test Finance: create currency (in-browser WASM), manage authorized minters, mint tokens, burn tokens.
7. Test GovernanceClaims: create claim, update weight, remove claim.
8. Test SSU dApp Market tab: create sell listing, buy from listing, create buy order.
9. Test Sonar: verify Pings tab (filtered events, audio alert), Log Feed (live stats), Chain Feed.
10. Test Deployables Location column: add/edit system + planet + L-point for a structure.
11. Test Wallet: verify SUI balance, token balances after minting.
12. Test SSU dApp: verify inventory display with URL params, owner transfers, market extension inter-slot transfers (admin + player routes, character search).
13. Test SSU Market dApp: verify SSU listings and buy flow, currency market browsing.
14. Test Permissions dApp: shared ACL creation and browsing.
15. Fix any runtime errors discovered during testing.

### Phase 5: Demo & Submission (Days 11-13)

1. Fix any remaining UI issues found during testing.
2. Prepare demo script -- ordered list of features to show.
3. Record demo video (screen capture with narration).
4. Write/update README with:
   - Project description (governance toolkit for EVE Frontier)
   - Setup instructions (prerequisites, commands -- no gas station required)
   - Architecture overview (monorepo, 13 project contracts + 2 world packages + token_template, standalone Periscope SPA, 3 standalone dApps)
   - Demo video link
5. Submit to hackathon.

### Phase 6: Stretch Goals (remaining time, if ahead of schedule)

1. ~~SSU Market upgrade + trade testing (item 10).~~ **DONE** -- `ssu_market_utopia` published. Now superseded by Plan 21.
2. Cross-view navigation polish (item 11).
3. Deploy dApps to hosting (item 12, plan 17).
4. ~~Archive completed plans (item 13).~~ **DONE** -- Plans 10, 12, 14, 15, 16, 18, 19 all archived.
5. ~~Gas station turret pipeline testing (item 14).~~ **REMOVED** -- Gas station removed from codebase.
6. Bounty board integration (item 16).

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/chain-shared/src/config.ts` | ~~MODIFY~~ DONE | `governanceExt.packageId` filled for stillness + utopia |
| `apps/periscope/src/components/TenantSwitcher.tsx` | ~~DELETE~~ DONE | Dead code removed |
| `apps/periscope/src/router.tsx` | ~~MODIFY~~ DONE | 9 views lazy-loaded, Sonar/Bridge/Killmails routes added, Radar removed |
| `apps/periscope/src/views/Finance.tsx` | ~~FIX~~ DONE | Replaces GovernanceFinance.tsx. signAndExecute API fixed (waitForTransaction pattern) |
| `apps/periscope/src/views/GovernanceTurrets.tsx` | ~~FIX~~ DONE | owner type assertion fixed |
| `apps/periscope/src/views/TurretConfig.tsx` | ~~FIX~~ DONE | owner type assertion fixed |
| `packages/chain-shared/src/token-factory.ts` | ~~CRITICAL~~ DONE | Bytecodes embedded as base64 (`TEMPLATE_BYTECODES_B64`) |
| `contracts/ssu_market_utopia/` | ~~DEPLOY~~ DONE | Published at `0x53c2bf...17501` (v3 with escrow sell orders) |
| `apps/ssu-dapp/` | DONE | Default SSU viewer dApp with owner transfers (plan 12) |
| `apps/ssu-market-dapp/` | DONE | SSU Market + Currency Market dApp (plan 16 phase 4) |
| `apps/periscope/src/views/Sonar.tsx` | DONE | Tabbed Pings/Log Feed/Chain Feed (plan 15) |
| `apps/periscope/src/views/Bridge.tsx` | DONE | Curated Sonar dashboard (plan 13), hook cleanup (plan 15) |
| `apps/periscope/src/views/Killmails.tsx` | DONE | Killmail intel view (plan 13) |
| `apps/periscope/src/views/Deployables.tsx` | DONE | Unified grid + Location column with inline editor (plans 11, 14) |
| `apps/periscope/src/views/Logs.tsx` | DONE | LiveTab removed, extracted components (plan 15) |
| `apps/periscope/src/views/Locations.tsx` | DONE | Shared SystemSearch component (plan 14) |
| `apps/periscope/src/components/SystemSearch.tsx` | DONE | Extracted shared component (plan 14) |
| `apps/periscope/src/components/LogEventRow.tsx` | DONE | Extracted component (plan 15) |
| `apps/periscope/src/components/StatCard.tsx` | DONE | Extracted component (plan 15) |
| `apps/periscope/src/components/GrantAccessView.tsx` | DONE | Extracted component (plan 15) |
| `apps/periscope/src/lib/format.ts` | DONE | Extracted utilities (plan 15) |
| `apps/periscope/src/lib/celestials.ts` | DONE | Celestial data lazy-loader (plan 18) |
| `apps/periscope/src/lib/lpoints.ts` | DONE | L-point computation (plan 18) |
| `apps/periscope/src/hooks/useSonarAlerts.ts` | DONE | Layout-level ping alerts (plan 15) |
| `apps/periscope/src/stores/sonarStore.ts` | DONE | Ping settings, activeTab, persistence (plan 15) |
| `apps/periscope/src/stores/logStore.ts` | DONE | grantAccess/clearAndReimport callbacks, removed "live" tab (plan 15) |
| `apps/periscope/src/hooks/useLogWatcher.ts` | DONE | Callbacks registered on store (plan 15) |
| `contracts/acl_registry/sources/acl_registry.move` | DONE | SharedAcl CRUD (plan 16) |
| `contracts/gate_acl/` | DONE | Shared ACL support upgrade (plan 16) |
| `packages/chain-shared/src/acl-registry.ts` | DONE | TX builders + queries (plan 16) |
| `packages/chain-shared/src/permissions.ts` | DONE | Shared ACL gate builders (plan 16) |
| `apps/permissions-dapp/src/App.tsx` | DONE | Tabbed UI with Shared ACLs (plan 16) |
| `packages/chain-shared/src/config.ts` | DONE | All package IDs populated (market, ssuMarket package IDs now populated) |
| `contracts/ssu_market/sources/ssu_market.move` | DONE | 7 transfer functions + assert_admin + TransferEvent (plan 19) |
| `contracts/ssu_market_utopia/sources/ssu_market.move` | DONE | Same transfer functions (utopia copy, plan 19) |
| `contracts/world_stillness/` | DONE | Local World package dependency for Stillness builds (plan 19) |
| `apps/ssu-dapp/src/hooks/useSsuConfig.ts` | DONE | Discover + query MarketConfig for SSU (plan 19) |
| `apps/ssu-dapp/src/hooks/useCharacterSearch.ts` | DONE | Character name search for admin transfers (plan 19) |
| `apps/ssu-dapp/src/components/TransferDialog.tsx` | DONE | Role-aware market PTB builders + character search UI (plan 19) |
| `apps/ssu-dapp/src/views/SsuView.tsx` | DONE | Integrated useMarketConfig, passes market info to TransferContext (plan 19) |
| `apps/ssu-dapp/src/lib/constants.ts` | DONE | getSsuMarketPackageId/getSsuMarketOriginalPackageId helpers (plan 19) |
| `apps/periscope/src/views/Finance.tsx` | TEST | Runtime test of Market<T> management (currency creation, mint/burn, authorized minters) |
| `apps/periscope/src/views/GovernanceClaims.tsx` | TEST | Verify claims CRUD |

## Open Questions

1. ~~**Has `pnpm build` ever succeeded?**~~ **RESOLVED** -- Yes.

2. ~~**Are the `token_template` compiled bytecodes available?**~~ **RESOLVED** -- Yes. Build output exists at `contracts/token_template/build/token_template/bytecode_modules/TOKEN_TEMPLATE.mv`. Bytecodes are embedded in `token-factory.ts` as `TEMPLATE_BYTECODES_B64`.

3. ~~**Are UpgradeCaps available for deployed contracts?**~~ **RESOLVED (alternative approach)** -- Instead of upgrading `ssu_market` (Stillness), a fresh `ssu_market_utopia` was published for the Utopia tenant with v3 code (escrow sell orders, buy orders, `buy_and_withdraw`). UpgradeCap: `0x232d...002d4`.

4. **Is the hackathon submission format determined?** Need to confirm: video required? README? Live demo? GitHub repo link?

5. **App deployment hosting** -- Plan 17 (pending) covers deployment but has open questions. For hackathon submission, do we need public URLs or is a GitHub repo with setup instructions sufficient?

6. ~~**`gate_acl` upgrade publishing**~~ **RESOLVED** -- Re-published as a new package against Utopia world package at `0x44ff83...3af4583`. Stillness version unchanged.

## Deferred

- **Gas station service** -- Removed from codebase. Custom turret compilation would need to be re-implemented if needed post-hackathon.
- **Plan 05 (Governance Phase 2)** -- All 5 workstreams. Post-hackathon.
- ~~**apps/web/, apps/api/, packages/db/**~~ -- Removed from codebase (commit `8e9e117`).
- ~~**SuiGrpcClient migration**~~ **DONE** -- GraphQL migration completed (plan 09).
- **Exchange order matching** -- DEX without matching is limited. Stretch goal.
- **Gate integration with governance tiers** -- Requires CCP clarification. Plan 05.
- **Turret shared ACL** -- SharedAcl struct supports turrets conceptually, but turret priority uses a fundamentally different execution model (devInspect + OnlineReceipt). Separate follow-up plan needed.
- **Periscope integration of shared ACL** -- Contracts are now published. Could add governance views in Periscope for managing shared ACLs. Low priority -- standalone dApps already cover these flows.
- **P2P sync** -- Removed from Periscope (commit `0061f5d`). Plan 05 Phase 2d Step 3 referencing P2P sync is stale.
