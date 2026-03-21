# Plan: Manifest Public Locations
**Status:** Draft
**Created:** 2026-03-21
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
- **Module:** `world::location` (documented in `docs/chain-events-reference.md` lines 456-473 and `docs/world-contracts-reference.md` lines 856-859)
- **Fields:** `assembly_id` (ID), `assembly_key` (TenantItemId), `type_id` (u64), `owner_cap_id` (ID), `location_hash` (vector<u8>), `solarsystem` (u64), `x` (String), `y` (String), `z` (String)
- **Note:** The x, y, z coordinates are strings that support negative values (e.g. "-123456789")
- **Emission:** When admin/game server publishes coordinates on-chain (v0.0.18 feature)

### LocationRegistry

- **Struct:** `LocationRegistry has key { id: UID, locations: Table<ID, Coordinates> }`
- **Coordinates:** `{ solarsystem: u64, x: String, y: String, z: String }`
- **Read access:** `get_location(registry, assembly_id): Option<Coordinates>` (documented in `docs/world-contracts-reference.md` line 871)

### L-Point Computation

- **`apps/periscope/src/lib/lpoints.ts`** -- `computeLPoints(px, py, pz)` returns L1-L5 coordinates for a planet at (px, py, pz) relative to the sun at origin. Uses configurable ratios (L1=0.85r, L2=1.15r, L3=-1.0r, L4/L5 at +/-60 degrees). Created by Plan 18.

- **`apps/periscope/src/lib/celestials.ts`** -- `ensureCelestialsLoaded()` lazy-loads planet positions from `celestials.json` into the `celestials` Dexie table (~83K records). `PLANET_TYPE_NAMES` maps typeID to name. Created by Plan 18.

- **No `nearestLPoint` utility exists** -- The existing `computeLPoints` function computes L-point coordinates from a planet position, but there is no function that takes arbitrary (x, y, z) coordinates and determines the nearest planet + L-point. This is needed to resolve raw coordinates from `LocationRevealedEvent` into human-readable "P{n}-L{m}" labels.

### Related Plans

- **Plan 22** (`docs/plans/active/22-market-buy-order-improvements.md`) -- Adds `is_public: bool` to `SsuConfig`. Cross-market queries for public SSU listings will need location data, which this manifest cache provides.

- **Plan 23** (`docs/plans/pending/23-private-map-system.md`) -- Encrypted private location sharing. Complementary to this plan's public location cache.

## Target State

### Data Model

```typescript
export interface ManifestLocation {
    /** Assembly (structure) object ID -- primary key */
    id: string;
    /** Assembly item key (TenantItemId -- e.g. { tenant, item_id }) */
    assemblyItemId: string;
    /** Assembly type ID (u64, maps to ASSEMBLY_TYPE_IDS) */
    typeId: number;
    /** Owner cap object ID */
    ownerCapId: string;
    /** Solar system ID */
    solarsystem: number;
    /** Raw X coordinate (string, supports negatives) */
    x: string;
    /** Raw Y coordinate */
    y: string;
    /** Raw Z coordinate */
    z: string;
    /** Resolved L-point label (e.g. "P2-L3") -- computed from coords + celestials */
    lPoint?: string;
    /** Tenant (stillness/utopia) */
    tenant: string;
    /** When this location was revealed on-chain (from event timestamp) */
    revealedAt: string;
    /** When this entry was last cached */
    cachedAt: string;
}
```

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
| L-point resolution | Separate pass after event discovery | Computing L-points requires loading celestials data (~83K records). This should not block event fetching. Resolve as a second pass or on-demand when displaying. |
| L-point resolution location | `lpoints.ts` utility | Keeps all L-point math in one file. The manifest module calls this utility when resolving labels. |
| Event type | `{worldPkg}::location::LocationRevealedEvent` | Per `docs/chain-events-reference.md` line 458. This is the only event emitted when coordinates are published on-chain. |
| Discovery pattern | Same incremental cursor as characters | Proven pattern. `queryEventsGql` pagination with cursor persistence in `db.settings`. Idempotent (re-running discovers only new events). |
| Deployable auto-population | Cross-reference manifest locations with deployables table | When a manifest location is cached for an assembly_id that matches a deployable's objectId, auto-fill the deployable's `systemId` and `lPoint` fields. This connects the public location data to the user's structure inventory. |
| Tab in Manifest UI | Third tab alongside Characters and Tribes | Natural extension of the manifest explorer. Same DataGrid pattern with filtering and sorting. |

