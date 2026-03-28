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
