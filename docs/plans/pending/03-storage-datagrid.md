# Plan: Storage Datagrid Improvements

**Status:** Draft
**Created:** 2026-03-26
**Module:** periscope

## Overview

Four targeted improvements to the Structures (Deployables) view in Frontier Periscope. These changes address location formatting inconsistencies, UX placement issues, a missing market picker, and a fundamental data-flow improvement to manifest-backed structure data.

Currently the Structures datagrid fetches owned structures via direct chain queries (`discoverCharacterAndAssemblies`) and merges them with local `deployables` and `assemblies` tables. Location formatting uses `SYSTEM -- P2-L3` with `--` separators and can show inconsistent results. The Extension "Reset" button lives inline in the datagrid's Extension column, and the SSU market ID field is a raw text input.

The target state introduces `SYSTEM NAME (P#L#)` location formatting throughout the app, moves the Extension reset link to the StructureDetailCard, replaces the Market ID text input with a dropdown picker, and shifts the datagrid to a filtered view over manifest data -- showing only owned, sonar-targeted, or standings-registry structures.

## Current State

### Location Formatting

- **Datagrid column** (`Deployables.tsx` L840-845): `accessorFn` formats as `${sysName} -- ${d.lPoint}` where lPoint is `P2-L3` format. Display shows `SysName -- P2-L3`.
- **LocationEditor** (`Deployables.tsx` L1290-1292): same `--` separator: `${sysName} -- ${row.lPoint}`.
- **StructureDetailCard** (`StructureDetailCard.tsx` L59-62): formats as `${systemName} -- ${row.lPoint}` with fallback to dash char.
- **Market view** (`Market.tsx` L485, L493, L503): formats as `${name} ${m.lPoint}` (space separator) and `${name} P${m.planet}L${m.lPoint}` (no separator). Inconsistent across views.
- The `lPoint` value stored on `DeployableIntel` and `AssemblyIntel` is `"P{n}-L{m}"` (e.g. `"P2-L3"`) per `db/types.ts` L100, L127.
- `resolveNearestLPoint()` in `lib/lpoints.ts` L151 produces `P${planet.index}-${key}` e.g. `"P2-L3"`.
- No centralized `formatLocation()` helper exists -- each view builds its own string.

### Extension Reset Link

- The "Reset" button is in the Extension column cell of the datagrid (`Deployables.tsx` L816-824).
- It appears as a small `text-[10px]` button labeled "Reset" with title "Remove extension (reset to default)".
- Clicking it enters a confirm flow (`revokeConfirmId` state, L795-824) before calling `handleRevoke()`.
- `handleRevoke()` (`Deployables.tsx` L584-629) calls `executeRevoke()` from `useExtensionRevoke`.
- The StructureDetailCard (`StructureDetailCard.tsx`) has no revoke/reset action currently.

### Market ID Picker (SSU Extension)

- The Market ID field is in `SsuStandingsConfig` component inside `StandingsExtensionPanel.tsx` L160-174.
- It is a plain text `<input>` with placeholder `"0x... (leave blank for no market link)"`.
- `SsuConfigValues` interface has `marketId: string` (L262).
- Market objects are stored in `db.currencies` with `marketId` field (db/types.ts L728).
- `CurrencyRecord` has `marketId`, `symbol`, `name`, `coinType` fields.
- Markets are synced from chain via `queryMarkets()` in `packages/chain-shared/src/market.ts` L381.
- The Market view already queries `db.currencies.filter(notDeleted).toArray()` (Market.tsx L80).
- `RegistrySelector` in `components/extensions/RegistrySelector.tsx` provides a pattern for a similar dropdown selector.

### Structure Data in Manifest + Filtered Datagrid

