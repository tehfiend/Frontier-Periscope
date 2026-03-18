# Plan: Hackathon Remaining Work

**Status:** Active
**Created:** 2026-03-15
**Updated:** 2026-03-18 (v5: status refresh -- plans 12/14/15/16/18 implemented, 2 new contracts, sonar restructured, SSU dApp complete, 13 days remaining)
**Module:** multi

## Overview

The EVE Frontier x Sui Hackathon ("A Toolkit for Civilization") runs March 11-31, 2026, with an $80K prize pool. Community voting follows April 1-15, judging April 15-22, and winners announced April 24. With 13 days remaining (March 18 to March 31), this plan maps what has been built, what remains, and the critical path to a compelling hackathon submission.

The project has made substantial progress: 17 Move contracts written (15 published to Sui testnet, 2 awaiting publish), a 123-file Periscope SPA with 30 views, a standalone SSU dApp (with owner inventory transfers) and SSU Market dApp (with currency market browser), a governance system with 4-tier organizations and claims deployed on-chain, and a full chain-shared package with TX builders for every contract. The monorepo infrastructure is solid (Turborepo, pnpm, Biome, 5 shared packages). Since the last update, five plans have been fully implemented: Sonar restructured into a tabbed Pings/Log Feed/Chain Feed interface (plan 15), structure location recording with planet/L-point selection (plan 14), solar system planet data extraction (plan 18), SSU dApp owner inventory transfers (plan 12), and ACL registry + currency market contracts + dApp UIs (plan 16). Plans 06, 08, 09, 11, and 13 have been archived as complete.

**Standalone-first approach:** Periscope is a fully client-side SPA -- no backend server required. Currency creation uses in-browser WASM bytecode patching (`buildPublishToken` via `@mysten/move-bytecode-template`), all governance TX builders run in-browser, and the user's wallet (EVE Vault) handles signing and gas. The gas station is an **optional enhancement** for custom turret package compilation only -- it is not on the critical path.

The hackathon theme is "A Toolkit for Civilization." The strongest submission angle is the governance organization system (Plan 04) combined with the closed-loop economy (Plan 06), the Periscope intel tool, the standalone SSU dApps, and the shared ACL registry + currency market system (Plan 16). The critical path is now: **publish 2 new contracts -> test standalone E2E flows -> polish UI -> record demo -> submit.**

## Current State -- Module Audit

### contracts/ -- 17 Move Packages

All contracts are located in `contracts/` with one `sources/` directory each.

| Contract | Published | Package ID | Notes |
|----------|-----------|-----------|-------|
| `turret_shoot_all` | Yes | `0x4ad1a1...3294b9` | Simplest turret, 1 source file |
| `turret_priority` | Yes | `0xbbca3a...bbb5ef` | Customizable turret priorities via code generation |
| `gate_acl` | Yes | `0x7e0ad0...9ad44c` | ACL-based gate control + config object. Upgraded with shared ACL support (plan 16). |
| `gate_tribe` | Yes | `0x7ce73c...fd3298` | Tribe-based gate filtering |
| `gate_toll` | Yes | `0xcef451...e1f6a8` | Toll gate extension |
| `gate_unified` | Yes | `0x364f68...36210f` | Groups + per-gate config + toll (most capable gate) |
| `exchange` | Yes | `0x72928e...48315d` | Order book DEX (lacks `match_orders()`) |
| `ssu_market` | Yes (v1) | `0xdb9df1...c8885` | SSU vending machine (Stillness). Original sell-only version. |
| `ssu_market_utopia` | Yes (v3) | `0x53c2bf...17501` | SSU market rebuilt for Utopia. Escrow-based sell orders, OrgMarket, buy orders, `buy_and_withdraw<T>()`. 650 lines. |
| `bounty_board` | Yes | `0xf55f78...1b4bf` | Generic bounty escrow (works with any `Coin<T>`) |
| `lease` | Yes | `0x9920af...bc7ce` | SSU rental system |
| `token_template` | Yes | `0x38e749...65ccf` | Template token (init creates TreasuryCap) |
| `governance` | Yes | `0x8bef45...a578cb` | 4-tier Organization + ClaimsRegistry, 9 tests |
| `governance_ext` | Yes | `0x670b84...bec349` | `treasury.move` (138 lines), OrgTreasury shared object |
| `acl_registry` | **No** | -- | NEW (plan 16). Shared ACL objects for cross-player gate configuration. Code complete, awaiting publish. |
| `currency_market` | **No** | -- | NEW (plan 16). Per-currency order books with sell listings + buy order escrow. Code complete, awaiting publish. |
| `world_utopia` | N/A (CCP) | `0xd12a70...043f75` | Local copy of CCP's World package (Utopia). Build dependency for `ssu_market_utopia`. |

