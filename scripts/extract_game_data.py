#!/usr/bin/env python3
"""
EVE Frontier Game Data Extractor

Extracts FSDBinary data from the EVE Frontier game client using the game's
own .pyd loader modules. Based on the VULTUR/eve-frontier-tools pipeline.

Required:
  - Python 3.12 (matching the game client's python312.dll)
  - EVE Frontier client installed at C:\\CCP\\EVE Frontier

Outputs JSON files to apps/periscope/public/data/
"""

import sys
import os
import json
import pickle
import importlib
import time

# ============================================================================
# Configuration
# ============================================================================

GAME_ROOT = r"C:\CCP\EVE Frontier"
BIN64_DIR = os.path.join(GAME_ROOT, "stillness", "bin64")
RESFILES_DIR = os.path.join(GAME_ROOT, "ResFiles")
INDEX_FILE = os.path.join(GAME_ROOT, "stillness", "resfileindex.txt")

# Output directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "apps", "periscope", "public", "data")

# Files to extract (loader_name -> resfile_path from index)
# Format: res:/staticdata/<name>.fsdbinary,<hash_prefix>/<hash_filename>,...
RESFILE_MAP = {
    "industry_blueprints": "c4/c41a791d1ef13a50_f45491c674873e8156ee528de3f1966f",
    "industry_facilities": "af/affb67cc07f15c0f_818bb55f2d8e81b33ee8a2e54bbb0025",
    "typematerials": "66/66c8b3f32a0b893b_30f6802a610d81046499d5885732ff73",
    "types": "3c/3cc5bf8ff5e9099a_f891c08953c4aca0d76d77dadb7bbc25",
    "groups": "b1/b198644fdc5397f3_895231a45d5cfad1dce8ca42f403e915",
    "categories": "81/81883d3b3f883f8f_3a84ffd2eaa56a60bad1133f1c7fd920",
    "spacecomponentsbytype": "f2/f26def0295b69084_d58a9d9f2b325da2cea9168efc8dcc7a",
    "marketgroups": "5b/5be8d79bd5183137_53b3cffe28c8faf78bf8617536d60501",
}

# Localization pickle
LOCALIZATION_RESFILE = "2c/2c3038b3c38e91a1_1b9c335531466bbd58e03524cd341ce4"

# Loader name mapping (fsdbinary name -> loader module name)
# The convention: <name>Loader.pyd where <name> is camelCase
LOADER_MAP = {
    "industry_blueprints": "industry_blueprintsLoader",
    "industry_facilities": "industry_facilitiesLoader",
    "typematerials": "typeMaterialsLoader",
    "types": "typesLoader",
    "groups": "groupsLoader",
    "categories": "categoriesLoader",
    "spacecomponentsbytype": "spaceComponentsByTypeLoader",
    "marketgroups": "marketGroupsLoader",
}

# ============================================================================
# FSDBinary decoder (adapted from VULTUR execute_loaders.py)
# ============================================================================

def decode_cfsd(key, data, strings):
    """Recursively decode cfsd objects into Python dicts/lists."""
    data_type = type(data)

    # cfsd.dict -> Python dict
    if data_type.__module__ == "cfsd" and data_type.__name__ == "dict":
        return {k: decode_cfsd(k, v, strings) for k, v in data.items()}

    # Loader objects (named types) -> dict of attributes
    if data_type.__module__.endswith("Loader"):
        return {
            x: decode_cfsd(x, getattr(data, x), strings)
            for x in dir(data)
            if not x.startswith("__")
        }

    # cfsd.list -> Python list
    if data_type.__module__ == "cfsd" and data_type.__name__ == "list":
        return [decode_cfsd(None, v, strings) for v in data]

    # Tuples
    if isinstance(data, tuple):
        return tuple(decode_cfsd(None, v, strings) for v in data)

    # Vectors (TODO: not yet handled)
    if data_type.__name__.endswith("_vector"):
        try:
            return [decode_cfsd(None, v, strings) for v in data]
        except Exception:
            return None

    # Integers (resolve NameID lookups)
    if isinstance(data, int) or data_type.__name__ == "long":
        if (
            key is not None
            and isinstance(key, str)
            and key.lower().endswith("nameid")
            and key != "dungeonNameID"
        ):
            if data in strings:
                return strings[data][0]
            return f"Unknown:{data}"
        return data

    # Floats
    if isinstance(data, float):
        return data

    # Strings
    if isinstance(data, str):
        return data

    # Booleans
    if isinstance(data, bool):
        return data

    # None
    if data is None:
        return None

    # Bytes
    if isinstance(data, bytes):
        return data.hex()

    # Fallback: try to convert to string
    try:
        return str(data)
    except Exception:
        return f"<unconvertible: {type(data).__name__}>"


