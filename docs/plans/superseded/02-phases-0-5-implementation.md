# TehFrontier Implementation Plan — Phases 0-5

**Status:** SUPERSEDED (2026-03-14) — Phase 0 (merge) completed. Phases 1-2 partially completed. Phases 3-5 superseded by Plan 03 (turret config + sponsored TX, now archived) and Plan 04 (governance system, now active). The governance plan restructured the entire approach around organizations rather than extension templates.

**Context:** Multi-phase implementation plan for the TehFrontier hackathon project (deadline March 31, 2026). Two codebases exist in diverged states — C:\Dev\TehFrontier (primary) and G:\My Drive copy. Plan starts with reconciliation, then builds toward an end-to-end demo. All phases are targeted for hackathon submission.

**Decisions made:**
- **Canonical repo:** C:\Dev\TehFrontier (fuller codebase, pnpm deps installed). Google Drive = backup only.
- **Target tenant:** Utopia first (UAT sandbox), then Stillness once verified.
- **Turret config:** Refactor to on-chain config object (like gate_acl) — no republishing needed. See Phase 3.2.
- **Scope:** All 5 phases targeted. Economy (Phase 4) can be trimmed if time runs short.

---

## Current State Summary

### What's Working (across both copies)
- Monorepo infra (Turborepo, pnpm, Biome, tsconfig)
- Periscope foundation: DB schema (6 versions, 20+ tables), 17 routes, wallet integration, character management
- Log analyzer with live watcher (mining/combat/travel/chat/structures)
- Extension deployment UI (5 templates, config forms, transaction builders)
- Permissions system (groups CRUD, policy CRUD, betrayal alerts, sync pipeline)
- 10 Move contracts written (8 production-ready)
- chain-shared package (29 transaction builders, 10 query functions)

### What's Split Between Copies
| Feature | C:\Dev (Session 2) | G:\My Drive (Session 3) |
|---------|-------------------|------------------------|
| Full views (Players, Killmails, Blueprints, Notes, Intel, OPSEC, Targets, StarMap) | Yes (309+ lines each) | Stubs (18-33 lines) |
| Chain sync module (chain/sync.ts, chain/client.ts) | Yes | No |
| Utilities (encryption, pathfinder, chatLinkParser, dataExport, autoBackup, worldApi, constants) | Yes (9 files in lib/) | Partial (2 files in lib/) |
| PWA support (service worker, manifest, PWAPrompt) | Yes | No |
| Extensions UI + chain layer | Partial | Yes (config.ts, queries.ts, transactions.ts, permissions.ts) |
| Permissions system (hooks, components, betrayal) | No | Yes (7 components, 5 hooks) |
| chain-shared package | No | Yes (11 modules) |
| Contracts (10 Move packages) | No | Yes |

### Critical Blockers
1. **No contracts published** — all packageIds empty in both config files
2. **Build never verified** — no successful `pnpm install && pnpm build` run
3. **Two codebases diverged** — must merge before any real progress

---

## Phase 0: Codebase Reconciliation & Build Verification

**Goal:** Single source of truth at C:\Dev\TehFrontier that compiles.

### 0.1 — Merge Session 3 into C:\Dev
Start from C:\Dev (has fuller Session 2 work). Cherry-pick Session 3 additions from G:\My Drive:

**New files (copy directly):**
- `packages/chain-shared/` — entire new package (11 source files)
- `apps/permissions-dapp/` — entire new app scaffold
- `contracts/` — all 10 Move packages
- `apps/periscope/src/hooks/useAssemblyPolicies.ts`
- `apps/periscope/src/hooks/useBetrayalResponse.ts`
- `apps/periscope/src/hooks/useExtensionDeploy.ts`
- `apps/periscope/src/hooks/useKillmailMonitor.ts`
- `apps/periscope/src/hooks/useOwnedAssemblies.ts`
- `apps/periscope/src/hooks/usePermissionGroups.ts`
- `apps/periscope/src/hooks/usePermissionSync.ts`
- `apps/periscope/src/components/permissions/*` (7 files)
- `apps/periscope/src/components/extensions/*` (3 files)
- `apps/periscope/src/components/WalletConnect.tsx`
- `apps/periscope/src/components/WalletProvider.tsx`
- `apps/periscope/src/components/CharacterSwitcher.tsx`
- `apps/periscope/src/components/TenantSwitcher.tsx`
- `apps/periscope/src/views/Extensions.tsx`
- `apps/periscope/src/views/Permissions.tsx`
- `docs/CCP_Feature_Requests.md`

