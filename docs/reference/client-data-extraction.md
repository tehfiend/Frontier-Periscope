# Client Data Extraction Reference

**Last Updated:** 2026-04-06
**Applies to:** EVE Frontier Cycle 5 (build 3251859)

---

## Overview

Static game data and item icons are extracted from the locally installed EVE Frontier game client. This must be re-run each cycle when CCP ships a new client build, as item types, icons, and static data may change.

Two categories of data are extracted:

| Category | Script | Output | What Changes Between Cycles |
|----------|--------|--------|-----------------------------|
| Static data | `scripts/extract_static_data.py` | `apps/periscope/public/data/*.json` | New item types, groups, blueprints, celestials |
| Landscape source data | `scripts/extract_landscape.py` | `apps/periscope/public/data/{gatherable_nodes,material_sources,system_resources,extraction_meta_landscape}.json` | Site/resource ecosystem mapping, harvestable node IDs, system state |
| Item icons | `scripts/extract_icons.py` | `apps/periscope/public/icons/` | New/updated item art, CDN icon availability |

> **Cycle 6 landscape / site / resource data** (the warp-to sites filling each system, what ore/salvage
> spawns at them, and the NPC/dormant gate network) lives in additional client static files
> (`landscape`/`ecosystem`/`dungeons`/`systemstate` fsdbinary). It is client-static-only -- not on chain,
> not exposed by any API (the old REST World API host is dead). Full findings + the raw-material -> site
> mapping are in **`reference/landscape-site-data.md`**; the extractor shipped with Plan 40.

---

## Prerequisites

- EVE Frontier installed at `C:\CCP\EVE Frontier\` (default Windows path)
- Python 3.12+
- The target server's game files downloaded (launch the game on Stillness at least once)

### Game Client Directory Structure

```
C:\CCP\EVE Frontier\
  ResFiles/             # Content-addressable asset store (hex-bucketed)
    00/ 01/ ... ff/     # 256 hash buckets, each containing asset files
  stillness/            # Server-specific data
    resfileindex.txt    # Maps res:/ virtual paths -> ResFiles hash entries
    bin64/
      staticdata/
        mapObjects.db   # SQLite -- celestial coordinates
    res/                # Additional resources
  utopia/               # Test server (same structure as stillness)
  index_stillness.txt
  index_utopia.txt
