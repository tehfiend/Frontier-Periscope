"""
EVE Frontier Static Data Extractor
Extracts star map data from the game client's ResFiles for the Periscope app.

Reads:
  - starmapcache.pickle  → solar systems, regions, constellations, jumps (topology + coordinates)
  - localization_fsd_en-us.pickle → names for all entities (messageID → text)
  - regions.static → nameID mapping for regions (FSD binary)
  - constellations.static → nameID mapping for constellations (FSD binary)
  - solarsystemcontent.static → nameID mapping for solar systems (FSD binary, 84MB)

Outputs (to apps/periscope/public/data/):
  - stellar_systems.json    → 24k solar systems with coords, names, region/constellation IDs
  - stellar_regions.json    → regions with names, coords, member systems
  - stellar_constellations.json → constellations with names, coords, member systems
  - stellar_jumps.json      → jump connections (directed edges for pathfinding)
  - stellar_labels.json     → combined id→name lookup for all entities
  - extraction_meta.json    → version, source, timestamp

Usage:
  python scripts/extract_static_data.py [--resfiles PATH] [--output PATH]
"""

import pickle
import json
import struct
import sys
import time
import argparse
from pathlib import Path


# ResFile index entries (from resfileindex.txt, Cycle 5 build 3251859)
RESFILE_PATHS = {
    "starmapcache": "2e/2edadfca55978bdf_4ee629789cbd821c2ca5f451d06f0c2e",
    "localization_en": "2c/2c3038b3c38e91a1_1b9c335531466bbd58e03524cd341ce4",
    "regions_static": "a7/a74cde5df2632168_13eb5da4601e760dd429a1a9ed2b799e",
    "constellations_static": "f5/f5d54e32f23ee5df_6c1b56bfd29ec39a3df196a3acf01085",
    "solarsystemcontent": "33/33c83a8c56c485e6_6192550ccd1762a95c8b8b8fe1050e85",
    "systems_static": "89/893086ea542ec98f_eaaf5da5479b0a5b60813e09a24dbdc7",
    "jumps_static": "cf/cf4829ec2741484c_edae55a0f68ee61a5b4f83b4f2e5ae05",
    "groups_fsdbinary": "b1/b198644fdc5397f3_895231a45d5cfad1dce8ca42f403e915",
    "categories_fsdbinary": "81/81883d3b3f883f8f_3a84ffd2eaa56a60bad1133f1c7fd920",
    "spacecomponents": "f2/f26def0295b69084_d58a9d9f2b325da2cea9168efc8dcc7a",
    "industry_blueprints": "c4/c41a791d1ef13a50_f45491c674873e8156ee528de3f1966f",
}


def resfile_path(resfiles_dir: Path, key: str) -> Path:
    """Get the full path for a ResFile by key."""
    return resfiles_dir / RESFILE_PATHS[key]


def load_pickle(resfiles_dir: Path, key: str):
    """Load a pickle file from ResFiles."""
    path = resfile_path(resfiles_dir, key)
    if not path.exists():
        raise FileNotFoundError(f"ResFile not found: {path}")
    with open(path, "rb") as f:
        return pickle.load(f)


def extract_name_ids_from_static(
    path: Path, name_id_offset: int
) -> dict[int, int]:
    """Extract entity_id → nameID mapping from a FSD dict .static file.

    Uses memory-mapped I/O to avoid loading huge files (e.g. 84MB
    solarsystemcontent.static) entirely into RAM. Only reads the footer
    index and then seeks to each entry's nameID field.

    FSD dict .static format:
      [4 bytes] header (offset pointer)
      [N bytes] value data section
      [M bytes] key footer: [{key: uint32, data_offset: uint32} * entry_count]
      [4 bytes] footer total size (= entry_count * 8 + 4)

    Args:
        path: Path to the .static file
        name_id_offset: Byte offset of nameID field within each value record

    Returns: {entity_id: nameID}
    """
    import mmap

    result = {}
    file_size = path.stat().st_size
    if file_size < 8:
        return result

    with open(path, "rb") as f:
        # Memory-map the file read-only (OS manages paging, minimal RAM)
        mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
        try:
            # Footer size is the last 4 bytes
            footer_size = struct.unpack_from("<I", mm, file_size - 4)[0]
            footer_start = file_size - footer_size
            entry_count = (footer_size - 4) // 8

            if entry_count <= 0 or footer_start < 4:
                return result

            # Data section starts at byte 4
            data_base = 4

            # Read footer entries and extract nameIDs
            for i in range(entry_count):
                pos = footer_start + i * 8
                key = struct.unpack_from("<I", mm, pos)[0]
                offset = struct.unpack_from("<I", mm, pos + 4)[0]
                abs_offset = data_base + offset

                # Read just the nameID field (4 bytes at the specified offset)
                name_pos = abs_offset + name_id_offset
                if name_pos + 4 <= footer_start:
                    name_id = struct.unpack_from("<i", mm, name_pos)[0]
                    if name_id > 0:
                        result[key] = name_id
        finally:
            mm.close()

    return result


