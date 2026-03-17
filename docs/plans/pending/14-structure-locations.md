# Plan: Structure Location Recording
**Status:** Draft
**Created:** 2026-03-17
**Module:** periscope

## Overview

Structures (turrets, gates, SSUs, network nodes, etc.) are tracked in the Deployables view but have no way to record *where* they're anchored. The `systemId` field already exists on both `DeployableIntel` and `AssemblyIntel` types but is never populated through the UI -- it only gets preserved if it existed before a chain sync. There is no L-point field at all.

This plan adds the ability to manually record each structure's solar system and Lagrange point (L1-L5). Players anchor structures at L-points within systems, so knowing the system + L-point combination is essential for fleet coordination, intel tracking, and logistics planning. The SystemSearch component already exists inside JumpPlanner.tsx and will be extracted into a reusable shared component.

Since there's no chain data or game API that exposes which system/L-point a structure is anchored at, this is necessarily a manual data entry feature. The goal is to make it as frictionless as possible -- inline editing in the DataGrid, searchable dropdown for systems, simple L-point selector.

## Current State

- **DeployableIntel** (`apps/periscope/src/db/types.ts` line 80): has optional `systemId?: number` and `position?: [number, number, number]` fields. No L-point field.
- **AssemblyIntel** (`apps/periscope/src/db/types.ts` line 103): has optional `systemId?: number`. No L-point field.
- **StructureRow** (`apps/periscope/src/views/Deployables.tsx` line 33): has `systemId?: number` but no L-point. The system column is not rendered in the DataGrid.
- **DB indexes** (`apps/periscope/src/db/index.ts`): neither `deployables` nor `assemblies` tables are indexed on `systemId`.
- **SystemSearch component** exists inline in `apps/periscope/src/views/JumpPlanner.tsx` (lines 63-144). It searches `SolarSystem[]` by name/id, shows a dropdown of up to 12 results, and returns the selected system ID. Not reusable from other views.
- **Locations view** (`apps/periscope/src/views/Locations.tsx`) has its own inline system search (lines 186-198) that searches a `Map<number, string>` -- a different pattern from the JumpPlanner version.
- **Solar system data**: 24,426 systems in `apps/periscope/public/data/stellar_systems.json` (both 30000xxx and 34000xxx ranges), loaded into Dexie `solarSystems` table indexed by `id, name, constellationId, regionId`.
- **Celestial data**: `mapObjects.db` at `{gameRoot}/utopia/bin64/staticdata/mapObjects.db` (SQLite, 18MB) contains 261,219 celestials: 24,026 suns, 83,257 planets, 147,060 moons, 6,876 stargates. Covers 24,026 of the 24,426 systems (400 special systems in 32000xxx/34000xxx lack celestials).
- **L-point data**: No explicit L-point records exist, but each planet has 5 implicit L-points (L1-L5). 83,257 planets x 5 = ~416,000 L-points. This matches EF-Map's "417,000+" claim. Planet count per system ranges from 1-13 (median ~3). The `celestials` table has `solarSystemID`, `groupID` (7=Planet), `celestialIndex` (planet number), `orbitID` (parent body ID), and `x,y,z` coordinates.
- **Planet drill-down is possible**: System -> Planet N -> L1-L5. The L-point selector should show planets for the selected system (queried from mapObjects.db or a pre-extracted JSON), then L1-L5 for the chosen planet.
- **Chain sync -- Deployables view** (`apps/periscope/src/views/Deployables.tsx` line 305): preserves existing `systemId` on re-sync (`systemId: existing?.systemId`) but never discovers it from chain.
- **Chain sync -- sync.ts** (`apps/periscope/src/chain/sync.ts`):
  - `syncOwnedAssemblies` (line 98): preserves `systemId` via `existing?.systemId ?? 0` but does NOT preserve `lPoint`.
  - `syncTargetAssemblies` (line 137-149): builds `AssemblyIntel` without preserving `systemId` or `lPoint` from existing records.

## Target State

1. **New `lPoint` field** on `DeployableIntel` and `AssemblyIntel` -- a simple string field ("L1" through "L5") to record which Lagrange point the structure is anchored at.
2. **Reusable `SystemSearch` component** extracted to `apps/periscope/src/components/SystemSearch.tsx` -- used by JumpPlanner, Locations, and Deployables.
3. **"Location" column** in the Deployables DataGrid showing "System Name -- L3" (or just system name if no L-point, or just L-point if no system, or "--" if neither).
4. **Inline location editing** -- clicking the location cell opens a popover/dropdown with the SystemSearch widget and an L-point selector (5 buttons: L1-L5), with save/cancel controls.
5. **DB index on `systemId`** for both `deployables` and `assemblies` tables to enable future filtering/grouping by system.
6. **DataGrid column filter** on the Location column so users can filter structures by system or L-point.

### Data Model Changes

