# Plan: Manifest Public Locations
**Status:** Complete
**Created:** 2026-03-21
**Completed:** 2026-03-22
**Module:** periscope

## Overview

The Periscope manifest system caches blockchain data locally in IndexedDB for fast offline-capable lookups. It currently has two tables: `manifestCharacters` (cached from `CharacterCreatedEvent` chain events) and `manifestTribes` (cached from the World API). This plan adds a third manifest table -- `manifestLocations` -- that caches publicly revealed structure locations from the blockchain.

When a player uses the in-game "Publish Location" button, the game server calls `reveal_location()` on the structure's module (e.g. `storage_unit::reveal_location()`, `assembly::reveal_location()`), which writes the structure's coordinates to the on-chain `LocationRegistry` and emits a `LocationRevealedEvent`. These public locations are valuable for spatial intelligence: knowing where SSUs, gates, turrets, and other structures are positioned in the universe.

By caching these events locally, Periscope gains a persistent map of all publicly revealed structure locations. This data serves multiple consumers: the Manifest explorer UI gets a "Locations" tab for browsing, the Deployables view can auto-populate locations for owned structures, and Plan 22's cross-market queries can display where each public SSU is located. The cache also complements Plan 23's Private Map system -- public locations are freely visible to all, while private maps handle encrypted/trusted sharing.

## Current State

### Manifest Infrastructure

- **`apps/periscope/src/chain/manifest.ts`** -- All manifest operations. `discoverCharactersFromEvents()` (line 137) is the primary pattern: paginated event fetching with cursor persistence, incremental sync, and task worker integration via `TaskContext`. The cursor is stored in `db.settings` as `manifestCharCursor:{worldPkg}`. `discoverTribes()` (line 318) fetches from the World API, not events.

- **`apps/periscope/src/db/types.ts`** -- `ManifestCharacter` (lines 417-436) and `ManifestTribe` (lines 438-452) interfaces. Both have `tenant` and `cachedAt` fields.

- **`apps/periscope/src/db/index.ts`** -- Dexie DB schema. Currently at V22. Manifest tables are declared in V10 (line 318). The class body declares `manifestCharacters` and `manifestTribes` (lines 90-91).

- **`apps/periscope/src/views/Manifest.tsx`** -- Manifest explorer UI with Characters and Tribes tabs. Uses `DataGrid` component with column definitions, `useLiveQuery` for reactive data, and `enqueueTask`/`useTaskWorker` for background sync.

- **`apps/periscope/src/chain/config.ts`** -- `getEventTypes()` (line 52) returns typed event strings for a tenant. Does not currently include `LocationRevealedEvent`.

### LocationRevealedEvent

- **Move Type:** `{worldPkg}::location::LocationRevealedEvent`
- **Module:** `world::location` (documented in `docs/chain-events-reference.md` lines 456-474 and `docs/world-contracts-reference.md` lines 890-900)
- **Fields:** `assembly_id` (ID), `assembly_key` (TenantItemId), `type_id` (u64), `owner_cap_id` (ID), `location_hash` (vector<u8>), `solarsystem` (u64), `x` (String), `y` (String), `z` (String)
- **Note:** The x, y, z coordinates are strings that support negative values (e.g. "-123456789")
- **Emission:** When admin/game server publishes coordinates on-chain (v0.0.18 feature)

### LocationRegistry

- **Struct:** `LocationRegistry has key { id: UID, locations: Table<ID, Coordinates> }`
- **Coordinates:** `{ solarsystem: u64, x: String, y: String, z: String }`
- **Read access:** `get_location(registry, assembly_id): Option<Coordinates>` (documented in `docs/world-contracts-reference.md` line 942)

### L-Point Computation

- **`apps/periscope/src/lib/lpoints.ts`** -- `computeLPoints(px, py, pz)` returns L1-L5 coordinates for a planet at (px, py, pz) relative to the sun at origin. Uses configurable ratios (L1=0.85r, L2=1.15r, L3=-1.0r, L4/L5 at +/-60 degrees). Created by Plan 18.

- **`apps/periscope/src/lib/celestials.ts`** -- `ensureCelestialsLoaded()` lazy-loads planet positions from `celestials.json` into the `celestials` Dexie table (~83K records). `PLANET_TYPE_NAMES` maps typeID to name. Created by Plan 18.

- **No `nearestLPoint` utility exists** -- The existing `computeLPoints` function computes L-point coordinates from a planet position, but there is no function that takes arbitrary (x, y, z) coordinates and determines the nearest planet + L-point. This is needed to resolve raw coordinates from `LocationRevealedEvent` into human-readable "P{n}-L{m}" labels.

