# Plan: Structure Location Recording
**Status:** Active -- Phases 1 & 3 complete, Phase 2 partially complete
**Created:** 2026-03-17
**Updated:** 2026-03-18
**Module:** periscope

## Overview

Structures (turrets, gates, SSUs, network nodes, etc.) are tracked in the Deployables view but have no way to record *where* they're anchored. The `systemId` field already exists on both `DeployableIntel` and `AssemblyIntel` types but is never populated through the UI -- it only gets preserved if it existed before a chain sync. There is no L-point field at all.

This plan adds **parent node auto-discovery from chain** and **manual location entry** for recording structure locations. Research into the world contracts (v0.0.18) confirmed that assembly locations on-chain use Poseidon2 cryptographic hashes that are NOT human-readable -- the `LocationRegistry` contains encrypted coordinates that we cannot decrypt. However, every assembly has an `energy_source_id: Option<ID>` field that points to its parent NetworkNode, and every NetworkNode has a `connected_assembly_ids: vector<ID>` listing all connected assemblies. This parent node linkage IS accessible and provides valuable structural grouping.

Phase 1 adds all data model changes (`lPoint` field) and extracts the shared SystemSearch component. Phase 2 wires parent node auto-discovery into the sync flow, extracting `energy_source_id` from assembly JSON and resolving it to a NetworkNode label. Phase 3 adds the Location column and editing UI with a Planet -> L-point drill-down picker. Manual entry is the only way to set system and L-point -- these come from game client data, not from chain.

### Prerequisite: Plan 18 (Solar System Data)

Plan 18 must be completed before this plan. It provides:
- **Planet data per system** in `stellar_systems.json` (`planetCount`, `planetTypes` fields)
- **`celestials.json`** with per-planet coordinates (`celestialID`, `celestialIndex`, `typeID`, `x`, `y`, `z`)
- **A `celestials` Dexie table** indexed by `solarSystemId`

This celestial data enables the Planet -> L-point drill-down selector in Phase 3 (instead of free-form text input).

## Research Findings: Chain Data

### What exists on-chain

1. **`Location` struct** (`world::location`): `{ location_hash: vector<u8> }` -- a Poseidon2 cryptographic hash. **NOT human-readable. Cannot be used to derive system IDs or coordinates.** Every assembly (Gate, Turret, StorageUnit, NetworkNode, Assembly) has this field.

2. **`LocationRegistry`** (`world::location`): `{ id: UID, locations: Table<ID, Coordinates> }` -- a shared object mapping assembly IDs to `Coordinates { solarsystem: u64, x, y, z }`. **Only populated by the game server via `reveal_location()`.** Even if populated, there is no reliable way to know if/when reveals have been called for our assemblies. **We do NOT use this for auto-discovery.**

3. **`energy_source_id: Option<ID>`** -- Every assembly struct (Gate, Turret, StorageUnit, Assembly) has this field. It points to the parent **NetworkNode** object ID. This is already read by `fetchFuelData()` in Deployables.tsx (line 154) to follow the chain to fuel data. When an assembly is online and connected to a network node, this field is populated; when offline/disconnected, it's `None`.

4. **`NetworkNode.connected_assembly_ids: vector<ID>`** -- The NetworkNode struct contains a list of all assemblies connected to it. View function: `connected_assemblies(nwn): vector<ID>`. This confirms the bidirectional linkage: assembly -> node via `energy_source_id`, node -> assemblies via `connected_assembly_ids`.

5. **NetworkNode metadata** -- Each NetworkNode has `metadata: Option<Metadata>` with a `name` field. This gives us a human-readable label for the parent node.

### What this means for the plan

