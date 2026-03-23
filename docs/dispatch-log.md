# Dispatch Log

## 2026-03-23 -- standings-access-control
- **Action:** CREATE
- **File:** docs/plans/pending/12-standings-access-control.md
- **Passes:** 2 (draft + 1 review pass with inline fixes)
- **Result:** pending -- Standings registry + gate/SSU extension contracts + client-side contacts + registry discovery UI. Replaces encrypted standings (plan 11) with plaintext u8 standings in shared StandingsRegistry objects. Three on-chain contracts: standings_registry (standalone, no world dep), gate_standings (ACL + toll based on standing thresholds), ssu_standings (deposit/withdraw access by standing). Turret integration deferred (game server devInspect fixed signature prevents shared object passing). Client-side contacts in IndexedDB for private notes. Registry discovery via GraphQL type queries. 7 phases, 20 files (10 new, 10 modified). 2 open questions: SSU extension inventory hook model, batch-set standings API.
- **Supersedes:** plan 11 (encrypted standings module)

## 2026-03-21 -- manifest-public-locations
- **Action:** CREATE
- **File:** docs/plans/active/24-manifest-public-locations.md
- **Passes:** 4 (draft + 3 review passes, converged on pass 4 with minor fix only)
- **Result:** active -- Add third manifest table `manifestLocations` to cache publicly revealed structure locations from `LocationRevealedEvent` chain events. New `ManifestLocation` interface with assembly ID, coordinates (x/y/z as strings), solar system, type ID, owner cap, and resolved L-point label. Discovery follows same incremental cursor pattern as `discoverCharactersFromEvents()` with `queryEventsGql` pagination. L-point resolution via new `resolveNearestLPoint()` utility in `lpoints.ts` that matches coordinates against celestial planet data (20% orbital radius threshold). Cross-references manifest locations with deployables/assemblies tables to auto-populate structure locations. Manifest UI gains third "Locations" tab with DataGrid showing assembly type, system name, L-point, and Suiscan links. 4 phases, 6 files (all modifications). Dexie V23 for new table. No open questions -- threshold resolved inline as design decision.

## 2026-03-21 -- private-map-system
- **Action:** CREATE
- **File:** docs/plans/pending/23-private-map-system.md
- **Passes:** 5 (draft + 4 review passes, converged on pass 5 with NO_CHANGES)
- **Result:** pending -- Encrypted location sharing via on-chain map objects with invite-based key distribution. New contract at `contracts/private_map/` with `PrivateMap` (shared, X25519 public key, dynamic field locations), `MapInvite` (owned, encrypted map secret key), `MapLocation` (encrypted coordinates). Client-side crypto via `tweetnacl` + `tweetnacl-sealedbox-js` + `@noble/curves` x25519. Wallet key derivation via `dAppKit.signPersonalMessage` -> SHA-256 -> x25519 seed (completely stateless, no local key storage). Membership enforced via `&MapInvite` on `add_location`. Soft revocation via `revoked` vector blacklist. 6 phases, 16 files (8 new, 8 modified) across contracts, chain-shared, periscope, ssu-dapp. 1 open question remains: public key distribution mechanism (registry vs out-of-band vs invite link). OQs 2-3 resolved inline (require MapInvite for add, revoked blacklist for removal).

## 2026-03-21 -- market-buy-order-improvements (BuyOrderPool architecture)
- **Action:** UPDATE (architectural change: buy orders move to shared BuyOrderPool<T>)
- **File:** docs/plans/active/22-market-buy-order-improvements.md
- **Passes:** 3
- **Result:** active -- Major architectural rewrite: buy orders move from per-SSU `Market<T>` objects to a shared `BuyOrderPool<T>` object per currency type. Key changes: (1) **New `buy_order_pool.move` module** in `contracts/market/` package -- `BuyOrderPool<T>` shared object with buy orders as dynamic fields, own fee config, `post_buy_order` with Clock + `original_quantity`, enriched cancel/fill events. (2) **All buy order code removed from `market.move`** -- `BuyOrder` struct, `BuyKey`/`BuyCoinKey`, post/cancel functions, events, accessors all move to pool. `Market<T>` loses `next_buy_id`. Error codes renumbered. (3) **`ssu_market.move` fill functions rewritten** -- `player_fill_buy_order` and `fill_buy_order` take `&mut BuyOrderPool<T>` instead of `&mut Market<T>`. Fee read from pool config. No `assert_market_linked` for fills. New `pool_id` field on `BuyOrderFilledEvent`. (4) **New `buy-order-pool.ts` in chain-shared** -- `buildCreateBuyOrderPool`, `buildPostBuyOrder`, `buildCancelBuyOrder` (all targeting pool), `queryBuyOrderPools` (discovery), `queryBuyOrderPoolOrders`. Buy order functions removed from `market.ts`. (5) **Cross-market buy order queries now trivial** -- one pool per currency, no N+1 aggregation needed. `CrossMarketBuyOrder` type removed (unnecessary). (6) **`useSsuConfig.ts` gains pool discovery** -- `SsuConfigResult` gets `poolId` field. (7) **All dapp components updated** -- `CreateBuyOrderDialog`, `FillBuyOrderDialog`, `MarketContent` (cancel), `MarketDetail` target pool instead of market. Review fixes: (a) MarketContent.tsx cancel handler needs poolId + import change, (b) SsuView.tsx useBuyOrders call uses poolId, (c) error code renumbering for market.move, (d) approach wording clarification (buy_order_pool is a module within market package, not separate). Plan expanded from 25 to 30 files (1 new contract module, 1 new chain-shared file), 26 design decisions (was 19), 7 phases (was 6).

