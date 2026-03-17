# Plan: Hackathon Remaining Work

**Status:** Active
**Created:** 2026-03-15
**Updated:** 2026-03-15 (v3: gas station removed from critical path, phases reordered for standalone-first)
**Module:** multi

## Overview

The EVE Frontier x Sui Hackathon ("A Toolkit for Civilization") runs March 11-31, 2026, with an $80K prize pool. Community voting follows April 1-15, judging April 15-22, and winners announced April 24. With 16 days remaining (March 15 to March 31), this plan maps what has been built, what remains, and the critical path to a compelling hackathon submission.

The project has made substantial progress: 13 Move contracts written and **all 13 published** to Sui testnet, a 107-file Periscope SPA with 29 views, a governance system with 4-tier organizations and claims deployed on-chain, and a full chain-shared package with TX builders for every contract. The monorepo infrastructure is solid (Turborepo, pnpm, Biome, 5 shared packages).

**Standalone-first approach:** Periscope is a fully client-side SPA — no backend server required. Currency creation uses in-browser WASM bytecode patching (`buildPublishToken` via `@mysten/move-bytecode-template`), all governance TX builders run in-browser, and the user's wallet (EVE Vault) handles signing and gas. The gas station is an **optional enhancement** for custom turret package compilation only — it is not on the critical path.

The hackathon theme is "A Toolkit for Civilization." The strongest submission angle is the governance organization system (Plan 04) combined with the closed-loop economy (Plan 06) and the Periscope intel tool. The critical path is: **verify token factory bytecodes work → test standalone E2E flows → polish UI → record demo → submit.**

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
| `ssu_market` | Yes (v1) | `0xdb9df1...c8885` | SSU vending machine. **v2 code written** (OrgMarket, buy orders, stock_items, buy_and_withdraw) but NOT upgraded on-chain yet |
| `bounty_board` | Yes | `0xf55f78...1b4bf` | Generic bounty escrow (works with any `Coin<T>`) |
| `lease` | Yes | `0x9920af...bc7ce` | SSU rental system |
| `token_template` | Yes | `0x38e749...65ccf` | Template token (init creates TreasuryCap) |
| `governance` | Yes | `0x8bef45...a578cb` | 4-tier Organization + ClaimsRegistry, 9 tests |
| `governance_ext` | Yes | `0x670b84...bec349` | `treasury.move` (138 lines), OrgTreasury shared object |

**Key gaps (deployment only — all code is written):**
- `ssu_market` v2 code written but needs on-chain upgrade for buy orders + `buy_and_withdraw<T>()` (UpgradeCap: `0xa803...3eaf`)
- `exchange` lacks `match_orders()` (deferred, not critical for hackathon)

### apps/periscope/ — Frontier Periscope Intel Tool (107 source files)

The primary deliverable. 29 views across 28 routes, IndexedDB with 13 schema versions, dark theme SPA. **Fully standalone — no backend required.**

**Views — Fully Functional (have real logic, DB queries, UI):**
| View | Lines | Key Features |
|------|-------|-------------|
| `Dashboard.tsx` | 141 | Stat cards (systems, players, killmails), quick actions |
| `StarMap.tsx` | 371 | React Three Fiber 3D map, 24K systems, route plotting |
| `Logs.tsx` | 1864 | Full log analyzer (mining/combat/travel/chat), live watcher |
| `JumpPlanner.tsx` | 719 | Route planning with Dijkstra pathfinding |
| `GovernanceDashboard.tsx` | 539 | Org creation, 4 tier panels, wired to chain TX |
| `GovernanceClaims.tsx` | 483 | Claims + nicknames, wired to chain TX |
| `GovernanceTurrets.tsx` | 351 | Public/private mode, turret build+deploy (requires gas station) |
| `GovernanceFinance.tsx` | 1330 | In-browser currency creation (WASM bytecode patching), OrgTreasury deposit, mint/burn |
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
| `Extensions.tsx` | 276 | Extension templates (legacy) |
| `TurretConfig.tsx` | 283 | Turret config (legacy, requires gas station) |
| `Assets.tsx` | 216 | Asset inventory |
| `Wallet.tsx` | 302 | SUI balance, coin balances, faucet link |
| `Workers.tsx` | 186 | Background worker status |
| `Setup.tsx` | 105 | First-launch setup wizard |

