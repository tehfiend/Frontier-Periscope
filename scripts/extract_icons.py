#!/usr/bin/env python3
"""
Extract item icons from the EVE Frontier game client and CCP CDN.

Three icon sources:
  1. iconID -> FSD path mapping (iconids.fsdbinary) -> res:/ texture icons
     Covers items, resources, materials, components, weapons, ammo, modules
  2. graphicID -> model render icons (resfileindex.txt) -> 3D model previews
     Covers ships, deployables, structures (64/128/512px, with no-background variants)
  3. CCP CDN -- https://artifacts.evefrontier.com/types/{typeId}.png
     (~36 deployables/fuels have CDN icons as of Cycle 6)

Usage:
  py scripts/extract_icons.py [--game-root "C:/CCP/EVE Frontier"] [--server stillness]
                              [--output apps/periscope/public/icons]
                              [--sizes 64,128,512] [--no-background]
                              [--cdn] [--manifest]
"""

import argparse
import importlib
import json
import re
import shutil
import struct
import sys
import urllib.request
from pathlib import Path

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
TYPES_JSON = PROJECT_ROOT / "apps/periscope/public/data/types.json"
DEFAULT_GAME_ROOT = Path("C:/CCP/EVE Frontier")
WORLD_API_TEMPLATE = "https://world-api-{server}.live.tech.evefrontier.com/v2/types"

# Res paths for the game's generic "?" placeholder icon. iconIDs resolving here are treated as
# "no icon" so items fall through to their render/CDN instead of showing a placeholder.
PLACEHOLDER_ICON_PATHS = {"res:/ui/texture/icons/9_64_10.png"}

# Manual overrides: typeID -> res:/ path for items where the iconIDsLoader still
# resolves to a wrong/legacy iconID. CCP assigned legacy EVE iconIDs to these
# Frontier materials even though Frontier-specific artwork exists; the loader
# returns the legacy path verbatim, so these overrides bypass the iconID lookup
# entirely. Checked first in extract_iconid_icons, so they take precedence over
# both the loader mapping and the byte-scan fallback.
#
# NOTE: All former module/fuel/ammo/frame overrides were removed because the
# game's iconIDsLoader.pyd now resolves them to the exact same Frontier paths
# (verified individually against the loader output, 2026-06). Only the three
# material entries below still need a manual override.
ICON_OVERRIDES = {
    88234: "res:/ui/texture/icons/frontier/materials/sulfides.png",         # Troilite Sulfide Grains
    88235: "res:/ui/texture/icons/frontier/materials/feldspar.png",         # Feldspar Crystal Shards
    89259: "res:/ui/texture/icons/frontier/materials/feldspar.png",         # Silica Grains
}


def load_types(extra_type_ids=None):
    """Load types.json and return published items plus any extra typeIDs."""
    with open(TYPES_JSON, encoding="utf-8") as f:
        data = json.load(f)

    extra = set(extra_type_ids or [])
    items = {}
    for key, val in data.items():
        tid = val["typeID"]
        if val.get("published") == 1 or tid in extra:
            items[tid] = {
                "typeID": tid,
                "name": val.get("typeNameID", f"Type_{tid}"),
                "graphicID": val.get("graphicID"),
                "iconID": val.get("iconID"),
                "groupID": val.get("groupID"),
            }
    return items


def build_resfile_lookup(game_root, server):
    """Build a case-insensitive res:/ path -> ResFile path lookup from resfileindex.txt."""
    index_path = game_root / server / "resfileindex.txt"
    resfiles_dir = game_root / "ResFiles"

    lookup = {}
    with open(index_path) as f:
        for line in f:
            parts = line.strip().split(",")
            if len(parts) < 3:
                continue
            res_path = parts[0]
            bucket_hash = parts[1]
            resfile_abs = resfiles_dir / bucket_hash
            lookup[res_path.lower()] = str(resfile_abs)

    return lookup