## 2026-03-21 -- market-buy-order-improvements (feature expansion)
- **Action:** UPDATE (add cross-market currency queries + public/private listings)
- **File:** docs/plans/active/22-market-buy-order-improvements.md
- **Passes:** 3
- **Result:** active -- Two new features added to plan since we're fresh-publishing anyway. (1) **Cross-market currency queries:** New `queryAllListingsForCurrency` and `queryAllBuyOrdersForCurrency` functions in chain-shared that discover all `Market<T>` objects for a given coin type via GraphQL type filtering (using existing `queryMarkets`), then aggregate orders across all markets. No on-chain registry needed. New `CrossMarketListing` and `CrossMarketBuyOrder` types. (2) **Public/private listings with location:** `SellListing` struct gains `is_public: bool` + `solar_system_id: u64`. Seller provides solar system ID when creating public listings (chain locations are Poseidon2 hashes -- not human-readable). `escrow_and_list` and `post_sell_listing` gain new params. `SellListingPostedEvent` enriched with visibility+location. Private listings set `solar_system_id: 0`. Buy orders have no location (offers are location-agnostic). Cross-market browse UI deferred to separate plan. Review fixes: (a) explicit Move parameter ordering for new params (before clock), (b) `BuyOrderWithName.postedAtMs` duplicate field removal, (c) solar system input approach for dApps without stellar data (simple numeric input). Plan expanded from 24 to 25 files, 19 design decisions (was 11).

## 2026-03-21 -- market-buy-order-improvements (review)
- **Action:** UPDATE (comprehensive review + future-proofing)
- **File:** docs/plans/active/22-market-buy-order-improvements.md
- **Passes:** 2
- **Result:** active -- Major expansion from 5 phases/14 files to 6 phases/24 files. Key findings: (1) Fee calculation truncation bug in all 3 ssu_market trade functions (`total_price / 10000 * fee_bps` truncates to 0 for small amounts -- fix to `total_price * fee_bps / 10000`). (2) `pricePerUnit` as `number` type in chain-shared types causes precision loss for u64 values > 2^53 -- changed to `bigint` across all types, queries, and TX builders. (3) `BuyOrderCancelledEvent` and `BuyOrderFilledEvent` too sparse for indexing -- enriched with buyer, type_id, refund_amount, price_per_unit. (4) `SellListingPostedEvent` missing timestamp. (5) `player_fill_buy_order` uses `ESSUMismatch` for type_id check -- added `ETypeMismatch` error. (6) `original_quantity` field added to `BuyOrder` for partial fill tracking. (7) `token_template` depends on `market` -- confirmed no source changes needed (local dep auto-resolves). (8) ssu-market-dapp components use raw base unit display without decimal formatting. 7 new files added to plan scope (SellDialog, PostSellListingForm, OwnerView, etc).

## 2026-03-21 -- market-buy-order-improvements
- **Action:** CREATE
- **File:** docs/plans/active/22-market-buy-order-improvements.md
- **Passes:** 2 (initial draft rewritten for fresh publish approach)
- **Result:** active -- Add posted_at_ms to BuyOrder via fresh publish, auto-merge coins for buy orders

## 2026-03-14 — governance-system review
- **Action:** UPDATE (execution review)
- **File:** docs/plans/active/04-governance-system.md
- **Passes:** 2
- **Result:** Plan verified against codebase and expanded for execution. All 22 files (9 new, 13 modified) confirmed to exist with correct contents. Step 12 expanded from 6-line summary to 7 detailed sub-steps (12a-12g) with exact commands, file paths, import patterns, and extraction instructions. Key finding: Periscope does not currently import CONTRACT_ADDRESSES from chain-shared (uses EXTENSION_TEMPLATES instead), so Step 12d will be the first governance view to use this import pattern. Plan status: execution-ready, no open questions.

## 2026-03-14 — governance-phase2 planning
- **Action:** UPDATE 04 (archive) + CREATE 05 (phase 2)
- **File:** docs/plans/pending/05-governance-phase2.md
- **Passes:** 3
- **Result:** Phase 1 plan (04) verified complete and archived — all 12 steps done, governance package deployed at 0x8bef45b3..., all 4 views wired to chain. Phase 2 plan (05) created with 5 workstreams (gates, finance, trade, claims, alliances/voting). Key findings during refinement: (1) No gate_unified TX builders exist in chain-shared — Phase 2a must create gate-unified.ts. (2) org.move does not expose &mut UID, so governance_ext modules cannot add dynamic fields to Organization — voting/faucet use separate shared objects. (3) Move package immutability means new modules must go in a governance_ext package that depends on the original governance package. (4) Claims secondary index approach depends on UpgradeCap availability (open question). 7 open questions identified; plan placed in pending/.

