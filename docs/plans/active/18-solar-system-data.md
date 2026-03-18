# Plan: Solar System Data Extraction
**Status:** Active -- Phases 1-2 code complete, data extraction pending
**Created:** 2026-03-17
**Updated:** 2026-03-18
**Module:** periscope
**Depends on:** None (plan 14 depends on this plan for planet data)

## Overview

EF Maps (ef-map.com) displays per-system planetary data including planet types, moon counts, and Lagrange point coordinates. We want the same data in Periscope to support the Location Recording feature (plan 14) and future map enhancements. The key question is: where does this data come from, and how do we get it?

Research reveals **two complementary data sources** already available locally -- no external API needed:

1. **`starmapcache.pickle`** (already read by `extract_static_data.py`) contains `sunTypeID`, `planetCountByType`, and `planetItemIDs` for each of the 24,026 inhabited systems. We currently extract this file but **discard these fields**. Adding them to `stellar_systems.json` costs only ~2.5 MB.

2. **`mapObjects.db`** (SQLite, 18 MB at `{gameRoot}/utopia/bin64/staticdata/mapObjects.db`) contains 261,219 celestial objects with full 3D coordinates: 24,026 suns, 83,257 planets, 147,060 moons, and 6,876 stargates. The `celestialID` values match the `planetItemIDs` from starmapcache, so the two sources cross-reference perfectly. Planet coordinates enable computation of L-point positions (L1-L5 are mathematically derived from the sun-planet line).

EF Maps almost certainly uses the same game client data -- their FAQ mentions "in-browser SQLite database (sql.js)" and the data structure is identical to mapObjects.db. No public API is exposed.

## Current State

- **`scripts/extract_static_data.py`** reads `starmapcache.pickle` and outputs system/region/constellation/jump data. The systems loop is at line 158. It ignores `sunTypeID`, `planetCountByType`, and `planetItemIDs` fields that exist in the pickle.
- **`scripts/extract_game_data.py`** is a separate script that extracts FSDBinary data (types, blueprints, groups, etc.) using the game's .pyd loader modules. Outputs to the same `apps/periscope/public/data/` directory.
- **`apps/periscope/public/data/stellar_systems.json`** (5.2 MB, 24,426 systems) has: `id`, `center`, `constellationId`, `regionId`, `neighbours`, `factionId`, `name`. No planet data.
- **`SolarSystem` type** (`apps/periscope/src/db/types.ts` lines 3-11) has the same fields as the JSON.
- **`DataInitializer.tsx`** loads `stellar_systems.json` into the Dexie `solarSystems` table on first run. It checks `db.cacheMetadata.get("stellarData")` -- if the entry exists, data is considered loaded. The stored version is `"1.0.0"` but no version comparison is performed; only presence/absence of the cache entry matters.
- **`mapObjects.db`** exists at `C:\CCP\EVE Frontier\utopia\bin64\staticdata\mapObjects.db` with two tables:
  - `celestials`: 261,219 rows -- columns: `celestialID`, `celestialNameID`, `solarSystemID`, `typeID`, `groupID`, `radius`, `x`, `y`, `z`, `orbitID`, `orbitIndex`, `celestialIndex`
  - `npcStations`: 98 rows (not relevant for this plan)
- **Group IDs in mapObjects.db**: 6 = Sun (24,026), 7 = Planet (83,257), 8 = Moon (147,060), 10 = Stargate (6,876)
- **Planet typeIDs**: 11 = Temperate (9,713), 12 = Ice (25,285), 13 = Gas (24,433), 2014 = Oceanic (3,267), 2015 = Lava (5,221), 2016 = Barren (10,768), 2063 = Plasma (4,570). Type names confirmed via `types.json`.
- **Planet counts per system**: range 1-13, median ~3. Distribution: 4,485 systems with 1 planet, 4,671 with 3, down to 1 system with 13.
- **Plan 14** (structure locations) references mapObjects.db and defers planet data extraction. This plan fulfills that deferred item.
- **`types.json`** (keyed by typeID string, in `apps/periscope/public/data/`) contains names for all planet types, sun type (45031 = "Sun K7 (Orange)"), and moon type (14 = "Moon"). However, this file is a local extraction artifact -- the app's `gameTypes` Dexie table is populated from the World API (`/v2/types`), which likely does NOT include celestial types (they have `published: 0`). Planet type name resolution will need a local mapping, not the gameTypes table.
- **Special systems** (403 systems in 34000xxx range) have no planet data in starmapcache -- empty `planetCountByType` and `planetItemIDs`. These are game-special systems (e.g. tutorial, test). The 400 systems also lack suns in mapObjects.db.
- **Dexie DB is at version 17** (V17 adds `parentId` index to deployables + assemblies). This plan's celestials table will use V18 (next available version). Plan 14 will use V19 or later for its `systemId` indexes.