### Related Plans

- **Plan 22** (`docs/plans/active/22-market-buy-order-improvements.md`) -- Adds `is_public: bool` to `SsuConfig`. Cross-market queries for public SSU listings will need location data, which this manifest cache provides.

- **Plan 23** (`docs/plans/active/23-private-map-system.md`) -- Encrypted private location sharing. Complementary to this plan's public location cache.

## Target State

### Data Model

```typescript
export interface ManifestLocation {
    /** Assembly (structure) object ID -- primary key (from event.assembly_id) */
    id: string;
    /** In-game item ID from TenantItemId.item_id (from event.assembly_key.item_id) */
    assemblyItemId: string;
    /** Assembly type ID (u64, maps to ASSEMBLY_TYPE_IDS in config.ts) */
    typeId: number;
    /** Owner cap object ID */
    ownerCapId: string;
    /** Solar system ID */
    solarsystem: number;
    /** Raw X coordinate (string, supports negatives -- matches on-chain String type) */
    x: string;
    /** Raw Y coordinate */
    y: string;
    /** Raw Z coordinate */
    z: string;
    /** Resolved L-point label (e.g. "P2-L3") -- computed from coords + celestials */
    lPoint?: string;
    /** Tenant (stillness/utopia -- extracted from event.assembly_key.tenant) */
    tenant: string;
    /** When this location was revealed on-chain (from event tx timestamp) */
    revealedAt: string;
    /** When this entry was last cached */
    cachedAt: string;
}
```

**Field mapping from `LocationRevealedEvent`:**
- `assembly_id` (ID) -> `id` (primary key)
- `assembly_key.item_id` (u64 inside TenantItemId) -> `assemblyItemId` (string)
- `assembly_key.tenant` (String inside TenantItemId) -> `tenant`
- `type_id` (u64) -> `typeId` (number)
- `owner_cap_id` (ID) -> `ownerCapId` (string)
- `solarsystem` (u64) -> `solarsystem` (number)
- `x`, `y`, `z` (String) -> `x`, `y`, `z` (string, kept as-is)
- Event timestamp -> `revealedAt`

The `assembly_key` field is a `TenantItemId` struct (`{ item_id: u64, tenant: String }` -- see `docs/world-contracts-reference.md` line 782). It will be parsed as a JSON object in the event's `parsedJson`, following the same pattern used in `discoverCharactersFromEvents()` (line 203 of `manifest.ts`).

### Dexie Table

New V23 store in `db/index.ts`:
```typescript
this.version(23).stores({
    manifestLocations: "id, solarsystem, typeId, tenant, cachedAt",
});
```

### Discovery Function

`discoverLocationsFromEvents()` in `manifest.ts` -- follows the same incremental cursor pattern as `discoverCharactersFromEvents()`:
1. Fetch `LocationRevealedEvent` events from chain via `queryEventsGql`
2. Parse `assembly_id`, `assembly_key`, `type_id`, `owner_cap_id`, `solarsystem`, `x`, `y`, `z`
3. Store in `manifestLocations` table with `cachedAt` timestamp
4. Persist cursor in `db.settings` as `manifestLocCursor:{worldPkg}`
5. Resolve L-point labels in a second pass (requires celestials data)

### L-Point Resolution Utility

New `resolveNearestLPoint()` function in `lpoints.ts`:
- Input: raw coordinates (x, y, z as numbers) + array of planets for the system
- Output: "P{n}-L{m}" label (or null if no planet match within a reasonable distance threshold)
- Algorithm: For each planet in the system, compute all 5 L-points, find the closest one to the target coordinates. If the distance is within a configurable threshold (fraction of orbital radius), return the label.

### Manifest UI

The `Manifest.tsx` view gains a third "Locations" tab showing:
- Assembly type (SSU, Gate, Turret, etc.) with icon
- Solar system name (resolved from `solarSystems` table)
- L-point label (e.g. "P2-L3")
- Assembly ID (truncated with link to Suiscan)
- Owner cap ID (truncated)
- Reveal timestamp
- Cached-at age

### Config Update