## 2026-03-14 — market-currency-system
- **Action:** CREATE
- **File:** docs/plans/pending/06-market-currency-system.md
- **Passes:** 3
- **Result:** Detailed implementation plan for market and currency systems — extracts and focuses Phase 2b (finance) and Phase 2c (trade) from 05-governance-phase2.md into an execution-ready document. 3 phases, 13 files (2 new, 11 modified). Key findings: (1) Token template bytecodes exist at 691 bytes (contracts/token_template/build/), ready for extraction. (2) Gas station source-generation approach preferred over bytecode patching — matches proven turret build pipeline. (3) ssu_market and exchange contracts both published with UpgradeCaps. (4) TreasuryCap ownership transfer via hardcoded address in init() needs testnet validation (Open Question #3). (5) MarketAuth witness construction gap in ssu_market.move needs investigation (Open Question #2). (6) Exchange contract lacks order matching (Open Question #1). 4 open questions remain; plan placed in pending/.

## 2026-03-15 — hackathon-remaining-work
- **Action:** CREATE
- **File:** docs/plans/active/07-hackathon-remaining-work.md
- **Passes:** 3 (converged — pass 3 found 1 numbering fix, all facts verified)
- **Result:** Comprehensive audit of entire project state for hackathon deadline (March 31). Module-by-module assessment: 13 contracts (12 published, `governance_ext` pending), 107-file Periscope SPA (29 views), gas station (5 endpoints), permissions-dapp (built), chain-shared (13 files, 2492 lines). Key findings: (1) Build never verified — `pnpm build` has never been run successfully end-to-end. (2) `governance_ext/treasury.move` is written (139 lines, no tests) but not published — blocks GovernanceFinance runtime. (3) GovernanceTrade (1467 lines) compiles but OrgMarket/buy-order Move functions don't exist in deployed `ssu_market` — buy tab fails at runtime. (4) Gas station `/build-token` route is registered and coded, just needs E2E test. (5) 6 critical path items, 4 high-value items, 5 stretch goals identified. Critical path estimated at ~7 days total. Plan placed in active/.

## 2026-03-15 — market-currency-system execution review
- **Action:** UPDATE (execution review)
- **File:** docs/plans/active/06-market-currency-system.md
- **Passes:** 2 (converged — pass 2 found 1 minor fix, all else verified clean)
- **Result:** Comprehensive pre-execution review with 21 changes across 2 review agents + 1 refinement pass. **Critical discoveries:** (1) SSU item binding constraint — `parent_id` locks items to originating SSU, making cross-SSU transfers impossible. Redesigned buy orders from automated `fill_buy_order` to stakeholder-confirmed `confirm_buy_order_fill`. (2) Missing `governance` source dependency in Move.toml files — both `governance_ext` and `ssu_market` upgrade had `governance` address in `[addresses]` but no source path in `[dependencies]`, preventing compilation. Fixed with `governance = { local = "../governance" }`. (3) Missing `stock_items()` function — sell orders need items in extension inventory but no function existed to move them there. Added `stock_items` with full PTB stocking flow. (4) Template mint/burn omission — gas station template contradicted resolved question #4. Added bootstrap mint/burn. (5) Mutable borrow conflict in Move code — `confirm_buy_order_fill` held `&mut record` while calling `dynamic_field::remove(&mut market.id)`. Fixed with block-scoped borrow. 1 non-blocking open question remains (game client deposit inventory target). Plan stays in active/.

## 2026-03-15 — hackathon-remaining-work update (governance_ext + UI tasks)
- **Action:** UPDATE
- **File:** docs/plans/active/07-hackathon-remaining-work.md
- **Passes:** 2 (initial update + refinement verification)
- **Result:** Updated Plan 07 to reflect governance_ext deployment and added two new UI tasks. Key changes:
  - **governance_ext published:** Contract table updated (No→Yes), package ID `0x670b84...bec349`, config.ts status updated (empty→filled). Critical path items 1-2 marked DONE. Phase 1 marked COMPLETE. Plan 06 completion bumped to ~95%.
  - **Build passes:** 9/9 packages confirmed. Open Question #1 resolved.
  - **Gas station optional:** Already noted in prior update; no change needed.
  - **ServerSwitcher relocation (item 11):** New High Value task. `ServerSwitcher` currently renders in Sidebar.tsx (line 140, between logo and CharacterSwitcher). Should move to Manifest.tsx header area where tenant is already displayed. 3 files affected: Sidebar.tsx (remove), Manifest.tsx (add), ServerSwitcher.tsx (restyle).
  - **Wallet view (item 12):** New High Value task. Read-only `/wallet` route showing SUI balance, all coin balances, faucet link. Uses `client.getBalance()` / `client.getAllBalances()` from Sui SDK. Follows Assets.tsx pattern (header + stat cards + DataGrid). 3 files affected: Wallet.tsx (create), router.tsx (add route), Sidebar.tsx (add nav item).
  - Nice to Have items renumbered 13-17 (was 11-15). File Summary table expanded with 4 new entries. Phase 4 updated to include UI tasks before demo recording.

## 2026-03-15 — plan review (all plans)
- **Action:** REVIEW + UPDATE (3 plans updated)
- **Files:** docs/plans/active/06-market-currency-system.md, docs/plans/active/07-hackathon-remaining-work.md, docs/plans/pending/05-governance-phase2.md
- **Passes:** 2 (initial review + refinement verification)
- **Result:** Reviewed all active, pending, and archived plans against codebase state. Key findings:
  - **Plan 06 (Market & Currency):** Status changed from "Active" to "Code Complete — Awaiting Contract Deployment." All 3 phases of code are written (treasury.move, treasury.ts, ssu-market.ts with 10 new functions, GovernanceFinance 1330 lines, GovernanceTrade 1467 lines, buildToken.ts, DB V13, etc.). Deployment blockers: governance_ext not published, ssu_market not upgraded on-chain, gas station not E2E tested. Added comprehensive "Implementation Status" section with phase-by-phase status tables. Noted gas station is now optional (GovernanceFinance import mode + scripts/create-token.sh).
  - **Plan 07 (Hackathon Remaining):** Updated to reflect Plan 06 execution. Fixed outdated claims ("not implemented in contracts yet" → "code complete, awaiting deployment"). Updated line counts (GovernanceFinance 1171→1330), file statuses, plan summary table (Plan 06 ~40%→~90%). SSU Market item 7 changed from "4-6 hour coding task" to "1-2 hour deployment task" (code already written). Added scripts/create-token.sh and scripts/upgrade-contract.sh to file summary.
  - **Plan 05 (Governance Phase 2):** Updated Phase 1 artifacts table with Plan 06 deliverables. Marked Phase 2b steps 1-2 and Phase 2c steps 1-2 as DONE (Plan 06). Updated file summary table for completed items.
  - **Archived plans (01, 03, 04):** Verified complete, no changes needed.
  - **Superseded plan (02):** Verified, no changes needed.
  - No plans moved between directories (06 remains in active/ due to deployment blockers; 05 remains in pending/ with open questions).

## 2026-03-15 — trade-page-improvements
- **Action:** UPDATE
- **File:** docs/plans/active/08-trade-page-improvements.md
- **Passes:** 2
- **Result:** active — Plan verified against codebase for execution readiness. All file paths, line numbers (20+ references), types, component signatures, and patterns confirmed accurate. Minor fix: line count 1478 corrected to 1477. Added comprehensive Verification Log documenting every checked reference. No open questions remain (both were previously resolved). Key findings: (1) All referenced functions, types, and patterns exist exactly as described. (2) `discoverOrgMarket()` follows proven `queryClaimEvents()` pattern from governance.ts. (3) `ssu_market` extension template does not exist yet in EXTENSION_TEMPLATES (correctly identified as to-be-added in Phase 2). (4) DB at V13, V14 slot available. (5) `OwnedAssembly.type` is always "storage_unit" for all SSU variants (defensive filter in plan is harmless). Plan spans 2 modules (chain-shared, periscope), 8 files (3 new, 5 modified), 5 phases. Execution-ready.

## 2026-03-16 — graphql-migration
- **Action:** UPDATE (review for execution readiness)
- **File:** docs/plans/active/09-graphql-migration.md
- **Passes:** 3
- **Result:** active — Comprehensive review and rewrite of GraphQL migration plan. Verified all details against actual SDK source code (`node_modules/@mysten/sui/src/graphql/`) and GraphQL schema (`schema.graphql`). Key findings: (1) DAppKit compatibility CONFIRMED — `SuiGraphQLClient` has `core: GraphQLCoreClient extends CoreClient`, satisfies `ClientWithCoreApi`. Risk downgraded from High to RESOLVED. (2) `getObject` (singular) exists in v2 unified API — delegates to `getObjects` internally. Plan's method rename table was corrected. (3) `token-factory.ts` was incorrectly listed as "no query changes needed" — actually uses `getTotalSupply` (JSON-RPC only) and `getCoins` (v1 only). Fixed with custom GraphQL query using `coinMetadata { supply }` (schema verified: `CoinMetadata.supply: BigInt` exists but is NOT in SDK's built-in query). (4) GraphQL `EventFilter` uses `type: String` (not `eventType` or `MoveEventType`). (5) GraphQL `TransactionFilter` uses `affectedAddress`/`affectedObject` (not `FromAddress`/`ChangedObject`). (6) Event timestamps are ISO DateTime strings, not milliseconds. (7) Added complete verified file inventory: 24 files across 6 packages, ~56 call sites total. (8) Added worktree allocation strategy. No open questions remain.