def load_localization(resfiles_dir: Path) -> dict[int, str]:
    """Load en-us localization: messageID → text string."""
    print("  Loading localization (en-us)...")
    data = load_pickle(resfiles_dir, "localization_en")
    # Format: tuple(lang_code, {messageID: (text, ?, ?)})
    texts = data[1]
    result = {}
    for msg_id, val in texts.items():
        if isinstance(val, tuple):
            result[msg_id] = val[0]
        else:
            result[msg_id] = str(val)
    print(f"    {len(result):,} localized strings loaded")
    return result


def extract_starmap(resfiles_dir: Path) -> dict:
    """Extract star map data from starmapcache.pickle."""
    print("  Loading starmapcache.pickle...")
    data = load_pickle(resfiles_dir, "starmapcache")

    raw_systems = data["solarSystems"]
    raw_regions = data["regions"]
    raw_constellations = data["constellations"]
    raw_jumps = data["jumps"]

    print(f"    {len(raw_systems):,} solar systems")
    print(f"    {len(raw_regions):,} regions")
    print(f"    {len(raw_constellations):,} constellations")
    print(f"    {len(raw_jumps):,} jump pairs")

    # Build systems
    systems = {}
    for sys_id, sys_data in raw_systems.items():
        center = sys_data["center"]
        systems[sys_id] = {
            "id": sys_id,
            "center": [center[0], center[1], center[2]],
            "constellationId": sys_data["constellationID"],
            "regionId": sys_data["regionID"],
            "neighbours": sys_data.get("neighbours", []),
            "factionId": sys_data.get("factionID"),
        }

    # Build regions
    regions = {}
    for reg_id, reg_data in raw_regions.items():
        center = reg_data["center"]
        regions[reg_id] = {
            "id": reg_id,
            "center": [center[0], center[1], center[2]],
            "neighbours": reg_data.get("neighbours", []),
            "solarSystemIds": reg_data.get("solarSystemIDs", []),
            "constellationIds": reg_data.get("constellationIDs", []),
        }

    # Build constellations
    constellations = {}
    for con_id, con_data in raw_constellations.items():
        center = con_data["center"]
        constellations[con_id] = {
            "id": con_id,
            "center": [center[0], center[1], center[2]],
            "neighbours": con_data.get("neighbours", []),
            "solarSystemIds": con_data.get("solarSystemIDs", []),
            "regionId": con_data["regionID"],
        }

    # Build directed jump edges (A→B + B→A for each system-level jump)
    jumps = []
    for jump in raw_jumps:
        jump_type = jump.get("jumpType", 0)
        if jump_type == 0:  # system-level jumps only
            from_id = jump["fromSystemID"]
            to_id = jump["toSystemID"]
            jumps.append({"fromSystemId": from_id, "toSystemId": to_id})
            jumps.append({"fromSystemId": to_id, "toSystemId": from_id})

    print(f"    {len(jumps):,} directed jump edges")

    return {
        "systems": systems,
        "regions": regions,
        "constellations": constellations,
        "jumps": jumps,
    }


def resolve_names(resfiles_dir: Path, locale: dict[int, str], starmap: dict) -> dict[int, str]:
    """Resolve names for all entities from FSD .static files + locale."""
    labels = {}

    # Regions: nameID at offset 4 in value record
    # Schema constantAttributeOffsets: regionID=0, nameID=4
    print("  Parsing regions.static...")
    region_name_ids = extract_name_ids_from_static(
        resfile_path(resfiles_dir, "regions_static"),
        name_id_offset=4,
    )
    for entity_id, name_id in region_name_ids.items():
        if name_id in locale:
            labels[entity_id] = locale[name_id]
    print(f"    {len(region_name_ids):,} region names resolved")

    # Constellations: nameID at offset 8
    # Schema: {constellationID: 0, regionID: 4, nameID: 8, center: 12}
    print("  Parsing constellations.static...")
    con_name_ids = extract_name_ids_from_static(
        resfile_path(resfiles_dir, "constellations_static"),
        name_id_offset=8,
    )
    for entity_id, name_id in con_name_ids.items():
        if name_id in locale:
            labels[entity_id] = locale[name_id]
    print(f"    {len(con_name_ids):,} constellation names resolved")

    # Solar systems: from systems.static (4.9MB, 24,426 entries)
    # Schema: {solarSystemID: 0, securityStatus: 4, frostLine: 8, potential: 12,
    #          constellationID: 16, regionID: 20, nameID: 24, center: 28, pseudoSecurity: 52}
    print("  Parsing systems.static...")
    sys_name_ids = extract_name_ids_from_static(
        resfile_path(resfiles_dir, "systems_static"),
        name_id_offset=24,
    )
    for entity_id, name_id in sys_name_ids.items():
        if name_id in locale:
            labels[entity_id] = locale[name_id]
    sys_resolved = sum(1 for s_id in starmap["systems"] if s_id in labels)
    print(f"    {len(sys_name_ids):,} entries parsed, {sys_resolved:,} system names resolved")

    return labels


