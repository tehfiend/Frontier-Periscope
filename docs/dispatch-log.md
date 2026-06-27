# Dispatch Log

## 2026-03-26 -- storage-datagrid
- **Action:** CREATE
- **File:** docs/plans/pending/03-storage-datagrid.md
- **Passes:** 4 (3 with changes, 1 NO_CHANGES)
- **Result:** pending -- 4-phase plan covering location formatting, extension reset relocation, market ID picker, and manifest-backed filtered datagrid. 3 open questions remain.

## 2026-03-26 -- manifest-expansion
- **Action:** CREATE
- **File:** docs/plans/pending/04-manifest-expansion.md
- **Passes:** 4 (3 with changes, pass 4 no changes)
- **Result:** pending -- 7-phase plan expanding Manifest to cache markets, registries, private map index, and merge private map locations into unified resolution. 3 open questions remain. Key finding: market/registry packageIds are shared across tenants, so these are stored globally (no tenant field).

## 2026-03-26 -- misc-fixes
- **Action:** CREATE
- **File:** docs/plans/pending/05-misc-fixes.md
- **Passes:** 4 (3 with changes, pass 4 no changes)
- **Result:** pending -- 3-phase plan covering standings reactivity bug fix, deployables datagrid improvements (category column, parent self-ref, notes placeholder, actions reorder), and local entity archival for on-chain objects. 4 open questions remain. Key finding: Sui shared objects cannot be destroyed; local-only _archived flag is the only viable approach.

## 2026-03-26 -- dashboard-landing
- **Action:** CREATE
- **File:** docs/plans/pending/07-dashboard-landing.md
- **Passes:** 4 (3 with changes, pass 4 no changes)
- **Result:** pending -- 2-phase plan: Phase 1 creates a Dashboard landing page at `/` with module cards (characters, private maps, standings, markets, structures) replacing the sonar redirect; Phase 2 adds "Add to map" links in Deployables for structures without locations. 3 open questions remain. Key findings: NavLink hardcodes `activeOptions={{ exact: false }}` requiring modification for Home link; neither Deployables.tsx nor StructureDetailCard.tsx imports TanStack Router Link.

## 2026-03-26 -- extension-fixes
- **Action:** CREATE
- **File:** docs/plans/pending/06-extension-fixes.md
- **Passes:** 4 (4 with changes)
- **Result:** pending -- 3-phase plan fixing turret deploy bug (false success without TX), adding turret staleness detection, and documenting gate toll SUI-only limitation. 5 open questions remain. Key findings: turret config UI model mismatches generator (weights vs. thresholds), witness type mismatch between template and generated source, gates read registry at runtime (no staleness issue), gate toll contract only supports SUI.

## 2026-03-26 -- misc-fixes (update)
- **Action:** UPDATE
- **File:** plans/active/05-misc-fixes.md
- **Passes:** 2
- **Result:** active -- resolved 4 open questions, researched standings reactivity root cause

## 2026-03-26 -- manifest-expansion (update)
- **Action:** UPDATE
- **File:** plans/active/04-manifest-expansion.md
- **Passes:** 3
- **Result:** active -- resolved 3 open questions (A: visual indicator, B: global scoping, A: startup + refresh button)

## 2026-03-26 -- dashboard-landing (update)
- **Action:** UPDATE
- **File:** plans/active/07-dashboard-landing.md
- **Passes:** 2
- **Result:** active -- resolved 3 open questions (B: quick actions with module links, Dashboard naming with exact match, B: depends on Plan 04 manifest data)

## 2026-03-26 -- storage-datagrid (update)
- **Action:** UPDATE
- **File:** plans/active/03-storage-datagrid.md
- **Passes:** 3
- **Result:** active -- resolved 3 open questions (B: show-all toggle, C: all-time sonar, A: all markets with admin info)

## 2026-03-26 -- extension-fixes (update)
- **Action:** UPDATE
- **File:** plans/active/06-extension-fixes.md
- **Passes:** 3
- **Result:** active -- simplified turrets to weights-only with bytecode patching, deferred standings integration pending CCP world contract improvements