- **System ID cannot be auto-populated from chain.** Location hashes are encrypted. The LocationRegistry may or may not have reveals for our assemblies, and relying on it is fragile. System + L-point must be entered manually.
- **Parent node CAN be auto-populated.** During sync, we already fetch each assembly's full JSON (via `getObjectJson`). The `energy_source_id` field is right there -- we just need to extract it and store it as `parentId` on the `DeployableIntel` record.
- **Parent node name CAN be resolved.** We already sync NetworkNode objects as deployables. If the parent node is in our DB, we can show its label. If not, we can fetch its metadata with a single `getObjectJson()` call.
- **All assemblies connected to the same NetworkNode share the same physical location.** Once a user sets the location on the NetworkNode, we could optionally propagate it to connected assemblies (deferred -- manual for now).

### Current `energy_source_id` usage

The `fetchFuelData()` function in Deployables.tsx (line 154) already reads `energy_source_id` from assembly JSON and follows it to the NetworkNode to read fuel data. This confirms:
- The field is reliably present in GraphQL JSON responses
- It contains the NetworkNode's object ID (not an internal sub-object ID)
- The pattern of "fetch assembly JSON -> read energy_source_id -> fetch parent" works

## Current State

- **DeployableIntel** (`apps/periscope/src/db/types.ts` line 80): has optional `systemId?: number`, `position?: [number, number, number]`, and `parentId?: string` fields. No L-point field.
- **AssemblyIntel** (`apps/periscope/src/db/types.ts` line 105): has optional `systemId?: number` and `parentId?: string`. No L-point field.
- **StructureRow** (`apps/periscope/src/views/Deployables.tsx` line 33): has `systemId?: number` and `parentId?: string` but no L-point. A "Parent" column already exists with a `ParentSelect` component.
- **DB indexes** (`apps/periscope/src/db/index.ts`): neither `deployables` nor `assemblies` tables are indexed on `systemId`. V17 (lines 465-471) already exists and added `parentId` index to both tables. V18 is taken by plan 18 (celestials table). The next available version is V19.
- **SystemSearch component** exists inline in `apps/periscope/src/views/JumpPlanner.tsx` (lines 63-144). It searches `SolarSystem[]` by name/id, shows a dropdown of up to 12 results, and returns the selected system ID. Not reusable from other views.
- **Locations view** (`apps/periscope/src/views/Locations.tsx`) has its own inline system search (lines 187-198 in `AddLocationForm`) that searches a `Map<number, string>` -- a different pattern from the JumpPlanner version.
- **Solar system data**: 24,426 systems in `apps/periscope/public/data/stellar_systems.json`, loaded into Dexie `solarSystems` table indexed by `id, name, constellationId, regionId`.
- **Celestial data**: Provided by plan 18 -- `celestials.json` bundled in `public/data/` and loaded into Dexie `celestials` table indexed by `solarSystemId`. Each planet has 5 implicit L-points (L1-L5). Planet data per system is also available via `stellar_systems.json` (`planetCount`, `planetTypes` fields).
- **Chain sync -- handleSyncOwn** (`apps/periscope/src/views/Deployables.tsx` line 276): The primary sync path. Calls `discoverCharacterAndAssemblies()` which returns `OwnedAssembly[]`. The `OwnedAssembly` type does NOT currently include `energy_source_id`. Preserves `parentId: existing?.parentId` at line 312.
- **Chain sync -- discoverCharacterAndAssemblies** (`apps/periscope/src/chain/queries.ts` line 106): Fetches full assembly JSON via `getObjectJson()` but only extracts `type_id`, `status`, `extension`, `dappUrl`, and `ownerCapId`. Does NOT extract `energy_source_id`.
- **Chain sync -- sync.ts**: `syncOwnedAssemblies` (line 67) and `syncTargetAssemblies` (line 118) -- secondary sync paths. Neither extracts `energy_source_id`. Pre-existing bugs: `syncOwnedAssemblies` defaults `systemId` to `0` instead of `undefined` (line 98), neither function preserves `parentId` from existing records, and `syncTargetAssemblies` doesn't preserve `systemId` from existing records at all.
- **fetchFuelData** (`apps/periscope/src/views/Deployables.tsx` line 118): Already reads `energy_source_id` from assembly JSON and follows it to the NetworkNode for fuel data. This proves the field is accessible and contains the NetworkNode object ID.

