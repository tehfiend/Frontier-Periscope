# Landscape / Site / Resource Data Reference (Cycle 6)

> Research findings, verified 2026-06-29/30 against EVE Frontier client **build 3413215**
> (`C:\CCP\EVE Frontier\stillness`). Captures where Cycle 6 landscape/site/resource data lives, what
> it contains, and what is NOT available. Feeds **Plan 40**
> (`docs/plans/pending/40-starmap-proximity-sourcing.md`).

## TL;DR

- **Landscapes / sites** (the warp-to content that fills systems) and the **NPC/dormant gate network**
  are **client-static-only**. They are NOT on the Sui chain, and NOT exposed by any API.
- The old REST **World API** (`world-api-stillness.live.tech.evefrontier.com`) is **gone** -- the host
  no longer resolves (DNS ENOTFOUND) and its Swagger page is archived. Even when live it only served
  `/v2/types` (item catalog for icons), never universe/site data. Current official data access is
  **Sui SDK / GraphQL / gRPC against the chain only** (characters, assemblies, inventory, `JumpEvent`).
- The data IS fully present in client static files and extractable via the game's `.pyd` loaders
  (`py -3.12`, same toolchain as the existing extractors -- see `client-data-extraction.md` and the
  `eve-frontier-local-paths` memory).

## What is NOT available (so nobody re-searches for it)

| Want | On chain? | Static data? | Notes |
|------|-----------|--------------|-------|
| Player smart gates | YES (already integrated) | catalog only | `world::gate`, type_ids 88086 Mini / 84955 Heavy |
| NPC gate network topology | no | YES (`starmapcache.pickle` -> `jumps`) | 3,536 edges, `jumpType` 0/1 |
| Dormant gate repair state / NPC-gate fuel level | no | no | Runtime/server state. "Disrupted Gate" is type group 4081 (catalog), but live repaired/fuel status is not static or chain. |
| Landscape sites (where + what type) | no | YES | see below |
| Site resource yields (exact tonnage / ore->mineral) | no | no | `typematerials` is near-empty (5 entries). Yields are runtime. |
| NPC loot / drop tables | no | **no static file exists** | Confirmed: no `loot`/`drop`/`reward` entry in the resfile index. Drop attribution is server-side. |

## The landscape -> site pipeline (4 layers)

All in `stillness/` static data; loaders all present in `stillness/bin64`.

| File | Size | Loader | Contents |
|------|------|--------|----------|
| `landscape.fsdbinary` | 29.5 MB | `landscapeLoader` | 23,736 systems, **113,253 sites**. Per system: `asteroidBelts` / `trojans` -> `clusters` -> `sites { siteID: { ecosystemID, position:[x,y,z] } }` + belt `tags[]`. |
| `ecosystem.fsdbinary` | 5 KB | `ecosystemLoader` | 20 biomes: `ecosystemID -> { name, naturalWorldPatterns[], brokenWorldPatterns[] }` (each pattern = weighted `dungeonID`). |
| `dungeons.fsdbinary` | 9.7 MB | `dungeonsLoader` | 313 layouts: `dungeonID -> rooms -> objects -> { typeID, position, entities{NPC spawns} }`. The object typeIDs ARE the asteroid/ore/salvage/structure content. |
| `systemstate.fsdbinary` | 94 KB | `systemStateLoader` | 3,371 systems: `SETTLED` (2,803) / `DEVASTATED` (568). Devastated = broken-world, content-heavy. |

**The chain:** `landscape: system -> sites (ecosystemID + position)` ; `ecosystem: ecosystemID ->
dungeonIDs` ; `dungeons: dungeonID -> object typeIDs`. So a site's `ecosystemID` determines which
dungeon layouts (and thus which ore/salvage/NPC objects) can spawn there.

### Belt/zone tags (resource-grade signal, 59 distinct)

Each belt/trojan zone carries tags usable to grade it before warping, e.g.:
`al26_low/medium/high` (Al-26 isotope richness), `cosmic_prebiotic_advanced/basic`, `cosmic_processed`,
`chemistry_carbide`, host-planet type (`gas_giant_host`, `ice_giant_host`, `super_host`,
`outer_rocky`, `inner_icy`...), `non_zero_danger_level`, `belt_hot/warm/cold`.

### Ecosystems (20)

Named biomes split Natural (mining: Garden/Grove/Shale/Stone/Ancient Cluster) vs Broken (salvage:
Abandoned Foundry/Derelict Quarry/Derelict Bay/Vestiges/Ruins) vs Trade Hub vs Starter (creche/colony/
armory/supply). Each holds weighted `naturalWorldPatterns`/`brokenWorldPatterns` of dungeonIDs.

## What resources spawn at sites

Resolving dungeon object typeIDs against `types/groups/categories`:
- **Mineable ore nodes** (Asteroid category): Char, Dewdrop, Comet, Ingot, Ember, Soot, Slag, Glint,
  Feldspar Crystals, **Deep-Core Carbon Ore**, **Crude Matter** (Rough/Fine x Old/Young), **Hermetite**
  (Crystallizing/Stale/Sediment Core).