## Implementation Phases

### Phase 1: Data Model + Event Discovery

1. **Add `ManifestLocation` interface** to `apps/periscope/src/db/types.ts` after the `ManifestTribe` interface (after line 452). Include all fields as specified in the Target State section above.

2. **Add `manifestLocations` table declaration** to `apps/periscope/src/db/index.ts`:
   - Add `ManifestLocation` to the import list (line 25 area)
   - Add class body declaration: `manifestLocations!: EntityTable<ManifestLocation, "id">;` (after line 91)
   - Add V23 store definition after V22 (after line 483): `this.version(23).stores({ manifestLocations: "id, solarsystem, typeId, tenant, cachedAt" });`

3. **Add `LocationRevealed` to `getEventTypes()`** in `apps/periscope/src/chain/config.ts` (inside the return object, after the ItemBurned line): `LocationRevealed: \`${pkg}::location::LocationRevealedEvent\``

4. **Create `discoverLocationsFromEvents()`** in `apps/periscope/src/chain/manifest.ts`:
   - Follow the `discoverCharactersFromEvents()` pattern (lines 137-283)
   - Event type: `${worldPkg}::location::LocationRevealedEvent`
   - Cursor key: `manifestLocCursor:${worldPkg}`
   - Parse fields: `assembly_id` -> `id`, `assembly_key` -> `assemblyItemId` (extract item_id), `type_id` -> `typeId`, `owner_cap_id` -> `ownerCapId`, `solarsystem`, `x`, `y`, `z`
   - Set `tenant` from the assembly_key or from the function parameter
   - Set `revealedAt` from event timestamp, `cachedAt` from current time
   - Use `db.manifestLocations.put()` to upsert (same structure re-revealed = overwrite)
   - No name resolution phase needed (unlike characters)
   - Use `TaskContext` for progress reporting
   - Return count of new/updated locations

5. **Add `import type { ManifestLocation }` to manifest.ts** imports (line 16)

### Phase 2: L-Point Resolution