**Standalone features (no gas station needed):**
- All intel views (Dashboard, StarMap, Logs, JumpPlanner, Intel, Players, Targets, etc.)
- GovernanceDashboard — org creation + tier management (in-browser TX)
- GovernanceClaims — claims CRUD (in-browser TX)
- GovernanceFinance — currency creation via `buildPublishToken()` (in-browser WASM), deposit TreasuryCap, mint, burn
- Wallet — SUI + token balances, faucet link
- Extension authorization — authorizing pre-published extensions on assemblies

**Gas station dependent (optional enhancement):**
- GovernanceTurrets — custom turret package compilation + publish (requires `/build-turret`)
- TurretConfig — same (legacy view, redirects to GovernanceTurrets)
- Sponsored transactions — `useSponsoredTransaction` hook (currently unused by standalone flows)

**Status assessment:** GovernanceFinance uses `buildPublishToken()` from `token-factory.ts` which does in-browser bytecode patching. The `TEMPLATE_BYTECODES` constant is currently `null` — **extracting the compiled bytecodes from `contracts/token_template/build/` is the #1 blocker** for standalone currency creation. Once bytecodes are embedded, the full currency lifecycle works without any server. GovernanceTrade requires `ssu_market` v2 on-chain.

### apps/gas-station/ — Gas Station API (5 source files) — OPTIONAL

Express server (port 3100) with 5 endpoints: `/build-turret`, `/build-governance-turret`, `/build-token`, `/sponsor`, `/health`. Only needed for custom turret package compilation. **Not required for hackathon critical path.**

### Other Modules (unchanged from previous audit)