## Target State

1. **Auto-populated `parentId` from chain** -- During sync, extract `energy_source_id` from each assembly's JSON and store it as `parentId` on the `DeployableIntel`/`AssemblyIntel` record. This links assemblies to their parent NetworkNode. When `energy_source_id` is present (assembly connected to a node), it takes priority. When absent (assembly offline/disconnected, or is a NetworkNode itself), the existing `parentId` is preserved. Users can still manually set `parentId` via the existing `ParentSelect` widget between syncs.
2. **New `lPoint` field** on `DeployableIntel` and `AssemblyIntel` -- a string field ("P2-L3" format) to record which planet/L-point the structure is anchored at. Manual entry only.
3. **Reusable `SystemSearch` component** extracted to `apps/periscope/src/components/SystemSearch.tsx` -- used by JumpPlanner, Locations, and Deployables.
4. **"Location" column** in the Deployables DataGrid showing "System Name -- P2-L3" (or just system name if no L-point, or "--" if neither).
5. **Inline location editing** -- clicking the location cell opens a popover/dropdown with the SystemSearch widget and an L-point selector, with save/cancel controls.
6. **DB index on `systemId`** for both `deployables` and `assemblies` tables to enable future filtering/grouping by system.
7. **DataGrid column filter** on the Location column so users can filter structures by system or L-point.

### Data Model Changes

```typescript
// DeployableIntel -- add:
lPoint?: string; // "P2-L3" format (planet-qualified) or "L1"-"L5" (simple)

// AssemblyIntel -- add:
lPoint?: string;
```

Note: `parentId` already exists on both types. It is currently set manually via the `ParentSelect` component. Phase 2 will auto-populate it from `energy_source_id` during sync, replacing the manual-only approach for assemblies that have a parent node on-chain.

### DB Version Bump

Version 19 adds `systemId` index to both `deployables` and `assemblies` (V17 added `parentId`, V18 added `celestials` table via plan 18):
```
deployables: "id, objectId, assemblyType, owner, status, label, systemId, updatedAt, _hlc, ownerCapId, parentId, *tags"
assemblies:  "id, assemblyType, objectId, owner, status, systemId, updatedAt, _hlc, parentId, *tags"
```

Note: `lPoint` is not indexed -- it's a non-key field stored on records but not queried by index.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Parent node discovery | Extract `energy_source_id` from assembly JSON during sync | Already proven by `fetchFuelData()`. Zero additional queries needed -- the field is in the assembly's own JSON. Every online assembly has this field populated. |
| Parent node storage | Reuse existing `parentId` field on `DeployableIntel`/`AssemblyIntel` | The field already exists and a "Parent" column with `ParentSelect` is already in the DataGrid. Chain sync auto-fills it; users can still override manually for offline/disconnected assemblies. |
| Chain vs. manual `parentId` | Chain value preferred; falls back to existing | `energy_source_id ?? existing?.parentId`. When the assembly has an on-chain parent node, it overwrites the local value. When `energy_source_id` is `None` (offline/disconnected), the existing `parentId` is preserved. Users can still set `parentId` manually via `ParentSelect` between syncs. |
| Location source | Manual only (system + L-point) | LocationRegistry contains encrypted Poseidon2 hashes. Even the `reveal_location()` mechanism is server-controlled and unreliable for user-side auto-detection. Manual entry is the only trustworthy approach. |
| L-point storage format | Planet-qualified "P{n}-L{m}" string (e.g. "P2-L3") | Storing "P2-L3" keeps the data precise. Plan 18 provides planet data (`celestials` Dexie table), enabling a proper Planet -> L-point drill-down picker. The LocationEditor queries `db.celestials` for planets in the selected system, shows a Planet dropdown, then L1-L5 buttons for the selected planet. |
| Inline editing approach | Popover panel on cell click | Matches the existing `EditableCell` pattern but needs a richer editor (system search + L-point buttons). A modal would be too heavy; inline editing can't fit a search dropdown. A popover anchored to the cell is the right balance. |
| SystemSearch extraction | Lift JumpPlanner's SystemSearch to shared component | JumpPlanner's version is more polished (searches Dexie array directly, shows system IDs, proper focus/blur handling). The Locations view version uses a Map and is simpler but less reusable. |
| DB indexing | Add systemId index on both tables | Enables future "filter by system" queries and grouping. Worth the minor index overhead since these tables are small (hundreds of rows at most). |
| Column placement | Location column between "Type" and "Parent" | Location is a key identifier -- grouping structures by where they are is a primary use case. Placing it early in the grid makes it visible without horizontal scrolling. |