## 2026-03-16 — server-switch-wallet-streamline
- **Action:** CREATE
- **File:** docs/plans/pending/10-server-switch-wallet-streamline.md
- **Passes:** 4
- **Result:** pending — Two-feature plan: (1) Multi-server support (Stillness/Utopia only, default Stillness, Settings page toggle, sidebar indicator, data segmentation via character tenant + address) and (2) Wallet streamline (auto-connect EVE Vault, remove ConnectButton/ConnectWalletButton, status indicators instead of buttons). Key findings: (1) Two separate `TenantId` types exist — chain-shared (literal union L3) and periscope/chain/config (keyof typeof TENANTS L40); both need nebula removed. (2) MOVE_TYPES/EVENT_TYPES hardcoded to stillness package only — `chain/client.ts` functions only work on Stillness; must convert to tenant-aware functions. (3) `WalletConnect` component exported but never imported — only `ConnectWalletButton` used (7 instances across 2 views). (4) `permissions-dapp` already has `autoConnect: true` but missing `slushWalletConfig`. (5) ~17 `as ChainTenantId` cast sites across 5 governance views become unnecessary once both TenantId types align. 5 phases, 24 files (all modify, 0 new). 2 open questions remain (wallet reconnect on server switch, AddCharacterDialog tenant selector).