`getEventTypes()` in `config.ts` gains `LocationRevealed` entry.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Table name | `manifestLocations` | Follows existing pattern (`manifestCharacters`, `manifestTribes`). Clear distinction from the intel `locations` table (which stores user-created bookmarks). |
| Primary key | `assembly_id` (structure object ID) | A structure can only have one revealed location. If re-revealed, we overwrite. This matches the on-chain `LocationRegistry` which uses `Table<ID, Coordinates>`. |
| Store raw coordinates | Keep x, y, z as strings | The on-chain type uses `String` to support negative values and arbitrary precision. Converting to numbers loses precision for very large coordinates. Store raw and parse to numbers only when computing L-points. |
| Ignore location_hash | Not stored in ManifestLocation | The `location_hash` field is a Poseidon2 hash used for on-chain proximity verification. We have the raw coordinates, so the hash is not useful for display or computation purposes. |
| L-point resolution | Separate pass after event discovery | Computing L-points requires loading celestials data (~83K records). This should not block event fetching. Resolve as a second pass or on-demand when displaying. |
| L-point resolution location | `lpoints.ts` utility | Keeps all L-point math in one file. The manifest module calls this utility when resolving labels. |
| Event type | `{worldPkg}::location::LocationRevealedEvent` | Per `docs/chain-events-reference.md` line 458. This is the only event emitted when coordinates are published on-chain. |
| Discovery pattern | Same incremental cursor as characters | Proven pattern. `queryEventsGql` pagination with cursor persistence in `db.settings`. Idempotent (re-running discovers only new events). |
| Deployable auto-population | Cross-reference manifest locations with deployables table | When a manifest location is cached for an assembly_id that matches a deployable's objectId, auto-fill the deployable's `systemId` and `lPoint` fields. This connects the public location data to the user's structure inventory. |
| Tab in Manifest UI | Third tab alongside Characters and Tribes | Natural extension of the manifest explorer. Same DataGrid pattern with filtering and sorting. |
| L-point match threshold | 20% of orbital radius | Generous enough to match game-placed structures near L-points. Configurable constant for future tuning. |

## Implementation Phases

### Phase 1: Data Model + Event Discovery -- COMPLETE

1. **Add missing assembly type IDs** to `ASSEMBLY_TYPE_IDS` in `apps/periscope/src/chain/config.ts`: add Gate types (88086 "Mini Gate", 84955 "Heavy Gate") and Turret types (92279 "Mini Turret", 92401 "Turret", 92404 "Heavy Turret"). Also add a fallback in the Locations tab renderer (Phase 4) to display the raw `typeId` number when no name is found in the map, so unknown types are still visible rather than blank.

2. **Add `ManifestLocation` interface** to `apps/periscope/src/db/types.ts` after the `ManifestTribe` interface (after line 452). Include all fields as specified in the Target State section above.

3. **Add `manifestLocations` table declaration** to `apps/periscope/src/db/index.ts`:
   - Add `ManifestLocation` to the import list (line 25 area)
   - Add class body declaration: `manifestLocations!: EntityTable<ManifestLocation, "id">;` (after line 91)
   - Add V23 store definition after V22, before the constructor closing brace (between lines 483 and 484): `this.version(23).stores({ manifestLocations: "id, solarsystem, typeId, tenant, cachedAt" });`

4. **Add `LocationRevealed` to `getEventTypes()`** in `apps/periscope/src/chain/config.ts` (inside the return object, after the ItemBurned line): `LocationRevealed: \`${pkg}::location::LocationRevealedEvent\``

5. **Create `discoverLocationsFromEvents()`** in `apps/periscope/src/chain/manifest.ts`:
   - Signature: `export async function discoverLocationsFromEvents(client: SuiGraphQLClient, tenant: TenantId, worldPkg: string, limit?: number, ctx?: TaskContext): Promise<number>`
   - Follow the `discoverCharactersFromEvents()` pattern (lines 137-283) but simpler (no Phase 2 name resolution needed)
   - Event type: `${worldPkg}::location::LocationRevealedEvent`
   - Cursor key: `manifestLocCursor:${worldPkg}`
   - Parse event `parsedJson` fields:
     - `parsed.assembly_id as string` -> `id`
     - `(parsed.assembly_key as { item_id?: string }).item_id` -> `assemblyItemId` (same pattern as line 203 in `discoverCharactersFromEvents`)
     - `(parsed.assembly_key as { tenant?: string }).tenant` -> `tenant` (fallback to function parameter)
     - `Number(parsed.type_id)` -> `typeId`
     - `parsed.owner_cap_id as string` -> `ownerCapId`
     - `Number(parsed.solarsystem)` -> `solarsystem`
     - `String(parsed.x)`, `String(parsed.y)`, `String(parsed.z)` -> `x`, `y`, `z`
   - Set `revealedAt` from `new Date(Number(event.timestampMs)).toISOString()`
   - Set `cachedAt` from `new Date().toISOString()`
   - Use `db.manifestLocations.put()` to upsert (same structure re-revealed = overwrite)
   - When updating an existing manifest location (re-reveal with changed coordinates), clear the `lPoint` field (`lPoint: undefined`) so the L-point resolution pass will recompute it
   - Since `manifestLocCursor` is a brand-new cursor key, old-format migration is unnecessary. Skip the cursor format detection -- use GraphQL cursor format directly.
   - Use `TaskContext` for progress reporting: `setProgress()` and `setItems()`
   - Return count of new/updated locations

