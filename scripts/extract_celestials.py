"""
EVE Frontier Celestial Data Extractor
Extracts planet (and optionally moon/stargate) positions from the game client's mapObjects.db.

Reads:
  - mapObjects.db (SQLite) at {gameRoot}/utopia/bin64/staticdata/mapObjects.db

Outputs (to apps/periscope/public/data/):
  - celestials.json → compact per-system planet coordinate data

Format:
  { "systemId": [[celestialID, celestialIndex, typeID, x, y, z], ...], ... }

Usage:
  py scripts/extract_celestials.py [--game-root PATH] [--output PATH]
  py scripts/extract_celestials.py --include-moons --include-stargates
"""

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

# Group IDs in mapObjects.db celestials table
GROUP_SUN = 6
GROUP_PLANET = 7
GROUP_MOON = 8
GROUP_STARGATE = 10


def extract_celestials(
    db_path: Path,
    include_moons: bool = False,
    include_stargates: bool = False,
) -> dict:
    """Extract celestial data from mapObjects.db.

    Returns a dict keyed by solarSystemID (int), where each value is a list of
    tuples: [celestialID, celestialIndex, typeID, x, y, z].
    """
    if not db_path.exists():
        print(f"ERROR: mapObjects.db not found: {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    # Build the group filter
    groups = [GROUP_PLANET]
    group_labels = ["planets"]
    if include_moons:
        groups.append(GROUP_MOON)
        group_labels.append("moons")
    if include_stargates:
        groups.append(GROUP_STARGATE)
        group_labels.append("stargates")

    placeholders = ",".join("?" * len(groups))
    query = f"""
        SELECT celestialID, solarSystemID, celestialIndex, typeID, x, y, z
        FROM celestials
        WHERE groupID IN ({placeholders})
        ORDER BY solarSystemID, celestialIndex
    """

    print(f"  Querying {', '.join(group_labels)} from mapObjects.db...")
    cursor.execute(query, groups)
    rows = cursor.fetchall()
    conn.close()

    print(f"    {len(rows):,} celestial objects found")

    # Group by system
    systems: dict[int, list] = {}
    for celestial_id, system_id, celestial_index, type_id, x, y, z in rows:
        if system_id not in systems:
            systems[system_id] = []
        systems[system_id].append([celestial_id, celestial_index, type_id, x, y, z])

    print(f"    {len(systems):,} systems with celestial data")

    # Stats
    type_counts: dict[int, int] = {}
    for row in rows:
        tid = row[3]
        type_counts[tid] = type_counts.get(tid, 0) + 1

    return {
        "data": systems,
        "stats": {
            "totalObjects": len(rows),
            "systemsCovered": len(systems),
            "byType": type_counts,
        },
    }


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
    parser = argparse.ArgumentParser(
        description="Extract celestial coordinates from EVE Frontier mapObjects.db"
    )
    parser.add_argument(
        "--game-root",
        default=r"C:\CCP\EVE Frontier",
        help="Path to EVE Frontier game root directory",
    )
    parser.add_argument(
        "--mapobjects",
        default=None,
        help="Direct path to mapObjects.db (overrides --game-root)",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output directory (default: apps/periscope/public/data/)",
    )
    parser.add_argument(
        "--include-moons",
        action="store_true",
        help="Include moon data (groupID=8)",
    )
    parser.add_argument(
        "--include-stargates",
        action="store_true",
        help="Include stargate data (groupID=10)",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output",
    )
    args = parser.parse_args()

    # Resolve mapObjects.db path
    if args.mapobjects:
        db_path = Path(args.mapobjects)
    else:
        db_path = Path(args.game_root) / "utopia" / "bin64" / "staticdata" / "mapObjects.db"

    if args.output:
        output_dir = Path(args.output)
    else:
        script_dir = Path(__file__).resolve().parent.parent
        output_dir = script_dir / "apps" / "periscope" / "public" / "data"

    print("EVE Frontier Celestial Data Extractor")
    print(f"  mapObjects.db: {db_path}")
    print(f"  Output:        {output_dir}")
    print()

    t0 = time.time()

    # Extract celestials
    print("[1/2] Extracting celestial data...")
    result = extract_celestials(
        db_path,
        include_moons=args.include_moons,
        include_stargates=args.include_stargates,
    )

    # Save output
    print("\n[2/2] Saving output...")
    save_json(result["data"], output_dir / "celestials.json", indent=args.pretty)

    elapsed = time.time() - t0
    stats = result["stats"]

    print(f"\nDone in {elapsed:.1f}s!")
    print(f"  Total objects: {stats['totalObjects']:,}")
    print(f"  Systems:       {stats['systemsCovered']:,}")
    print(f"  By type ID:    {stats['byType']}")


if __name__ == "__main__":
    main()