## 2026-03-19 — consolidate-dapps UI redesign
- **Action:** UPDATE
- **File:** docs/plans/active/20-consolidate-dapps.md
- **Passes:** 3
- **Result:** active — Added Phase 1 UI redesign: two-card layout (SsuInfoCard + ContentTabs), sell flow, market tab, buy order discovery. Key changes from original: (1) Replaced flat Phase 1 file list with 3 sub-phases (1A: SSU Info Card + Edit Toggle, 1B: Content Tabs + Sell Action, 1C: Market Tab) totaling 15 numbered steps. (2) Added 9 new Design Decisions (SSU layout, edit button, sell button placement, sell flow, market tab structure, coinType, OrgMarket discovery, buy orders). (3) Added Sell Flow Detail with exact `buildCreateSellOrder` params including `worldPackageId`. (4) Added Sell Button Visibility Rules and Buy Order Discovery sections. (5) Added Verification checklist (7 items). (6) Resolved all open questions. (7) File Summary expanded from 15 to 22 files. Codebase-verified: all chain-shared functions (`buildCreateSellOrder`, `queryAllSellOrders`, `discoverOrgMarket`, etc.) confirmed at correct paths, `resolveItemNames` correctly sourced from `@/lib/items` (not chain-shared), `getUrlParam` exists in `@/lib/constants`, Permissions.tsx tab type confirmed as `"groups" | "policies"`.

## 2026-03-19 — ssu-inventory-transfers deployment (Plan 19, Phase 2)
- **Action:** DEPLOY
- **Files:** contracts/ssu_market, contracts/ssu_market_utopia, packages/chain-shared/src/config.ts
- **Result:** Both ssu_market contracts upgraded to testnet with 7 new inventory transfer functions.
  - Utopia: `0xde7c7dacdfb98fa507f1ee70ea13c056b8b00a6b2a9060ae387306e84147df1d` (v2)
  - Stillness: `0x35c690bb9d049b78856e990bfe439709d098922de369d0f959a1b9737b6b824e` (v4)
  - Sui CLI upgraded from v1.67.2 to v1.68.0 (protocol v117).
  - Created `contracts/world_stillness/` for Stillness build dependency (git World dep had `world = "0x0"`).
  - Updated config.ts, periscope EXTENSION_TEMPLATES, ssu-market-dapp constants, chain-events-reference, Plan 07 contract table.

## 2026-03-19 — market-architecture-review
- **Action:** CREATE
- **File:** docs/plans/pending/21-market-architecture-review.md
- **Passes:** 2
- **Result:** pending — Deep dive on market architecture: MarketConfig vs OrgMarket, currency integration, simplification options. Exhaustive mapping of 4 contracts (ssu_market 775 lines, currency_market 425 lines, token_template 51 lines, governance_ext/treasury 139 lines), 2 chain-shared modules (ssu-market.ts 638 lines, currency-market.ts 495 lines), and 3 consuming dApps. Key findings: (1) OrgMarket's `authorized_ssus` is maintained but never asserted -- `ENotAuthorizedSSU` error code defined but unused. (2) Buy order fill is manual/trust-based (hackathon shortcut). (3) coinType is never stored on-chain -- always passed as generic `<T>` per-function. (4) Dynamic field key collision risk when adding buy orders to MarketConfig -- solved via wrapper struct keys (`BuyOrderKey`, `BuyOrderCoinKey`). Proposal: add per-SSU buy orders to MarketConfig with trustless atomic fills (seller provides items, receives escrowed payment in one TX). 4 open questions remain (coinType storage, fill mechanism, OrgMarket deprecation, CurrencyMarket future).

## 2026-03-19 — market-architecture-simplification
- **Action:** UPDATE
- **File:** docs/plans/active/21-market-architecture-simplification.md
- **Passes:** 3
- **Result:** active — Rewrote plan: CurrencyMarket<T> as single market, remove MarketConfig + OrgMarket, atomic trade execution. Key findings: (1) Trade execution must live in ssu_market (only declaring module can construct `MarketAuth {}` -- Move struct construction is module-private). currency_market exposes read/write accessors. (2) currency_market has a sell/buy order key collision bug -- both use `u64` dynamic field keys with independent counters starting at 0. Fix via wrapper key structs (`SellKey`, `BuyKey`, `BuyCoinKey`). (3) MarketConfig struct definition must be retained (on-chain instances exist), repurposed as pure auth token for inventory transfers. (4) SellListing keeps `market_config_id` field (struct changes not allowed in upgrade) -- new listings pass dummy `@0x0`. 4 phases: strip ssu_market, upgrade currency_market + add trade execution, update chain-shared, update dApps.

## 2026-03-19 — market-architecture clean publish
- **Action:** UPDATE
- **File:** docs/plans/active/21-market-architecture-simplification.md
- **Passes:** 3
- **Result:** active — Removed all upgrade-constraint workarounds, clean publish with ideal struct definitions. Key changes: (1) MarketConfig deleted entirely (struct + all functions) -- replaced by new `SsuAdmin` struct for transfer function authorization. (2) OrgMarket deleted entirely -- no vestiges. (3) SellListing `market_config_id` field removed -- clean struct. (4) All deprecated/dead code deleted -- no `#[deprecated]` annotations, no retained-for-compat structs. (5) Both ssu_market and currency_market get fresh publishes with new package IDs. (6) currency_market key collision fixed with wrapper key structs from the start (`SellKey`, `BuyKey`, `BuyCoinKey`). (7) Old honor-based `fill_buy_order` deleted from currency_market, replaced by atomic fills in ssu_market. (8) `sui::dynamic_field` import removed from ssu_market (no longer needed). 5 phases: fresh currency_market, fresh ssu_market, chain-shared updates, dApp updates, post-deploy setup. 17 files total. No open questions.