## Target State

### Phase 1: Augment stellar_systems.json (starmapcache fields)
Extend the extraction script and data model to include planet summary data that's already in starmapcache.pickle but currently discarded. This adds ~2.5-3.5 MB to stellar_systems.json and enables:
- Showing planet count and types per system (e.g. "3 planets: Lava, Temperate, Gas")
- Knowing the sun type per system
- Cross-referencing planet celestialIDs for future coordinate lookups

### Phase 2: Extract celestial coordinates (mapObjects.db)
A separate extraction step reads mapObjects.db and produces `celestials.json` -- a compact file containing planet positions per system. This enables:
- Computing L-point coordinates (L1-L5 for each planet, derived from sun-planet vector)
- Planet-qualified location recording ("P2-L3" -- plan 14 will consume this data)

### Phase 3: Periscope UI integration
Add a system detail panel showing planets, their types, and L-point positions. Integrate with the Location recording feature from plan 14.

## Data Model

### Augmented SolarSystem type
```typescript
export interface SolarSystem {
    id: number;
    name?: string;
    center: [number, number, number];
    constellationId: number;
    regionId: number;
    neighbours: number[];
    factionId?: number | null;
    // New fields (Phase 1):
    sunTypeId?: number;                    // e.g. 45031 ("Sun K7 (Orange)")
    planetCount?: number;                  // total planets in this system (0-13)
    planetCountByType?: Record<number, number>;  // typeID -> count (e.g. {11: 2, 12: 3, 13: 1, 2015: 1})
    planetItemIds?: number[];              // celestialIDs in orbit order (cross-ref to mapObjects.db)
}
```

### Planet type name map (static, in code)
```typescript
export const PLANET_TYPE_NAMES: Record<number, string> = {
    11: "Temperate",
    12: "Ice",
    13: "Gas",
    2014: "Oceanic",
    2015: "Lava",
    2016: "Barren",
    2063: "Plasma",
};
export const SUN_TYPE_NAME = "Sun K7 (Orange)"; // typeID 45031 -- ALL 24,026 suns are this type
```

### Celestial data (Phase 2)
A separate `celestials.json` file:
```typescript
// Keyed by systemId (string), value is array of [celestialID, celestialIndex, typeID, x, y, z]
// Includes planets only (groupID=7). Sun is always at (0,0,0).
type CelestialsData = Record<string, [number, number, number, number, number, number][]>;
```
Estimated size: ~4.5 MB (compact JSON with celestialIDs). Can be gzipped to ~1.5 MB for transfer.

### L-point computation (Phase 2)
L-points are computed client-side from planet coordinates. These are used for **informational purposes only** (e.g. presenting L-point options when a user sets a location for a structure), not for rendering on a map.

Lagrange point definitions relative to the sun-planet system:
- **L1**: On the sun-planet line, between sun and planet (~85% of orbital radius from sun)
- **L2**: On the sun-planet line, beyond planet (~115% of orbital radius from sun)
- **L3**: Opposite side of sun from planet (~100% of orbital radius, 180 degrees)
- **L4**: 60 degrees ahead of planet in orbital plane (equilateral triangle vertex)
- **L5**: 60 degrees behind planet in orbital plane (equilateral triangle vertex)