## 2026-03-27 -- gate-toll-treasury
- **Action:** CREATE
- **File:** docs/plans/pending/08-gate-toll-treasury.md
- **Passes:** 4 (3 with changes, pass 4 NO_CHANGES)
- **Result:** pending -- 5-phase plan for custom currency gate tolls and shared treasury wallet. New gate extension contract with Coin<T> generics for custom toll currencies, treasury shared object with admin ACL for multi-user fund management, Treasury UI view, gate toll currency selector, and toll-to-treasury PTB integration. 5 open questions remain. Key findings: gate tolls are extension-defined (not world contract), fully generic Coin<T> approach preferred over bytecode patching, Balance<T> recommended for treasury storage, existing Wallet view at /wallet could host treasury but standalone /treasury route is cleaner. Supersedes Plan 06 deferral of custom toll currency.

## 2026-03-27 -- branding-refresh
- **Action:** CREATE
- **File:** docs/plans/pending/09-branding-refresh.md
- **Passes:** 4 (3 with changes, pass 4 NO_CHANGES)
- **Result:** pending -- 2-phase plan refreshing README and landing page messaging. Reframes from "intel and monitoring tool" to "organizational toolkit" positioning. Reorders features to lead with custom currencies, standings/diplomacy, private maps, and treasury. Rewrites feature descriptions to be benefit-oriented. Adds Standings and Treasury cards to landing page (8 cards, up from 6). 5 open questions remain (tagline wording, treasury pre-implementation inclusion, grid layout, screenshots, privacy section restructuring).

## 2026-03-27 -- gate-toll-treasury (update)
- **Action:** UPDATE
- **File:** plans/active/08-gate-toll-treasury.md
- **Passes:** 3
- **Result:** active -- resolved 5 open questions, added coin creation UI migration from Market to Treasury

## 2026-03-27 -- branding-refresh (update)
- **Action:** UPDATE
- **File:** plans/active/09-branding-refresh.md
- **Passes:** 3
- **Result:** active -- resolved 5 questions, added philosophy section, treasury is implemented not coming soon

## 2026-03-27 -- structures-ux-v2
- **Action:** CREATE
- **File:** docs/plans/pending/10-structures-ux-v2.md
- **Passes:** 5 (5 with changes)
- **Result:** pending -- 4-phase plan covering default private map selection, CSV export, extension column cleanup (None->Deploy, remove redundant Configure icon, Periscope branding), market currency column, filterable parent IDs, detail card Deploy/Configure buttons, and inline Add to Map dialog. 3 open questions remain (V2 map support scope, CSV export data source, parent ID truncation format). Key findings: V2 add-location is currently unimplemented in PrivateMaps, onConfigure prop exists on StructureDetailCard but is not wired from Deployables, dataExport.ts has reusable Blob download pattern.

## 2026-03-28 -- structures-ux-v2 (update)
- **Action:** UPDATE
- **File:** plans/active/10-structures-ux-v2.md
- **Passes:** 3
- **Result:** active -- resolved 3 questions, added turret extension detection fix

## 2026-03-28 -- currencies-overhaul
- **Action:** CREATE
- **File:** docs/plans/pending/11-currencies-overhaul.md
- **Passes:** 4 (4 with changes)
- **Result:** pending -- 5-phase plan merging Market view and Treasury currency management into a unified Currencies page at /currencies. DataGrid with all currencies from manifestMarkets, Excel-like filtering, archive toggle, inline create with 2-decimal default, ConnectWalletButton pattern, detail panel with admin actions + order book + SSU link. Market.tsx deleted, Treasury.tsx trimmed to treasury-wallet only, syncMarkets deduplicated. 3 open questions remain (treasury balance column, exchange inclusion, SSU link placement). Key findings: Treasury.tsx is 1628 lines with StatusBanner/FormField shared between treasury and currency sections; both Market.tsx and Treasury.tsx duplicate identical syncMarkets logic; CreateCurrencyForm uses plain text instead of ConnectWalletButton.

## 2026-03-28 -- currencies-overhaul (update)
- **Action:** UPDATE
- **File:** plans/active/11-currencies-overhaul.md
- **Passes:** 3
- **Result:** active -- resolved 3 questions (treasury balance included, exchange order book added, SSU link to structures only)

## 2026-03-28 -- currencies-overhaul (simplify)
- **Action:** UPDATE
- **File:** plans/active/11-currencies-overhaul.md
- **Passes:** 2
- **Result:** active -- removed backwards-compat concerns, fresh contract/schema design