```typescript
// DeployableIntel -- add:
lPoint?: string; // "L1" | "L2" | "L3" | "L4" | "L5"

// AssemblyIntel -- add:
lPoint?: string; // "L1" | "L2" | "L3" | "L4" | "L5"
```

### DB Version Bump

Version 17 adds `systemId` and `lPoint` indexes to both `deployables` and `assemblies`:
```
deployables: "id, objectId, assemblyType, owner, status, label, systemId, updatedAt, _hlc, ownerCapId, *tags"
assemblies:  "id, assemblyType, objectId, owner, status, systemId, updatedAt, _hlc, *tags"
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| L-point storage format | Free string field ("L1"-"L5"), not an enum or number | Keeps the type simple, allows future extension (e.g. "Station" or custom labels). Validated in the UI to restrict to L1-L5 for now. |
| L-point count per system | Per-planet L1-L5, planet count from mapObjects.db | `mapObjects.db` has planet counts per system (1-13 planets each). The selector should show "Planet 1", "Planet 2", etc. based on actual data, then L1-L5 for the chosen planet. 400 special systems lack data -- fall back to free text for those. |
| Inline editing approach | Popover panel on cell click | Matches the existing `EditableCell` pattern but needs a richer editor (system search + L-point buttons). A modal would be too heavy; inline editing can't fit a search dropdown. A popover anchored to the cell is the right balance. |
| SystemSearch extraction | Lift JumpPlanner's SystemSearch to shared component | JumpPlanner's version is more polished (searches Dexie array directly, shows system IDs, proper focus/blur handling). The Locations view version uses a Map and is simpler but less reusable. |
| DB indexing | Add systemId index on both tables | Enables future "filter by system" queries and grouping. Worth the minor index overhead since these tables are small (hundreds of rows at most). |
| Column placement | Location column between "Type" and "Ownership" | Location is a key identifier -- grouping structures by where they are is a primary use case. Placing it early in the grid makes it visible without horizontal scrolling. |

## Implementation Phases

### Phase 1: Data Model & Shared Component

1. **Add `lPoint` field to types** -- In `apps/periscope/src/db/types.ts`:
   - Add `lPoint?: string` to `DeployableIntel` (after `systemId` field, line ~86)
   - Add `lPoint?: string` to `AssemblyIntel` (after `systemId` field, line ~108)

2. **Add DB version 17** -- In `apps/periscope/src/db/index.ts`:
   - Add `this.version(17).stores({...})` after the V16 block
   - Re-declare `deployables` index string with `systemId` added
   - Re-declare `assemblies` index string with `systemId` added
   - No data migration needed -- fields are optional and new

3. **Extract SystemSearch component** -- Create `apps/periscope/src/components/SystemSearch.tsx`:
   - Lift the `SystemSearch` function from `apps/periscope/src/views/JumpPlanner.tsx` (lines 63-144)
   - Accept props: `value: number | null`, `onChange: (id: number | null) => void`, `systems: SolarSystem[]`, `placeholder?: string`, `label?: string`, `compact?: boolean`
   - The `compact` prop reduces padding/font-size for use inside popovers
   - Export as named export

4. **Update JumpPlanner.tsx** -- Replace inline SystemSearch with import from `@/components/SystemSearch`
   - Remove the `SystemSearch` function definition (lines 63-144)
   - Add import: `import { SystemSearch } from "@/components/SystemSearch"`
   - No other changes needed -- props are identical

5. **Optionally update Locations.tsx** -- Replace inline system search in `AddLocationForm` with `SystemSearch` component
   - This simplifies Locations and consolidates the pattern, but is optional for Phase 1

### Phase 2: Deployables View -- Location Column & Editing

1. **Update StructureRow type** -- In `apps/periscope/src/views/Deployables.tsx`:
   - Add `lPoint?: string` to the `StructureRow` interface (after `systemId`)

2. **Wire lPoint into row construction** -- In the `data` useMemo:
   - Map `d.lPoint` from deployables and `a.lPoint` from assemblies into StructureRow

3. **Load solar systems** -- Add a `useLiveQuery` call to load `db.solarSystems.toArray()` and build a `systemNames` lookup map (same pattern as Locations.tsx lines 40-46)

4. **Add Location column** -- Insert a new column definition between "type" and "ownership" columns:
   - `id: "location"`
   - `accessorFn`: return formatted string like `"SystemName -- L3"` (for sorting/filtering)
   - `header: "Location"`
   - `size: 180`
   - `filterFn: excelFilterFn` (enables the existing DataGrid column filter)
   - Cell renderer: show location text with a MapPin icon, styled with `text-zinc-400`

5. **Create LocationEditor popover component** -- Inline in Deployables.tsx (or extract to `@/components/LocationEditor.tsx` if it grows):
   - Renders on click of the location cell
   - Contains: `SystemSearch` component (compact mode) + 5 L-point toggle buttons (L1-L5)
   - Save button persists to `db.deployables.update()` or `db.assemblies.update()` depending on `row.source`
   - Cancel button / click-outside closes the popover
   - Uses absolute positioning anchored to the cell (similar to the existing dropdown pattern in SystemSearch)

6. **Add handleSaveLocation callback** -- Similar to existing `handleSaveNotes`:
   - Accepts `(row: StructureRow, systemId: number | null, lPoint: string | null)`
   - Updates the appropriate table (`deployables` or `assemblies`) with both fields + new `updatedAt`

7. **Preserve lPoint on chain sync -- Deployables.tsx** -- In `handleSyncOwn`, update the `db.deployables.put()` call (line ~298):
   - Add `lPoint: existing?.lPoint` to preserve the user's L-point annotation across re-syncs

8. **Preserve lPoint + systemId on chain sync -- sync.ts** -- In `apps/periscope/src/chain/sync.ts`:
   - `syncOwnedAssemblies` (line ~91): add `lPoint: existing?.lPoint` to the `DeployableIntel` object. Also fix pre-existing bug: change `systemId: existing?.systemId ?? 0` to `systemId: existing?.systemId` (avoid defaulting to 0 for new records).
   - `syncTargetAssemblies` (line ~137): add `systemId: existing?.systemId` and `lPoint: existing?.lPoint` to the `AssemblyIntel` object

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/db/types.ts` | Modify | Add `lPoint?: string` to `DeployableIntel` and `AssemblyIntel` interfaces |
| `apps/periscope/src/db/index.ts` | Modify | Add version 17 with `systemId` index on `deployables` and `assemblies` |
| `apps/periscope/src/components/SystemSearch.tsx` | Create | Reusable system search dropdown extracted from JumpPlanner |
| `apps/periscope/src/views/JumpPlanner.tsx` | Modify | Replace inline SystemSearch with import from shared component |
| `apps/periscope/src/views/Deployables.tsx` | Modify | Add Location column, LocationEditor popover, lPoint to StructureRow, system lookup, save handler, preserve lPoint on sync |
| `apps/periscope/src/chain/sync.ts` | Modify | Preserve `lPoint` in `syncOwnedAssemblies`, preserve `systemId` + `lPoint` in `syncTargetAssemblies` |
| `apps/periscope/src/views/Locations.tsx` | Modify (optional) | Replace inline system search with shared SystemSearch component |