```

---

## Star Map / Stellar Data Extraction

`scripts/extract_static_data.py` emits `stellar_systems.json`, `stellar_regions.json`,
`stellar_constellations.json`, `stellar_jumps.json`, and `stellar_labels.json` from
`starmapcache.pickle` (topology + coords) plus name resolution.

### Solar-system names are stored INLINE in systems.static (gotcha)

Region and constellation names resolve straightforwardly: their `.static` records carry a `nameID`
(offsets 4 and 8) that indexes `localization_fsd_en-us.pickle`.

Solar systems are the trap -- there are THREE candidate name sources and only one is the real
in-game display name:

1. `systems.static` `nameID` (offset 24) -> a numeric internal code (e.g. `"30113292"`). WRONG.
2. `localization_fsd_main.pickle` `labels` `{FullPath: "Map/SolarSystems", label: "solar_system_<id>"}`
   -> a localized string (e.g. `"I.0S7.8N1"`). ALSO WRONG -- a different, non-display name set.
3. **A length-prefixed ASCII string stored inline in each `systems.static` record.** This IS the
   in-game display name (e.g. `"O3S-11J"`), verified against Local-channel travel logs.

`extract_inline_system_names()` reads source 3: `[int32 length][name bytes]` at a near-fixed offset
within each record (118 for most; shifted +/-4 in a minority -- the bytes just before hold an
unrelated short code, so candidate offsets start at 114). All 24,026 systems resolve, zero duplicates,
and every current-cycle system seen in the logs matches.

> Both wrong sources (1 and 2) were shipped in earlier passes and mis-named every system, which made
> the location search and recent-systems picker fail to resolve systems the player had actually visited.

### Coverage: 24,026 mapped systems; older-cycle names drop out

`starmapcache.pickle` and `systems.static` both cover exactly the 24,026 navigable systems
(IDs `30000001`-`30024026`). That is the full current-cycle universe -- all systems a player visits
this cycle resolve. Names seen only in OLD-cycle travel logs (`A.8H9.MN1`, `B:18A8` style) are not in
the current static data: the universe is re-cut between cycles, so those systemIds/names no longer
exist. That is expected, not a gap -- only current-cycle systems need to resolve.

---

## Landscape / Source-Site Extraction

`scripts/extract_landscape.py` mirrors the static/game-data extractor toolchain: it runs under
`py -3.12`, inserts `C:\CCP\EVE Frontier\stillness\bin64` for the client `.pyd` loaders, resolves all
`res:/staticdata/...` inputs from the live `stillness/resfileindex.txt`, decodes cfsd dict/list values,
and resolves `*NameID` fields through `localization_fsd_en-us.pickle`.

Run it after the starmap/static refresh when the client build changes:

```bash
py -3.12 scripts/extract_landscape.py
```

Outputs in `apps/periscope/public/data/`:

| File | Contents |
|------|----------|
| `gatherable_nodes.json` | Authoritative harvestable node typeId set from dungeon objects, unioned with the required byproduct-masked ore IDs `77800`, `78446`, and `78448`. |
| `material_sources.json` | Per material typeId: tier (`tier1` mineable/salvage, `tier2` rogue-drone site hint, `tier3` unknown), source label/caveat, source ecosystem IDs, and source system count. |
| `system_resources.json` | Compact per-system inverse index. Rows use bitmasks over `materialTypeIds`, `ecosystemIds`, and `tagLegend` to keep the bundle small. |
| `extraction_meta_landscape.json` | Build number, resfile provenance, counts, ore-group-hop validation, required byproduct-node status, and unmapped raws. |

The emitted indexes are aggregate "where to look" data, not per-site rows and not yield estimates.
Tier 2 rogue-drone components are intentionally caveated because no static loot/drop table exists.

---

## Icon Extraction

### How It Works

The game client stores icons using three systems, each serving different item categories:

#### Source 1: iconID -> FSD Path (Items, Resources, Materials)

This is the primary source for inventory item icons -- ores, refined materials, components, ammo, modules, fuels, and consumables.

**Chain:** `types.json[iconID]` -> `iconids.fsdbinary` -> `res:/` path -> `resfileindex.txt` -> `ResFiles/{hash}`

1. Each item type has an `iconID` field in `types.json`
2. `iconids.fsdbinary` (at `res:/staticdata/iconids.fsdbinary`) is a CCP FSD binary file that maps each integer iconID to a `res:/` virtual path
3. The `res:/` path (e.g. `res:/ui/texture/icons/Frontier/Frontier_ore1.png`) is looked up case-insensitively in `resfileindex.txt`
4. The resfileindex entry points to a content-addressable file in `ResFiles/`

**Key Frontier icon directories:**

```
res:/ui/texture/icons/Frontier/                    # Top-level item icons
res:/ui/texture/icons/Frontier/Materials/           # Refined materials (Printed Circuits, etc.)
res:/ui/texture/icons/Frontier/Components/EV/       # EV components
res:/ui/texture/icons/Frontier/Components/Synod/    # Synod components
res:/ui/texture/icons/Frontier/Weapons/Ammunition/  # Ammo icons
res:/ui/texture/icons/Frontier/Weapons/Turrets/     # Turret module icons
res:/ui/texture/icons/Frontier/Weapons/EnergyWeapons/
res:/ui/texture/icons/Frontier/KeepPixel64/         # 64px pixel-style icons
res:/ui/texture/icons/Frontier/KEEP Emergency Kit/  # Starter kit items
```

**FSD Binary Parsing:** The `iconids.fsdbinary` format is a proprietary CCP key-value store. The file has two regions: an **index region** at the start (packed integer keys used for fast lookup) and a **data region** (actual key-value records containing `res:/` path strings). The extraction script finds the data region start (first `res:/` occurrence, typically around offset 24840), then searches for each iconID as a little-endian u32 within the data region only. This avoids false positives from the index region where the same byte patterns appear without associated path strings.

**Multi-path records:** Each FSD record can contain multiple `res:/` paths -- typically a legacy EVE icon path (or even a mannequin clothing texture) followed by a Frontier-specific icon path. The extraction script searches a 350-byte window after each iconID and prefers any path containing "frontier" (case-insensitive). Without this preference, items like Palladium would get a clothing texture and batched materials would get generic EVE icon sheets instead of their proper Frontier artwork.

**All-occurrence search:** Small iconID values (< 30000) have frequent false positives because their 4-byte little-endian representation appears coincidentally in other records' metadata. The script searches ALL occurrences of each iconID in the data region and picks the first one with a Frontier path, falling back to the first occurrence's path if no Frontier path is found.

**Manual overrides (`ICON_OVERRIDES`):** Some items have fundamentally wrong iconID assignments in the FSD -- their iconID maps to the wrong icon entirely, with no Frontier path at any occurrence. These require typeID-level overrides in the script that bypass the FSD lookup. Current overrides:

The `ICON_OVERRIDES` dict in the script currently has **99 entries** across these categories:

| Category | Count | Issue Pattern |
|----------|-------|---------------|
| Materials (Troilite, Feldspar, Silica) | 3 | iconID maps to wrong legacy icon entirely |
| Fuels (D1, D2) | 2 | path1 is `ML-*.png` (mining laser) |
| Afterburners (Celerity, Tempo, Velocity) | 8 | path1 is `ML-*.png` (mining laser) |
| Ammo (EM Disintegrator) | 2 | path1 is `ML-*.png` (mining laser) |
| Mining tools (Crude Extractor, Lasers, Lenses) | 8 | path1 is `Frontier_ore*.png` |
| Coilguns | 6 | path1 is `Frontier_res14.png` |
| Warp/Propulsion (Entanglers, Tuho, Xoru) | 11 | path1 is `Frontier_res*.png` |
| Shield modules | 11 | path1 is `Frontier_res*.png` |
| Field arrays (EM, Thermal, Explosive, Kinetic) | 12 | path1 is `Frontier_res7.png` |
| Stasis nets | 5 | path1 is `Frontier_res8.png` |
| Hull repair | 1 | path1 is `Frontier_res12.png` |
| Cargo grids | 5 | path1 is `Drop64_*.png` (faction icon, false hit) |
| Armor weaves/braces | 19 | path1 is `Drop64_*.png` / `Frontier_res*.png` |
| Protocol/Program frames | 6 | FSD has `kclone/khold` pixel art; correct icon is `Drop64_*` faction render |

**Three common patterns requiring overrides:**

1. **`ML-*.png` as path1** -- FSD reused mining laser iconIDs for fuels, afterburners, and ammo charges. The correct icon is path2 in `KeepPixel64/`. Affects iconIDs 2582411-2582418.

2. **`Frontier_ore*.png` / `Frontier_res*.png` as path1** -- FSD reused ore/resource iconIDs for modules and weapons. The correct icon is path2 in `KeepPixel64/`. Affects iconIDs 2582391-2582408.

3. **Protocol/Program Frames need `Drop64_*` not `KeepPixel64`** -- FSD records for frame iconIDs (25719-25726) contain both `Drop64_*` faction-specific 3D renders and `KeepPixel64/kclone*` (humanoid figures) or `khold*` (generic containers) pixel art. The Drop64 icons are correct -- they show the actual faction device. The KeepPixel64 variants are generic pixel art that doesn't represent these items. **Caution:** Drop64 paths also appear as false positives in FSD searches for unrelated items (Cargo Grids, Nanitic Braces) because their byte patterns coincidentally appear in the 350-byte search window. Only Protocol/Program Frame items (typeIDs 78415-78422) should use Drop64 icons.

   | typeID | Name | Correct Icon |
   |--------|------|-------------|
   | 78415 | Siege Protocol Frame | `Drop64_0007_siege.png` |
   | 78416 | Apocalypse Protocol Frame | `Drop64_0006_apocalypse.png` |
   | 78417 | Bastion Program Frame | `Drop64_0005_bastion.png` |
   | 78418 | Nomad Program Frame | `Drop64_0004_nomad.png` |
   | 78419 | Shadow Protocol Frame | `Drop64_0003_shadow.png` |
   | 78420 | Archangel Protocol Frame | `Drop64_0002_archangel.png` |
   | 78421 | Exterminata Protocol Frame | `Drop64_0001_exterminata.png` |
   | 78422 | Equilibrium Program Frame | `Drop64_0000_equilibrium.png` |

**How to diagnose wrong icons:** Search for the item's iconID in the FSD data, check all `res:/` paths within 350 bytes. If path1 is an ore/resource/laser icon but the item is a module/weapon/tool, path2 (usually in `KeepPixel64/`) is correct. For faction-specific items (Protocol/Program Frames), the `Drop64_*` icon is correct. Add a typeID override to `ICON_OVERRIDES`.

#### Source 2: graphicID -> Model Render Icons (Ships, Structures)

3D model preview renders at 64/128/512px, with optional no-background variants.

**Chain:** `types.json[graphicID]` -> `resfileindex.txt` (pattern match) -> `ResFiles/{hash}`

The resfileindex contains entries like:
```
res:/dx9/model/spaceobjectfactory/icons/{model_name}/{graphicID}_{size}.png
res:/dx9/model/spaceobjectfactory/icons/{model_name}/{graphicID}_{size}_no_background.png
```

Size variants: `_64.png` (64x64), `_128.png` (128x128), `_512.jpg` (512x512)

Other variant suffixes exist but are skipped: `_bp` (blueprint), `_bpc` (blueprint copy), `_t2`, `_abyssal`, `_struct`, `_faction`, `_limited`.

#### Source 3: CCP CDN (Deployable Beauty Shots)

~36 deployable structures have high-quality renders hosted on CCP's CDN.

**URL pattern:** `https://artifacts.evefrontier.com/types/{typeId}.png`