## 2026-03-19 — market seamless flows
- **Action:** UPDATE
- **File:** docs/plans/active/21-market-architecture-simplification.md
- **Passes:** 3
- **Result:** active — Added currency_market_id to SsuAdmin, seamless single-PTB sell flow, explicit buy order UI, auto currency detection

## 2026-03-19 — unified Market<T>
- **Action:** UPDATE
- **File:** docs/plans/active/21-market-architecture-simplification.md
- **Passes:** 3
- **Result:** active — Unified Market<T> replaces CurrencyMarket + OrgTreasury + Organization. Token template creates Market on publish. Four contracts replaced by one. Complete plan rewrite: Market<T> contains TreasuryCap + order book + authorized-minters list + fee config. Token template init() calls market::create_market() -- one publish creates currency + marketplace. New contracts/market/ package. ssu_market replaces MarketConfig with SsuAdmin (market_id for auto-discovery), trade execution via Market<T> write accessors. 7 phases, 28 files. Key review findings: (1) Design decisions table contradiction fixed (mint/burn removal). (2) Item data must be captured before deposit in escrow_and_list (deposit consumes Item). (3) cancel_listing uses write accessors (remove_sell_listing) not cancel_sell_listing to avoid redundant seller check. (4) SellOrder queries removed from ssu-market.ts (sell listings now on Market<T>). (5) governance.ts and treasury.ts kept frozen for periscope compatibility -- published contracts remain on-chain. (6) governance/governanceExt kept in ContractAddresses and config.ts.

## 2026-03-19 — periscope governance cleanup
- **Action:** UPDATE
- **File:** docs/plans/active/21-market-architecture-simplification.md
- **Passes:** 3
- **Result:** active — Added periscope governance cleanup: remove Dashboard/Trade views, rework Finance to use Market<T>, update nav/router/DB. Key changes: (1) New Phase 7 with 14 steps covering full periscope governance teardown. (2) GovernanceDashboard + GovernanceTrade deleted (~2,600 LOC removed). (3) useOrgMarket + useSellOrders hooks deleted. (4) GovernanceFinance rewritten as Finance.tsx using Market<T> builders. (5) governance.ts deleted, claims.ts extracted with buildCreateClaim/buildRemoveClaim for GovernanceClaims. (6) treasury.ts deleted (no remaining consumers). (7) governance config entry kept (claims view needs packageId + claimsRegistryObjectId). (8) governanceExt config entry removed. (9) Dead code found: generateOrgTurretConfig in turret-priority.ts never imported by any app -- removed with OrganizationInfo. (10) Extensions.tsx also uses discoverMarketConfig/queryMarketConfig -- added to Phase 7. (11) ssu-market-dapp had 7 unaccounted component files using old types/builders -- added to Phase 6. (12) GovernanceTurrets and GovernanceClaims deferred to post-hackathon. (13) DB tables kept as legacy (Dexie append-only). (14) CurrencyRecord updated: orgId/treasuryCapId replaced with marketId. Plan expanded from 7 to 8 phases, 28 to 48 files.

## 2026-03-19 — SsuConfig with delegation
- **Action:** UPDATE
- **File:** docs/plans/active/21-market-architecture-simplification.md
- **Passes:** 2
- **Result:** active — SsuAdmin -> SsuConfig with owner, delegates, optional market_id. Transfer functions work without market. Delegate management for SSU access delegation.

## 2026-03-19 — Plans 20+21 execution
- **Action:** EXECUTE
- **Files:** 80+ files across contracts, chain-shared, ssu-dapp, ssu-market-dapp, periscope
- **Agents:** 5 (3 waves: contracts, chain-shared, dApps)
- **Result:** Complete. New contracts published:
  - `market`: `0x1755eaaebe4335fcf5f467dfaab73ba21047bdfbda1d97425e6a2cb961a055f4`
  - `ssu_market` (Stillness): `0x40576ea9e07fa8516abc4820a24be12b0ad7678d181afba5710312d2a0ca6e48`
  - `ssu_market` (Utopia): `0xf6e9699d86cd58580dd7d4ea73f8d42841c72b4f23d9de71d2988baabc5f25a0`
- Deleted: governance_ext, currency_market, governance (sources), GovernanceDashboard, GovernanceTrade
- Net: +6,390 / -8,149 lines across 80 files

## 2026-03-19 — Code review + fixes
- **Action:** REVIEW + FIX
- **Files:** 15 files across contracts, chain-shared, ssu-dapp, periscope
- **Result:** 4 HIGH, 5 MEDIUM, 7 LOW issues found and fixed. Key fixes: authorized list dedup guard (market.move), fee overflow prevention (ssu_market.move), Extensions.tsx deprecated orgId filter, query cache keys, dialog state race condition, loading state threading.

## 2026-03-19 — Contract deployment
- **Action:** DEPLOY
- **Files:** contracts/market, contracts/ssu_market, contracts/ssu_market_utopia
- **Result:** 3 contracts published to Sui testnet. Config files updated (chain-shared/config.ts, ssu-market-dapp/constants.ts). Move.toml files updated with published-at addresses.

## 2026-03-19 — Documentation update
- **Action:** UPDATE
- **Files:** Plans 05 (superseded), 07 (updated), 20+21 (archived), chain-events-reference, dispatch-log
- **Result:** Plans 20+21 moved to archive/. Plan 05 moved to superseded/. Plan 07 updated for v9 (new contract table, deleted views, new architecture). Chain events reference updated for SsuConfig events.

