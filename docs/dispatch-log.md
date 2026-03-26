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