The World API (`https://world-api-stillness.live.tech.evefrontier.com/v2/types?limit=500`) returns an `iconUrl` field for items that have CDN icons. Most items return `iconUrl: ""`.

### Running the Extraction

```bash
# Full extraction: item icons + render icons (64/128px, no-bg) + CDN + manifest
py scripts/extract_icons.py --sizes 64,128 --no-background --cdn --manifest

# Include unpublished items needed by the app (Stack Slices, etc.)
py scripts/extract_icons.py --sizes 64,128 --no-background --cdn --manifest \
  --include-types scripts/extra_type_ids.json

# Include 512px JPG renders
py scripts/extract_icons.py --sizes 64,128,512 --no-background --cdn --manifest

# Use utopia server data instead
py scripts/extract_icons.py --server utopia --manifest
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--game-root` | `C:/CCP/EVE Frontier` | Game install path |
| `--server` | `stillness` | Server name (stillness, utopia) |
| `--output` | `apps/periscope/public/icons` | Output directory |
| `--sizes` | `64,128` | Render icon sizes to extract |
| `--no-background` | off | Include `_nobg` render variants |
| `--cdn` | off | Download CDN icons from World API |
| `--manifest` | off | Write manifest.json |
| `--include-types` | none | JSON file with extra typeIDs to include beyond published items |