**Merge files (both copies have versions, resolve conflicts):**
- `apps/periscope/src/router.tsx` — add Extensions + Permissions routes to existing routes
- `apps/periscope/src/components/Sidebar.tsx` — add Extensions + Permissions nav items
- `apps/periscope/src/components/Layout.tsx` — may need WalletProvider wrapping
- `apps/periscope/src/db/index.ts` — add v4 (extensions), v5 (permissions), v6 (betrayal) to existing v1-v3
- `apps/periscope/src/db/types.ts` — add PermissionGroup, GroupMember, AssemblyPolicy, BetrayalAlert, ExtensionRecord types
- `apps/periscope/src/chain/config.ts` — merge Session 3 extension templates with Session 2 chain config (package IDs, type patterns)
- `apps/periscope/package.json` — add chain-shared + wallet deps
- `apps/periscope/src/stores/appStore.ts` — reconcile if both modified
- `pnpm-workspace.yaml` — add packages/chain-shared, apps/permissions-dapp
- `turbo.json` — add permissions-dapp targets if needed

### 0.2 — Dependency resolution
- `pnpm install` from C:\Dev\TehFrontier
- Verify workspace resolution: `@tehfrontier/chain-shared`, `@tehfrontier/shared`, `@tehfrontier/sui-client`

### 0.3 — Build verification
- `pnpm build` — fix compilation errors
- `pnpm dev --filter=@tehfrontier/periscope` — verify dev server starts
- Smoke test: all 17 routes render without console errors