## Implementation Phases

### Phase 1: Data Model & Shared Component -- COMPLETE

1. **Add `lPoint` field to types** -- In `apps/periscope/src/db/types.ts`:
   - Add `lPoint?: string` to `DeployableIntel` (after `systemId` field, line ~86)
   - Add `lPoint?: string` to `AssemblyIntel` (after `systemId` field, line ~110)

2. **Add DB version 19** -- In `apps/periscope/src/db/index.ts`:
   - Add `this.version(19).stores({...})` after the existing V18 block (added by plan 18 for the `celestials` table)
   - Re-declare `deployables` index string with `systemId` added (keeping existing `parentId` from V17):
     `"id, objectId, assemblyType, owner, status, label, systemId, updatedAt, _hlc, ownerCapId, parentId, *tags"`
   - Re-declare `assemblies` index string with `systemId` added (keeping existing `parentId` from V17):
     `"id, assemblyType, objectId, owner, status, systemId, updatedAt, _hlc, parentId, *tags"`
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

5. **Update Locations.tsx** -- Replace inline system search in `AddLocationForm` with `SystemSearch` component:
   - Change `AddLocationForm` props from `systemNames: Map<number, string>` to `systems: SolarSystem[]`
   - Update the parent call in `Locations()` (line 99) to pass `systems={systems ?? []}` instead of `systemNames={systemNames}`
   - Remove the inline `systemResults` useMemo (lines 187-198) and the manual search input/dropdown JSX (lines 247-275)
   - Replace with `<SystemSearch value={selectedSystemId} onChange={setSelectedSystemId} systems={systems} placeholder="Search for a solar system..." />`
   - The `systemNames` map is still needed for display in `LocationRow` (line 155) -- keep that useMemo, just remove it from `AddLocationForm` props

### Phase 2: Parent Node Auto-Discovery from Chain -- PARTIALLY COMPLETE (steps 4-6 done, steps 1-3 remaining)

1. **Add `energySourceId` to `OwnedAssembly` type** -- In `apps/periscope/src/chain/queries.ts`:
   - Add `energySourceId?: string` to the `OwnedAssembly` interface (line ~16)

2. **Extract `energy_source_id` in `discoverCharacterAndAssemblies`** -- In `apps/periscope/src/chain/queries.ts`:
   - In the assembly fetch loop (around line 174 and line 232), after extracting `type_id`, `status`, etc. from `assemblyFields`, also extract `energy_source_id`:
     ```typescript
     energySourceId: assemblyFields.energy_source_id
       ? String(assemblyFields.energy_source_id)
       : undefined,
     ```
   - Add this to both the wallet-owned OwnerCap path (line ~174) and the character-owned OwnerCap path (line ~232)
   - Also add it to the fallback `catch` paths (lines ~187 and ~244) as `energySourceId: undefined`