For EVE Frontier game purposes, the exact gravitational ratios don't matter -- the game places structures at approximate L-point positions. The formula only needs the planet position vector relative to the sun.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data source for planet types/counts | starmapcache.pickle (already read by extract_static_data.py) | Zero new dependencies. The pickle already contains `sunTypeID`, `planetCountByType`, and `planetItemIDs`. We just need to stop discarding them. |
| Data source for coordinates | mapObjects.db (SQLite at game client path) | Only source of per-celestial 3D coordinates. The 83,257 planets have meter-scale positions relative to the system's sun at origin. |
| Celestials file format | Separate `celestials.json` rather than augmenting stellar_systems.json | stellar_systems.json is already 5.2 MB. Adding ~4.5 MB of coordinate arrays would make first-load slow. Celestials can be loaded on-demand when a user opens a system detail view. |
| L-point computation | Client-side math from planet vectors | No pre-computation needed. Given a planet at (x, y, z) relative to sun at origin, L-points are simple vector operations. Keeps data files small and allows adjustable L-point distance ratios. |
| L-point purpose | Informational only, not rendered | L-point coordinates are used to populate dropdowns and labels (e.g. "P2-L3") in the location editor, not drawn on a map. Simplified ratios (L1=0.85r, L2=1.15r, L3=-1.0r, L4/L5 at +/-60 degrees) are sufficient. Ratios should be configurable constants for future tuning. |
| Planet type names | Hardcoded lookup map (7 planet types + 1 sun type) | The World API `gameTypes` table does not include celestial types (`published: 0`). Since there are only 7 planet types and 1 sun type, a static map in code is simpler and more reliable than depending on types.json or the World API. |
| Extraction scripts | Separate: extend extract_static_data.py + create new extract_celestials.py | Phase 1 is a small change to the existing script. Phase 2 needs a separate script since it reads a different source file (SQLite vs pickle). A user might not have mapObjects.db available (e.g. game not installed), so keeping them separate means stellar_systems.json can be regenerated independently. |
| Celestials Dexie table | New `celestials` table with lazy loading | Planets are only needed in system detail views and location editors. The full ~4.5 MB dataset (83K records) is loaded into Dexie on first use, then cached in IndexedDB. This avoids slowing first-load while keeping data always available after initial use. |
| Celestials content | Planets only (~4.5 MB with celestialIDs) | Sufficient for L-point computation and location recording. The extraction script will have `--include-moons` and `--include-stargates` flags for future use, but the default output includes only planets. |
| Data re-import on version bump | Delete + re-import stellar data on version mismatch | DataInitializer currently only checks presence of `stellarData` cache entry. To force re-import with new fields, clear the solarSystems table and stellarData entry, then re-run the standard import flow. |

## Implementation Phases

### Phase 1: Augment stellar_systems.json with planet summary data

**Goal:** Add sunTypeId, planetCountByType, planetCount, and planetItemIds to every solar system record.

**Progress:** Steps 1-4 DONE (code changes). Steps 5-6 PENDING (data re-extraction not yet run).

1. **[DONE] Extend `extract_starmap()` in `scripts/extract_static_data.py`** -- In the systems loop (line 158, `for sys_id, sys_data in raw_systems.items():`), add four new fields to the output dict after the existing `factionId` line:
   ```python
   "sunTypeId": sys_data.get("sunTypeID"),
   "planetCount": len(sys_data.get("planetItemIDs", [])),
   "planetCountByType": sys_data.get("planetCountByType", {}),
   "planetItemIds": sys_data.get("planetItemIDs", []),
   ```
   Note: `planetCountByType` keys in the pickle are ints but will serialize as string keys in JSON (Python JSON encoder converts int dict keys to strings). This is fine -- the TypeScript `Record<number, number>` will read them correctly since JSON keys are always strings and `parseInt` can be applied when needed.

2. **[DONE] Update `SolarSystem` interface** in `apps/periscope/src/db/types.ts` (after line 10, before the closing brace) -- Add four new optional fields:
   ```typescript
   sunTypeId?: number;
   planetCount?: number;
   planetCountByType?: Record<number, number>;
   planetItemIds?: number[];
   ```