**Key gaps:**
- `acl_registry` and `currency_market` need publishing to Sui testnet (code complete, placeholder addresses in config)
- `gate_acl` upgrade needs re-publishing (shared ACL support added per plan 16)
- `exchange` lacks `match_orders()` (deferred, not critical for hackathon)

### apps/periscope/ -- Frontier Periscope Intel Tool (123 source files)

The primary deliverable. 30 views across 32 routes (including redirects), IndexedDB with 19 schema versions, dark theme SPA. **Fully standalone -- no backend required.**

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
| `GovernanceDashboard.tsx` | 600 | Org creation, 4 tier panels, wired to chain TX |
| `GovernanceClaims.tsx` | 487 | Claims + nicknames, wired to chain TX |
| `GovernanceTurrets.tsx` | 355 | Public/private mode, turret build+deploy (requires gas station) |
| `GovernanceFinance.tsx` | 1310 | In-browser currency creation (WASM bytecode patching), OrgTreasury deposit, mint/burn |
| `GovernanceTrade.tsx` | 2053 | Sell orders + buy orders tabs, SSU market management, escrow sell orders |
| `Locations.tsx` | 395 | Location bookmarking and notes. Uses shared `SystemSearch` component. |
| `Settings.tsx` | 721 | DB management, encryption, backup, polling config |
| `PeerSync.tsx` | 598 | WebRTC P2P sync configuration |
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

**Changes since last update (v4 -> v5):**
- `Sonar.tsx` **restructured** into tabbed Pings/Log Feed/Chain Feed interface (plan 15, 655 lines up from 297)
- `Logs.tsx` **updated** -- LiveTab removed (absorbed into Sonar), default tab now "sessions", extracted shared components
- `Deployables.tsx` **updated** -- Location column with inline LocationEditor popover, system/planet/L-point selector (plan 14, 1284 lines up from 975)
- `Locations.tsx` **updated** -- uses shared `SystemSearch` component (plan 14)
- `Bridge.tsx` **updated** -- duplicate sonar hook calls removed (plan 15)
- New extracted components: `LogEventRow.tsx`, `StatCard.tsx`, `GrantAccessView.tsx`, `SystemSearch.tsx`
- New hooks: `useSonarAlerts.ts` (layout-level ping alerts with audio + desktop notification)
- New utilities: `format.ts` (`fmtDateTime`, `fmtTime`, `formatDuration`), `celestials.ts` (lazy-load celestial data), `lpoints.ts` (L-point computation)
- DB schema now at V19 (V18 dropped radar tables, V19 added systemId index for deployables)
- Planet data added to `stellar_systems.json` (sunTypeId, planetCount, planetCountByType, planetItemIds)
- New `celestials.json` with per-planet coordinates from `mapObjects.db`
- Sonar/log/chain hooks all run at Layout level; callbacks exposed via stores

**Standalone features (no gas station needed):**
- All intel views (Dashboard, StarMap, Sonar, Bridge, Killmails, Logs, JumpPlanner, Intel, Players, Targets, etc.)
- GovernanceDashboard -- org creation + tier management (in-browser TX)
- GovernanceClaims -- claims CRUD (in-browser TX)
- GovernanceFinance -- currency creation via `buildPublishToken()` (in-browser WASM), deposit TreasuryCap, mint, burn
- GovernanceTrade -- sell + buy orders, SSU market management (uses `ssu_market_utopia` on Utopia)
- Wallet -- SUI + token balances, faucet link
- Extension authorization -- authorizing pre-published extensions on assemblies

**Gas station dependent (optional enhancement):**
- GovernanceTurrets -- custom turret package compilation + publish (requires `/build-turret`)
- Sponsored transactions -- `useSponsoredTransaction` hook (currently unused by standalone flows)

