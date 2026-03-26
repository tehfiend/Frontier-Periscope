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