def decode_iconids_via_loader(game_root, server):
    """Decode iconids.fsdbinary with the game's own iconIDsLoader.pyd.

    Returns {int(iconID): iconFile_str} -- the EXACT iconID -> res:/ path mapping
    the client uses. This is the PRIMARY iconID resolution source; the regex
    byte-scan (parse_iconids_fsd + map_iconids_to_paths) is kept only as a
    fallback for any iconIDs the loader does not provide.

    Mirrors the loader pattern in extract_game_data.py. Requires py -3.12 to match
    the client's python312.dll. On any failure, returns {} so the caller falls
    back to the byte-scan.
    """
    bin64 = game_root / server / "bin64"
    if not bin64.is_dir():
        print(f"  WARNING: bin64 not found ({bin64}); skipping loader")
        return {}
    if str(bin64) not in sys.path:
        sys.path.insert(0, str(bin64))

    # Resolve the iconids.fsdbinary storage path from resfileindex.txt:
    #   res:/staticdata/iconids.fsdbinary,<storage>,...  -> ResFiles/<storage>
    index_path = game_root / server / "resfileindex.txt"
    storage = None
    try:
        with open(index_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.lower().startswith("res:/staticdata/iconids.fsdbinary"):
                    parts = line.strip().split(",")
                    if len(parts) >= 2:
                        storage = parts[1]
                    break
    except OSError as e:
        print(f"  WARNING: could not read {index_path}: {e}")
        return {}

    if not storage:
        print("  WARNING: iconids.fsdbinary entry not found in resfileindex.txt")
        return {}

    full_path = game_root / "ResFiles" / storage
    if not full_path.exists():
        print(f"  WARNING: iconids storage file not found ({full_path})")
        return {}

    try:
        loader = importlib.import_module("iconIDsLoader")
        raw = loader.load(str(full_path))
    except Exception as e:
        print(f"  WARNING: iconIDsLoader failed ({type(e).__name__}: {e}); "
              "using byte-scan only")
        return {}

    mapping = {}
    for icon_id, record in raw.items():
        try:
            icon_file = record["iconFile"]
        except Exception:
            icon_file = getattr(record, "iconFile", None)
        if icon_file:
            mapping[int(icon_id)] = str(icon_file)

    return mapping


def parse_iconids_fsd(game_root, server, resfile_lookup):
    """Parse iconids.fsdbinary to build iconID -> ResFile path mapping."""
    index_path = game_root / server / "resfileindex.txt"
    resfiles_dir = game_root / "ResFiles"

    # Find the iconids.fsdbinary entry
    iconids_resfile = None
    with open(index_path) as f:
        for line in f:
            if "iconids.fsdbinary" in line.lower():
                parts = line.strip().split(",")
                iconids_resfile = resfiles_dir / parts[1]
                break

    if not iconids_resfile or not iconids_resfile.exists():
        print("  WARNING: iconids.fsdbinary not found")
        return {}

    with open(iconids_resfile, "rb") as f:
        data = f.read()

    # Extract all res:/ paths from the binary
    all_paths = []
    for m in re.finditer(rb'res:/[^\x00]+', data):
        all_paths.append((m.start(), m.group().decode("ascii", errors="replace").rstrip()))

    # For each iconID, find its entry in the binary and map to nearest res:/ path
    # We'll search for each iconID value (as u32 or u64 little-endian) and find
    # the nearest subsequent res:/ path string
    return data, all_paths


def map_iconids_to_paths(items, fsd_data, fsd_paths):
    """Map each iconID used by published items to its icon res:/ path."""
    icon_ids = set()
    for v in items.values():
        if v.get("iconID") is not None and v["iconID"] != 0:
            icon_ids.add(v["iconID"])

    # The FSD binary has an index region at the start (packed integer keys)
    # followed by a data region containing the actual key-value records with
    # res:/ path strings. Searching from offset 0 causes false positives when
    # an iconID's byte pattern appears in the index. Start from the data region
    # (first res:/ string offset) to find the correct record.
    data_region_start = fsd_data.find(b"res:/")
    if data_region_start == -1:
        return {}

    icon_to_respath = {}
    for iid in sorted(icon_ids):
        packed = struct.pack("<I", iid)

        # Search ALL occurrences of the iconID bytes in the data region.
        # Small iconID values (< 30000) have frequent false positives because
        # their byte patterns appear as string lengths, offsets, etc. in other
        # records. We scan every occurrence and prefer any that has a Frontier
        # path within 350 bytes.
        best_path = None
        pos = data_region_start
        while True:
            pos = fsd_data.find(packed, pos)
            if pos == -1:
                break

            search_region = fsd_data[pos:pos + 350]
            all_paths = [
                m.group().decode("ascii", errors="replace").rstrip()
                for m in re.finditer(rb'res:/[^\x00]+', search_region)
            ]

            frontier_paths = [p for p in all_paths if "frontier" in p.lower()]
            if frontier_paths:
                best_path = frontier_paths[0]
                break  # Frontier path found, no need to keep searching
            elif best_path is None and all_paths:
                best_path = all_paths[0]  # Keep first legacy path as fallback

            pos += 1

        if best_path:
            icon_to_respath[iid] = best_path

    return icon_to_respath


def parse_graphicid_icons(game_root, server):
    """Parse resfileindex.txt for graphicID-based model render icons."""
    index_path = game_root / server / "resfileindex.txt"
    resfiles_dir = game_root / "ResFiles"

    icon_map = {}

    with open(index_path) as f:
        for line in f:
            line = line.strip()
            if "/icons/" not in line:
                continue

            parts = line.split(",")
            if len(parts) < 3:
                continue

            res_path = parts[0]
            bucket_hash = parts[1]
            filename = res_path.split("/")[-1]

            # Only match graphicID_size pattern (e.g. 28033_128.png)
            segments = filename.replace(".png", "").replace(".jpg", "").split("_")
            if len(segments) < 2:
                continue

            try:
                graphic_id = int(segments[0])
                size = int(segments[1])
            except ValueError:
                continue

            no_bg = "no_background" in filename
            ext = filename.rsplit(".", 1)[-1]

            # Skip blueprint/tech/faction variants
            if any(
                v in filename
                for v in [
                    "_bp.", "_bp_", "_bpc.", "_bpc_",
                    "_t2.", "_t2_", "_abyssal.", "_abyssal_",
                    "_struct.", "_struct_", "_faction.", "_faction_",
                    "_limited.", "_limited_",
                ]
            ):
                continue

            resfile_abs = resfiles_dir / bucket_hash
            if not resfile_abs.exists():
                continue

            if graphic_id not in icon_map:
                icon_map[graphic_id] = []

            icon_map[graphic_id].append({
                "size": size,
                "ext": ext,
                "no_bg": no_bg,
                "source": str(resfile_abs),
            })

    return icon_map


def extract_iconid_icons(items, icon_to_respath, resfile_lookup, output_dir):
    """Extract icons using the iconID -> FSD path -> ResFile chain."""
    extracted = {}
    missing = []

    for type_id, item in sorted(items.items(), key=lambda x: x[1]["name"]):
        iid = item.get("iconID")
        if iid is None or iid == 0:
            continue

        # Check for manual override first (wrong FSD mappings)
        res_path = ICON_OVERRIDES.get(type_id) or icon_to_respath.get(iid)
        if not res_path:
            missing.append((type_id, item["name"], iid))
            continue

        # Look up the resfile for this path (case-insensitive)
        resfile = resfile_lookup.get(res_path.lower())
        if not resfile or not Path(resfile).exists():
            missing.append((type_id, item["name"], iid))
            continue

        # Determine extension from the res path
        ext = res_path.rsplit(".", 1)[-1] if "." in res_path else "png"
        out_name = f"{type_id}.{ext}"
        out_path = output_dir / "items" / out_name

        out_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(resfile, str(out_path))

        if type_id not in extracted:
            extracted[type_id] = {
                "name": item["name"],
                "iconID": iid,
                "icons": {},
            }
        extracted[type_id]["icons"]["item"] = str(out_path.relative_to(output_dir)).replace("\\", "/")

    return extracted, missing


def extract_graphicid_icons(items, icon_map, output_dir, sizes, include_no_bg):
    """Extract 3D model render icons using graphicID."""
    extracted = {}
    missing_gids = set()

    for type_id, item in sorted(items.items(), key=lambda x: x[1]["name"]):
        gid = item.get("graphicID")
        if gid is None:
            continue

        if gid not in icon_map:
            missing_gids.add(gid)
            continue

        icons = icon_map[gid]
        item_extracted = {}

        for icon in icons:
            if icon["size"] not in sizes:
                continue
            if icon["no_bg"] and not include_no_bg:
                continue

            suffix = "_nobg" if icon["no_bg"] else ""
            out_name = f"{type_id}_{icon['size']}{suffix}.{icon['ext']}"
            out_path = output_dir / "renders" / out_name

            out_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(icon["source"], str(out_path))

            key = f"{icon['size']}{suffix}"
            item_extracted[key] = str(out_path.relative_to(output_dir)).replace("\\", "/")

        if item_extracted:
            extracted[type_id] = {
                "name": item["name"],
                "graphicID": gid,
                "icons": item_extracted,
            }

    return extracted, missing_gids


def fetch_cdn_icons(output_dir, server="stillness"):
    """Fetch icon URLs from the World API and download from CDN.

    If the World API is unreachable (e.g. offline / DNS failure), fall back to the
    CDN icons already present in output_dir/cdn so a previously extracted CDN set
    is preserved instead of being dropped from the manifest.
    """
    print("\nFetching World API for CDN icon URLs...")
    base_url = WORLD_API_TEMPLATE.format(server=server)
    items = []
    page = 1
    page_size = 500
    while True:
        url = f"{base_url}?page={page}&pageSize={page_size}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "periscope-icon-extractor/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"  WARNING: Could not fetch World API page {page}: {e}")
            break
        page_items = data.get("data", []) if isinstance(data, dict) else data
        items.extend(page_items)
        total = data.get("meta", {}).get("total") if isinstance(data, dict) else None
        if len(page_items) < page_size or (total is not None and len(items) >= total):
            break
        page += 1

    print(f"  World API returned {len(items)} types")
    cdn_map = {}

    for item in items:
        url = item.get("iconUrl", "")
        if not url:
            continue

        type_id = item["id"]
        name = item["name"]
        out_path = output_dir / "cdn" / f"{type_id}.png"

        if out_path.exists():
            print(f"  SKIP (exists): {name} ({type_id})")
            cdn_map[type_id] = str(out_path.relative_to(output_dir)).replace("\\", "/")
            continue

        try:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(url, str(out_path))
            size = out_path.stat().st_size
            print(f"  OK: {name} ({type_id}) -- {size:,} bytes")
            cdn_map[type_id] = str(out_path.relative_to(output_dir)).replace("\\", "/")
        except Exception as e:
            print(f"  FAIL: {name} ({type_id}) -- {e}")

    # Fallback: if the World API gave us nothing (e.g. the host is unreachable),
    # reuse any CDN icons already extracted to disk so we don't silently drop them.
    if not cdn_map:
        cdn_dir = output_dir / "cdn"
        if cdn_dir.is_dir():
            for png in sorted(cdn_dir.glob("*.png")):
                try:
                    type_id = int(png.stem)
                except ValueError:
                    continue
                cdn_map[type_id] = f"cdn/{png.name}"
            if cdn_map:
                print(f"  World API unreachable; reused {len(cdn_map)} CDN icons "
                      f"already present in {cdn_dir}")

    return cdn_map