3. **[DONE] Add version-aware re-import logic to `DataInitializer.tsx`** -- The current logic (line 25-26) checks `const meta = await db.cacheMetadata.get("stellarData"); if (meta) { ... return; }`. Change this to also compare the version:
   ```typescript
   const STELLAR_DATA_VERSION = "2.0.0";
   const meta = await db.cacheMetadata.get("stellarData");
   if (meta && meta.version === STELLAR_DATA_VERSION) {
       // Data is up-to-date, skip import
       ...
       return;
   }
   // Version mismatch or no data: clear stale data, then re-import
   if (meta) {
       await db.solarSystems.clear();
       await db.regions.clear();
       await db.constellations.clear();
       await db.jumps.clear();
       await db.cacheMetadata.delete("stellarData");
   }
   // ... proceed to standard import flow ...
   ```
   Update the version string in the `db.cacheMetadata.put()` call (line 81) from `"1.0.0"` to the `STELLAR_DATA_VERSION` constant.

4. **[DONE] Create `apps/periscope/src/lib/celestials.ts`** -- Planet type constants:
   ```typescript
   export const PLANET_TYPE_NAMES: Record<number, string> = {
       11: "Temperate",
       12: "Ice",
       13: "Gas",
       2014: "Oceanic",
       2015: "Lava",
       2016: "Barren",
       2063: "Plasma",
   };
   export const SUN_TYPE_NAME = "Sun K7 (Orange)";
   export const SUN_TYPE_ID = 45031;
   ```

5. **[PENDING] Re-run extraction** -- `py scripts/extract_static_data.py` to regenerate `stellar_systems.json` with the new fields. Expected size: ~7.5-8.5 MB (from 5.2 MB). The `planetCountByType` dicts add more per-system overhead than raw arrays since they include stringified key names. **Note:** stellar_systems.json is still 5.2 MB and does not contain planet fields -- the script was updated but not re-run.

6. **[PENDING] Verify data integrity** -- Spot-check a few systems: system 30005068 should have `sunTypeId: 45031`, `planetCount: 7`, `planetCountByType: {"2015": 1, "11": 2, "13": 1, "12": 3}`, `planetItemIds: [40052569, 40052570, 40052571, 40052572, 40052577, 40052578, 40052579]`. Also check a special system (e.g. 34000160) to confirm empty/null planet fields.

### Phase 2: Extract celestial coordinates from mapObjects.db

**Goal:** Produce `celestials.json` containing planet positions for all systems, and provide a client-side L-point utility.

**Progress:** Steps 1-5 DONE (code changes). Data extraction PENDING (celestials.json does not yet exist).

1. **[DONE] Create `scripts/extract_celestials.py`** -- A new Python script that:
   - Opens `mapObjects.db` from the game client path (default: `C:\CCP\EVE Frontier\utopia\bin64\staticdata\mapObjects.db`, configurable via `--mapobjects` flag)
   - Queries all celestials with `groupID=7` (planets) ordered by `solarSystemID, celestialIndex`
   - Outputs a compact JSON: `{systemId: [[celestialID, celestialIndex, typeID, x, y, z], ...], ...}`
   - Optionally includes moons (`groupID=8`) and stargates (`groupID=10`) behind `--include-moons` / `--include-stargates` flags
   - Writes to `apps/periscope/public/data/celestials.json`
   - Prints summary stats (total planets, systems covered, file size)
   - Estimated output: ~4.5 MB for planets only (with celestialIDs)

2. **[DONE] Add `Celestial` type** to `apps/periscope/src/db/types.ts`:
   ```typescript
   export interface Celestial {
       id: number;           // celestialID
       systemId: number;     // solarSystemID
       index: number;        // celestialIndex (planet number 1-13)
       typeId: number;       // planet type (11, 12, 13, 2014-2016, 2063)
       x: number;            // position relative to sun (meters)
       y: number;
       z: number;
   }
   ```

3. **[DONE] Add `celestials` table to Dexie** -- Add V18 to `db/index.ts` (next version after V17). V18 declares the new table:
   ```typescript
   this.version(18).stores({
       celestials: "id, systemId, typeId, index",
   });
   ```
   Also add the table declaration to the class body:
   ```typescript
   celestials!: EntityTable<Celestial, "id">;
   ```

