# Dispatch Log

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