### 0.4 — Git commit
- Commit merged state to master branch
- Ensure .gitignore covers node_modules, dist, .turbo, contracts/*/build

**Files touched:** ~30-40 files
**Verification:** `pnpm build` succeeds, dev server starts, all routes render

---

## Phase 1: Contract Pipeline & First On-Chain Demo

**Goal:** Publish contracts to Utopia and prove the full UI → chain → in-game loop.

### 1.1 — Sui CLI setup
- Confirm `sui` CLI installed and configured for testnet
- Fund publisher wallet via `sui client faucet`
- Set active address: `sui client active-address`

### 1.2 — Publish core contracts (priority order)

**Round 1 — prove the pipeline:**
1. `turret_shoot_all` — simplest, no config object, one source file

**Round 2 — core value:**
2. `gate_tribe` — simple gate ACL
3. `gate_acl` — full ACL with multi-admin + shared ExtensionConfig

**Round 3 — after turret refactor (Phase 3.2):**
4. `turret_priority` — refactored to use on-chain config (not hardcoded constants)

For each contract:
```bash
cd contracts/{name}
sui move build
sui client publish --gas-budget 500000000
# Record: package ID, shared object IDs (ExtensionConfig, etc.)
```

### 1.3 — Update config files
- `apps/periscope/src/chain/config.ts` — fill packageIds + configObjectIds per template per tenant
- `packages/chain-shared/src/config.ts` — fill CONTRACT_ADDRESSES for utopia

### 1.4 — End-to-end test
- Start Periscope → Connect wallet → Extensions tab
- Select owned turret → Deploy turret_shoot_all
- Verify transaction succeeds, extension recorded in IndexedDB
- Check in-game turret behavior changed

**Files touched:** 2 config files + contract build artifacts
**Verification:** Extension deployed from Periscope UI, visible on-chain, working in-game

---

## Phase 2: Periscope Core Completion

**Goal:** All 17 views functional with real data.

### 2.1 — Verify Session 2 views post-merge
Confirm these views from C:\Dev still work after Session 3 merge:
- Dashboard, Deployables, Players, Killmails, StarMap, Blueprints, Notes, Intel, OPSEC, Targets, Logs, Settings, Setup

### 2.2 — Implement Assemblies view
- Query `db.assemblies` table (observed via chain sync)
- Table with filtering by type, owner, status
- "View Owner" link → Players view

### 2.3 — Implement Locations view
- Query `db.locations` table
- Bookmark systems, add notes
- "Show on Map" link → StarMap view

### 2.4 — Chain sync integration
- Ensure `chain/sync.ts` feeds killmails into betrayal detection (`useKillmailMonitor`)
- Add configurable polling interval in Settings
- Show sync status indicator in sidebar/header

### 2.5 — Cross-view navigation
- Players → "Add to permission group"
- Killmails → "Mark attacker hostile" (triggers betrayal flow)
- Deployables → "Manage extensions" → Extensions view
- Extensions → "Configure permissions" → Permissions view

**Files touched:** ~10-15 files
**Verification:** All 17 routes render with real data, cross-navigation works

---

## Phase 3: Permissions & Security End-to-End

**Goal:** Full permissions loop + turret config without republishing.

### 3.1 — Gate permissions sync
- Create permission group with tribe ID(s)
- Create gate policy (allowlist mode) → assign group → Sync Now
- Verify on-chain: AclConfig dynamic field has correct tribe/character IDs
- Test in-game: only allowed characters can jump

### 3.2 — Turret priority refactor: on-chain config (KEY ARCHITECTURAL CHANGE)

**Problem:** Current turret_priority bakes friendly/KOS lists into compile-time constants. Any change requires republishing the entire contract and re-authorizing on every turret.

**Solution:** Refactor to use a shared config object (same pattern as gate_acl). The game server already supports passing `&ExtensionConfig` to extension entry points — gate_acl proves this. Apply the same pattern to turrets.

**New contract structure:**

`contracts/turret_priority/sources/config.move` (NEW):
```
TurretConfig (shared object, created at init):
  - owner: address
  - admins: vector<address>
  - admin_tribes: vector<u32>
  + dynamic fields keyed by turret_id → PriorityConfig

PriorityConfig (per-turret, stored as dynamic field):
  - friendly_tribes: vector<u32>
  - friendly_characters: vector<u64>
  - kos_tribes: vector<u32>
  - kos_characters: vector<u64>
  - default_weight: u64
  - kos_weight: u64
  - aggressor_bonus: u64
  - betrayal_bonus: u64
  - low_hp_bonus: u64
  - low_hp_threshold: u64
  - class_bonus: u64
  - effective_classes: vector<u64>

Functions:
  - set_config(config, turret_id, priority_config, ctx) — admin only
  - remove_config(config, turret_id, ctx)
  - get_config(config, turret_id) → &PriorityConfig
  - has_config(config, turret_id) → bool
  + admin management (same as gate_acl: add/remove admin, add/remove admin tribe)
```

`contracts/turret_priority/sources/turret_priority.move` (REFACTORED):
```
get_target_priority_list(
    turret: &Turret,
    _character: &Character,
    target_candidate_list: vector<u8>,
    receipt: OnlineReceipt,
    config: &TurretConfig,        // ← NEW parameter
): vector<u8>

Priority logic stays the same, but reads from config dynamic field
instead of compile-time constants:
  1. let priority_config = config::get_config(config, turret_id);
  2. Check friendly lists from priority_config
  3. Check KOS lists from priority_config
  4. Apply bonuses from priority_config
  5. Fallback: if no config exists for this turret, use sensible defaults
```

**Benefits:**
- Update friendly/KOS lists via transaction — no republish
- Admin delegation — co-admins can manage turret targeting
- Per-turret config — different turrets can have different rules
- Integrates with Periscope permission groups → resolve → sync (same flow as gates)

**Risk:** Game server may not pass config object to turret extensions. **Mitigation:** Test on Utopia immediately. If it fails, fall back to the code-generation approach (keep the source generator in chain-shared as backup).

**chain-shared changes:**

`packages/chain-shared/src/turret-priority.ts` (REFACTORED):
- Remove source code generator functions (or keep as fallback)
- Add query functions: `queryTurretConfig()`, `queryPriorityConfig()`
- Add transaction builders: `buildSetTurretConfig()`, `buildRemoveTurretConfig()`
- Add admin management: `buildAddTurretAdmin()`, `buildRemoveTurretAdmin()`
- Keep `SHIP_CLASSES`, `TURRET_TYPES`, `DEFAULT_TURRET_PRIORITY_CONFIG` constants

### 3.3 — Turret config UI in Periscope

New component: `apps/periscope/src/components/permissions/TurretConfigCard.tsx`
- Friendly tribes/characters inputs (multi-value, from permission groups OR direct entry)
- KOS tribes/characters inputs
- Weight config: sliders for default, KOS, aggressor, betrayal, low HP, class bonuses
- Ship class effectiveness checkboxes (per turret type)
- "Sync to Chain" button → builds set_config transaction
- Sync status badge (same as gate policies)

Integration in Permissions view:
- Turret policies section already exists (PolicyCard)
- TurretConfigCard replaces the generic PolicyCard for turrets
- Uses the same group resolution pipeline: groups → tribe/character IDs → chain transaction

### 3.4 — Betrayal response end-to-end
- Killmail monitor detects friendly attacker → BetrayalAlert created
- Alert banner shows → user clicks "Revoke & Blacklist"
- Member removed from friendly groups, added to KOS
- ALL affected policies (gate AND turret) marked dirty
- User re-syncs each dirty policy → updated ACL on chain for gates, updated PriorityConfig on chain for turrets
- **No contract republish needed** — just a config update transaction

### 3.5 — Multi-admin delegation
- Add co-admin via Periscope UI (both gate_acl and turret_priority configs)
- Verify co-admin wallet can modify configs
- Admin tribe support: any character in admin tribe can configure

**Files touched:** ~12-18 files (contract refactor + chain-shared + UI)
**Verification:**
- Gate restricts access based on Periscope-managed groups
- Turret targets based on on-chain config (not hardcoded constants)
- Betrayal revoke → re-sync updates both gate and turret configs on chain
- Test: `sui client call --function set_config` with turret_priority to manually verify config reads

---

## Phase 4: Economy Contracts & Token System

**Goal:** Custom tokens, DEX trading, and toll gates working.

### 4.1 — Token factory pipeline
- `sui move build` the token_template contract
- Extract compiled bytecodes from build output (base64 encode the module bytes)
- Embed in `packages/chain-shared/src/token-factory.ts` (replace null placeholder)
- Test: patch bytecodes for "REAPER_GOLD" → publish → verify CoinMetadata shows correct name/symbol

### 4.2 — Token creation UI
- Economy view in Periscope (new view or section in Extensions)
- Form: token name, symbol, decimals, description, icon URL
- "Create Token" → patches bytecodes → publishes new package → records in IndexedDB
- Post-creation: "Mint" / "Burn" actions using TreasuryCap
- Token balance display via `suiClient.getBalance()`

### 4.3 — Fix exchange contract
Add `match_orders()` to `contracts/exchange/sources/exchange.move`:
- Walk best bid (highest price) and best ask (lowest price)
- Match when bid.price >= ask.price at ask.price (price improvement for buyer)
- Execute partial fills (reduce remaining amounts)
- Transfer coins between counterparties
- Deduct fee, send to fee_recipient
- Emit `TradeEvent` per fill
- Batch limit (max 10 matches per call) to avoid gas issues
- Publish to Utopia

### 4.4 — Exchange UI
- New view or section: Economy → Exchange
- Pair selector (create new pair with coin type selectors, or select existing)
- Order book visualization (bid/ask depth)
- Place order form: buy/sell toggle, price, amount, estimated total
- "My Orders" list with cancel button
- Trade history (from on-chain events)

### 4.5 — Publish remaining economy contracts
Priority order:
1. `gate_toll` — toll gate extension (hybrid: pay or be whitelisted)
2. `bounty_board` — escrow bounties with killmail verification
3. `lease` — prepaid rent system
4. `ssu_market` — vending machine (fix item transfer gap: wire `storage_unit::withdraw_item<MarketAuth>()`)

Update `packages/chain-shared/src/config.ts` CONTRACT_ADDRESSES after each publish.

### 4.6 — Toll gate config UI
- In Permissions view, toll gates appear as a special policy type
- Config: fee amount, coin type selector, free-pass tribe/character lists
- Integrates with permission groups for free-pass lists
- Sync to chain via `buildSetToll()` transaction

**Files touched:** ~15-20 files
**Verification:** Create custom token → trade on DEX → use to pay gate toll. Full economy loop.

---

## Phase 5: Standalone Permissions dApp & Demo Polish

**Goal:** Public-facing dApp for any admin. Demo-ready hackathon submission.

### 5.1 — Permissions dApp completion
`apps/permissions-dapp/` — flesh out from scaffold:
- **AssemblySelector:** enter object ID manually, or auto-discover from wallet's OwnerCaps
- **AclEditor:** read on-chain ACL config → display current tribes/characters → edit inline → sync
- **TurretConfigEditor:** read on-chain PriorityConfig → edit weights/lists → sync
- **AdminPanel:** view/add/remove co-admins and admin tribes (owner only)
- **SyncButton:** build transaction → wallet sign → success/error feedback
- Uses `@tehfrontier/chain-shared` directly — no IndexedDB, no groups, no intel
- Single-page app, no routing needed

### 5.2 — Periscope polish
- Lazy-load routes via `router.lazy()` (17 views loaded eagerly today)
- React error boundaries around each view (one crash shouldn't kill the app)
- Loading skeletons and empty states for all views
- Responsive layout adjustments for smaller screens

### 5.3 — Demo preparation
- Record screen captures of key flows:
  1. Extension deployment (turret_shoot_all on a turret)
  2. Permission group management + gate ACL sync
  3. Turret priority config + live config update
  4. Betrayal detection → revoke & blacklist → re-sync
  5. Token creation + DEX trading (if Phase 4 complete)
- Write README with setup + demo instructions
- Hackathon submission page / video

### 5.4 — Stretch goals (if time permits)
- Bulk sync all dirty policies in one click
- Import/export permission groups as JSON
- Right-click player in Players view → "Add to group"
- Bounty board UI (post bounty, browse, claim)
- Lease management UI (create lease, deposit rent, check status)
- SuiGrpcClient migration (from deprecated JSON-RPC SuiClient)

**Files touched:** ~10-15 files
**Verification:** Permissions dApp: connect wallet → select assembly → read config → edit → sync. Demo video recorded.

---

## Timeline (18 days: March 13-31)

| Days | Phase | Focus | Deliverable |
|------|-------|-------|-------------|
| 1-2 | **Phase 0** | Merge codebases, build verification | Clean build, all routes render |
| 3-4 | **Phase 1** | Publish turret_shoot_all + gate_acl to Utopia | First on-chain extension from UI |
| 5-7 | **Phase 2** | Verify all views, Assemblies/Locations, cross-nav | 17 functional views |
| 8-11 | **Phase 3** | Turret refactor, config UI, permissions E2E, betrayal | No-republish turret config, full permissions loop |
| 12-15 | **Phase 4** | Token factory, exchange fix, toll gates | Custom tokens + DEX trading |
| 16-18 | **Phase 5** | Standalone dApp, polish, demo prep | Hackathon submission |

**Cut line:** If behind schedule by day 12, trim Phase 4 to just token factory + toll gate (skip exchange UI, bounty, lease). Phase 5.1 (dApp) can be minimal.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Merge conflicts between Session 2 & 3 | Delays Phase 0 | Session 3 is mostly additive (new files); conflicts limited to router, sidebar, db schema |
| Contract publish fails on testnet | Blocks Phase 1+ | Start with turret_shoot_all (simplest). Check Sui framework version match. |
| **Turret config parameter not supported by game server** | Blocks Phase 3.2 | Test on Utopia immediately after publish. Fallback: keep code-gen approach, add "Download & CLI publish" UI |
| world-contracts v0.0.18 API changes | Blocks contracts | Pin to exact git rev in Move.toml |
| Exchange match_orders() complexity | Delays Phase 4 | Ship with manual "Match" button (user triggers matching) as MVP |
| Token bytecode patching fragility | Blocks Phase 4.1 | Test with a single token first. Pin Sui framework version. |
| Build errors after merge | Delays everything | Address in Phase 0.3; don't proceed until clean |

---

## Key Architecture Decisions

### Turret Priority: On-Chain Config vs Code Generation

**Chosen: On-chain config** (like gate_acl pattern)

The gate_acl contract proves the game server can pass a shared `&ExtensionConfig` object to extension entry points. The turret_priority contract will use the same pattern:
- Shared `TurretConfig` object stores per-turret `PriorityConfig` as dynamic fields
- `get_target_priority_list()` reads config at runtime instead of using compile-time constants
- Config updates are transactions, not republishes
- Admin delegation works the same way

**Fallback:** If the game server doesn't support config params for turrets (test on Utopia), revert to code-generation approach. The source generator in `chain-shared/src/turret-priority.ts` remains as backup. In this case, Phase 3.2 becomes a "Generate & Download" UI instead.

### Canonical Repository

**C:\Dev\TehFrontier** — primary development location. Has pnpm deps, fuller codebase (Session 2 work). Google Drive copy is a stale backup. After Phase 0, all work happens in C:\Dev.