6. **Add `ManifestLocation` to manifest.ts imports** (line 16, add to the existing `import type { ... } from "@/db/types"` statement)

### Phase 2: L-Point Resolution -- COMPLETE

1. **Add `resolveNearestLPoint()` to `apps/periscope/src/lib/lpoints.ts`**:
   - Signature: `export function resolveNearestLPoint(x: number, y: number, z: number, planets: Celestial[]): string | null`
   - Import `type { Celestial }` from `@/db/types` at top of file
   - Algorithm:
     1. For each planet in the array, compute orbital radius: `sqrt(planet.x^2 + planet.y^2 + planet.z^2)`
     2. Compute all 5 L-points using existing `computeLPoints(planet.x, planet.y, planet.z)`
     3. For each L-point (L1-L5), compute Euclidean distance from target (x, y, z) to L-point coordinates
     4. Track the global minimum distance across all planets and L-points
     5. If the minimum distance is within `L_POINT_MATCH_THRESHOLD * orbitalRadius` (new configurable constant, e.g. 0.20), return `P${planet.index}-L${lNum}` (planet.index is the `celestialIndex` field from Celestial, 1-based)
     6. Otherwise return null
   - Add new constant: `export const L_POINT_MATCH_THRESHOLD = 0.20;` (20% of orbital radius)

2. **Add `resolveManifestLocationLPoints()` to `apps/periscope/src/chain/manifest.ts`**:
   - Add imports: `import { ensureCelestialsLoaded } from "@/lib/celestials"` and `import { resolveNearestLPoint } from "@/lib/lpoints"`
   - Load all manifest locations with unresolved `lPoint` via `db.manifestLocations.filter(loc => !loc.lPoint).toArray()` (filter needed since `lPoint` is not indexed)
   - Group results by `solarsystem` (e.g. using a `Map<number, ManifestLocation[]>`)
   - Call `await ensureCelestialsLoaded()` once to ensure planet data is in IndexedDB
   - For each system group, load planets from `db.celestials.where("systemId").equals(solarsystem).toArray()`
   - Call `resolveNearestLPoint(Number(loc.x), Number(loc.y), Number(loc.z), planets)` for each location (note: parse string coords to numbers here)
   - Batch-update `lPoint` field on manifest locations via `db.manifestLocations.update(loc.id, { lPoint })`
   - This can run as a background task or be called after event discovery completes

3. **Integrate L-point resolution into `discoverLocationsFromEvents()`**:
   - After the event pagination loop, call `resolveManifestLocationLPoints()` for newly discovered locations
   - This makes a single discovery task handle both fetching and resolution

### Phase 3: Deployable Auto-Population -- COMPLETE

1. **Add `crossReferenceManifestLocations()` to `apps/periscope/src/chain/manifest.ts`**:
   - Signature: `export async function crossReferenceManifestLocations(locationIds: string[]): Promise<number>` -- accepts the list of newly discovered/updated location IDs from the current discovery pass
   - Query only the specified manifest locations via `db.manifestLocations.bulkGet(locationIds)` instead of scanning the entire table. This avoids O(N*M) scanning on each sync.
   - For each location, check if a deployable exists with matching `objectId` (via `db.deployables.where("objectId").equals(loc.id).first()` -- the manifest location `id` is the assembly's Sui object ID, which matches the deployable's `objectId` field)
   - Also check assemblies via `db.assemblies.where("objectId").equals(loc.id).first()`
   - If found and the deployable/assembly lacks `systemId` or `lPoint`, update it: `db.deployables.update(dep.id, { systemId: loc.solarsystem, lPoint: loc.lPoint, updatedAt: new Date().toISOString() })`
   - This bridges the manifest cache to the user's structure inventory

2. **Call `crossReferenceManifestLocations(newLocationIds)` at the end of `discoverLocationsFromEvents()`** (after L-point resolution), passing the list of location IDs that were discovered or updated in this pass

### Phase 4: Manifest UI -- Locations Tab -- COMPLETE