- Currently `Deployables.tsx` L230-234 queries `db.deployables` filtered by owner, and L238 queries all `db.assemblies`.
- These tables are populated by `discoverCharacterAndAssemblies()` in `chain/queries.ts` (individual GraphQL calls per structure).
- `handleSyncOwn` (`Deployables.tsx` L392-466) calls the same discovery function and writes to `db.deployables`.
- The manifest already has `manifestLocations` (db/index.ts L89) keyed by assembly objectId, with `solarsystem`, `lPoint`, `typeId`.
- Cross-referencing happens in `manifest.ts` L824-849 (`crossReferenceManifestLocations`) and L857-882 (`crossReferencePrivateMapLocations`), but only populates systemId/lPoint on existing deployable/assembly records.
- Sonar events reference assemblies via `assemblyId` field (db/types.ts L808). `sonarWatchlist` tracks character/tribe IDs but not assembly IDs directly.
- `registryStandings` (db/types.ts L649-660) track character/tribe standings per registry. To find structures "in a standings registry," we must join: registryStandings -> characterId/tribeId -> manifestCharacters.suiAddress -> deployables/assemblies.owner.
- `structureExtensionConfigs` (db/index.ts L123, L544) stores `registryId` per assembly but only for the user's own configured structures -- not useful for discovering external structures.
- `SubscribedRegistry` records are in `db.subscribedRegistries` (db/index.ts L103).

## Target State

### 1. Location Formatting -- `SYSTEM NAME (P#L#)`

A new shared helper `formatLocation(systemName, lPoint)` returns:
- `"Zarzakh (P2L3)"` when both system name and lPoint are present
- `"Zarzakh"` when only system name is known
- `"P2L3"` when only lPoint is known (unlikely but handled)
- `""` or em-dash when neither is available

The lPoint label `"P2-L3"` is compacted to `"P2L3"` for display by stripping the hyphen. No parentheses are rendered when lPoint data is absent.

All location display sites updated to use this helper:
- Datagrid `location` column accessorFn and LocationEditor display
- StructureDetailCard location section
- Market view location strings (opportunistic alignment)

### 2. Extension Reset -> StructureDetailCard

The "Reset" button and its confirm flow move from the inline Extension column cell to the StructureDetailCard. The card already has structure context and an `onConfigure` callback -- we add an `onReset` callback alongside it. The Extension column in the datagrid loses the Reset/Confirm buttons, keeping only the Deploy/Configure/Update actions.

### 3. Market ID Picker for SSU

Replace the raw text input in `SsuStandingsConfig` with a `MarketSelector` dropdown component (modeled after `RegistrySelector`). It:
- Queries `db.currencies` for all known markets (those with a `marketId`)
- Shows market name/symbol, coinType, and truncated marketId
- Allows clearing the selection (optional field)
- Falls back to the raw text input if no currencies are cached yet
- Stores the selected `marketId` string in `SsuConfigValues` (no type change needed)

### 4. Manifest-Backed Datagrid with Filtered View

The datagrid shifts from querying `db.deployables` / `db.assemblies` directly to reading from a combined view that includes:
- **Owned structures:** `db.deployables` where `owner` matches active character's addresses (unchanged)
- **Sonar-targeted structures:** assemblies/deployables whose `objectId` appears in recent `sonarEvents` (join on `assemblyId`)
- **Registry structures:** structures whose owner appears in a subscribed registry's standings. The join path: `db.assemblies`/`db.deployables` -> `owner` (Sui address) -> `db.manifestCharacters` (suiAddress -> characterId, tribeId) -> `db.registryStandings` (characterId or tribeId). Any structure whose owner (resolved to characterId/tribeId via manifest) has an entry in any subscribed registry is included. Note: `structureExtensionConfigs` only stores configs for the user's own structures, so it cannot be used for this purpose.

The existing `assemblies` table continues to hold watched structures. The key change is the filter: instead of showing all assemblies, only show those that match the three criteria above. A new `useStructureRows()` hook encapsulates the query logic.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location format | `SYSTEM (P#L#)` with compact lPoint | Matches EVE-style conventions; parentheses only when lPoint data exists avoids empty `()` |
| Location helper location | `lib/format.ts` (new) | Centralizes formatting; avoids spreading logic across views |
| lPoint display format | Strip hyphen: `P2-L3` -> `P2L3` | Compact, widely used in EVE conventions |
| Reset button placement | StructureDetailCard only | Reduces datagrid clutter; destructive actions belong in detail views |
| Market selector component | New `MarketSelector.tsx` in `components/extensions/` | Follows same pattern as `RegistrySelector` |
| Market data source | `db.currencies` where `marketId` is non-null | Already synced from chain; no new queries needed |
| Filtered datagrid approach | Computed in `useMemo` from existing live queries | Avoids complex Dexie joins; data sets are small (hundreds, not thousands) for in-memory filtering |
| Sonar-targeted detection | Query recent `sonarEvents` for distinct `assemblyId` values | Direct DB index on `assemblyId` exists |
| Registry structure detection | Join structure owner -> manifest char -> registry standings | Indirect but only viable path; `structureExtensionConfigs` only has user's own structures |