def save_json(data, path: Path, indent: bool = False):
    """Save data as JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2 if indent else None, ensure_ascii=False)
    size_kb = path.stat().st_size / 1024
    unit = "KB" if size_kb < 1024 else "MB"
    size_display = size_kb if size_kb < 1024 else size_kb / 1024
    print(f"    Saved {path.name} ({size_display:.1f} {unit})")


def main():
    parser = argparse.ArgumentParser(description="Extract EVE Frontier static data")
    parser.add_argument(
        "--resfiles",
        default=r"C:\CCP\EVE Frontier\ResFiles",
        help="Path to EVE Frontier ResFiles directory",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output directory (default: apps/periscope/public/data/)",
    )
    parser.add_argument(
        "--pretty", action="store_true", help="Pretty-print JSON output"
    )
    args = parser.parse_args()

    resfiles_dir = Path(args.resfiles)
    if not resfiles_dir.exists():
        print(f"ERROR: ResFiles directory not found: {resfiles_dir}")
        sys.exit(1)

    if args.output:
        output_dir = Path(args.output)
    else:
        script_dir = Path(__file__).resolve().parent.parent
        output_dir = script_dir / "apps" / "periscope" / "public" / "data"

    print("EVE Frontier Static Data Extractor")
    print(f"  ResFiles: {resfiles_dir}")
    print(f"  Output:   {output_dir}")
    print()

    t0 = time.time()

    # Step 1: Load localization
    print("[1/4] Loading localization...")
    locale = load_localization(resfiles_dir)

    # Step 2: Extract star map topology
    print("\n[2/4] Extracting star map...")
    starmap = extract_starmap(resfiles_dir)

    # Step 3: Resolve names from FSD .static files
    print("\n[3/4] Resolving entity names...")
    labels = resolve_names(resfiles_dir, locale, starmap)

    # Apply names to starmap entities
    for reg_id in starmap["regions"]:
        if reg_id in labels:
            starmap["regions"][reg_id]["name"] = labels[reg_id]
    for con_id in starmap["constellations"]:
        if con_id in labels:
            starmap["constellations"][con_id]["name"] = labels[con_id]
    for sys_id in starmap["systems"]:
        if sys_id in labels:
            starmap["systems"][sys_id]["name"] = labels[sys_id]

    named = {
        "regions": sum(1 for r in starmap["regions"].values() if "name" in r),
        "constellations": sum(1 for c in starmap["constellations"].values() if "name" in c),
        "systems": sum(1 for s in starmap["systems"].values() if "name" in s),
    }
    print(f"\n  Summary: {named['regions']}/{len(starmap['regions'])} regions, "
          f"{named['constellations']}/{len(starmap['constellations'])} constellations, "
          f"{named['systems']}/{len(starmap['systems'])} systems named")

    # Step 4: Save output
    print("\n[4/4] Saving output files...")

    save_json(list(starmap["systems"].values()), output_dir / "stellar_systems.json", indent=args.pretty)
    save_json(list(starmap["regions"].values()), output_dir / "stellar_regions.json", indent=args.pretty)
    save_json(list(starmap["constellations"].values()), output_dir / "stellar_constellations.json", indent=args.pretty)
    save_json(starmap["jumps"], output_dir / "stellar_jumps.json", indent=args.pretty)

    # Labels: convert int keys to strings for JSON
    save_json(
        {str(k): v for k, v in labels.items()},
        output_dir / "stellar_labels.json",
        indent=args.pretty,
    )

    meta = {
        "version": "1.0.0",
        "source": "EVE Frontier Client ResFiles (build 3251859)",
        "extractedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "counts": {
            "regions": len(starmap["regions"]),
            "constellations": len(starmap["constellations"]),
            "solarSystems": len(starmap["systems"]),
            "jumpEdges": len(starmap["jumps"]),
            "labels": len(labels),
        },
        "namesResolved": named,
    }
    save_json(meta, output_dir / "extraction_meta.json", indent=True)

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s! Output: {output_dir}")

    if named["systems"] == 0:
        print("\nWARNING: Solar system names were not resolved.")
        print("The solarsystemcontent.static nameID offset may differ from regions/constellations.")
        print("Consider using frontier-reapers/frontier-static-data for a complete extraction.")


if __name__ == "__main__":
    main()