- **apps/web/** — Unused scaffold. Not part of hackathon.
- **apps/api/** — Unused scaffold. Not part of hackathon.
- **apps/permissions-dapp/** — Functional standalone ACL editor. Could be submitted as companion tool.
- **packages/chain-shared/** — Complete. All TX builders work in-browser. `token-factory.ts` needs bytecodes embedded.
- **packages/shared/, db/, sui-client/, tsconfig/** — Complete.

## Plan Status Summary

| Plan | Location | Status | Completion | Remaining |
|------|----------|--------|------------|-----------|
| 01 — Project Setup | `archive/` | Complete | 100% | None |
| 02 — Phases 0-5 | `superseded/` | Superseded | ~40% | Superseded by Plans 03, 04, 06 |
| 03 — Turret Config + Sponsored TX | `archive/` | Complete | 100% | None |
| 04 — Governance System | `archive/` | Complete | ~95% | Cleanup only (low priority) |
| 05 — Governance Phase 2 | `pending/` | Draft | 0% | Post-hackathon |
| 06 — Market & Currency System | `active/` | Code Complete | ~95% | Embed bytecodes, upgrade `ssu_market`, E2E test |
| **07 — Hackathon Remaining Work** | `active/` | **This plan** | — | — |

## Remaining Work

### Critical Path (must-have for hackathon)

These items are required for a functional standalone demo.

1. ~~**Build verification**~~ **DONE** — Build passes.

2. ~~**Publish `governance_ext` to testnet**~~ **DONE** — Published at `0x670b84...bec349`.

3. ~~**UI polish: ServerSwitcher + Wallet + lazy-load + cleanup**~~ **DONE** — ServerSwitcher moved to Manifest, Wallet view created, 7 views lazy-loaded, TenantSwitcher deleted.

4. ~~**Fix pre-existing TS errors**~~ **DONE** — GovernanceFinance `signAndExecute` API fixed, GovernanceTurrets/TurretConfig owner type fixed.

5. **Embed token_template bytecodes** (~1 hour) — Extract compiled bytecodes from `contracts/token_template/build/` and embed in `packages/chain-shared/src/token-factory.ts` (replace the `null` value). This is the **#1 blocker** for standalone currency creation — without it, `buildPublishToken()` throws at runtime.
   - Files: `packages/chain-shared/src/token-factory.ts` (replace `TEMPLATE_BYTECODES = null` with actual bytecodes)
   - Source: `contracts/token_template/build/` (compiled Move bytecode)
   - Verify: `buildPublishToken()` returns a valid `Transaction` object

6. **Test standalone E2E flows** (~2-3 hours) — Start Periscope dev server, connect EVE Vault, test these flows without any gas station:
   - GovernanceDashboard: create org, add tier members, verify chain TX
   - GovernanceFinance: create currency (in-browser), deposit TreasuryCap, mint tokens, burn tokens
   - GovernanceClaims: create claim, update weight, remove claim
   - Wallet: verify SUI balance displays, token balances after mint
   - Fix any runtime errors discovered
   - Files: Various `apps/periscope/src/views/Governance*.tsx` (may need minor fixes)

7. **Demo recording** (~2-3 hours) — Record screen captures of key flows:
   - Organization creation + tier management (GovernanceDashboard)
   - System claims (GovernanceClaims)
   - Currency creation + OrgTreasury + mint/burn (GovernanceFinance)
   - Star Map 3D navigation
   - Log Analyzer with live log parsing
   - Wallet view with balances
   - Periscope dashboard overview

8. **Hackathon submission** (~1 hour) — README with setup instructions, demo video upload, submission page.
   - Files: `README.md` at project root

### High Value (should-have)

These items significantly strengthen the submission but are not blocking.

9. **SSU Market contract upgrade on-chain** (~1-2 hours) — Move code is ALREADY WRITTEN in `contracts/ssu_market/sources/ssu_market.move` (426 lines). Upgrade on-chain using UpgradeCap `0xa803...3eaf`. Unlocks GovernanceTrade sell + buy order flows.
   - Files: `contracts/ssu_market/sources/ssu_market.move` (already complete)
   - Dependency: UpgradeCap must still be available

10. **Cross-view navigation polish** (~2 hours) — Ensure navigation between views works smoothly (e.g., Players -> "Add to tier", Killmails -> "Mark hostile", GovernanceDashboard -> "Go to Finance/Claims").
    - Files: Various view files in `apps/periscope/src/views/`

11. **Permissions dApp build + smoke test** (~1 hour) — Verify `apps/permissions-dapp/` builds and renders. Companion tool for gate ACL management.
    - Files: `apps/permissions-dapp/`

### Nice to Have (stretch goals)

12. **Gas station turret pipeline** (~2 hours) — If gas station is running, test `/build-turret` and GovernanceTurrets deploy flow. Optional add-on for the demo.
    - Requires: `GAS_STATION_PRIVATE_KEY` env var, `sui` CLI installed

13. **Exchange `match_orders()` implementation** (~4-6 hours) — Add order matching to the DEX contract.
    - Files: `contracts/exchange/sources/exchange.move`

14. **Bounty board UI in GovernanceFinance** (~2 hours) — Wire the bounty posting flow (imports and status already exist).
    - Files: `apps/periscope/src/views/GovernanceFinance.tsx`

15. **P2P sync demo** (~3 hours) — Show two Periscope instances syncing intel via WebRTC.
    - Files: `apps/periscope/src/sync/`, `apps/periscope/src/views/PeerSync.tsx`

## Implementation Phases

### Phase 1: Build Verification & Contract Deployment (Day 1) — COMPLETE

1. ~~Build passes.~~ **DONE**
2. ~~`governance_ext` published.~~ **DONE**
3. ~~Config updated.~~ **DONE**

### Phase 2: Standalone Token Factory (Day 2)

1. Run `sui move build` in `contracts/token_template/` to ensure compiled bytecodes exist.
2. Extract the compiled module bytecodes from the build output.
3. Embed bytecodes in `packages/chain-shared/src/token-factory.ts` (replace `null`).
4. Verify `pnpm build` still passes.
5. Write a quick smoke test: call `buildPublishToken()` and verify it returns a `Transaction` object.

### Phase 3: Standalone E2E Testing (Days 3-4)

1. Start Periscope dev server: `pnpm --filter @tehfrontier/periscope dev`.
2. Connect EVE Vault wallet.
3. Test GovernanceDashboard: create org, add tier members, verify chain TX execution.
4. Test GovernanceFinance: create currency (in-browser WASM), deposit TreasuryCap into OrgTreasury, mint tokens, burn tokens.
5. Test GovernanceClaims: create claim, update weight, remove claim.
6. Test Wallet: verify SUI balance, token balances after minting.
7. Fix any runtime errors discovered during testing.
8. If time permits: upgrade `ssu_market` on-chain, test GovernanceTrade sell order flow.

### Phase 4: Demo & Submission (Days 5-7)

1. Fix any remaining UI issues found during testing.
2. Prepare demo script — ordered list of features to show.
3. Record demo video (screen capture with narration).
4. Write/update README with:
   - Project description (governance toolkit for EVE Frontier)
   - Setup instructions (prerequisites, commands — no gas station required)
   - Architecture overview (monorepo, Sui contracts, standalone Periscope SPA)
   - Demo video link
5. Submit to hackathon.

### Phase 5: Stretch Goals (Days 8-16, if ahead of schedule)

1. SSU Market upgrade + GovernanceTrade testing (item 9).
2. Cross-view navigation polish (item 10).
3. Permissions dApp verification (item 11).
4. Gas station turret pipeline testing (item 12).
5. Bounty board integration (item 14).
6. P2P sync demo (item 15).

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/chain-shared/src/config.ts` | ~~MODIFY~~ DONE | `governanceExt.packageId` filled for stillness + utopia |
| `contracts/governance_ext/sources/treasury.move` | ~~VERIFY~~ DONE | Published to testnet |
| `apps/periscope/src/components/TenantSwitcher.tsx` | ~~DELETE~~ DONE | Dead code removed |
| `apps/periscope/src/router.tsx` | ~~MODIFY~~ DONE | Lazy-loaded 7 governance views |
| `apps/periscope/src/views/GovernanceFinance.tsx` | ~~FIX~~ DONE | signAndExecute API fixed (waitForTransaction pattern) |
| `apps/periscope/src/views/GovernanceTurrets.tsx` | ~~FIX~~ DONE | owner type assertion fixed |
| `apps/periscope/src/views/TurretConfig.tsx` | ~~FIX~~ DONE | owner type assertion fixed |
| `packages/chain-shared/src/token-factory.ts` | **CRITICAL** | Embed compiled template bytecodes (replace `null`) |
| `apps/periscope/src/views/GovernanceFinance.tsx` | TEST | Runtime test of standalone currency lifecycle |
| `apps/periscope/src/views/GovernanceDashboard.tsx` | TEST | Verify org creation + tier management |
| `apps/periscope/src/views/GovernanceClaims.tsx` | TEST | Verify claims CRUD |
| `apps/periscope/src/views/GovernanceTrade.tsx` | TEST | Runtime test (requires `ssu_market` upgrade) |
| `contracts/ssu_market/sources/ssu_market.move` | DEPLOY | Code complete. Upgrade on-chain via UpgradeCap. |

## Open Questions

1. ~~**Has `pnpm build` ever succeeded?**~~ **RESOLVED** — Yes.

2. **Are the `token_template` compiled bytecodes available?** Need to check if `contracts/token_template/build/` exists with compiled output. If not, need to run `sui move build` first (requires Sui CLI).

3. **Are UpgradeCaps available for deployed contracts?** Plan 06 requires upgrading `ssu_market`. If the UpgradeCap was destroyed or transferred, a new package must be published instead.

4. **Is the hackathon submission format determined?** Need to confirm: video required? README? Live demo? GitHub repo link?

## Deferred

- **Gas station service** — Optional enhancement for custom turret compilation. Not needed for core governance + currency demo. Can be shown as bonus if time permits.
- **Plan 05 (Governance Phase 2)** — All 5 workstreams. Post-hackathon.
- **apps/web/ and apps/api/** — Server-side stack. Not part of hackathon deliverable.
- **packages/db/** — PostgreSQL schema. Only relevant if web/api become active.
- **P2P sync production testing** — Sync engine written but untested.
- **SuiGrpcClient migration** — Deprecated JSON-RPC usage. Deadline Jul 2026.
- **Exchange order matching** — DEX without matching is limited. Stretch goal.
- **Gate integration with governance tiers** — Requires CCP clarification. Plan 05.