## 2026-03-28 -- ssu-market-linking
- **Action:** CREATE
- **File:** docs/plans/pending/12-ssu-market-linking.md
- **Passes:** 4 (4 with changes)
- **Result:** pending -- 5-phase plan for new ssu_unified Move contract with market_id storage, config deployment flow, SSU dapp market resolution, and trade TX builder refactor to PTB-only. 3 open questions remain (trade entry points vs PTB-only, config discovery strategy, old ssu_standings removal). Key findings: deployed ssu_unified/ssu_standings contracts lack market fields and source not in repo; market_standings::post_sell_listing uses virtual listings (no item escrow); owned config objects work because trade TXs read config via GraphQL rather than passing as TX argument.

## 2026-03-28 -- ssu-market-linking (simplify)
- **Action:** UPDATE
- **File:** plans/active/12-ssu-market-linking.md
- **Passes:** 2
- **Result:** active -- stripped legacy concerns, fresh contract design

## 2026-03-28 -- ssu-escrow-transfers
- **Action:** CREATE
- **File:** docs/plans/active/13-ssu-escrow-transfers.md
- **Passes:** 5 (4 with changes, pass 5 trivial line-number fix)
- **Result:** active -- 5-phase plan fixing SSU market escrow transfers. 4 composite Move functions (escrow_and_list, buy_and_receive, cancel_and_unescrow, fill_and_deliver) atomically combine market + inventory operations. buy_and_receive authorization via payment. SsuUnifiedConfig changed from owned to shared.

## 2026-03-29 -- ssu-escrow-transfers (resolve questions)
- **Action:** UPDATE
- **File:** docs/plans/active/13-ssu-escrow-transfers.md
- **Passes:** 2 (1 with changes, 1 NO_CHANGES)
- **Result:** active -- resolved 3 open questions (A: bypass standings for hackathon, A: off-chain buyer character resolution, A: shared escrow pool). Thorough verification against codebase: all line numbers, file paths, prop threading claims, and dead code claims confirmed accurate. Minor formatting fix applied.

## 2026-03-30 -- log-reader-fixes
- **Action:** CREATE
- **File:** docs/plans/active/14-log-reader-fixes.md
- **Passes:** 3 (2 with changes, pass 4 NO_CHANGES)
- **Result:** active -- 4-phase plan fixing log file reader/tailer bugs. Partial line buffering + truncation reset (data loss), \r\n normalization, UTF-16LE byte alignment, poll interval 5s->1s + diagnostics.

## 2026-03-30 -- log-reader-fixes (resolve questions)
- **Action:** UPDATE
- **File:** docs/plans/active/14-log-reader-fixes.md
- **Passes:** 1
- **Result:** active -- resolved 3 open questions (A: hardcoded 1s interval, A: ephemeral Map for pending buffers, A: plain console with prefix)

## 2026-03-30 -- exchange-ui
- **Action:** CREATE
- **File:** docs/plans/active/15-exchange-ui.md
- **Passes:** 4
- **Result:** active -- 6-phase plan adding Exchange tab to ssu-dapp with order book browser, place/cancel order dialogs, create pair dialog. Refactors chain-shared TX builders for merge+split PTB pattern. 3 open questions resolved (B: standalone/global tab, A: pre-split coin deposit, C: hybrid coin type picker).

## 2026-03-30 -- exchange-ui (update)
- **Action:** UPDATE
- **File:** plans/active/15-exchange-ui.md
- **Passes:** 4 (3 with changes, pass 4 NO_CHANGES)
- **Result:** active -- execution-ready. Added exact import paths, line references, merge+split code snippet, PairRow sub-component pattern, tab visibility conditions, error code handling approach.

## 2026-03-30 -- wallet-connect-audit
- **Action:** CREATE
- **File:** docs/plans/pending/16-wallet-connect-audit.md
- **Passes:** 3 (2 with changes, pass 3 NO_CHANGES)
- **Result:** pending -- 4-phase plan auditing and fixing wallet connection patterns across 12 files in apps/periscope. Converts all ConnectWalletButton ternaries, !account gates, and silent-fail guards to inline auto-connect pattern (prefer Eve Vault, connect-and-execute in one click). Removes ConnectWalletButton export. 12 violations identified across views (Currencies, Deployables, PrivateMaps, Standings, Wallet), components (AddCharacterDialog, AddToMapDialog, TurretPublishFlow, TransferDialog), and hooks (useExtensionRevoke, useExtensionDeploy). 3 open questions remain (CurrencyDetail sender address source, PrivateMaps keyPair timing, TransferDialog prop strategy).