1. **Add `resolveNearestLPoint()` to `apps/periscope/src/lib/lpoints.ts`**:
   - Signature: `resolveNearestLPoint(x: number, y: number, z: number, planets: Celestial[]): string | null`
   - For each planet, compute all 5 L-points using existing `computeLPoints()`
   - Calculate distance from target (x, y, z) to each L-point
   - Track the closest match
   - If closest distance is within a threshold (e.g. 20% of the planet's orbital radius), return `P{planetIndex}-L{lNum}`
   - Otherwise return null
   - Import `Celestial` type from `@/db/types`

2. **Add `resolveManifestLocationLPoints()` to `apps/periscope/src/chain/manifest.ts`**:
   - Load all manifest locations with null `lPoint` field
   - Group by `solarsystem`
   - For each system, load planets from `db.celestials` (ensure loaded via `ensureCelestialsLoaded()`)
   - Call `resolveNearestLPoint()` for each location
   - Batch-update `lPoint` field on manifest locations
   - This can run as a background task or be called after event discovery completes

3. **Integrate L-point resolution into `discoverLocationsFromEvents()`**:
   - After the event pagination loop, call `resolveManifestLocationLPoints()` for newly discovered locations
   - This makes a single discovery task handle both fetching and resolution

### Phase 3: Deployable Auto-Population

1. **Add `crossReferenceManifestLocations()` to `apps/periscope/src/chain/manifest.ts`**:
   - Query all manifest locations
   - For each, check if a deployable or assembly exists with matching `objectId`
   - If found and the deployable/assembly lacks `systemId` or `lPoint`, update it with the manifest location data
   - This bridges the manifest cache to the user's structure inventory

2. **Call `crossReferenceManifestLocations()` at the end of `discoverLocationsFromEvents()`** (after L-point resolution)

### Phase 4: Manifest UI -- Locations Tab

1. **Add location columns** to `apps/periscope/src/views/Manifest.tsx`:
   - Define `makeLocationColumns()` function (similar to `makeCharacterColumns()` at line 42)
   - Columns: Assembly Type (resolve `typeId` via `ASSEMBLY_TYPE_IDS`), Solar System (resolve via `systemNames` map), L-Point, Assembly ID (truncated + Suiscan link), Owner Cap (truncated), Revealed At, Cached At

2. **Extend the Tab type** from `"characters" | "tribes"` to `"characters" | "tribes" | "locations"` (line 263)

3. **Add Locations tab button** to the tab bar (after the Tribes button, line 423-435)

4. **Add location query** via `useLiveQuery(() => db.manifestLocations.toArray())` filtered by tenant

5. **Add Discover handler for locations** -- extend `handleDiscover` callback (line 294) to handle the `locations` tab by calling `enqueueTask()` with `discoverLocationsFromEvents()`

6. **Add DataGrid rendering** for the locations tab -- third conditional branch alongside characters and tribes (after line 478)

7. **Update header stats** to include location count (line 380)

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/db/types.ts` | Modify | Add `ManifestLocation` interface after `ManifestTribe` |
| `apps/periscope/src/db/index.ts` | Modify | Import `ManifestLocation`, add class declaration, add V23 store |
| `apps/periscope/src/chain/config.ts` | Modify | Add `LocationRevealed` to `getEventTypes()` return object |
| `apps/periscope/src/chain/manifest.ts` | Modify | Add `discoverLocationsFromEvents()`, `resolveManifestLocationLPoints()`, `crossReferenceManifestLocations()`, import ManifestLocation |
| `apps/periscope/src/lib/lpoints.ts` | Modify | Add `resolveNearestLPoint()` function and Celestial import |
| `apps/periscope/src/views/Manifest.tsx` | Modify | Add Locations tab, location columns, location discovery handler, location DataGrid |

## Open Questions

1. **L-point distance threshold -- what fraction of orbital radius is appropriate?**
   - **Option A: 20% of orbital radius** -- Pros: Fairly generous, will match most structures placed near L-points. Cons: Could false-positive for structures between planets or at unusual positions.
   - **Option B: 10% of orbital radius** -- Pros: More precise, fewer false matches. Cons: May miss structures that are near but not exactly at L-points.
   - **Option C: No threshold, always return closest** -- Pros: Every location gets a label. Cons: Labels could be misleading for structures far from any L-point (e.g. in deep space between planets).
   - **Recommendation:** Option A (20%). In practice, the game places structures at L-points, so a generous threshold is appropriate. Structures in weird positions are rare. The threshold can be tuned later if needed since `L_POINT_RATIOS` and the threshold are configurable constants.

## Deferred

- **LocationRegistry direct read** -- Reading the `LocationRegistry` shared object directly (via `get_location()`) could provide location data for structures that were revealed before we started listening to events. This would require knowing the LocationRegistry object ID per tenant, which we don't currently track. Deferred until we have a use case for historical lookups that the event-based approach doesn't cover.
- **Location display on map** -- Rendering manifest locations on a 2D/3D map view. Deferred to a separate map visualization plan.
- **Cross-market location enrichment** -- When Plan 22's cross-market queries return SSU listings, enriching each SSU's display with location data from this manifest cache. This is a consumer of the cache, not a feature of the cache itself. Deferred to Plan 22's implementation phase.
- **Stale location detection** -- Detecting when a structure has been destroyed or moved but its location is still cached. Would require listening to additional events (e.g. `StatusChangedEvent` for destroyed state). Deferred.