## Implementation Phases

### Phase 1: Location Formatting

1. Create `apps/periscope/src/lib/format.ts` with `formatLocation(systemName?: string, lPoint?: string): string` helper
   - Strip hyphen from lPoint: `"P2-L3"` -> `"P2L3"`
   - Return `"${systemName} (${compactLPoint})"` when both present
   - Return `systemName` when only system
   - Return `compactLPoint` when only lPoint
   - Return `""` when neither
2. Update `Deployables.tsx` location column `accessorFn` (L840-845) to use `formatLocation()`
3. Update `LocationEditor` display text (L1290-1292) to use `formatLocation()`
4. Update `LocationEditor` preview (L1428-1432) to use same format
5. Update `StructureDetailCard.tsx` location string (L59-62) to use `formatLocation()`
6. Optionally update `Market.tsx` location strings (L485, L493, L503) for consistency

### Phase 2: Move Extension Reset to Detail Card

1. Add `onReset?: (row: StructureRow) => void` and `isResetting?: boolean` props to `StructureDetailCard` interface (L39-44)
2. Import `canRevokeExtension` from `@/hooks/useExtensionRevoke` in `StructureDetailCard.tsx`
3. Add a "Reset Extension" button in the Extension section of `StructureDetailCard` (after L170), with confirm flow:
   - Only render when `extensionInfo.status !== "default"` AND `row.ownership === "mine"` AND `canRevokeExtension(row.assemblyModule ?? "")` AND `row.ownerCapId` AND `row.characterObjectId`
   - Button shows "Reset to Default" initially
   - On click, enters confirm state (local `useState` in card)
   - On confirm, calls `onReset(row)`
   - Show loading spinner when `isResetting` is true
4. Remove the Reset button, confirm flow, and `revokeConfirmId` state from the Extension column cell in `Deployables.tsx` (L787-824, plus L388 state declaration)
5. Pass `onReset={handleRevoke}` and `isResetting={revokingId === selectedRow?.objectId}` from `Deployables` to `StructureDetailCard`
6. Remove `revokeConfirmId` state (L388) -- confirm flow now lives in the card

### Phase 3: Market ID Picker

1. Create `apps/periscope/src/components/extensions/MarketSelector.tsx`:
   - Props: `value: string`, `onChange: (marketId: string) => void`
   - Query `db.currencies` for records with non-null `marketId` (note: `CurrencyRecord` has no `tenant` field -- all synced markets are shown)
   - Dropdown UI matching `RegistrySelector` pattern: search, item list, clear option
   - Display each market as `SYMBOL -- truncated marketId`
2. Replace the `<input type="text">` in `SsuStandingsConfig` (`StandingsExtensionPanel.tsx` L160-174) with `<MarketSelector>`
3. Add a "Paste custom ID" fallback toggle for advanced users who need to enter an ID not in the list
4. No changes to `SsuConfigValues` type -- still stores `marketId: string`

### Phase 4: Manifest-Backed Filtered Datagrid

1. Create `apps/periscope/src/hooks/useStructureRows.ts`:
   - Accept active character address(es), tenant
   - Use `useLiveQuery()` (from `dexie-react-hooks`) for all DB queries to maintain reactivity
   - Query `db.deployables` for owned structures (existing logic from Deployables.tsx L230-234)
   - Query `db.sonarEvents` for distinct `assemblyId` values from recent events (last 7 days or configurable), then query `db.assemblies`/`db.deployables` for matching entries
   - Build a `registryOwnerAddresses: Set<string>` in a `useMemo`: load `db.registryStandings` -> collect characterIds/tribeIds -> look up `db.manifestCharacters` to resolve to Sui addresses. Then query `db.assemblies`/`db.deployables` where `owner` is in that set.
   - Merge and deduplicate by `objectId` in a final `useMemo` (owned structures take priority for richer data)
   - Return `StructureRow[]` and any needed lookup maps (ownerNames, extensionByAssembly)
   - Note: the owner name lookup, extension lookup, and contacts lookup currently in Deployables.tsx L254-293 should either move into this hook or remain in the view -- the hook returns raw rows and the view enriches them