3. **Wire `energySourceId` into `handleSyncOwn` as `parentId`** -- In `apps/periscope/src/views/Deployables.tsx`:
   - In the `db.deployables.put()` call (around line 301), change the `parentId` line from:
     ```typescript
     parentId: existing?.parentId,
     ```
     to:
     ```typescript
     parentId: assembly.energySourceId ?? existing?.parentId,
     ```
   - This auto-populates `parentId` from chain when `energy_source_id` is set, but preserves manual values for assemblies without a parent node (e.g. NetworkNodes themselves, or offline/disconnected assemblies)
   - Also add `lPoint: existing?.lPoint` to preserve manual L-point across syncs

4. **Wire into `syncOwnedAssemblies` (secondary sync path)** -- PARTIALLY DONE -- In `apps/periscope/src/chain/sync.ts`:
   - The `getOwnedAssemblies` function returns raw objects. In the sync loop, extract `energy_source_id` from `fields`:
     ```typescript
     const energySourceId = fields.energy_source_id
       ? String(fields.energy_source_id)
       : undefined;
     ```
   - REMAINING: Add to the `DeployableIntel` object: `parentId: energySourceId ?? existing?.parentId` (currently just `existing?.parentId`)
   - DONE: `lPoint: existing?.lPoint` preservation added
   - DONE: Bug fix `systemId: existing?.systemId` (was `?? 0`)

5. **Wire into `syncTargetAssemblies`** -- PARTIALLY DONE -- In `apps/periscope/src/chain/sync.ts`:
   - REMAINING: Extract `energy_source_id` from `fields` and set `parentId: energySourceId ?? existing?.parentId` (currently just `existing?.parentId`)
   - DONE: `systemId: existing?.systemId` preservation added
   - DONE: `lPoint: existing?.lPoint` preservation added

6. **NetworkNodes as parents: ensure they're discoverable** -- DONE (no work needed). NetworkNodes are already discovered by `discoverCharacterAndAssemblies` (it iterates `network_node` in the `assemblyTypes` array at line 153). They appear in the `deployables` table. The existing "Parent" column and `ParentSelect` component can already show them.

### Phase 3: Deployables View -- Location Column & Editing -- COMPLETE

1. **Update StructureRow type** -- In `apps/periscope/src/views/Deployables.tsx`:
   - Add `lPoint?: string` to the `StructureRow` interface (after `systemId`)

2. **Wire lPoint into row construction** -- In the `data` useMemo:
   - Map `d.lPoint` from deployables and `a.lPoint` from assemblies into StructureRow

3. **Load solar systems and celestials** -- Add a `useLiveQuery` call to load `db.solarSystems.toArray()` and build a `systemNames` lookup map (same pattern as Locations.tsx lines 40-46). Also add `import { SystemSearch } from "@/components/SystemSearch"` and `import type { SolarSystem } from "@/db/types"` for use in the LocationEditor popover. The LocationEditor will query `db.celestials` on demand (filtered by `solarSystemId`) when a system is selected -- no need to preload all celestials.

4. **Add Location column** -- Insert a new column definition between "type" and "parent" columns:
   - `id: "location"`
   - `accessorFn`: return formatted string like `"SystemName -- P2-L3"` (for sorting/filtering)
   - `header: "Location"`
   - `size: 180`
   - `filterFn: excelFilterFn` (enables the existing DataGrid column filter)
   - Cell renderer: show location text with a MapPin icon, styled with `text-zinc-400`
   - Add `MapPin` to the lucide-react imports at the top of the file (currently not imported)

