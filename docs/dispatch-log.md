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

## 2026-03-15 — market-currency-system execution review
- **Action:** UPDATE (execution review)
- **File:** docs/plans/active/06-market-currency-system.md
- **Passes:** 2 (converged — pass 2 found 1 minor fix, all else verified clean)
- **Result:** Comprehensive pre-execution review with 21 changes across 2 review agents + 1 refinement pass. **Critical discoveries:** (1) SSU item binding constraint — `parent_id` locks items to originating SSU, making cross-SSU transfers impossible. Redesigned buy orders from automated `fill_buy_order` to stakeholder-confirmed `confirm_buy_order_fill`. (2) Missing `governance` source dependency in Move.toml files — both `governance_ext` and `ssu_market` upgrade had `governance` address in `[addresses]` but no source path in `[dependencies]`, preventing compilation. Fixed with `governance = { local = "../governance" }`. (3) Missing `stock_items()` function — sell orders need items in extension inventory but no function existed to move them there. Added `stock_items` with full PTB stocking flow. (4) Template mint/burn omission — gas station template contradicted resolved question #4. Added bootstrap mint/burn. (5) Mutable borrow conflict in Move code — `confirm_buy_order_fill` held `&mut record` while calling `dynamic_field::remove(&mut market.id)`. Fixed with block-scoped borrow. 1 non-blocking open question remains (game client deposit inventory target). Plan stays in active/.