2. Replace the inline data-merging logic in `Deployables.tsx` (L296-360 and surrounding queries at L230-241) with `useStructureRows()` hook
3. Keep quick-filter logic (`all` / `mine` / `friendly` / `hostile`) -- it stacks on top of the base filter
4. Remove standalone `db.assemblies.filter(notDeleted).toArray()` query (L238) -- now handled by hook
5. Ensure the "Sync Chain" button still populates `db.deployables` the same way
6. Add a "Show All" toggle or notice so users understand the datagrid is filtered

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/lib/format.ts` | CREATE | Shared `formatLocation()` helper |
| `apps/periscope/src/views/Deployables.tsx` | MODIFY | Use formatLocation, remove Reset from Extension column, replace inline data merge with useStructureRows hook |
| `apps/periscope/src/components/StructureDetailCard.tsx` | MODIFY | Use formatLocation, add onReset prop and Reset button with confirm flow |
| `apps/periscope/src/components/extensions/MarketSelector.tsx` | CREATE | Dropdown selector for Market objects from db.currencies |
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | MODIFY | Replace Market ID text input with MarketSelector component |
| `apps/periscope/src/hooks/useStructureRows.ts` | CREATE | Hook encapsulating filtered structure query (owned + sonar + registry) |
| `apps/periscope/src/views/Market.tsx` | MODIFY | (optional) Align location format strings with formatLocation |
| `apps/periscope/src/lib/lpoints.ts` | UNCHANGED | No changes -- lPoint values stay as `"P2-L3"` in storage; display formatting is in format.ts |

## Open Questions

1. **Should the filtered datagrid allow a "show all" mode?**
   - **Option A: No "show all" -- strict filter only** -- Pros: cleaner UX, intentional curation, smaller data set. Cons: users may want to see all tracked structures.
   - **Option B: Add a "Show All" toggle** -- Pros: flexibility, backward compat, users can browse full dataset. Cons: defeats purpose of filtering, may re-introduce noise.
   - **Recommendation:** Option B -- add a toggle defaulting to filtered view. This preserves the improvement while giving users an escape hatch.

2. **How far back should sonar events be scanned for "targeted by sonar" structures?**
   - **Option A: Last 7 days (rolling window)** -- Pros: bounded, predictable. Cons: may miss older targets.
   - **Option B: Since last clear / configurable** -- Pros: user control. Cons: more complexity.
   - **Option C: All time (all events with assemblyId)** -- Pros: no data loss. Cons: potentially large set.
   - **Recommendation:** Option A -- 7-day rolling window. Simple, bounded, and most sonar targets are recent. Can be made configurable later.

3. **Should the Market ID picker show all synced markets or only markets the user has access to?**
   - **Option A: All synced markets** -- Pros: simple, markets are already filtered during sync. Cons: might show irrelevant markets.
   - **Option B: Only markets where user is creator or authorized** -- Pros: relevant only. Cons: requires re-filtering already-filtered data.
   - **Recommendation:** Option A -- `db.currencies` already contains only markets the user has access to (the sync in Market.tsx L117-126 filters by creator/authorized). No additional filtering needed.

## Deferred

- **Manifest structure table** -- A dedicated `manifestStructures` table that caches all on-chain structures (not just locations) would be the ideal foundation for Phase 4. Deferred because the current approach (filtering existing tables) works without a schema migration.
- **Location auto-resolution on sync** -- When syncing owned structures, auto-query `manifestLocations` to populate systemId/lPoint. Currently relies on separate manifest sync. Could be made more seamless but is a separate concern.
- **Turret/Gate market support** -- The market picker is SSU-specific. Other assembly types might need market links in the future.
- **PrivateMaps location formatting** -- `PrivateMaps.tsx` L782 uses `P{loc.planet}-L{loc.lPoint}` with numeric lPoint values (number, not string). Different data shape than `formatLocation` expects; would need a separate adapter or overload.