## Open Questions

1. **Should the Locations view also adopt the shared SystemSearch component in this plan?**
   - **Option A: Yes, update Locations.tsx in Phase 1** -- Pros: consolidates all system search to one component, reduces code duplication. Cons: slightly larger scope, Locations uses a `Map<number, string>` while SystemSearch uses `SolarSystem[]` so props differ.
   - **Option B: No, defer to a separate cleanup task** -- Pros: keeps scope focused on Deployables. Cons: leaves two divergent system search implementations.
   - **Recommendation:** Option A -- the adaptation is minimal (Locations just needs to pass the full `systems` array instead of the Map) and it prevents drift.

2. **Should L-point storage be "L3" or "P2-L3" (planet-qualified)?**
   - **Option A: Simple "L1"-"L5" string** -- Pros: simple, matches current plan. Cons: ambiguous when a system has multiple planets -- "L3" doesn't tell you which planet's L3.
   - **Option B: Planet-qualified "P{n}-L{m}" string (e.g. "P2-L3")** -- Pros: unambiguous, supports the full System -> Planet -> L-point drill-down now that we have planet data from mapObjects.db. Cons: slightly more complex storage and UI.
   - **Recommendation:** Option B -- since we now have per-system planet counts from mapObjects.db (1-13 planets per system), the selector should be Planet -> L-point. Storing "P2-L3" keeps the data precise and enables meaningful grouping (e.g. "all structures at Planet 3").

## Deferred

- **Auto-detect system from game logs** -- When a log event shows a structure departing or anchoring, we could auto-fill the systemId. Requires cross-referencing log sessions with structure names. Deferred because log parsing for structure events is not yet reliable enough.
- **System-based grouping/filtering in the Deployables view** -- A "group by system" toggle or system filter sidebar. Deferred because the DataGrid's built-in column filtering should cover most use cases initially.
- **Extract and bundle planet data from mapObjects.db** -- A build-time script could extract planet-per-system data from `{gameRoot}/utopia/bin64/staticdata/mapObjects.db` into a compact JSON (~200KB estimated) for the Periscope public/data directory. This would enable the System -> Planet -> L-point drill-down without requiring the user to have the game client installed. Deferred to a follow-up phase once the basic location recording is working.
- **Chain-derived location data** -- If structure location becomes queryable on-chain, auto-populate systemId and lPoint during chain sync. Deferred because this capability doesn't exist in the current world contracts.