4. **[DONE] Create lazy-load utility for celestials** -- In `apps/periscope/src/lib/celestials.ts` (same file as the constants from Phase 1), add:
   ```typescript
   // [celestialID, celestialIndex, typeID, x, y, z]
   type CelestialsData = Record<string, [number, number, number, number, number, number][]>;

   export async function ensureCelestialsLoaded(): Promise<void> {
       const meta = await db.cacheMetadata.get("celestialsData");
       if (meta) return;
       // Fetch + import celestials.json into Dexie
       const data: CelestialsData = await fetch("/data/celestials.json").then(r => r.json());
       const records: Celestial[] = [];
       for (const [systemId, planets] of Object.entries(data)) {
           for (const [celestialId, index, typeId, x, y, z] of planets) {
               records.push({
                   id: celestialId,
                   systemId: Number(systemId),
                   index, typeId, x, y, z,
               });
           }
       }
       await db.celestials.bulkPut(records);
       await db.cacheMetadata.put({
           key: "celestialsData",
           version: "1.0.0",
           importedAt: new Date().toISOString(),
           counts: { celestials: records.length },
       });
   }
   ```

5. **[DONE] Create `apps/periscope/src/lib/lpoints.ts`** -- L-point computation utility:
   ```typescript
   // Configurable L-point ratios
   export const L_POINT_RATIOS = {
       L1: 0.85,   // fraction of orbital radius, sunward
       L2: 1.15,   // fraction of orbital radius, beyond planet
       L3: -1.0,   // opposite side of sun
       L4_ANGLE: Math.PI / 3,   // 60 degrees ahead
       L5_ANGLE: -Math.PI / 3,  // 60 degrees behind
   };

   export function computeLPoints(
       planetX: number, planetY: number, planetZ: number
   ): Record<string, [number, number, number]> {
       // Returns { L1: [x,y,z], L2: [x,y,z], L3: [x,y,z], L4: [x,y,z], L5: [x,y,z] }
       // L1/L2: scale planet vector
       // L3: negate planet vector
       // L4/L5: rotate planet vector +/-60 degrees in the orbital plane
       //   Requires computing a perpendicular vector. Since the sun is at origin,
       //   the orbital plane normal is cross(planet_pos, [0,1,0]) (or [0,0,1]
       //   if planet is near the y-axis). Then L4/L5 = rotate(planet_pos, +/-60deg, normal).
   }
   ```

### Phase 3: Periscope UI integration

**Goal:** Surface planet data in the UI and connect to location recording (plan 14).

**Note:** Plan 14 (structure locations) will build on the data model and utilities created by this plan. Phase 3 UI can begin independently, but full integration with location recording requires plan 14.

**Progress:** Step 2 DONE (via plan 14 implementation). Steps 1 and 3 NOT STARTED.

1. **[NOT STARTED] System detail panel** -- When a user clicks a system in JumpPlanner, Locations, or Deployables, show a panel with:
   - System name, region, constellation
   - Sun type (always "Sun K7 (Orange)" for inhabited systems)
   - Planet list with types (e.g. "Planet 1: Lava", "Planet 2: Temperate")
   - Planet count comes from `SolarSystem.planetCount` (Phase 1 data)
   - Planet types come from `SolarSystem.planetCountByType` resolved through `PLANET_TYPE_NAMES`