## 2026-03-21 -- market-buy-order-improvements
- **Action:** CREATE
- **File:** docs/plans/pending/22-market-buy-order-improvements.md
- **Passes:** 2
- **Result:** pending -- Two improvements: (1) Add `posted_at_ms` timestamp to buy orders via separate `BuyTimestampKey` dynamic field (cannot modify `BuyOrder` struct under compatible upgrade policy), new `post_buy_order_v2` with `&Clock`. (2) Auto-merge coin objects for buy orders and buy-from-listing using `mergeCoins`+`splitCoins` PTB pattern, replacing manual coin selector dropdown with total balance display. 5 phases, 9-12 files (depending on ssu_market upgrade need). Critical finding: Sui Move `compatible` upgrade policy prohibits adding fields to existing structs, requiring the separate dynamic field approach. 2 open questions: (1) confirm separate dynamic field approach vs fresh publish, (2) verify ssu_market compatibility after market upgrade.

## 2026-03-22 -- periscope-wallet-structures-ui
- **Action:** CREATE
- **File:** docs/plans/pending/25-periscope-wallet-structures-ui.md
- **Passes:** 3 (draft + 2 review passes, converged on pass 3 with NO_CHANGES)
- **Result:** pending -- Five related UI improvements across Periscope and SSU dApp. (1) **CopyAddress component** -- reusable truncated-address-with-copy-to-clipboard widget, adopted across 26+ Periscope files and 7 SSU dApp files. Clipboard API with execCommand fallback for CEF compatibility. (2) **ContactPicker** -- search-as-you-type character picker backed by `manifestCharacters` Dexie table and existing `searchCachedCharacters()`. Debounced search, tribe display, chain lookup fallback. (3) **Wallet Transfers** -- send custom currencies (Coin<T>) to other characters via ContactPicker. PTB: `queryOwnedCoins` + `mergeCoins` + `splitCoins` + `transferObjects`. Uses `useDAppKit().signAndExecuteTransaction`. (4) **Structures Improvements** -- merge Ownership+Owner columns (resolve names from both `players` and `manifestCharacters`), add row selection to DataGrid, create StructureDetailCard below grid (shows Item ID, Fuel, full addresses, extension info, dApp URL), remove Item ID+Fuel from grid columns, cross-reference private map locations with structures via `manifestMapLocations.structureId`. (5) **SSU Market Orders DataGrid** -- replace card-based sell/buy lists with combined DataGrid (copy DataGrid+ColumnFilter into SSU dApp, ~546 lines). Columns: Type, Item Name, Qty, Price, By, Timestamp. Same `excelFilterFn` as Periscope. 7 phases (1a, 1b, 2, 3, 4, 5, 6), 43 files (8 new, 35 modified). 2 open questions: market grid action pattern (inline vs dialogs), CEF clipboard API compatibility.

## 2026-03-22 -- private-map-system (pre-execution review)
- **Action:** UPDATE
- **File:** docs/plans/archive/23-private-map-system.md
- **Passes:** 1
- **Result:** archive -- All 7 phases verified complete against codebase. Move contract published at 0x2be1058fa8..., crypto.ts + private-map.ts + types + config all implemented. Periscope integration complete (PrivateMaps.tsx view, manifest caching V24, syncPrivateMapsForUser/syncMapLocations/decryptMapKeys/invalidateMapCache functions, sidebar nav, router). ssu-dapp integration complete (PublishToMapDialog with system search, useMapKey hook, SsuView "Publish to Map" button). Minor deviations documented: view named PrivateMaps.tsx (not Maps.tsx), useMapKey inlined as useStoredMapKey in Periscope (separate file in ssu-dapp), no separate usePrivateMaps hook (direct Dexie queries), queryTransactionSignature inlined in crypto.ts (not graphql-queries.ts). Plan moved to archive/.

## 2026-03-22 -- periscope-wallet-structures-ui (update)
- **Action:** UPDATE
- **File:** docs/plans/active/25-periscope-wallet-structures-ui.md
- **Passes:** 2
- **Result:** active -- Resolved both open questions, expanded Phase 6 Actions column, added missing dependencies. Key changes: (1) **OQ1 resolved (Option B):** Market grid actions use overlay dialogs, not inline expansion. Three new dialog components: `BuyFromListingDialog` (extracted from ListingCard), `EditListingDialog` (extracted from ListingAdminList), `CancelListingDialog`. Existing `CreateBuyOrderDialog` and `FillBuyOrderDialog` unchanged. (2) **OQ2 resolved (Option A+fallback):** CopyAddress uses `navigator.clipboard.writeText()` with try/catch fallback to `document.execCommand('copy')`. CEF 122 supports Clipboard API. (3) **Phase 6 Actions column expanded:** Detailed column spec with `enableSorting: false`, `enableColumnFilter: false`, context-dependent buttons (Buy/Fill/Edit/Cancel) with specific dialog triggers per order type and ownership. (4) **Missing dependencies added:** `@tanstack/react-virtual` and `lucide-react` for SSU dApp (ColumnFilter uses react-virtual virtualizer, DataGrid/ColumnFilter use lucide icons). (5) **`MarketOrderRow` improved:** Stores original `SellListingWithName`/`BuyOrderWithName` objects for dialog props instead of reconstructing from individual fields. (6) **Type propagation fix:** `listings` prop type updated from `MarketSellListing[]` to `SellListingWithName[]` in both `ContentTabs.tsx` and `MarketContent.tsx`. File count expanded from 43 to 47 files (11 new, 36 modified). No open questions remain.