#### Unpublished Items

Some in-game items are marked `published=0` in the FSD but still appear in gameplay (Stack Slices for ship assembly, Thermal Field Array V, Large Cutting Laser). These must be listed in `scripts/extra_type_ids.json` to be extracted. The file accepts either a JSON array of typeIDs or a `{typeId: name}` object.

### Output Structure

```
apps/periscope/public/icons/
  items/                # iconID-based item icons (ores, materials, modules, etc.)
    77800.png           # Feldspar Crystals
    77801.png           # Nickel-Iron Veins
    84180.png           # Printed Circuits
    ...
  renders/              # graphicID-based 3D model renders
    91106_128.png       # Stride (128px)
    91106_64.png        # Stride (64px)
    88063_128_nobg.png  # Refinery (128px, no background)
    ...
  cdn/                  # CCP CDN beauty shots
    88068.png           # Assembler
    84955.png           # Heavy Gate
    ...
  manifest.json         # Complete typeID -> icon path mapping
```

### manifest.json Format

```json
{
  "77801": {
    "name": "Nickel-Iron Veins",
    "icons": {
      "item": "items/77801.png"
    }
  },
  "91106": {
    "name": "Stride",
    "icons": {
      "item": "items/91106.png",
      "128": "renders/91106_128.png",
      "64": "renders/91106_64.png"
    }
  },
  "88068": {
    "name": "Assembler",
    "icons": {
      "item": "items/88068.png",
      "128": "renders/88068_128.png",
      "128_nobg": "renders/88068_128_nobg.png",
      "64": "renders/88068_64.png",
      "64_nobg": "renders/88068_64_nobg.png",
      "cdn": "cdn/88068.png"
    }
  }
}
```

**Icon priority for display:** `item` > `cdn` > `128` > `64`

### Icon Fallback Chain

Every published item (plus extras from `--include-types`) gets a single canonical icon in `items/{typeId}.png` using this priority:

1. **iconID path** (FSD) -- inventory icons for ores, materials, modules, ammo
2. **Render fallback** -- if no iconID, copy the best graphicID render (prefer 128px no-bg)
3. **CDN fallback** -- if no render, copy the CDN image

This means `items/` is the only directory the app needs to reference for a single icon per item.

### Coverage (Cycle 5, build 3251859, with extra_type_ids.json)