**Status assessment:** GovernanceFinance uses `buildPublishToken()` from `token-factory.ts` which does in-browser bytecode patching. Bytecodes are embedded as base64 in `TEMPLATE_BYTECODES_B64`. The full currency lifecycle works without any server. GovernanceTrade is functional with `ssu_market_utopia` on Utopia tenant.

### apps/ssu-market-dapp/ -- SSU Market Trading dApp

Standalone Vite + React dApp for SSU marketplace interactions. Deployed at port 3200. Uses `@mysten/dapp-kit-react` with EVE Vault. Components: `MarketView`, `OwnerView`, `BuyerView`, `ListingCard`, `ListingForm`. Has hooks for market config, listings, inventory, and sign+execute. **Updated (plan 16):** Now includes `CurrencyMarketView`, `MarketBrowser`, `PostSellListing`, `PostBuyOrder` components for browsing and interacting with currency markets. Routes between SSU market mode (`?configId=`) and currency market mode (`?marketId=`).

### apps/ssu-dapp/ -- Default SSU Viewer -- COMPLETE

Standalone dApp reproducing the default SSU interface (what players see when pressing F on a Storage Unit). **Updated (plan 12 phases 3-4):** Now includes owner inventory transfers with partial stack support (withdraw to wallet, deposit from wallet with remainder pattern), `@noble/hashes` dependency, Move error code decoder, responsive layout for in-game browser, market dApp link when SSU has market extension.

### apps/gas-station/ -- Gas Station API (5 source files) -- OPTIONAL

Express server (port 3100) with 5 endpoints: `/build-turret`, `/build-governance-turret`, `/build-token`, `/sponsor`, `/health`. Only needed for custom turret package compilation. **Not required for hackathon critical path.**

### apps/permissions-dapp/ -- Permissions Management dApp

Functional standalone ACL editor with EVE Vault config. **Updated (plan 16 phase 4):** Now includes tabbed navigation between "Assembly ACL" (existing inline ACL editor) and "Shared ACLs" (new browser + create/edit form with bulk update, admin management). Uses chain-shared `acl-registry.ts` builders.

### Other Modules