5. **Create LocationEditor popover component** -- Inline in Deployables.tsx (or extract to `@/components/LocationEditor.tsx` if it grows):
   - Renders on click of the location cell
   - Contains: `SystemSearch` component (compact mode) + Planet -> L-point drill-down picker
   - **Planet dropdown:** When a system is selected, query `db.celestials` (provided by plan 18) filtered by `solarSystemId` to get planets in that system. Show a "Planet" dropdown listing planets by index ("Planet 1", "Planet 2", etc.) with planet type shown as secondary text. If no system is selected, the planet dropdown is disabled.
   - **L-point buttons:** When a planet is selected, show L1-L5 as a button group (radio-style, only one selected). Clicking a button selects that L-point.
   - **Storage format:** Combine planet index and L-point into "P{n}-L{m}" format (e.g. "P2-L3"). Store as the `lPoint` field value.
   - Save button persists to `db.deployables.update()` or `db.assemblies.update()` depending on `row.source`
   - Cancel button / click-outside closes the popover
   - Uses absolute positioning anchored to the cell (similar to the existing dropdown pattern in ParentSelect)

6. **Add handleSaveLocation callback** -- Similar to existing `handleSaveNotes`:
   - Accepts `(row: StructureRow, systemId: number | null, lPoint: string | null)`
   - Updates the appropriate table (`deployables` or `assemblies`) with both fields + new `updatedAt`

7. **Note:** The `lPoint` preservation in `handleSyncOwn` is already handled in Phase 2, step 3. No additional work needed in Phase 3 beyond the UI changes above.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/db/types.ts` | Modify | Add `lPoint?: string` to `DeployableIntel` and `AssemblyIntel` |
| `apps/periscope/src/db/index.ts` | Modify | Add version 19 with `systemId` index on `deployables` and `assemblies` |
| `apps/periscope/src/components/SystemSearch.tsx` | Create | Reusable system search dropdown extracted from JumpPlanner |
| `apps/periscope/src/views/JumpPlanner.tsx` | Modify | Replace inline SystemSearch with import from shared component |
| `apps/periscope/src/chain/queries.ts` | Modify | Add `energySourceId` to `OwnedAssembly`, extract `energy_source_id` from assembly JSON |
| `apps/periscope/src/chain/sync.ts` | Modify | Extract `energy_source_id` in both sync functions, map to `parentId`, preserve `lPoint` |
| `apps/periscope/src/views/Deployables.tsx` | Modify | Add Location column, LocationEditor popover (Planet -> L-point drill-down), lPoint to StructureRow, system lookup, celestials query, save handler, wire `energySourceId` to `parentId` |
| `apps/periscope/src/views/Locations.tsx` | Modify | Replace inline system search in `AddLocationForm` with shared SystemSearch component |

## Resolved Questions

1. **Should the Locations view also adopt the shared SystemSearch component in this plan?**
   - **Resolution: Yes, update Locations.tsx in Phase 1 (Option A).** The adaptation is minimal -- `AddLocationForm` currently receives a `Map<number, string>` for system search, but can be refactored to accept the full `SolarSystem[]` array and use the shared `SystemSearch` component. This prevents two divergent system search implementations from drifting apart. The `AddLocationForm` props change from `systemNames: Map<number, string>` to `systems: SolarSystem[]`, and the inline search logic (lines 187-198) is replaced with `<SystemSearch>`.

## Deferred

- **Auto-detect system from game logs** -- When a log event shows a structure departing or anchoring, we could auto-fill the systemId. Requires cross-referencing log sessions with structure names. Deferred because log parsing for structure events is not yet reliable enough.
- **System-based grouping/filtering in the Deployables view** -- A "group by system" toggle or system filter sidebar. Deferred because the DataGrid's built-in column filtering should cover most use cases initially.
- **Location propagation from NetworkNode to children** -- Once a user sets the location on the NetworkNode, automatically propagate `systemId` and `lPoint` to all connected assemblies (identified by matching `parentId`). Deferred because it adds complexity and users may want different L-points for different structures even on the same node.
- **LocationRegistry lookup as supplementary data** -- In theory, if the game server has called `reveal_location()` for an assembly, its solar system could be read from the LocationRegistry. However, this requires knowing the LocationRegistry object ID per tenant, requires additional GraphQL queries, and is unreliable (we don't know which assemblies have been revealed). Deferred unless a clear use case emerges.