def main():
    parser = argparse.ArgumentParser(description="Extract EVE Frontier item icons")
    parser.add_argument("--game-root", type=Path, default=DEFAULT_GAME_ROOT,
                        help="EVE Frontier installation directory")
    parser.add_argument("--server", default="stillness",
                        help="Server name (stillness or utopia)")
    parser.add_argument("--output", type=Path,
                        default=PROJECT_ROOT / "apps/periscope/public/icons",
                        help="Output directory for extracted icons")
    parser.add_argument("--sizes", default="64,128",
                        help="Comma-separated render icon sizes to extract (64, 128, 512)")
    parser.add_argument("--no-background", action="store_true",
                        help="Also extract no-background render variants")
    parser.add_argument("--cdn", action="store_true",
                        help="Also download icons from CCP CDN")
    parser.add_argument("--manifest", action="store_true",
                        help="Write manifest.json mapping typeID -> icon paths")
    parser.add_argument("--include-types", type=Path, default=SCRIPT_DIR / "extra_type_ids.json",
                        help="JSON file with extra typeIDs to include (array of ints or {id: name}). "
                             "Defaults to scripts/extra_type_ids.json; pass a different path to override.")
    args = parser.parse_args()

    sizes = {int(s) for s in args.sizes.split(",")}
    output_dir = args.output.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    game_root = args.game_root
    server = args.server

    # Load extra typeIDs if provided
    extra_type_ids = set()
    if args.include_types and args.include_types.exists():
        with open(args.include_types, encoding="utf-8") as f:
            extra_data = json.load(f)
        if isinstance(extra_data, list):
            extra_type_ids = {int(x) for x in extra_data}
        elif isinstance(extra_data, dict):
            extra_type_ids = {int(k) for k in extra_data.keys()}
        print(f"Extra typeIDs: {len(extra_type_ids)} from {args.include_types}")

    print(f"Game root:  {game_root}")
    print(f"Server:     {server}")
    print(f"Output:     {output_dir}")
    print(f"Sizes:      {sorted(sizes)}")
    print(f"No-bg:      {args.no_background}")
    print(f"CDN:        {args.cdn}")
    print()

    # Load types
    items = load_types(extra_type_ids)
    print(f"Published items: {len(items)}")

    # Build resfile lookup (case-insensitive res:/ path -> local file)
    print("Building resfile lookup...")
    resfile_lookup = build_resfile_lookup(game_root, server)
    print(f"Resfile entries: {len(resfile_lookup)}")

    # --- Source 1: iconID -> FSD path -> item/resource icons ---
    # Primary: decode iconids.fsdbinary with the game's own loader (exact mapping).
    print("\nDecoding iconids.fsdbinary via iconIDsLoader (primary)...")
    loader_map = decode_iconids_via_loader(game_root, server)
    print(f"Loader iconID mappings: {len(loader_map)}")

    # Fallback: regex byte-scan, used only for iconIDs the loader does not provide.
    print("Parsing iconids.fsdbinary (byte-scan fallback)...")
    fsd_data, fsd_paths = parse_iconids_fsd(game_root, server, resfile_lookup)
    byte_scan_map = map_iconids_to_paths(items, fsd_data, fsd_paths)
    print(f"Byte-scan iconID mappings: {len(byte_scan_map)}")

    # Merge: byte-scan first, then loader overwrites -> loader takes precedence,
    # byte-scan survives only for iconIDs the loader lacks.
    icon_to_respath = dict(byte_scan_map)
    icon_to_respath.update(loader_map)
    fallback_only = set(byte_scan_map) - set(loader_map)
    print(f"iconID -> path mappings: {len(icon_to_respath)} "
          f"({len(loader_map)} loader, {len(fallback_only)} byte-scan fallback)")

    # Some iconIDs resolve to the game's generic "?" placeholder texture (e.g. iconID 1001 ->
    # res:/ui/texture/icons/9_64_10.png, used by the Network Node structure). A placeholder counts
    # as a real item icon and would suppress the render fallback, leaving a "?" in the UI. Drop those
    # paths so affected items fall through to their 3D render (or CDN) instead.
    dropped_placeholders = {k for k, v in icon_to_respath.items() if str(v).lower() in PLACEHOLDER_ICON_PATHS}
    for k in dropped_placeholders:
        del icon_to_respath[k]
    if dropped_placeholders:
        print(f"Dropped {len(dropped_placeholders)} placeholder iconID(s): {sorted(dropped_placeholders)}")

    print("\nExtracting item icons (iconID)...")
    item_extracted, item_missing = extract_iconid_icons(items, icon_to_respath, resfile_lookup, output_dir)
    print(f"Extracted: {len(item_extracted)} items")
    if item_missing:
        print(f"Missing: {len(item_missing)} items (no iconID path or resfile)")

    # --- Source 2: graphicID -> model render icons ---
    print("\nParsing graphicID render icons...")
    graphic_icon_map = parse_graphicid_icons(game_root, server)
    print(f"GraphicIDs with renders: {len(graphic_icon_map)}")

    print("\nExtracting render icons (graphicID)...")
    render_extracted, missing_gids = extract_graphicid_icons(
        items, graphic_icon_map, output_dir, sizes, args.no_background
    )
    print(f"Extracted: {len(render_extracted)} items")
    if missing_gids:
        print(f"Missing graphicIDs: {len(missing_gids)}")

    # --- Source 3: CDN icons ---
    cdn_map = {}
    if args.cdn:
        cdn_map = fetch_cdn_icons(output_dir, server)
        print(f"CDN icons downloaded: {len(cdn_map)}")

    # --- Fallback: items with renders but no item icon get a copy in items/ ---
    render_fallback_count = 0
    for type_id, info in render_extracted.items():
        if type_id in item_extracted:
            continue  # already has an item icon

        # Pick best render: prefer 128px no-bg, then 128px, then 64px no-bg, then 64px
        source_key = None
        for candidate in ["128_nobg", "128", "64_nobg", "64"]:
            if candidate in info["icons"]:
                source_key = candidate
                break

        if not source_key:
            continue

        source_rel = info["icons"][source_key]
        source_abs = output_dir / source_rel
        if not source_abs.exists():
            continue

        ext = source_rel.rsplit(".", 1)[-1]
        out_path = output_dir / "items" / f"{type_id}.{ext}"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(source_abs), str(out_path))

        item_extracted[type_id] = {
            "name": info["name"],
            "iconID": None,
            "icons": {"item": str(out_path.relative_to(output_dir)).replace("\\", "/")},
        }
        render_fallback_count += 1

    if render_fallback_count:
        print(f"\nRender fallback: {render_fallback_count} items copied render -> items/")

    # --- Write manifest ---
    if args.manifest:
        manifest = {}

        # Item icons (iconID-based + render fallbacks) -- primary source for inventory items
        for type_id, info in item_extracted.items():
            manifest[str(type_id)] = {
                "name": info["name"],
                "icons": info["icons"].copy(),
            }

        # Render icons (graphicID-based) -- merge into existing entries
        for type_id, info in render_extracted.items():
            key = str(type_id)
            if key in manifest:
                manifest[key]["icons"].update(info["icons"])
            else:
                manifest[key] = {
                    "name": info["name"],
                    "icons": info["icons"].copy(),
                }

        # CDN icons -- merge, and use as item fallback if no item icon exists
        for type_id, rel_path in cdn_map.items():
            key = str(type_id)
            if key in manifest:
                manifest[key]["icons"]["cdn"] = rel_path
            else:
                name = next((i["name"] for i in items.values() if i["typeID"] == type_id), f"Type_{type_id}")
                manifest[key] = {
                    "name": name,
                    "icons": {"cdn": rel_path},
                }

            # CDN fallback: copy CDN icon as item icon if none exists
            if "item" not in manifest[key]["icons"]:
                cdn_abs = output_dir / rel_path
                if cdn_abs.exists():
                    out_path = output_dir / "items" / f"{type_id}.png"
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(str(cdn_abs), str(out_path))
                    manifest[key]["icons"]["item"] = f"items/{type_id}.png"

        manifest_path = output_dir / "manifest.json"
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        print(f"\nManifest written: {manifest_path} ({len(manifest)} items)")

    # --- Summary ---
    all_covered = set(item_extracted.keys()) | set(render_extracted.keys()) | set(cdn_map.keys())
    item_files = sum(len(info["icons"]) for info in item_extracted.values())
    render_files = sum(len(info["icons"]) for info in render_extracted.values())
    print(f"\n--- Summary ---")
    print(f"Item icons (iconID):      {len(item_extracted):4d} items, {item_files:4d} files")
    print(f"Render icons (graphicID): {len(render_extracted):4d} items, {render_files:4d} files")
    print(f"CDN icons:                {len(cdn_map):4d} items, {len(cdn_map):4d} files")
    print(f"Total unique items:       {len(all_covered):4d} / {len(items)}")
    print(f"Items with no icons:      {len(items) - len(all_covered):4d}")


if __name__ == "__main__":
    main()