- **Salvage nodes**: Salvageable Wreckage, Salvageable Cargo Debris, Crystalline Refuse, Industrial
  Waste, Debris; `Hauler Wrecks` group; `Floating Container`.
- **Named asteroid-field site types** (the warp-in beacon name = theme): Metal-Rich Cluster, Platinum
  Mass Cluster, Hydrosulphide Formation, Heavy Metal Harvest Field, Enhanced Extraction Zone, Carbon
  Rock Debris Field, Pulverized Asteroid Cluster, Abandoned Mining Operation.
- **`Invisible Locator Beacon - Resource Spawner`** (x963 across layouts) -- marks where ore actually
  spawns at runtime.
- The bulk of objects (~53k, Celestial cosmetics: `As_Debris_*`, kitbash panels, "carbon conduit"
  non-interactables) are scenery, not loot.

## Build-queue raw materials -> site mapping (the key result)

`useBlueprintData.findRawMaterials` yields **33** raw leaf inputs today. Site-source mapping is **three
tiers** (verified against `dungeons.fsdbinary` + `typematerials.fsdbinary`):

- **Tier 1 -- mineable nodes (18/33, fully mappable):**
  - 9 asteroid ores: Crude Matter x4 (`Rift` group, **exact typeId match** in sites:
    77729/78434/92394/92414), Platinum-Palladium Matrix (`Slag Ores`), Hydrated Sulfide Matrix
    (`Comet Ores`), Iridosmine Nodules (`Ingot Ores`), Primitive Kerogen Matrix (`Ember Ores`),
    Tholin Nodules (`Soot Ores`). Non-crude ores map via the "X Ores" group -> "X" parent asteroid hop.
  - 9 salvage: Salvaged Materials, Cinderwrack, Cargo Debris, Industrial Waste, Crystalline Refuse,
    Debris, Propulsion Component A, Contaminated Neuron, Mummified Clone -> wreck / Broken-World sites.
- **Tier 2 -- NPC combat drops (5 rogue-drone components: Gravionite, Luminalis, Eclipsite, Radiantium,
  Catalytic Dust):** NOT mineable nodes. The rogue-drone NPCs DO spawn in sites (29 distinct
  `npcGroupingID`s, 264 spawns across the 313 dungeons), so the SITE TYPE is identifiable -- but there
  is **no drop table in static data**, so static data cannot attribute "drone X drops Gravionite."
  Exception: **Radiantium (83894)** refines from a site object (Unrefined Radiantium 87595).
- **Tier 3 -- not landscape-sourced (10 "Stack Slice" commodities):** absent from site/dungeon data
  entirely. Different loot source (likely hacking/data sites). Out of scope for landscape sourcing.

Practical implication: a "nearest sites for the raws this build needs" feature can fully serve Tier 1,
honestly label Tier 2 ("found in sites with rogue drones"), and exclude Tier 3 -- it is a **"where to
look" recommender** (types + biome grade + proximity), NOT a yield calculator.

## NPC / dormant gate network (related finding)

- `starmapcache.pickle` -> `jumps` (3,536 edges, `jumpType` 0:2185 / 1:1351) is the fixed inter-system
  **NPC gate network**. `solarSystems` entries have `center`, `neighbours`, `factionID`, `sunTypeID`.
- **Dormant gates** = type group **4081 "Disrupted Gate"** (33 types, tiered Border/Region/
  Constellation/System) -- the repairable NPC gates, in the catalog. Player gates = group 4850
  (84955 Heavy, 88086 Mini). Relevant gate/fuel dogma attributes exist (`jumpGateRange` 5710,
  `jumpGateCostPerBlock` 5711, `gateMaxJumpMass` 2798, `fuelCapacity` 5633, `warpFuelRate` 5640).
- A specific gate's live **fuel level / dormant-vs-repaired status is runtime/server state** -- not in
  static data or chain. Static data gives topology + catalog + cost params only.

## How to extract (toolchain)

Same pattern as `scripts/extract_game_data.py` / `extract_static_data.py`:
- `py -3.12` (matches client `python312.dll`); `sys.path.insert(0, stillness/bin64)`.
- Resolve resfile hashes dynamically from `stillness/resfileindex.txt` (path-hash prefix is stable
  across builds; only the content-md5 suffix changes -- look up `res:/staticdata/<name>.fsdbinary`).
- `importlib.import_module("<camelCase>Loader").load(<resfile path>)`; decode cfsd dicts/lists
  recursively; resolve `*NameID` ints via `localization_fsd_en-us.pickle`.
- Plan 40 Phase 1 proposes a new `scripts/extract_landscape.py` emitting `system_resources.json` +
  `material_sources.json` to `apps/periscope/public/data/`.

See also: `client-data-extraction.md`, `chain-events-reference.md`, `world-contracts-reference.md`,
and the `eve-frontier-local-paths` memory.