1. **Add imports** to `apps/periscope/src/views/Manifest.tsx`:
   - Import `discoverLocationsFromEvents` from `@/chain/manifest` (add to existing import, line 8)
   - Import `type { ManifestLocation }` from `@/db/types` (add to existing import, line 26)
   - Import `ASSEMBLY_TYPE_IDS` from `@/chain/config` (add to existing import, line 6)
   - Import `MapPin` icon from `lucide-react` (add to existing import, line 16)

2. **Add system name resolution** -- create a `systemNames` map from `useLiveQuery(() => db.solarSystems.toArray())` mapping `systemId -> name` (similar to how `tribeMap` works at line 282). This is needed to display system names in the Locations grid.

3. **Add location columns** -- define `makeLocationColumns(systemNames: Map<number, string>)` function (similar to `makeCharacterColumns()` at line 42):
   - Assembly Type: resolve `typeId` via `ASSEMBLY_TYPE_IDS` from config.ts (e.g. 77917 -> "Smart Storage Unit")
   - Solar System: resolve `solarsystem` via `systemNames` map
   - L-Point: display `lPoint` or "--" if unresolved
   - Assembly ID: truncated `id` with Suiscan link (same pattern as character objectId column)
   - Revealed At: formatted timestamp from `revealedAt`
   - Cached At: age display using `formatAge()` helper (line 30)

4. **Extend the Tab type** from `"characters" | "tribes"` to `"characters" | "tribes" | "locations"` (line 263)

5. **Add location query** -- `useLiveQuery(() => db.manifestLocations.toArray())` filtered by `tenant`, following the same pattern as characters (line 275-276)

6. **Add Locations tab button** to the tab bar (after the Tribes button, around line 423-435). Use `MapPin` icon with location count.

7. **Extend `handleDiscover` callback** (line 294) -- add `else if (tab === "locations")` branch that calls `enqueueTask()` with `discoverLocationsFromEvents(client, tenant, worldPkg, 5000, ctx)`. Update the discover button label for the locations tab (e.g. "Discover Locations").

8. **Add DataGrid rendering** for the locations tab -- third conditional branch alongside characters and tribes (after line 478)

9. **Update header stats** (line 380) to include location count: `{locations.length} locations`

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/db/types.ts` | Modify | Add `ManifestLocation` interface after `ManifestTribe` |
| `apps/periscope/src/db/index.ts` | Modify | Import `ManifestLocation`, add class declaration, add V23 store |
| `apps/periscope/src/chain/config.ts` | Modify | Add Gate (88086, 84955) and Turret (92279, 92401, 92404) type IDs to `ASSEMBLY_TYPE_IDS`; add `LocationRevealed` to `getEventTypes()` return object |
| `apps/periscope/src/chain/manifest.ts` | Modify | Add `discoverLocationsFromEvents()`, `resolveManifestLocationLPoints()`, `crossReferenceManifestLocations()`, import ManifestLocation |
| `apps/periscope/src/lib/lpoints.ts` | Modify | Add `resolveNearestLPoint()` function and Celestial import |
| `apps/periscope/src/views/Manifest.tsx` | Modify | Add Locations tab, location columns, location discovery handler, location DataGrid |

## Resolved Questions

1. **L-point distance threshold -- what fraction of orbital radius is appropriate?**
   - **Resolution: 20% of orbital radius (Option A).** In practice, the game places structures at L-points, so a generous threshold is appropriate. Structures in weird positions are rare. The threshold is a configurable constant (`L_POINT_MATCH_THRESHOLD` in `lpoints.ts`) that can be tuned later if observed in-game positions differ. Alternatives considered: 10% (too strict, may miss near-L-point structures) and no threshold (misleading labels for structures far from any L-point).

## Deferred

- **LocationRegistry direct read** -- Reading the `LocationRegistry` shared object directly (via `get_location()`) could provide location data for structures that were revealed before we started listening to events. This would require knowing the LocationRegistry object ID per tenant, which we don't currently track. Deferred until we have a use case for historical lookups that the event-based approach doesn't cover.
- **Location display on map** -- Rendering manifest locations on a 2D/3D map view. Deferred to a separate map visualization plan.
- **Cross-market location enrichment** -- When Plan 22's cross-market queries return SSU listings, enriching each SSU's display with location data from this manifest cache. This is a consumer of the cache, not a feature of the cache itself. Deferred to Plan 22's implementation phase.
- **Stale location detection** -- Detecting when a structure has been destroyed or moved but its location is still cached. Would require listening to additional events (e.g. `StatusChangedEvent` for destroyed state). Deferred.