| Source | Items | Files | Content |
|--------|-------|-------|---------|
| `items/` (all sources) | 622 | 622 | Unified: one icon per item |
| `renders/` (graphicID) | 249 | 848 | Multi-size model renders (64/128px + no-bg) |
| `cdn/` (World API) | 36 | 36 | Deployable beauty shots |
| **Total unique** | **625 / 642** | **1,506** | |

The 17 uncovered items:
- 4 internal/debug types (CharacterLegacy14, Default Point Light, swarren, Electronic Effect Beacon)
- 4 Crude Matter types with no icon data in the client (Fine Old/Young, Rough Old/Young)
- 9 items with graphicIDs that have zero assets in the client (NPC ships, floating containers, turret duplicates) -- likely rendered at runtime

---

## Cycle Update Checklist

When a new cycle launches with updated game client:

1. **Launch the game** on Stillness to download the new client files
2. **Re-run static data extraction** (if `extract_static_data.py` exists):
   ```bash
   py scripts/extract_static_data.py
   ```
3. **Re-run landscape/source-site extraction**:
   ```bash
   py -3.12 scripts/extract_landscape.py
   ```
4. **Delete old icons** and re-run icon extraction:
   ```bash
   rm -rf apps/periscope/public/icons/items
   rm -rf apps/periscope/public/icons/renders
   rm -rf apps/periscope/public/icons/cdn
   py scripts/extract_icons.py --sizes 64,128 --no-background --cdn --manifest \
     --include-types scripts/extra_type_ids.json
   ```
5. **Verify coverage** -- check the summary output. If new items are missing:
   - New iconIDs may need the FSD parsing heuristic adjusted
   - New graphicIDs just need a fresh resfileindex parse (automatic)
   - Check if more items now have CDN `iconUrl` values
6. **Diff the manifest** to see what changed:
   ```bash
   git diff apps/periscope/public/icons/manifest.json
   ```
7. **Commit** the updated icons and manifest

### What Can Break Between Cycles

- **FSD binary format change** -- CCP could restructure `iconids.fsdbinary`. The current parser uses a heuristic (find iconID as u32 in the data region, scan 350 bytes for `res:/` strings, prefer Frontier paths). If CCP changes the record layout, the parser may return wrong paths. Verify by spot-checking items with known Frontier icons (e.g. Palladium 99001 -> `Frontier/materials/palladium_refined_01.png`, Batched Carbon Weave 88841 -> `Frontier/Materials/Batched_carbon_nanothread.png`, Iron-Rich Nodules 89260 -> `23_64_13.png`). Wrong icons typically manifest as legacy EVE art, mannequin clothing textures, or mutaplasmid module icons.
- **New icon directory structure** -- New `res:/ui/texture/icons/Frontier/` subdirectories may appear. These are handled automatically as long as they follow the existing `resfileindex.txt` pattern.
- **CDN URL pattern change** -- The `artifacts.evefrontier.com` domain or path structure could change. The script fetches URLs from the World API so this is self-correcting as long as the API endpoint remains stable.
- **ResFiles hash format** -- The content-addressable format (`{bucket}/{hash}_{hash}`) has been stable across all observed builds.

---

## Technical Details

### resfileindex.txt Format

Each line: `{res_path},{bucket/hash_hash},{md5},{size_on_disk},{original_size}`

```
res:/ui/texture/icons/frontier/frontier_ore1.png,26/265a4accd40234aa_6881...,6881...,10047,9864
```

- `res_path` -- virtual path used by the game engine (case-insensitive)
- `bucket/hash_hash` -- path within `ResFiles/` directory
- `md5` -- content hash for integrity verification
- `size_on_disk` -- size of the file in ResFiles (may be compressed)
- `original_size` -- decompressed size

### Content-Addressable Storage (ResFiles)

Files are stored in 256 hex-bucketed directories (`00/` through `ff/`). The first two hex characters of the hash determine the bucket. Files are stored as-is (not compressed for images) and can be copied directly.

### iconids.fsdbinary Structure

- **Offset 0-15:** 16-byte schema hash (e.g. `e62746ff0dc540cc73e06fca63926f29`)
- **Offset 16+:** Metadata and index region (packed integer keys for fast lookup)
- **~Offset 24840+:** Data region -- interleaved integer keys (iconIDs) and `res:/` path strings
- **Total entries:** ~3,953 icon paths (Cycle 5)
- **Published item coverage:** 124 unique iconIDs map to paths used by 391 published items (many items share the same iconID)

**Important:** The index region contains the same iconID integer values as the data region but without associated path strings. The parser must search starting from the data region (first `res:/` occurrence) to avoid false matches in the index.