## 2026-03-22 -- hackathon-remaining-work (pre-execution review)
- **Action:** UPDATE
- **File:** docs/plans/active/07-hackathon-remaining-work.md
- **Passes:** 2
- **Result:** active -- Comprehensive v11 update reflecting Plans 22-24 execution and Plan 25 creation. Key changes: (1) Contract count updated from 16 to 17 (14 project + 2 CCP + token_template) with `private_map` added to table. (2) `ssu_market` (both tenants) upgraded to v2 with new package IDs in contract table. `market` re-published with new ID. (3) Plans 22-24 status updated: Plan 22 ~95% (contracts upgraded, chain-shared + dApps done, uncommitted changes pending), Plan 23 archived (all 7 phases done), Plan 24 archived (all 4 phases done). Plan 25 added at ~0%. (4) Periscope stats updated: 113 files, 28 views (added PrivateMaps.tsx), 31 routes, 24 DB schema versions. Line counts corrected: Finance 1497, Manifest 627, Wallet 585, Deployables 1330. (5) New Phase 3b added tracking Plans 22-24 implementation with commit references. (6) Phase 5 added for Plan 25 UI polish. (7) Critical path updated: commit pending changes -> E2E test -> UI polish -> demo -> submit. (8) chain-shared module description updated with new modules (crypto.ts, private-map.ts, coin-format.ts). 2 open questions remain (submission format, hosting) -- both logistics, not implementation blockers.

## 2026-03-22 -- manifest-public-locations (pre-execution review)
- **Action:** UPDATE
- **File:** docs/plans/archive/24-manifest-public-locations.md
- **Passes:** 0
- **Result:** archive -- All 4 phases verified complete against codebase. Phase 1 (Data Model + Event Discovery): ManifestLocation interface in db/types.ts, manifestLocations table in db/index.ts V23, LocationRevealed event type in config.ts, Gate+Turret type IDs in ASSEMBLY_TYPE_IDS, discoverLocationsFromEvents() in manifest.ts. Phase 2 (L-Point Resolution): resolveNearestLPoint() + L_POINT_MATCH_THRESHOLD in lpoints.ts, resolveManifestLocationLPoints() in manifest.ts, integrated into discovery function. Phase 3 (Deployable Auto-Population): crossReferenceManifestLocations() in manifest.ts, called at end of discovery. Phase 4 (Manifest UI): Locations tab with makeLocationColumns(), system name resolution, DataGrid, discovery handler, header stats -- all in Manifest.tsx. Plan moved to archive/.

## 2026-03-22 -- market-buy-order-improvements (pre-execution review)
- **Action:** UPDATE
- **File:** docs/plans/active/22-market-buy-order-improvements.md
- **Passes:** 1
- **Result:** active -- Phases 1-4 fully complete (contracts published, chain-shared updated). Phase 5 nearly complete (9/10 steps done). Phase 6 mostly complete (9/10 steps done, 1 optional). Three remaining items: (1) REQUIRED: Import and render VisibilitySettings component in SsuView.tsx -- component exists but is never wired into the UI. (2) OPTIONAL: Update SSU_MARKET_PACKAGE_ID in ssu-market-dapp constants to latest published-at (Sui auto-routes original IDs, so current value works). (3) DEVIATION: queryAllListingsForCurrency does not filter by isPublic as planned -- returns all listings, leaves filtering to caller. Plan updated with comprehensive current state reflecting all implemented code. File summary updated for files that deviated from plan (coin-format.ts not needed, useCoinMetadata already existed, components self-query coin metadata instead of prop drilling, periscope config no change needed). No open questions.

## 2026-03-22 -- periscope-wallet-structures-ui (pre-execution review)
- **Action:** UPDATE
- **File:** docs/plans/active/25-periscope-wallet-structures-ui.md
- **Passes:** 3
- **Result:** active -- Pre-execution review verified all 7 phases (1a, 1b, 2, 3, 4, 5, 6) against codebase. 0/7 phases complete. Three corrections applied: (1) Removed `Players.tsx` from Phase 1a and File Summary -- has no address truncation (only `f.slice(1)` for string capitalization). (2) Added `AclEditor.tsx` and `AclTab.tsx` to Phase 1b permission components and File Summary -- both have address/objectId truncation patterns (6 occurrences total). (3) Fixed `AssemblyActions.tsx` and `PublishToMapDialog.tsx` descriptions from "Address display" to "Object ID display" in both Phase 1b and File Summary. All other references verified correct: ManifestCharacter interface (lines 417-440), searchCachedCharacters (line 230), fetchCharacterByAddress (line 198), StructureRow (lines 46-70), column definitions (Item ID 595-608, Ownership 712-729, Owner 731-746, Fuel 748-758), ownerNames map (line 221), crossReferenceManifestLocations (line 723), syncMapLocations (line 864), Wallet.tsx line refs, queryOwnedCoins in token-factory.ts, @tanstack/react-virtual in ColumnFilter, ContentTabs.tsx listings type (MarketSellListing[] confirmed -- plan correctly identifies the type mismatch). SSU dApp confirmed missing lucide-react, @tanstack/react-table, @tanstack/react-virtual. Both apps use same `@/` path alias. No open questions.