def load_localization():
    """Load English localization strings from pickle."""
    loc_path = os.path.join(RESFILES_DIR, *LOCALIZATION_RESFILE.split("/"))
    if not os.path.exists(loc_path):
        print(f"  WARNING: Localization file not found: {loc_path}")
        return {}

    print(f"  Loading localization from {loc_path}...")
    with open(loc_path, "rb") as f:
        loc_data = pickle.load(f)

    strings = loc_data[1] if isinstance(loc_data, tuple) else loc_data
    print(f"  Loaded {len(strings):,} localization strings")
    return strings


def load_fsdbinary(name, strings):
    """Load a single FSDBinary file using its game loader."""
    loader_name = LOADER_MAP.get(name)
    resfile_path = RESFILE_MAP.get(name)

    if not loader_name or not resfile_path:
        print(f"  ERROR: No loader/path configured for '{name}'")
        return None

    full_path = os.path.join(RESFILES_DIR, *resfile_path.split("/"))
    if not os.path.exists(full_path):
        print(f"  ERROR: File not found: {full_path}")
        return None

    file_size = os.path.getsize(full_path)
    print(f"  Loading {name}.fsdbinary ({file_size:,} bytes) with {loader_name}...")

    try:
        loader = importlib.import_module(loader_name)
        raw_data = loader.load(full_path)
        decoded = decode_cfsd(None, raw_data, strings)

        count = len(decoded) if isinstance(decoded, (dict, list)) else "N/A"
        print(f"  Decoded {name}: {count} entries")
        return decoded
    except Exception as e:
        print(f"  ERROR loading {name}: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return None


def save_json(data, filename, description=""):
    """Save data as formatted JSON."""
    filepath = os.path.join(OUTPUT_DIR, filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    file_size = os.path.getsize(filepath)
    print(f"  Saved {filepath} ({file_size:,} bytes){' - ' + description if description else ''}")
    return filepath


# ============================================================================
# Data processors
# ============================================================================

def build_type_name_map(types_data):
    """Build a typeID -> name mapping from types data."""
    name_map = {}
    if not types_data:
        return name_map

    for type_id, type_info in types_data.items():
        if isinstance(type_info, dict):
            name = type_info.get("typeNameID", type_info.get("name", f"Type {type_id}"))
            name_map[int(type_id)] = name
        else:
            name_map[int(type_id)] = f"Type {type_id}"

    return name_map


def process_blueprints(bp_data, type_names):
    """Process blueprint data into a clean format with BOM."""
    if not bp_data:
        return None

    blueprints = {}
    materials_index = {}  # materialTypeID -> list of blueprint IDs that use it

    for bp_id, bp_info in bp_data.items():
        bp_id = int(bp_id)

        if not isinstance(bp_info, dict):
            continue

        primary_type_id = bp_info.get("primaryTypeID", bp_id)
        run_time = bp_info.get("runTime", 0)

        inputs = []
        for inp in (bp_info.get("inputs") or []):
            if isinstance(inp, dict):
                tid = inp.get("typeID", 0)
                qty = inp.get("quantity", 1)
            else:
                continue

            inputs.append({
                "typeID": tid,
                "typeName": type_names.get(tid, f"Type {tid}"),
                "quantity": qty,
            })

            # Index materials
            if tid not in materials_index:
                materials_index[tid] = []
            materials_index[tid].append(bp_id)

        outputs = []
        for out in (bp_info.get("outputs") or []):
            if isinstance(out, dict):
                tid = out.get("typeID", 0)
                qty = out.get("quantity", 1)
            else:
                continue

            outputs.append({
                "typeID": tid,
                "typeName": type_names.get(tid, f"Type {tid}"),
                "quantity": qty,
            })

        blueprints[bp_id] = {
            "blueprintID": bp_id,
            "primaryTypeID": primary_type_id,
            "primaryTypeName": type_names.get(primary_type_id, f"Type {primary_type_id}"),
            "runTime": run_time,
            "runTimeFormatted": format_time(run_time),
            "inputs": inputs,
            "outputs": outputs,
        }

    # Build materials-to-blueprints index with names
    materials_to_blueprints = {}
    for mat_id, bp_ids in materials_index.items():
        materials_to_blueprints[mat_id] = {
            "typeID": mat_id,
            "typeName": type_names.get(mat_id, f"Type {mat_id}"),
            "usedInBlueprints": sorted(set(bp_ids)),
        }

    return {
        "blueprints": blueprints,
        "materialsIndex": materials_to_blueprints,
        "stats": {
            "totalBlueprints": len(blueprints),
            "totalUniqueMaterials": len(materials_to_blueprints),
        },
    }


def format_time(seconds):
    """Format seconds into human-readable time."""
    if seconds <= 0:
        return "instant"
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    parts = []
    if hours:
        parts.append(f"{hours}h")
    if minutes:
        parts.append(f"{minutes}m")
    if secs:
        parts.append(f"{secs}s")
    return " ".join(parts) if parts else "0s"


def process_facilities(fac_data, type_names):
    """Process industry facilities data."""
    if not fac_data:
        return None

    facilities = {}
    for fac_id, fac_info in fac_data.items():
        fac_id = int(fac_id)
        if isinstance(fac_info, dict):
            facilities[fac_id] = {
                "facilityID": fac_id,
                **fac_info,
            }
        else:
            facilities[fac_id] = {"facilityID": fac_id, "raw": str(fac_info)}

    return facilities


def process_groups(groups_data, type_names):
    """Process groups data."""
    if not groups_data:
        return None

    groups = {}
    for gid, ginfo in groups_data.items():
        gid = int(gid)
        if isinstance(ginfo, dict):
            groups[gid] = {
                "groupID": gid,
                **ginfo,
            }

    return groups


def process_categories(cat_data):
    """Process categories data."""
    if not cat_data:
        return None

    categories = {}
    for cid, cinfo in cat_data.items():
        cid = int(cid)
        if isinstance(cinfo, dict):
            categories[cid] = {
                "categoryID": cid,
                **cinfo,
            }

    return categories


def process_types(types_data):
    """Process types into a clean lookup table."""
    if not types_data:
        return None

    types_clean = {}
    for tid, tinfo in types_data.items():
        tid = int(tid)
        if isinstance(tinfo, dict):
            types_clean[tid] = {
                "typeID": tid,
                **tinfo,
            }

    return types_clean


# ============================================================================
# Main
# ============================================================================

def main():
    start_time = time.time()
    print("=" * 70)
    print("EVE Frontier Game Data Extractor")
    print("=" * 70)
    print()

    # Validate paths
    if not os.path.isdir(GAME_ROOT):
        print(f"ERROR: Game root not found: {GAME_ROOT}")
        sys.exit(1)
    if not os.path.isdir(BIN64_DIR):
        print(f"ERROR: bin64 not found: {BIN64_DIR}")
        sys.exit(1)

    # Add bin64 to Python path so loaders can find their dependencies
    sys.path.insert(0, BIN64_DIR)

    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Game root:  {GAME_ROOT}")
    print(f"bin64:      {BIN64_DIR}")
    print(f"ResFiles:   {RESFILES_DIR}")
    print(f"Output:     {OUTPUT_DIR}")
    print()

    # Step 1: Load localization strings
    print("[1/7] Loading localization...")
    strings = load_localization()
    print()

    # Step 2: Load types (needed for name resolution)
    print("[2/7] Loading types...")
    types_raw = load_fsdbinary("types", strings)
    type_names = build_type_name_map(types_raw)
    print(f"  Built name map: {len(type_names):,} type names")
    print()

    # Step 3: Load and process blueprints
    print("[3/7] Loading blueprints...")
    bp_raw = load_fsdbinary("industry_blueprints", strings)
    bp_processed = process_blueprints(bp_raw, type_names)
    if bp_processed:
        save_json(bp_processed, "blueprints.json",
                  f"{bp_processed['stats']['totalBlueprints']} blueprints, "
                  f"{bp_processed['stats']['totalUniqueMaterials']} materials")
    print()

    # Step 4: Load and process facilities
    print("[4/7] Loading facilities...")
    fac_raw = load_fsdbinary("industry_facilities", strings)
    fac_processed = process_facilities(fac_raw, type_names)
    if fac_processed:
        save_json(fac_processed, "facilities.json",
                  f"{len(fac_processed)} facilities")
    print()

    # Step 5: Load groups and categories
    print("[5/7] Loading groups & categories...")
    groups_raw = load_fsdbinary("groups", strings)
    groups_processed = process_groups(groups_raw, type_names)
    if groups_processed:
        save_json(groups_processed, "groups.json",
                  f"{len(groups_processed)} groups")

    cat_raw = load_fsdbinary("categories", strings)
    cat_processed = process_categories(cat_raw)
    if cat_processed:
        save_json(cat_processed, "categories.json",
                  f"{len(cat_processed)} categories")
    print()

    # Step 6: Load types (full export)
    print("[6/7] Saving types lookup...")
    types_processed = process_types(types_raw)
    if types_processed:
        save_json(types_processed, "types.json",
                  f"{len(types_processed)} types")
    print()

    # Step 7: Load space components
    print("[7/7] Loading space components...")
    space_raw = load_fsdbinary("spacecomponentsbytype", strings)
    if space_raw:
        # Space components is large - save raw decoded data
        count = len(space_raw) if isinstance(space_raw, (dict, list)) else "N/A"
        save_json(space_raw, "spacecomponents.json",
                  f"{count} type entries")
    print()

    # Step 8: Load type materials
    print("[Bonus] Loading type materials...")
    typemat_raw = load_fsdbinary("typematerials", strings)
    if typemat_raw:
        count = len(typemat_raw) if isinstance(typemat_raw, (dict, list)) else "N/A"
        save_json(typemat_raw, "typematerials.json",
                  f"{count} entries")
    print()

    # Step 9: Load market groups
    print("[Bonus] Loading market groups...")
    mg_raw = load_fsdbinary("marketgroups", strings)
    if mg_raw:
        count = len(mg_raw) if isinstance(mg_raw, (dict, list)) else "N/A"
        save_json(mg_raw, "marketgroups.json",
                  f"{count} entries")
    print()

    # Save extraction metadata
    elapsed = time.time() - start_time
    meta = {
        "extractedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "extractionTimeSeconds": round(elapsed, 2),
        "gameRoot": GAME_ROOT,
        "pythonVersion": sys.version,
        "filesExtracted": [],
    }

    for filename in sorted(os.listdir(OUTPUT_DIR)):
        if filename.endswith(".json") and filename != "extraction_meta.json":
            filepath = os.path.join(OUTPUT_DIR, filename)
            meta["filesExtracted"].append({
                "filename": filename,
                "sizeBytes": os.path.getsize(filepath),
            })

    save_json(meta, "extraction_meta.json", "metadata")

    print("=" * 70)
    print(f"Extraction complete in {elapsed:.1f}s")
    print(f"Output directory: {OUTPUT_DIR}")
    print("=" * 70)


if __name__ == "__main__":
    main()