## 2026-04-02 -- sonar-audit
- **Action:** CREATE
- **File:** docs/plans/pending/17-sonar-audit.md
- **Passes:** 3 (2 with changes, pass 3 NO_CHANGES)
- **Result:** pending -- Deep audit of the full Sonar system (13 files, ~5000 LOC). Found 8 bugs (3 critical, 5 high), 5 performance issues, and 9 low-priority issues. Critical: chain event cursor init race causing duplicate events (BUG-01/02), local sonar full-table scan every 5s (BUG-03). High: alert HWM race, truncation recursion, sonarStore DB persistence race, watchlist dependency churn, ping settings never restored on load. Performance: 5000-event reactive query, unindexed source filter, N+1 watchlist queries, context rebuild every 15s. Also found dead bounty event types and missing reimport cleanup. 4-phase implementation plan organized by priority. 3 open questions remain (dedup strategy, HWM migration approach, event limit reduction).

## 2026-04-02 -- bulk plan review
- **Action:** UPDATE (5 plans)
- **Plans reviewed:** 12, 13, 15, 16, 17
- **Passes:** 1 per plan (5 total agents)
- **Results:**
  - **12-ssu-market-linking** -> `archive/` -- all 5 phases complete. Contract uses shared objects + atomic composite trades (improvements over original design).
  - **13-ssu-escrow-transfers** -> `archive/` -- all 5 phases complete. 6 enhancements beyond original plan (market ID validation, player-side TX builders, delegate cancel fallback, buyer-is-SSU-owner optimization, escrow quantity tracking, connected character threading).
  - **15-exchange-ui** -- stays `active/`, not started. Phase status markers added, TabId line reference corrected.
  - **16-wallet-connect-audit** -- stays `pending/`, in progress. Line numbers corrected, OQ#1 resolved (CurrencyDetail uses ensureWallet), OQ#4 added (useExtensionDeploy approach). 3 open questions remain.
  - **17-sonar-audit** -- stays `active/`, not started. Line references and file inventory line counts corrected, PERF-02 description refined (compound index exists but Dexie .where() doesn't leverage it).

## 2026-04-02 -- stillness-support
- **Action:** CREATE
- **File:** docs/plans/pending/18-stillness-support.md
- **Passes:** 2 (1 draft + 1 refinement)
- **Result:** pending -- Stillness upgraded from v0.0.18 to v0.0.23 on April 1. Both tenants now at contract code parity. Primary fix: add `worldPublishedAt` to Stillness config (periscope + ssu-dapp). Also: remove `access_control` fallback in queries.ts, update stale v0.0.18 comments in transactions.ts, update reference docs. Active bug found: `buildRemoveExtension()` silently failing on Stillness because `revoke_extension_authorization` doesn't exist at the v0.0.18 original address. 3 open questions remain (access_control fallback safety, gate/storage_unit rename enablement, standings packageId for Stillness).

## 2026-04-02 -- stillness-support (review)
- **Action:** UPDATE
- **File:** docs/plans/active/18-stillness-support.md
- **Passes:** 3 (OQ resolution + 2 refinement passes)
- **Result:** active -- All 3 open questions resolved: (1) remove access_control fallback (module has always been `world::access`), (2) enable gate/storage_unit rename in-scope (2-line change, UI already dynamic), (3) leave standings packageId as-is (ecosystem works, bookkeeping gap only). Code snippets updated to match actual files, line references verified, Phase 2 expanded with gate/storage_unit rename steps. Execution-ready.

## 2026-06-26 -- cycle-6-cutover
- **Action:** CREATE
- **File:** docs/plans/pending/26-cycle-6-cutover.md (gitignored -- local only)
- **Passes:** 4 (1 draft + 3 adversarial review/apply rounds via workflow; 5-lens panel: accuracy, completeness, phase-sizing, consistency/safety, risk)
- **Result:** pending -- Instantiates docs/runbooks/cycle-cutover.md for the Cycle 6 (Stillness) values resolved against github.com/evefrontier/world-contracts (world pkg 0x8b8a46ed = published-at, fresh v1; eve token 0xac361aa5; object registry 0xf6aed936; chain-id 4c78adac unchanged; checkpoint 352596413). 7 phases (0-6), Stillness-only (Utopia inaccessible). Key findings beyond the runbook: (1) the three deleted extractors (extract_game_data/static_data/celestials.py) were recoverable from git history (59df905/0124215), restored + staged; (2) PWA service-worker CacheFirst serves stale /data/*.json for 7 days -- requires vite.config workbox cacheName bump, not just STELLAR_DATA_VERSION; (3) celestials needs CELESTIALS_DATA_VERSION bump or a V33 clear leaves it permanently empty; (4) gameTypes must stay on a version-key bump (NOT a V33 hard-clear) to survive the down World API host; (5) sonar cursors are event-name-scoped not package-scoped (stale-cursor leak) -> Dexie V33 reset. Deploy gated in two waves (offline config+static to dev; republish+cache-invalidation+prod held until the new world is Sui-queryable + World API host up + chain emitting events). 6 open questions (Q3 republish scope, Q4 archive route, Q5 checkpoint, Q6 Utopia cleanup, Q7 MVR, Q8 cutover timing while host down).

## 2026-06-26 -- static-only-build (Plan 27)
- **Action:** CREATE
- **File:** docs/plans/active/27-static-only-build.md (gitignored -- local only; MOVED to active/ to trigger execution session)
- **Passes:** 3 (1 draft + 2 adversarial review/apply rounds via workflow; 4-lens panel: classification, flag-design, execution-readiness, accuracy/safety)
- **Result:** active (execution-ready) -- Interim Cycle 6 build: disable all chain-contract features behind a single build-time flag CHAIN_ENABLED (new apps/periscope/src/featureFlags.ts, sourced from committed .env.production/.env.development VITE_CHAIN_ENABLED=false), keep all non-chain features working. Rationale: chain features are ALREADY broken in prod (world republished, World API host down), so a chain-disabled build is a net improvement. Owner priority = log analyzer (Sonar local-log mode) + Industry Calculator, both 100% non-chain. Verified classification: 5 static / 5 mixed / 7 chain-disabled routes. 7 phases (flag module, gate chain hooks, nav/route/command-palette filters, mixed-view degradation, refresh static data + cache bumps, log-analyzer Cycle-6 verification, version+build chain-OFF+deploy with dev->STOP->prod). Key catches: useChainSonar already has a chainEnabled flag in sonarStore; IndustryCalculator's BomStockPanel secretly pulls chain inventory via useOwnedAssemblies (gated to manual entry); useLogWatcher date floor 20260311 already passes Cycle-6 logs. 2 non-blocking OQs (env-file vs dashboard var; dedicated feature/cycle6-static-only branch -- both recommend Option A). Plan 28 flips the flag back on. Drafted while owner away; moved to active/ per instruction to trigger the execution session.

## 2026-06-26 -- cycle6-contracts-and-chain (Plan 28)
- **Action:** CREATE
- **File:** docs/plans/pending/28-cycle6-contracts-and-chain.md (gitignored -- local only; left in pending for owner review, NOT auto-triggered)
- **Passes:** investigate (enumerate 14 blockers + parallel verify vs new world-contracts HEAD) + 1 draft + 2 adversarial review/apply rounds (26 agents total via workflow)
- **Result:** pending -- The CHAIN half of the cutover: republish ssu_unified only (verified sole world-dependent production contract) against the Cycle 6 world (fresh publish, new original; world rev v0.0.21 -> pin main commit d1929fad7 since the Cycle 6 world is only on HEAD, not a tag; possible Sui toolchain 1.68->1.74 bump), apply Cycle 6 chain identity (cites Plan 26 Phase 3a), invalidate the chain-subset Dexie caches via V33 (cites Plan 26 Phase 5; static caches already done by Plan 27), flip CHAIN_ENABLED back on, deploy dev->STOP->prod. INVESTIGATION VERDICT: 5 resolved / 1 partial / 8 unresolved / 0 unknown -- BUT the 5 "resolved" were already resolved in Cycle 5 (v0.0.19 era); Cycle 6 added NO new contract capabilities for our blockers. turret.move/gate.move/assembly.move are byte-identical v0.0.21->HEAD, so FR1 (turret config-object), FR2 (retarget), FR3 (dynamic fields), FR4 (config discovery), FR5/FR6/FR8 (aggression/write) all REMAIN BLOCKED. CRITICAL Cycle 6 BREAKING CHANGE found: inventory.move swapped ItemDeposited/WithdrawnEvent -> ...EventV2 (adds inventory_key); Periscope queries V1 names (config.ts:97-98, sonarEventHandlers.ts:664-665) -> deposit/withdraw events silently vanish from Sonar/market unless migrated to V2 (plan Phase 2 step 2). NET-NEW: rift.move (RiftSpawnedEvent/RiftLocationBroadcastEvent) -- new Cycle 6 system to index. Top genuinely-new feature unblocked once chain re-enabled: SSU access-controlled storage (FR7). 4 open questions (turret scope, world-rev pin, ItemEventV2 migration timing, build-new-features-now-vs-defer).

## 2026-06-26 -- rift-intel (Plan 29)
- **Action:** CREATE
- **File:** docs/plans/pending/29-rift-intel.md (gitignored -- local only)
- **Passes:** investigate (design against the real chain/StarMap/Sonar pipeline) + 1 draft + 2 adversarial review/apply rounds via workflow
- **Result:** pending -- The C6 net-new `rift/rift.move` system as a read-only chain-indexing feature (Plan 28 net-new opportunity #7, spun out). Subscribes to `RiftSpawnedEvent` (hash-only, low-value) + `RiftLocationBroadcastEvent` (coords, high-value), caches in a new Dexie `rifts` table (V34), fires a `rift_revealed` Sonar ping (on by default; `rift_spawned` off), and plots fuchsia rift markers on the Star Map. Integration mirrors the CharacterCreated special-case (manifest-layer poll that bypasses the ownership-filtered EVENT_HANDLER_REGISTRY so one GraphQL query drives BOTH the table and the ping). Closest existing code: discoverLocationsFromEvents/pollCharacterEvents in manifest.ts. Filter is "global" (server-emitted via admin_acl.verify_sponsor -> sender is a sponsor address, useless for owner attribution). 5 phases (data model+event types, indexing pipeline, real-time wiring+ping, Star Map layer, optional surfacing/housekeeping). Behind CHAIN_ENABLED, inert until Plan 28 re-enables chain; can merge ahead of it. 4 open questions (index spawned events vs broadcast-only, Dexie V34 sequencing vs Plan 28's V33, staleness TTL since no despawn event exists, dedicated list view now vs defer). Highest risk flagged: coordinate frame assumed sun-relative (like LocationRevealedEvent) -- verify against a live broadcast in Plan 28 Phase 6 smoke. Owner explicitly prioritized this feature.

## 2026-06-26 -- ssu-market-cycle6-improvements (Plan 30)
- **Action:** CREATE
- **File:** docs/plans/pending/30-ssu-market-cycle6-improvements.md (gitignored -- local only)
- **Passes:** investigate (SSU/market improvement analysis with honest feasibility classification) + 1 draft + 2 adversarial review/apply rounds (incl. a contract-claim-rigor lens) via workflow
- **Result:** pending -- Investigated whether C6 improves our SSU + currency-market stack. HONEST HEADLINE: C6's net contribution is small -- `inventory_key` is purely OBSERVABILITY and adds no new callable world capability, so it unblocks nothing in our Move contracts. The one genuine win: the deposit/withdraw event stream now self-identifies the partition (owner_cap_id / open-inventory key / player Character OwnerCap). Scope = frontend/indexing partition attribution only (opportunities #1 owner-vs-player + #2 escrow), split into a high-feasibility half (owner/player, no open-key derivation needed) and a medium half (escrow, gated on Q1 open-key discovery). #3 escrow reconciliation/desync alerting = optional follow-on. #4 FR7 vending = NOT a C6 unblock (possible since v0.0.18; buy_and_receive already payment-gated). #5 cross-SSU transfer = still CCP-blocked (transfer_items() is a FUTURE stub, EItemParentMismatch asserted everywhere). #6 in-contract guard = low value (happy path already atomic via ssu_unified composites). The contract-claim-rigor review CORRECTED the seeding investigation's wrong PATH (no useInventory.ts in the periscope app; partition classification there lives in chain/inventory.ts, owner_cap->character in manifest.ts) -- but a later cross-check (post-workflow) found the helper DOES exist in the sibling app: apps/ssu-dapp/src/hooks/useInventory.ts:265 ships computeOpenInventoryKey = blake2b256(bcs(ssu_id)||"open_inventory") + a full owner/open/player classifier. So escrow attribution is HIGH feasibility (port the proven helper or lift it to chain-shared), not an unsolved sub-problem; Q1 is read-vs-derive (recommend Option C derive). Plan 30 + Q1 updated 2026-06-26 to cite the ssu-dapp reference impl. Hard prerequisite: Plan 28 Phase 2 step 2 (V1->V2 migration). 3 phases + 4 open questions (open-key discovery method, partition field shape, build reconciliation now vs defer, owned-only vs public SSUs).

## 2026-06-26 -- plans 28/29/30 cross-linking + CCP wish-list Cycle 6 audit
- **Action:** UPDATE (3 docs)
- **Files:** docs/plans/pending/28-cycle6-contracts-and-chain.md, docs/CCP_Feature_Requests.md
- **Result:** Folded the Plan 29/30 investigation back into the surrounding docs. Plan 28: added Plan 29 pointer to net-new opportunity #7, added net-new opportunity #8 (inventory_key attribution -> Plan 30 with the "no new world capability" honest note), and cross-referenced both plans in Q4 + Deferred. CCP_Feature_Requests.md (was stale at 2026-03-23, pre-C6): added a "Cycle 6 Update (2026-06-26)" section documenting the only two world deltas (inventory_key V2 = observability-only, rift.move = net-new event stream) and confirming #1/#2/#3/#4/#5/#6/#8 remain unaddressed (turret/gate/assembly byte-identical v0.0.21->HEAD); marked #7 RESOLVED (vending shipped v0.0.18, not a C6 unblock); flagged the V2 migration action item; refreshed the priority-summary #7 row and the footer date. Net for CCP: #5 (criminal timer) and #8 (structure-under-attack event) remain the top open Critical/Low-effort asks, both untouched by C6.

## 2026-06-26 -- chain re-enable: prep all chain-gated plans for execution
- **Action:** UPDATE (8 docs) + supersede 1
- **Trigger:** Owner greenlit re-enabling ALL blockchain features ("I'm ready to update all of the blockchain features. Prep all of those plans for execution."). Cycle 6 confirmed live.
- **Liveness re-verified (not assumed):** C6 world `0x8b8a46ed...` queryable on Sui (object resolves as a Move package); chain emitting C6 events (owner played live C6). World API host `world-api-stillness.live.tech.evefrontier.com` STILL down (all candidate hosts -> 000), but it only feeds gameTypes via `worldApi.ts` with a static `/data/types.json` fallback (`DataInitializer.tsx:139-141`, non-blocking) -- so it does NOT gate the chain re-enable. config.ts still on the Cycle-5 world `0x28b497...` + CHAIN_ENABLED=false = our own undone work, fixed by Plan 28.
- **Result:** 7 plans -> active/, 1 -> superseded/. Survey done by 5 parallel read agents; prep done by 3 parallel edit agents (distinct file ownership, cardinal rule held).
  - **28-cycle6-contracts-and-chain -> active/** (EXECUTE FIRST). Q3 liveness gate CLEARED (owner greenlit; re-verified a+c, b non-gating). New LOCKED decision: gameTypes World API fetch made FAIL-SAFE (try host -> silent static fallback, never block init, no hard dep on dead host). Fixed stale refs: Plan 25 -> "the dev-deployment plan"; Plan 26 path -> superseded/.
  - **currency-trading-ui -> active/** (prereq: Plan 28). OQ1 resolved: first pass = read-only order book + buy-order create/fill; sell-listing creation deferred to Plan 30's SSU work, then via SSU picker. OQ2/OQ3 per Option A. Re-confirm drifted line refs at execution.
  - **wallet-connect-audit -> active/** (resume, ~15-20% done; no external blocker). OQ2/3/4 resolved per recommendations. Commit pending Deployables/useExtensionRevoke changes first.
  - **dev-deployment -> active/** (dev-deploy scope). OQ1 resolved: keep frontierperiscope.com (dev at dev-app.frontierperiscope.com), NOT tehfrontier.com. OQ2/3/4 resolved. Contract-env half flagged as partly superseded by Plan 28.
  - **29-rift-intel -> active/** (impl can proceed now; dormant until Plan 28). Q1-Q4 all resolved to Option A.
  - **30-ssu-market-cycle6-improvements -> active/** (Phases 1-2; hard prereq Plan 28 Phase 2 V1->V2 migration). Q1 Option C (derive open key), Q2 Option A (typed inventoryPartition field), Q3/Q5 defer, Q4 keep owned_ssu. Cross-SSU atomic transfer stays Deferred (blocked-needs-ccp).
  - **19-tenant-filtering-audit: deferred/ -> active/** (Phase 1 shipped; Phase 2 testable once Plan 28 re-enables chain). No OQs.
  - **26-cycle-6-cutover -> superseded/** -- static half = Plan 27 (archived), chain half = Plan 28. SUPERSEDED banner added; do NOT execute (execute Plan 28). Its 6 OQs covered by Plan 28 or minor cleanups.
- **Cross-refs normalized:** all inter-plan pending/ paths -> active/ for moved files; 28's File Summary self-ref + Plan 25/26 refs updated.
- **Execution order:** Plan 28 FIRST (re-enables chain, updates config, V1->V2 migration). Then dependents: 30 after 28 Phase 2; 19/currency/wallet/29 after 28 lands. All gitignored/local; no commits made.
- **Still note:** 28/29/30/26 retain number prefixes (kept this pass to avoid cross-ref churn). Owner's no-number convention -> separate de-numbering pass available on request.

## 2026-06-26 -- restore incremental plan numbering (convention reversal)
- **Action:** RENAME (5 plans) + convention update
- **Trigger:** Owner reversed the earlier no-numbers preference: "I kind of like the numbers because it's easy to identify them ... Restore numbers and resume using an incremental plan ID numbering system!"
- **Renames:** active/wallet-connect-audit -> 16-, active/currency-trading-ui -> 21-, active/dev-deployment -> 25- (original numbers restored; slots were free). archive/cycle-reset-mechanism -> 31-, archive/buildable-blueprints-filter -> 32- (the two plans created during the no-numbers window; numbered by completion order after the prior max of 30).
- **Ref fixes:** Plan 28 prose "the dev-deployment plan" -> "Plan 25 (dev-deployment)" (4x); runbooks/cycle-cutover.md "docs/plans/pending/dev-deployment.md" -> "docs/plans/active/25-dev-deployment.md" (4x, also corrected the stale pending->active folder). No path refs to the un-numbered files existed elsewhere, so nothing else broke.
- **Convention restored:** /planfile skill (.claude/commands/planfile.md) reverted to `{NN}-{feature-name}.md`, NN = highest existing plan number across ALL plans/ subdirs + 1 (re-check max before naming; parallel sessions can collide). Plan number lives only in the filename, not the title. Memory feedback_plan_naming.md rewritten (number-plans-incrementally) + MEMORY.md index updated.
- All gitignored/local; no commits made.

## 2026-06-26 -- fold Cycle 5 -> 6 string sweep into Plan 28
- **Action:** UPDATE (docs/plans/active/28-cycle6-contracts-and-chain.md)
- **Why:** Cycle 6 is live (memory project_current_cycle corrected), but code was scrubbed cycle6->cycle5 in commit 7e4eda8 BEFORE C6 launched (2026-06-25). Verified current code has ZERO cycle6 strings; everything reads "Cycle 5" (incl. live ssu-dapp footer + version.ts changelog + README).
- **Added:** Phase 4 step 5 "Cycle 5 -> 6 string sweep" -- user-facing (ssu-dapp App.tsx L103 footer, version.ts L21/26/31 changelog, README L7), cache/cycle-version levers (vite.config.ts L48 cacheName static-data-cycle5->cycle6 = one-time SW re-clear; cycleReset.ts L14 CYCLE_VERSION cycle5-interim->cycle6-interim), cosmetic comments (featureFlags/CommandPalette/useBlueprintData/scripts). Explicitly LEAVE useLogWatcher "Cycle 5+" (means cycle 5 onward, still valid) and the STELLAR/CELESTIALS data-version numbers (not cycle-labeled).
- **Reconciled the plan's now-false claims:** Current State (said cacheName already = static-data-cycle6), Overview (said Plan 28 does not re-touch cacheName), Design Decisions (split "do not touch static caches" into data-versions=leave vs cacheName=rename), Phase 4 step 3 (dropped the wrong "README already Cycle 6" assertion), File Summary (added rows for App.tsx/vite.config/cycleReset/README/comment files; removed cacheName from the "not re-touched" note).
- All gitignored/local; no commits.