2. **[DONE] Planet-qualified L-point selector** -- Implemented by plan 14 in the LocationEditor component (`apps/periscope/src/views/Deployables.tsx`). Uses `ensureCelestialsLoaded()`, `PLANET_TYPE_NAMES`, and stores as "P{n}-L{m}" format. For the Location recording feature (plan 14), enhance the L-point selector with a "Planet N -> L-point" drill-down:
   - First pick the planet (dropdown: "Planet 1 (Lava)", "Planet 2 (Temperate)", etc.)
   - Then pick the L-point (L1-L5 buttons)
   - Stores as "P2-L3" format (matches plan 14's recommendation)
   - Planet list is derived from `SolarSystem.planetCountByType` (Phase 1 data, no celestials fetch needed for the selector itself)

3. **[NOT STARTED] System search augmentation** -- The SystemSearch component (created by plan 14) could show planet count as secondary info (e.g. "ESS-JP8 -- 4 planets" in the dropdown), leveraging the `SolarSystem.planetCount` field added in Phase 1. **Note:** Blocked until Phase 1 step 5 (data re-extraction) is complete, since `SolarSystem.planetCount` will be undefined without the augmented JSON.

## File Summary

**Note:** `scripts/*` files are coordinator-owned (per CLAUDE.md). The coordinator must edit `extract_static_data.py` and create `extract_celestials.py` before dispatching a sub-agent for the periscope module changes.

| File | Action | Description |
|------|--------|-------------|
| `scripts/extract_static_data.py` | Modify (coordinator) | Add sunTypeId, planetCountByType, planetCount, planetItemIds extraction from starmapcache |
| `scripts/extract_celestials.py` | Create (coordinator) | New script to extract planet coordinates from mapObjects.db |
| `apps/periscope/public/data/stellar_systems.json` | Regenerate | Re-extract with augmented planet data (~7.5-8.5 MB) |
| `apps/periscope/public/data/celestials.json` | Create | Planet coordinates per system (~4.5 MB with celestialIDs) |
| `apps/periscope/src/db/types.ts` | Modify | Add fields to SolarSystem, add Celestial interface |
| `apps/periscope/src/db/index.ts` | Modify | Add celestials table at V18 (next version after V17) |
| `apps/periscope/src/components/DataInitializer.tsx` | Modify | Add version-aware re-import: compare stellarData version, clear + re-import on mismatch |
| `apps/periscope/src/lib/celestials.ts` | Create | Planet type constants (PLANET_TYPE_NAMES, SUN_TYPE_NAME), lazy-load utility for celestials |
| `apps/periscope/src/lib/lpoints.ts` | Create | L-point coordinate computation with configurable ratios |

## Resolved Questions

1. **Should celestials.json include moons and stargates, or planets only?**
   - **Resolution: Planets only** (~3.9 MB base, ~4.5 MB with celestialIDs). Sufficient for L-point computation and location recording. The extraction script will have `--include-moons` and `--include-stargates` flags for future use. Moon/stargate data can be extracted separately later if needed.

2. **Should celestials be loaded eagerly or lazily?**
   - **Resolution: Lazy (on first use).** Load the full celestials dataset into Dexie on first use of a feature that needs it (system detail panel, location editor). After that it's cached in IndexedDB. The ~4.5 MB download + 83K Dexie inserts should take 2-3 seconds on modern hardware.

3. **Should the extraction scripts be unified into one or kept separate?**
   - **Resolution: Separate.** `extract_static_data.py` for pickle-based data (systems, regions, constellations) and `extract_celestials.py` for SQLite-based data (planet coordinates). The data sources are fundamentally different (pickle vs SQLite), the extraction logic is independent, and a user might not have mapObjects.db available (e.g. game not installed). Keeping them separate means stellar_systems.json can be regenerated without mapObjects.db.

4. **What L-point distance ratios should we use?**
   - **Resolution: Simplified ratios, configurable constants.** L-points are used for informational purposes only (populating dropdown selectors, displaying labels like "P2-L3"), not for rendering on a map. Start with L1=0.85r, L2=1.15r, L3=-1.0r, L4/L5 at +/-60 degrees at distance r. Store as named constants in `lib/lpoints.ts` for future tuning if observed in-game positions differ.

## Deferred

- **System map visualization** -- A 2D/3D view showing planet orbits, L-points, and structure locations within a system. Would use celestial coordinates for layout. Significant UI effort -- deferred to a separate plan.
- **Moon data extraction** -- 147,060 moons with orbit relationships. Useful for future "warp to moon" navigation but not needed for L-point computation or location recording.
- **Stargate data extraction** -- 6,876 stargates with positions. Could enable showing gate locations on system maps.
- **Real-time celestial data from game client** -- solarsystemcontent.static (84 MB FSD binary) contains richer per-system data. Parsing it is complex (nested pickle/FSD format). Deferred unless simpler sources prove insufficient.
- **EF Maps data federation** -- EF Maps does not expose a public API. If they add one, we could fetch data directly. For now, local extraction is the only option.
- **Compressed celestials delivery** -- Serving celestials.json gzipped (~1.2 MB) with proper Content-Encoding. Standard Vite dev server and production hosting typically handle this automatically.
