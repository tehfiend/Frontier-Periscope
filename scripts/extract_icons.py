#!/usr/bin/env python3
"""
Extract item icons from the EVE Frontier game client and CCP CDN.

Three icon sources:
  1. iconID -> FSD path mapping (iconids.fsdbinary) -> res:/ texture icons
     Covers items, resources, materials, components, weapons, ammo, modules
  2. graphicID -> model render icons (resfileindex.txt) -> 3D model previews
     Covers ships, deployables, structures (64/128/512px, with no-background variants)
  3. CCP CDN -- https://artifacts.evefrontier.com/types/{typeId}.png
     (~36 deployables/fuels have CDN icons as of Cycle 5)

Usage:
  py scripts/extract_icons.py [--game-root "C:/CCP/EVE Frontier"] [--server stillness]
                              [--output apps/periscope/public/icons]
                              [--sizes 64,128,512] [--no-background]
                              [--cdn] [--manifest]
"""

import argparse
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

# Manual overrides: typeID -> res:/ path for items where the FSD has wrong iconID mappings.
# CCP sometimes assigns legacy EVE iconIDs to Frontier items even though Frontier-specific
# artwork exists under different iconIDs. These overrides bypass the FSD lookup entirely.
ICON_OVERRIDES = {
    # Materials with wrong FSD iconID mappings
    88234: "res:/ui/texture/icons/frontier/materials/sulfides.png",         # Troilite Sulfide Grains
    88235: "res:/ui/texture/icons/frontier/materials/feldspar.png",         # Feldspar Crystal Shards
    89259: "res:/ui/texture/icons/frontier/materials/feldspar.png",         # Silica Grains
    # Fuels: FSD path1 is ML-*.png (mining laser), path2 is the correct fuel icon
    88319: "res:/ui/texture/icons/Frontier/KeepPixel64/D2.png",            # D2 Fuel
    88335: "res:/ui/texture/icons/Frontier/KeepPixel64/D1.png",            # D1 Fuel
    # Afterburners: FSD path1 is ML-*.png, path2 is the correct engine icon
    78506: "res:/ui/texture/icons/Frontier/KeepPixel64/kengine2.png",      # Celerity CD01
    78507: "res:/ui/texture/icons/Frontier/KeepPixel64/kengine2.png",      # Celerity CD02
    78508: "res:/ui/texture/icons/Frontier/KeepPixel64/kengine2.png",      # Celerity CD03
    78504: "res:/ui/texture/icons/Frontier/KeepPixel64/kengine3.png",      # Tempo CD43
    78510: "res:/ui/texture/icons/Frontier/KeepPixel64/kengine3.png",      # Tempo CD42
    78511: "res:/ui/texture/icons/Frontier/KeepPixel64/kengine3.png",      # Tempo CD41
    78490: "res:/ui/texture/icons/Frontier/KeepPixel64/kengine4.png",      # Velocity CD81
    78502: "res:/ui/texture/icons/Frontier/KeepPixel64/kengine4.png",      # Velocity CD82
    # Ammo charges: FSD path1 is ML-*.png, path2 is the correct charge icon
    81658: "res:/ui/texture/icons/Frontier/KeepPixel64/p12.png",           # EM Disintegrator Charge (S)
    82137: "res:/ui/texture/icons/Frontier/KeepPixel64/p12.png",           # EM Disintegrator Charge (M)
    # Modules with ore/resource icons: FSD path1 is Frontier_ore/res*.png, path2 is correct
    # -- Mining tools --
    77484: "res:/ui/texture/icons/Frontier/KeepPixel64/miner1.png",        # Crude Extractor
    77852: "res:/ui/texture/icons/Frontier/KeepPixel64/miner3.png",        # Small Cutting Laser
    83525: "res:/ui/texture/icons/Frontier/KeepPixel64/miner2.png",        # Purified Moon Cutting Laser
    83463: "res:/ui/texture/icons/Frontier/KeepPixel64/lens1.png",         # Synthetic Mining Lens
    83895: "res:/ui/texture/icons/Frontier/KeepPixel64/lens2.png",         # Radiantium Mining Lens
    83896: "res:/ui/texture/icons/Frontier/KeepPixel64/lens2.png",         # Gravionite Mining Lens
    83897: "res:/ui/texture/icons/Frontier/KeepPixel64/lens2.png",         # Luminalis Mining Lens
    83898: "res:/ui/texture/icons/Frontier/KeepPixel64/lens2.png",         # Eclipsite Mining Lens
    # -- Coilguns --
    81972: "res:/ui/texture/icons/Frontier/KeepPixel64/GYRO-3.png",        # Base Coilgun (S)
    82028: "res:/ui/texture/icons/Frontier/KeepPixel64/GYRO-3.png",        # Base Coilgun (M)
    82088: "res:/ui/texture/icons/Frontier/KeepPixel64/GYRO-3.png",        # Tier 2 Coilgun (S)
    82089: "res:/ui/texture/icons/Frontier/KeepPixel64/GYRO-3.png",        # Tier 3 Coilgun (S)
    82092: "res:/ui/texture/icons/Frontier/KeepPixel64/GYRO-3.png",        # Tier 2 Coilgun (M)
    82093: "res:/ui/texture/icons/Frontier/KeepPixel64/GYRO-3.png",        # Tier 3 Coilgun (M)
    # -- Warp/Propulsion --
    82682: "res:/ui/texture/icons/Frontier/KeepPixel64/threader1.png",     # Warp Entangler II
    83516: "res:/ui/texture/icons/Frontier/KeepPixel64/threader1.png",     # Warp Entangler III
    83517: "res:/ui/texture/icons/Frontier/KeepPixel64/threader1.png",     # Warp Entangler IV
    83518: "res:/ui/texture/icons/Frontier/KeepPixel64/threader1.png",     # Warp Entangler V
    83519: "res:/ui/texture/icons/Frontier/KeepPixel64/threader1.png",     # Warp Entangler VI
    81656: "res:/ui/texture/icons/Frontier/KeepPixel64/threader2.png",     # Tuho 7
    81657: "res:/ui/texture/icons/Frontier/KeepPixel64/threader2.png",     # Xoru 7
    82090: "res:/ui/texture/icons/Frontier/KeepPixel64/threader2.png",     # Tuho 9
    82091: "res:/ui/texture/icons/Frontier/KeepPixel64/threader2.png",     # Tuho S
    82094: "res:/ui/texture/icons/Frontier/KeepPixel64/threader2.png",     # Xoru 9
    82095: "res:/ui/texture/icons/Frontier/KeepPixel64/threader2.png",     # Xoru S
    # -- Shield modules --
    82667: "res:/ui/texture/icons/Frontier/KeepPixel64/kshield1.png",      # Shield Restorer II
    83458: "res:/ui/texture/icons/Frontier/KeepPixel64/kshield1.png",      # Shield Restorer III
    82652: "res:/ui/texture/icons/Frontier/KeepPixel64/kshield2.png",      # Bulwark Shield Generator II
    82653: "res:/ui/texture/icons/Frontier/KeepPixel64/kshield2.png",      # Attuned Shield Generator II
    82654: "res:/ui/texture/icons/Frontier/KeepPixel64/kshield2.png",      # Reinforced Shield Generator II
    83448: "res:/ui/texture/icons/Frontier/KeepPixel64/kshield2.png",      # Bulwark Shield Generator III
    83449: "res:/ui/texture/icons/Frontier/KeepPixel64/kshield2.png",      # Bulwark Shield Generator IV
    83450: "res:/ui/texture/icons/Frontier/KeepPixel64/kshield2.png",      # Attuned Shield Generator III
    83451: "res:/ui/texture/icons/Frontier/KeepPixel64/kshield2.png",      # Attuned Shield Generator IV
    83456: "res:/ui/texture/icons/Frontier/KeepPixel64/kshield2.png",      # Reinforced Shield Generator III
    83457: "res:/ui/texture/icons/Frontier/KeepPixel64/kshield2.png",      # Reinforced Shield Generator IV
    # -- Field arrays --
    83768: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # EM Field Array II
    83769: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # EM Field Array III
    83770: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # EM Field Array IV
    83772: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # Thermal Field Array II
    83773: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # Thermal Field Array III
    83774: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # Thermal Field Array IV
    83777: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # Explosive Field Array II
    83778: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # Explosive Field Array III
    83779: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # Explosive Field Array IV
    83782: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # Kinetic Field Array II
    83783: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # Kinetic Field Array III
    83784: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine3.png",     # Kinetic Field Array IV
    # -- Stasis nets --
    82683: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine4.png",     # Stasis Net II
    83520: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine4.png",     # Stasis Net III
    83521: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine4.png",     # Stasis Net IV
    83522: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine4.png",     # Stasis Net V
    83523: "res:/ui/texture/icons/Frontier/KeepPixel64/kturbine4.png",     # Stasis Net VI
    # -- Hull repair --
    72960: "res:/ui/texture/icons/Frontier/KeepPixel64/kpatcher2.png",     # Hull Repairer
    # Cargo grids: FSD path1 is Drop64_0003_shadow.png
    83497: "res:/ui/texture/icons/Frontier/KeepPixel64/khold1.png",        # Cargo Grid II
    83498: "res:/ui/texture/icons/Frontier/KeepPixel64/khold1.png",        # Cargo Grid III
    83499: "res:/ui/texture/icons/Frontier/KeepPixel64/khold1.png",        # Cargo Grid IV
    83500: "res:/ui/texture/icons/Frontier/KeepPixel64/khold1.png",        # Cargo Grid V
    83501: "res:/ui/texture/icons/Frontier/KeepPixel64/khold1.png",        # Cargo Grid VI
    # Armor modules: FSD path1 is Drop64_* icons
    83441: "res:/ui/texture/icons/Frontier/KeepPixel64/khold3.png",        # Adaptive Nanitic Armor Weave II
    83442: "res:/ui/texture/icons/Frontier/KeepPixel64/khold3.png",        # Adaptive Nanitic Armor Weave III
    83443: "res:/ui/texture/icons/Frontier/KeepPixel64/khold3.png",        # Adaptive Nanitic Armor Weave IV
    83613: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Thermal-electro Nanitic Brace II
    83614: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Thermal-electro Nanitic Brace III
    83615: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Thermal-electro Nanitic Brace IV
    83618: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Explonetic-electro Nanitic Brace II
    83619: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Explonetic-electro Nanitic Brace III
    83620: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Explonetic-electro Nanitic Brace IV
    83623: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Explo-electro Nanitic Brace II
    83624: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Explo-electro Nanitic Brace III
    83625: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Explo-electro Nanitic Brace IV
    83628: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Thermalnetic Nanitic Brace II
    83629: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Thermalnetic Nanitic Brace III
    83630: "res:/ui/texture/icons/Frontier/KeepPixel64/khold2.png",        # Thermalnetic Nanitic Brace IV
    # Nanite sequencers: FSD path1 is Crude1.png
    82410: "res:/ui/texture/icons/Frontier/KeepPixel64/ksys1a.png",        # Explosive Nanite Sequencer
    82411: "res:/ui/texture/icons/Frontier/KeepPixel64/ksys1a.png",        # EM Nanite Sequencer
    82412: "res:/ui/texture/icons/Frontier/KeepPixel64/ksys1a.png",        # Thermal Nanite Sequencer
    82413: "res:/ui/texture/icons/Frontier/KeepPixel64/ksys1a.png",        # Kinetic Nanite Sequencer
    # Program/Protocol frames: FSD has kclone/khold pixel art, correct icons are Drop64 faction renders
    78415: "res:/ui/texture/icons/Frontier/Drop64_0007_siege.png",          # Siege Protocol Frame (unpub)
    78416: "res:/ui/texture/icons/Frontier/Drop64_0006_apocalypse.png",     # Apocalypse Protocol Frame
    78417: "res:/ui/texture/icons/Frontier/Drop64_0005_bastion.png",        # Bastion Program Frame
    78418: "res:/ui/texture/icons/Frontier/Drop64_0004_nomad.png",          # Nomad Program Frame
    78419: "res:/ui/texture/icons/Frontier/Drop64_0003_shadow.png",         # Shadow Protocol Frame (unpub)
    78420: "res:/ui/texture/icons/Frontier/Drop64_0002_archangel.png",      # Archangel Protocol Frame
    78421: "res:/ui/texture/icons/Frontier/Drop64_0001_exterminata.png",    # Exterminata Protocol Frame
    78422: "res:/ui/texture/icons/Frontier/Drop64_0000_equilibrium.png",    # Equilibrium Program Frame
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
    """Fetch icon URLs from the World API and download from CDN."""
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
    parser.add_argument("--include-types", type=Path, default=None,
                        help="JSON file with extra typeIDs to include (array of ints or {id: name})")
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
    print("\nParsing iconids.fsdbinary...")
    fsd_data, fsd_paths = parse_iconids_fsd(game_root, server, resfile_lookup)
    icon_to_respath = map_iconids_to_paths(items, fsd_data, fsd_paths)
    print(f"iconID -> path mappings: {len(icon_to_respath)}")

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