- **apps/web/** -- Unused scaffold. Not part of hackathon.
- **apps/api/** -- Unused scaffold. Not part of hackathon.
- **packages/chain-shared/** -- Complete. All TX builders work in-browser. Token factory bytecodes embedded. GraphQL migration complete. **Updated (plan 16):** New `acl-registry.ts` and `currency-market.ts` modules with TX builders and queries. Updated `permissions.ts` with shared ACL gate builders. Placeholder addresses in config for unpublished contracts.
- **packages/sui-client/** -- Complete. Migrated from JSON-RPC to GraphQL (plan 09).
- **packages/shared/, db/, tsconfig/** -- Complete.

## Plan Status Summary

| Plan | Location | Status | Completion | Remaining |
|------|----------|--------|------------|-----------|
| 01 -- Project Setup | `archive/` | Complete | 100% | None |
| 02 -- Phases 0-5 | `superseded/` | Superseded | ~40% | Superseded by Plans 03, 04, 06 |
| 03 -- Turret Config + Sponsored TX | `archive/` | Complete | 100% | None |
| 04 -- Governance System | `archive/` | Complete | ~95% | Cleanup only (low priority) |
| 05 -- Governance Phase 2 | `pending/` | Draft | 0% | Post-hackathon |
| 06 -- Market & Currency System | `archive/` | Complete | 100% | None |
| **07 -- Hackathon Remaining Work** | `active/` | **This plan** | -- | -- |
| 08 -- Trade Page Improvements | `archive/` | Complete | 100% | None |
| 09 -- GraphQL Migration | `archive/` | Complete | 100% | None |
| 10 -- Server Switch + Wallet Streamline | `active/` | Implemented | ~100% | Should move to archive |
| 11 -- Deployables Merge | `archive/` | Complete | 100% | None |
| 12 -- SSU dApp | `active/` | Complete | 100% | All 4 phases done. Should move to archive. |
| 13 -- Sonar & Bridge | `archive/` | Complete | 100% | None |
| 14 -- Structure Locations | `active/` | Complete | 100% | All phases implemented. Should move to archive. |
| 15 -- Sonar Restructure | `active/` | Complete | 100% | All 6 phases implemented. Should move to archive. |
| 16 -- ACL Market Standardization | `active/` | Code Complete | ~90% | Contracts need publishing to testnet. dApp UIs done. |
| 17 -- App Deployment | `pending/` | Draft | 0% | Has open questions |
| 18 -- Solar System Data | `active/` | Complete | 100% | Both phases implemented. Should move to archive. |

## Remaining Work

### Critical Path (must-have for hackathon)

These items are required for a functional standalone demo.

1. ~~**Build verification**~~ **DONE** -- Build passes.

2. ~~**Publish `governance_ext` to testnet**~~ **DONE** -- Published at `0x670b84...bec349`.

3. ~~**UI polish: ServerSwitcher + Wallet + lazy-load + cleanup**~~ **DONE** -- ServerSwitcher moved to Manifest, Wallet view created, 12 views lazy-loaded, TenantSwitcher deleted.

4. ~~**Fix pre-existing TS errors**~~ **DONE** -- GovernanceFinance `signAndExecute` API fixed, GovernanceTurrets/TurretConfig owner type fixed.

5. ~~**Embed token_template bytecodes**~~ **DONE** -- Bytecodes embedded as base64 in `packages/chain-shared/src/token-factory.ts` (`TEMPLATE_BYTECODES_B64`). `buildPublishToken()` uses `atob()` to decode and patch bytecodes in-browser.

6. **Publish `acl_registry` and `currency_market` to testnet** (~1 hour) -- Both contracts are code complete but have placeholder addresses (`0x000...`) in `packages/chain-shared/src/config.ts`. Need `sui client publish` for each, then update config with real package IDs. Also re-publish `gate_acl` upgrade for shared ACL support.
   - Files: `packages/chain-shared/src/config.ts`, `contracts/acl_registry/Move.toml`, `contracts/currency_market/Move.toml`

7. **Test standalone E2E flows** (~2-3 hours) -- Start Periscope dev server, connect EVE Vault, test these flows without any gas station:
   - GovernanceDashboard: create org, add tier members, verify chain TX
   - GovernanceFinance: create currency (in-browser), deposit TreasuryCap, mint tokens, burn tokens
   - GovernanceClaims: create claim, update weight, remove claim
   - GovernanceTrade: create sell order, buy from sell order (Utopia tenant with `ssu_market_utopia`)
   - Wallet: verify SUI balance displays, token balances after mint
   - Sonar: verify Pings tab filtering, Log Feed with live stats, Chain Feed with on-chain events
   - Deployables: verify Location column editing with planet/L-point picker
   - SSU dApp: open with `?tenant=&itemId=` params, verify inventory display + owner transfers
   - SSU Market dApp: open with `?configId=`, verify listings and buy flow; test currency market browser
   - Permissions dApp: test shared ACL creation and browsing
   - Fix any runtime errors discovered
   - Files: Various `apps/periscope/src/views/Governance*.tsx`, `apps/ssu-dapp/`, `apps/ssu-market-dapp/`, `apps/permissions-dapp/`

8. **Demo recording** (~2-3 hours) -- Record screen captures of key flows:
   - Organization creation + tier management (GovernanceDashboard)
   - System claims (GovernanceClaims)
   - Currency creation + OrgTreasury + mint/burn (GovernanceFinance)
   - SSU Market sell/buy order management (GovernanceTrade)
   - Star Map 3D navigation
   - Sonar tabbed interface (Pings with alerts, Log Feed, Chain Feed)
   - Structure location recording in Deployables
   - Shared ACL creation + gate binding (Permissions dApp)
   - Currency market browsing (SSU Market dApp)
   - SSU dApp inventory viewing + owner transfers
   - Wallet view with balances
   - Periscope dashboard overview

9. **Hackathon submission** (~1 hour) -- README with setup instructions, demo video upload, submission page.
   - Files: `README.md` at project root

### High Value (should-have)

These items significantly strengthen the submission but are not blocking.

10. ~~**SSU Market contract upgrade on-chain**~~ **DONE (alternative approach)** -- Instead of upgrading `ssu_market` (Stillness), a new `ssu_market_utopia` (v3) was published at `0x53c2bf...17501` with escrow-based sell orders, OrgMarket, buy orders, and `buy_and_withdraw<T>()`. 650 lines. GovernanceTrade view is wired to this.

11. **Cross-view navigation polish** (~2 hours) -- Ensure navigation between views works smoothly (e.g., Players -> "Add to tier", Killmails -> "Mark hostile", GovernanceDashboard -> "Go to Finance/Claims").
    - Files: Various view files in `apps/periscope/src/views/`

12. **Deploy dApps to hosting** (~2 hours) -- Get Periscope, SSU dApp, SSU Market dApp, and Permissions dApp hosted at public URLs for the demo. Plan 17 covers this but is still in pending.
    - Depends on: Plan 17 decisions

13. **Archive completed plans** (~15 min) -- Plans 10, 12, 14, 15, 18 are complete and should be moved to `docs/plans/archive/`.

### Nice to Have (stretch goals)

14. **Gas station turret pipeline** (~2 hours) -- If gas station is running, test `/build-turret` and GovernanceTurrets deploy flow. Optional add-on for the demo.
    - Requires: `GAS_STATION_PRIVATE_KEY` env var, `sui` CLI installed

15. **Exchange `match_orders()` implementation** (~4-6 hours) -- Add order matching to the DEX contract.
    - Files: `contracts/exchange/sources/exchange.move`

16. **Bounty board UI in GovernanceFinance** (~2 hours) -- Wire the bounty posting flow (imports and status already exist).
    - Files: `apps/periscope/src/views/GovernanceFinance.tsx`

17. **P2P sync demo** (~3 hours) -- Show two Periscope instances syncing intel via WebRTC.
    - Files: `apps/periscope/src/sync/`, `apps/periscope/src/views/PeerSync.tsx`

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

1. Publish `acl_registry` to Sui testnet, update `packages/chain-shared/src/config.ts` with real package ID.
2. Publish `currency_market` to Sui testnet, update config.
3. Re-publish `gate_acl` upgrade (shared ACL support) if needed.
4. Start Periscope dev server: `pnpm --filter @tehfrontier/periscope dev`.
5. Connect EVE Vault wallet.
6. Test GovernanceDashboard: create org, add tier members, verify chain TX execution.
7. Test GovernanceFinance: create currency (in-browser WASM), deposit TreasuryCap into OrgTreasury, mint tokens, burn tokens.
8. Test GovernanceClaims: create claim, update weight, remove claim.
9. Test GovernanceTrade: create sell order on SSU market, test buy flow (Utopia tenant).
10. Test Sonar: verify Pings tab (filtered events, audio alert), Log Feed (live stats), Chain Feed.
11. Test Deployables Location column: add/edit system + planet + L-point for a structure.
12. Test Wallet: verify SUI balance, token balances after minting.
13. Test SSU dApp: verify inventory display with URL params, owner transfers.
14. Test SSU Market dApp: verify SSU listings and buy flow, currency market browsing.
15. Test Permissions dApp: shared ACL creation and browsing.
16. Fix any runtime errors discovered during testing.

### Phase 5: Demo & Submission (Days 11-13)

1. Fix any remaining UI issues found during testing.
2. Prepare demo script -- ordered list of features to show.
3. Record demo video (screen capture with narration).
4. Write/update README with:
   - Project description (governance toolkit for EVE Frontier)
   - Setup instructions (prerequisites, commands -- no gas station required)
   - Architecture overview (monorepo, 17 Sui contracts, standalone Periscope SPA, 3 standalone dApps)
   - Demo video link
5. Submit to hackathon.

### Phase 6: Stretch Goals (remaining time, if ahead of schedule)

1. ~~SSU Market upgrade + GovernanceTrade testing (item 10).~~ **DONE** -- `ssu_market_utopia` published.
2. Cross-view navigation polish (item 11).
3. Deploy dApps to hosting (item 12, plan 17).
4. Archive completed plans (item 13).
5. Gas station turret pipeline testing (item 14).
6. Bounty board integration (item 16).
7. P2P sync demo (item 17).

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/chain-shared/src/config.ts` | ~~MODIFY~~ DONE | `governanceExt.packageId` filled for stillness + utopia |
| `contracts/governance_ext/sources/treasury.move` | ~~VERIFY~~ DONE | Published to testnet |
| `apps/periscope/src/components/TenantSwitcher.tsx` | ~~DELETE~~ DONE | Dead code removed |
| `apps/periscope/src/router.tsx` | ~~MODIFY~~ DONE | 12 views lazy-loaded, Sonar/Bridge/Killmails routes added, Radar removed |
| `apps/periscope/src/views/GovernanceFinance.tsx` | ~~FIX~~ DONE | signAndExecute API fixed (waitForTransaction pattern) |
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
| `contracts/currency_market/sources/currency_market.move` | DONE | CurrencyMarket order book (plan 16) |
| `contracts/gate_acl/` | DONE | Shared ACL support upgrade (plan 16) |
| `packages/chain-shared/src/acl-registry.ts` | DONE | TX builders + queries (plan 16) |
| `packages/chain-shared/src/currency-market.ts` | DONE | TX builders + queries (plan 16) |
| `packages/chain-shared/src/permissions.ts` | DONE | Shared ACL gate builders (plan 16) |
| `apps/permissions-dapp/src/App.tsx` | DONE | Tabbed UI with Shared ACLs (plan 16) |
| `packages/chain-shared/src/config.ts` | PUBLISH | Placeholder addresses for `aclRegistry` + `currencyMarket` -- need real package IDs |
| `apps/periscope/src/views/GovernanceFinance.tsx` | TEST | Runtime test of standalone currency lifecycle |
| `apps/periscope/src/views/GovernanceDashboard.tsx` | TEST | Verify org creation + tier management |
| `apps/periscope/src/views/GovernanceClaims.tsx` | TEST | Verify claims CRUD |
| `apps/periscope/src/views/GovernanceTrade.tsx` | TEST | Runtime test of sell/buy orders (Utopia) |

## Open Questions

1. ~~**Has `pnpm build` ever succeeded?**~~ **RESOLVED** -- Yes.

2. ~~**Are the `token_template` compiled bytecodes available?**~~ **RESOLVED** -- Yes. Build output exists at `contracts/token_template/build/token_template/bytecode_modules/TOKEN_TEMPLATE.mv`. Bytecodes are embedded in `token-factory.ts` as `TEMPLATE_BYTECODES_B64`.

3. ~~**Are UpgradeCaps available for deployed contracts?**~~ **RESOLVED (alternative approach)** -- Instead of upgrading `ssu_market` (Stillness), a fresh `ssu_market_utopia` was published for the Utopia tenant with v3 code (escrow sell orders, buy orders, `buy_and_withdraw`). UpgradeCap: `0x232d...002d4`.

4. **Is the hackathon submission format determined?** Need to confirm: video required? README? Live demo? GitHub repo link?

5. **App deployment hosting** -- Plan 17 (pending) covers deployment but has open questions. For hackathon submission, do we need public URLs or is a GitHub repo with setup instructions sufficient?

6. **`gate_acl` upgrade publishing** -- Plan 16 added shared ACL support to `gate_acl`. Does the existing UpgradeCap allow re-publishing? If not, a new package publish may be needed.

## Deferred

- **Gas station service** -- Optional enhancement for custom turret compilation. Not needed for core governance + currency demo. Can be shown as bonus if time permits.
- **Plan 05 (Governance Phase 2)** -- All 5 workstreams. Post-hackathon.
- **apps/web/ and apps/api/** -- Server-side stack. Not part of hackathon deliverable.
- **packages/db/** -- PostgreSQL schema. Only relevant if web/api become active.
- **P2P sync production testing** -- Sync engine written but untested.
- ~~**SuiGrpcClient migration**~~ **DONE** -- GraphQL migration completed (plan 09).
- **Exchange order matching** -- DEX without matching is limited. Stretch goal.
- **Gate integration with governance tiers** -- Requires CCP clarification. Plan 05.
- **Turret shared ACL** -- SharedAcl struct supports turrets conceptually, but turret priority uses a fundamentally different execution model (devInspect + OnlineReceipt). Separate follow-up plan needed.
- **Periscope integration of shared ACL/currency market** -- Periscope could show governance views for managing shared ACLs and currency market activity. Defer until contracts are published and dApps are stable.
