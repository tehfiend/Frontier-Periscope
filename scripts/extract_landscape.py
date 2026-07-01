#!/usr/bin/env python3
"""
EVE Frontier landscape / source-site extractor.

Reads the live Stillness client static data and emits compact aggregate indexes for
Periscope's Plan 40 proximity sourcing UI.

Outputs (to apps/periscope/public/data/):
  - gatherable_nodes.json
  - material_sources.json
  - system_resources.json
  - extraction_meta_landscape.json
"""

from __future__ import annotations

import argparse
import configparser
import importlib
import json
import os
import pickle
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


GAME_ROOT = Path(r"C:\CCP\EVE Frontier")
SERVER = "stillness"

RESPATH_MAP = {
    "landscape": "res:/staticdata/landscape.fsdbinary",
    "ecosystem": "res:/staticdata/ecosystem.fsdbinary",
    "dungeons": "res:/staticdata/dungeons.fsdbinary",
    "systemstate": "res:/staticdata/systemstate.fsdbinary",
    "types": "res:/staticdata/types.fsdbinary",
    "groups": "res:/staticdata/groups.fsdbinary",
    "categories": "res:/staticdata/categories.fsdbinary",
    "industry_blueprints": "res:/staticdata/industry_blueprints.fsdbinary",
    "spacecomponentsbytype": "res:/staticdata/spacecomponentsbytype.fsdbinary",
    "typematerials": "res:/staticdata/typematerials.fsdbinary",
}
LOCALIZATION_RESPATH = "res:/localizationfsd/localization_fsd_en-us.pickle"

LOADER_MAP = {
    "landscape": "landscapeLoader",
    "ecosystem": "ecosystemLoader",
    "dungeons": "dungeonsLoader",
    "systemstate": "systemStateLoader",
    "types": "typesLoader",
    "groups": "groupsLoader",
    "categories": "categoriesLoader",
    "industry_blueprints": "industry_blueprintsLoader",
    "spacecomponentsbytype": "spaceComponentsByTypeLoader",
    "typematerials": "typeMaterialsLoader",
}

STRUCTURE_BP_ID_OFFSET = 9_000_000
REQUIRED_BYPRODUCT_NODE_IDS = {77800, 78448, 78446}
ROGUE_DRONE_GROUP_NAME = "Rogue Drone Components"
SALVAGE_GROUP_NAME = "Salvage"
SALVAGE_SOURCE_GROUPS = {"Salvage", "Salvageable Wreckage"}
ASTEROID_CATEGORY_NAME = "Asteroid"
GRADE_TAG_PREFIXES = (
    "al26_",
    "cosmic_",
    "chemistry_",
    "migration_",
    "belt_",
    "danger_",
)
GRADE_TAGS_EXACT = {
    "non_zero_danger_level",
    "belt_hot",
    "belt_warm",
    "belt_cold",
    "inner",
    "outer",
    "belt",
    "trojan",
}


def build_resfile_index(index_file: Path) -> dict[str, str]:
    index: dict[str, str] = {}
    with open(index_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split(",")
            if len(parts) >= 2 and parts[0].startswith("res:/"):
                index[parts[0].lower()] = parts[1]
    return index


def decode_cfsd(key: str | None, data: Any, strings: dict[int, Any]) -> Any:
    data_type = type(data)

    if data_type.__module__ == "cfsd" and data_type.__name__ == "dict":
        return {k: decode_cfsd(str(k), v, strings) for k, v in data.items()}

    if data_type.__module__ == "cfsd" and data_type.__name__ == "list":
        return [decode_cfsd(None, v, strings) for v in data]

    if data_type.__module__.endswith("Loader"):
        return {
            x: decode_cfsd(x, getattr(data, x), strings)
            for x in dir(data)
            if not x.startswith("__")
        }

    if isinstance(data, tuple):
        return tuple(decode_cfsd(None, v, strings) for v in data)

    if data_type.__name__.endswith("_vector"):
        try:
            return [decode_cfsd(None, v, strings) for v in data]
        except Exception:
            return None

    if isinstance(data, int) or data_type.__name__ == "long":
        if (
            key is not None
            and isinstance(key, str)
            and key.lower().endswith("nameid")
            and key != "dungeonNameID"
        ):
            localized = strings.get(data)
            if isinstance(localized, tuple):
                return localized[0]
            if localized:
                return str(localized)
            return f"Unknown:{data}"
        return int(data)

    if isinstance(data, float | str | bool) or data is None:
        return data

    if isinstance(data, bytes):
        return data.hex()

    try:
        return str(data)
    except Exception:
        return f"<unconvertible: {type(data).__name__}>"


def load_localization(resfiles_dir: Path, loc_resfile: str) -> dict[int, Any]:
    path = resfiles_dir / loc_resfile
    print(f"  Loading localization: {path}")
    with open(path, "rb") as f:
        data = pickle.load(f)
    return data[1] if isinstance(data, tuple) else data


def load_fsdbinary(name: str, resfiles_dir: Path, resfile_map: dict[str, str], strings: dict[int, Any]):
    loader_name = LOADER_MAP[name]
    full_path = resfiles_dir / resfile_map[name]
    size = full_path.stat().st_size
    print(f"  Loading {name}.fsdbinary ({size:,} bytes) with {loader_name}...")
    raw = importlib.import_module(loader_name).load(str(full_path))
    decoded = decode_cfsd(None, raw, strings)
    count = len(decoded) if isinstance(decoded, (dict, list)) else "N/A"
    print(f"    Decoded {name}: {count:,} entries" if isinstance(count, int) else f"    Decoded {name}")
    return decoded


def read_build_number(server_dir: Path) -> str | None:
    start_ini = server_dir / "start.ini"
    if not start_ini.exists():
        return None
    parser = configparser.ConfigParser()
    parser.read(start_ini)
    return parser.get("main", "build", fallback=None)


def type_name(type_id: int, types: dict[int, dict[str, Any]]) -> str:
    return str(types.get(type_id, {}).get("typeNameID") or f"Type {type_id}")


def group_for(type_id: int, types: dict[int, dict[str, Any]], groups: dict[int, dict[str, Any]]):
    group_id = types.get(type_id, {}).get("groupID")
    if group_id is None:
        return None
    return groups.get(int(group_id))


def category_name_for(
    type_id: int,
    types: dict[int, dict[str, Any]],
    groups: dict[int, dict[str, Any]],
    categories: dict[int, dict[str, Any]],
) -> str | None:
    group = group_for(type_id, types, groups)
    if not group:
        return None
    cat = categories.get(int(group.get("categoryID", -1)))
    return str(cat.get("categoryNameID")) if cat else None


def group_name_for(
    type_id: int,
    types: dict[int, dict[str, Any]],
    groups: dict[int, dict[str, Any]],
) -> str | None:
    group = group_for(type_id, types, groups)
    return str(group.get("groupNameID")) if group else None


def is_grade_tag(tag: str) -> bool:
    return tag in GRADE_TAGS_EXACT or tag.startswith(GRADE_TAG_PREFIXES)


def walk_ints(value: Any):
    if isinstance(value, dict):
        for v in value.values():
            yield from walk_ints(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from walk_ints(v)
    elif isinstance(value, int):
        yield value


def collect_raw_material_ids(
    blueprints: dict[int, dict[str, Any]],
    spacecomponents: dict[int, dict[str, Any]],
    types: dict[int, dict[str, Any]],
) -> set[int]:
    bp_map = dict(blueprints)
    for type_id, entry in spacecomponents.items():
        if not isinstance(entry, dict):
            continue
        smart = entry.get("smartDeployable")
        if not isinstance(smart, dict):
            continue
        cost = smart.get("constructionCost")
        if not cost:
            continue
        tid = int(type_id)
        inputs = [
            {
                "typeID": int(mat),
                "typeName": type_name(int(mat), types),
                "quantity": qty,
            }
            for mat, qty in cost.items()
        ]
        bp_map[STRUCTURE_BP_ID_OFFSET + tid] = {
            "blueprintID": STRUCTURE_BP_ID_OFFSET + tid,
            "primaryTypeID": tid,
            "primaryTypeName": type_name(tid, types),
            "inputs": inputs,
            "outputs": [{"typeID": tid, "typeName": type_name(tid, types), "quantity": 1}],
        }

    inputs: set[int] = set()
    outputs: set[int] = set()
    for bp in bp_map.values():
        for item in bp.get("inputs") or []:
            inputs.add(int(item["typeID"]))
        for item in bp.get("outputs") or []:
            outputs.add(int(item["typeID"]))
    return {type_id for type_id in inputs if type_id not in outputs}


def collect_dungeon_facts(
    dungeons: dict[int, dict[str, Any]],
    types: dict[int, dict[str, Any]],
    groups: dict[int, dict[str, Any]],
    categories: dict[int, dict[str, Any]],
):
    object_counts: Counter[int] = Counter()
    object_dungeons: dict[int, set[int]] = defaultdict(set)
    trigger_refs_by_dungeon: dict[int, set[int]] = defaultdict(set)
    dungeon_objects: dict[int, set[int]] = defaultdict(set)
    dungeon_has_rogue: dict[int, bool] = {}
    gatherable_nodes: set[int] = set()

    for dungeon_id, dungeon in dungeons.items():
        did = int(dungeon_id)
        has_rogue = False
        for room in (dungeon.get("rooms") or {}).values():
            for obj in (room.get("objects") or {}).values():
                if not isinstance(obj, dict):
                    continue
                type_id = obj.get("typeID")
                if type_id is not None:
                    tid = int(type_id)
                    object_counts[tid] += 1
                    object_dungeons[tid].add(did)
                    dungeon_objects[did].add(tid)
                    group_name = group_name_for(tid, types, groups)
                    category_name = category_name_for(tid, types, groups, categories)
                    if category_name == ASTEROID_CATEGORY_NAME or group_name == SALVAGE_GROUP_NAME:
                        gatherable_nodes.add(tid)

                entities = obj.get("entities")
                if isinstance(entities, dict):
                    for ent in entities.values():
                        if isinstance(ent, dict) and ent.get("npcGroupingID") is not None:
                            has_rogue = True

        # Some salvage item IDs are referenced by dungeon trigger payloads rather than as
        # room object typeIDs. These are used only for source mapping validation, not for the
        # strict gatherable_nodes object set.
        trigger_refs_by_dungeon[did].update(int(v) for v in walk_ints(dungeon) if 70_000 <= int(v) <= 100_000)
        dungeon_has_rogue[did] = has_rogue

    return {
        "object_counts": object_counts,
        "object_dungeons": object_dungeons,
        "trigger_refs_by_dungeon": trigger_refs_by_dungeon,
        "dungeon_objects": dungeon_objects,
        "dungeon_has_rogue": dungeon_has_rogue,
        "gatherable_nodes": gatherable_nodes,
    }


def ecosystem_dungeon_ids(ecosystem: dict[str, Any]) -> set[int]:
    ids: set[int] = set()
    for key in ("naturalWorldPatterns", "brokenWorldPatterns"):
        for pattern in ecosystem.get(key) or []:
            if isinstance(pattern, dict) and pattern.get("dungeonID") is not None:
                ids.add(int(pattern["dungeonID"]))
    entry = ecosystem.get("entryPattern")
    if isinstance(entry, dict) and entry.get("dungeonID") is not None:
        ids.add(int(entry["dungeonID"]))
    return ids


def collect_ecosystem_facts(ecosystems: dict[int, dict[str, Any]], dungeon_facts: dict[str, Any]):
    facts: dict[int, dict[str, Any]] = {}
    for ecosystem_id, ecosystem in ecosystems.items():
        eid = int(ecosystem_id)
        dungeon_ids = ecosystem_dungeon_ids(ecosystem)
        object_type_ids: set[int] = set()
        trigger_type_ids: set[int] = set()
        has_rogue = False
        for dungeon_id in dungeon_ids:
            object_type_ids.update(dungeon_facts["dungeon_objects"].get(dungeon_id, set()))
            trigger_type_ids.update(dungeon_facts["trigger_refs_by_dungeon"].get(dungeon_id, set()))
            has_rogue = has_rogue or bool(dungeon_facts["dungeon_has_rogue"].get(dungeon_id))
        facts[eid] = {
            "name": str(ecosystem.get("name") or f"Ecosystem {eid}"),
            "dungeonIds": dungeon_ids,
            "objectTypeIds": object_type_ids,
            "triggerTypeIds": trigger_type_ids,
            "hasRogueDrones": has_rogue,
            "hasNaturalPatterns": bool(ecosystem.get("naturalWorldPatterns")),
        }
    return facts


def find_parent_asteroid_type(
    ore_group_name: str,
    object_counts: Counter[int],
    types: dict[int, dict[str, Any]],
    groups: dict[int, dict[str, Any]],
    categories: dict[int, dict[str, Any]],
) -> int | None:
    parent_name = ore_group_name.removesuffix(" Ores")
    for type_id in object_counts:
        if type_name(type_id, types) != parent_name:
            continue
        if category_name_for(type_id, types, groups, categories) == ASTEROID_CATEGORY_NAME:
            return type_id
    return None


def source_ecosystems_for_object_ids(
    source_object_ids: set[int],
    ecosystem_facts: dict[int, dict[str, Any]],
) -> set[int]:
    out: set[int] = set()
    for ecosystem_id, facts in ecosystem_facts.items():
        if facts["objectTypeIds"].intersection(source_object_ids):
            out.add(ecosystem_id)
    return out


def build_material_mappings(
    material_ids: set[int],
    ecosystem_facts: dict[int, dict[str, Any]],
    dungeon_facts: dict[str, Any],
    types: dict[int, dict[str, Any]],
    groups: dict[int, dict[str, Any]],
    categories: dict[int, dict[str, Any]],
):
    object_counts: Counter[int] = dungeon_facts["object_counts"]

    salvage_ecosystems: set[int] = set()
    salvage_source_object_ids: set[int] = set()
    for type_id in object_counts:
        group_name = group_name_for(type_id, types, groups)
        if group_name in SALVAGE_SOURCE_GROUPS:
            salvage_source_object_ids.add(type_id)
    salvage_ecosystems = source_ecosystems_for_object_ids(salvage_source_object_ids, ecosystem_facts)

    rogue_ecosystems = {
        ecosystem_id
        for ecosystem_id, facts in ecosystem_facts.items()
        if facts["hasRogueDrones"]
    }
    mining_ecosystems = {
        ecosystem_id
        for ecosystem_id, facts in ecosystem_facts.items()
        if facts["hasNaturalPatterns"]
        and "Starter" not in facts["name"]
        and "Trade Hub" not in facts["name"]
    }
    radiantium_object_id = 87595
    radiantium_ecosystems = source_ecosystems_for_object_ids({radiantium_object_id}, ecosystem_facts)

    mappings: dict[int, dict[str, Any]] = {}
    validation: list[dict[str, Any]] = []
    for material_id in sorted(material_ids):
        name = type_name(material_id, types)
        group_name = group_name_for(material_id, types, groups) or "Unknown"
        category_name = category_name_for(material_id, types, groups, categories) or "Unknown"
        source_object_ids: set[int] = set()
        source_ecosystems: set[int] = set()
        tier = "tier3"
        source_kind = "unknown"
        label = "source unknown"
        caveat = "No landscape/source-site mapping in static data."

        if category_name == ASTEROID_CATEGORY_NAME:
            if object_counts.get(material_id, 0) > 0:
                source_object_ids.add(material_id)
                source_ecosystems = source_ecosystems_for_object_ids(source_object_ids, ecosystem_facts)
                if not source_ecosystems:
                    source_ecosystems = set(mining_ecosystems)
                tier = "tier1"
                source_kind = "direct-node"
                label = "mineable node"
                caveat = None
            elif group_name.endswith(" Ores"):
                parent_id = find_parent_asteroid_type(
                    group_name, object_counts, types, groups, categories
                )
                validation.append(
                    {
                        "materialTypeId": material_id,
                        "materialName": name,
                        "oreGroup": group_name,
                        "parentTypeId": parent_id,
                        "parentName": type_name(parent_id, types) if parent_id else None,
                        "status": "validated" if parent_id else "source unknown",
                    }
                )
                if parent_id is not None:
                    source_object_ids.add(parent_id)
                    source_ecosystems = source_ecosystems_for_object_ids(
                        source_object_ids, ecosystem_facts
                    )
                    if not source_ecosystems:
                        source_ecosystems = set(mining_ecosystems)
                    tier = "tier1"
                    source_kind = "ore-group-hop"
                    label = f"mine {type_name(parent_id, types)} sites"
                    caveat = None
            elif group_name == "Rift":
                tier = "tier3"
                caveat = "Rift raw did not appear as a dungeon object in this build."

        elif group_name == SALVAGE_GROUP_NAME:
            source_object_ids = set(salvage_source_object_ids)
            source_ecosystems = set(salvage_ecosystems)
            if source_ecosystems:
                tier = "tier1"
                source_kind = "salvage-site"
                label = "salvage sites"
                caveat = None

        elif group_name == ROGUE_DRONE_GROUP_NAME:
            source_ecosystems = set(rogue_ecosystems)
            source_object_ids = set()
            if material_id == 83894 and radiantium_ecosystems:
                source_ecosystems.update(radiantium_ecosystems)
                source_object_ids.add(radiantium_object_id)
            tier = "tier2"
            source_kind = "rogue-drone-site-hint"
            label = "found in sites with rogue drones"
            caveat = (
                "Static data identifies rogue-drone site types, but no loot/drop table "
                "attributes this component to a specific NPC."
            )
            if material_id == 83894 and radiantium_ecosystems:
                label = "rogue-drone sites; also refines from Unrefined Radiantium"

        mappings[material_id] = {
            "typeId": material_id,
            "typeName": name,
            "groupName": group_name,
            "tier": tier,
            "sourceKind": source_kind,
            "label": label,
            "caveat": caveat,
            "sourceObjectTypeIds": sorted(source_object_ids),
            "sourceEcosystemIds": sorted(source_ecosystems),
        }

    return mappings, validation


def collect_system_sites(landscape: dict[int, dict[str, Any]]):
    system_sites: dict[int, dict[str, Any]] = {}
    site_count = 0
    for system_id, system in landscape.items():
        sid = int(system_id)
        eco_counts: Counter[int] = Counter()
        eco_tags: dict[int, set[str]] = defaultdict(set)
        grade_tags: set[str] = set()
        for zone_key in ("asteroidBelts", "trojans"):
            for zone in (system.get(zone_key) or {}).values():
                tags = {str(tag) for tag in (zone.get("tags") or []) if is_grade_tag(str(tag))}
                for site in (zone.get("sites") or {}).values():
                    ecosystem_id = site.get("ecosystemID") if isinstance(site, dict) else None
                    if ecosystem_id is None:
                        continue
                    eid = int(ecosystem_id)
                    eco_counts[eid] += 1
                    eco_tags[eid].update(tags)
                    grade_tags.update(tags)
                    site_count += 1
        system_sites[sid] = {
            "ecosystemCounts": eco_counts,
            "ecosystemTags": eco_tags,
            "gradeTags": grade_tags,
            "siteCount": sum(eco_counts.values()),
        }
    return system_sites, site_count


def build_outputs(
    material_mappings: dict[int, dict[str, Any]],
    system_sites: dict[int, dict[str, Any]],
    ecosystem_facts: dict[int, dict[str, Any]],
    system_states: dict[int, dict[str, Any]],
):
    material_sources: dict[str, Any] = {
        "version": 1,
        "ecosystems": {
            str(eid): facts["name"]
            for eid, facts in sorted(ecosystem_facts.items())
        },
        "materials": {},
    }
    system_acc: dict[int, dict[str, Any]] = defaultdict(
        lambda: {
            "materials": set(),
            "ecosystems": set(),
            "gradeTags": set(),
            "siteCount": 0,
        }
    )
    material_system_counts: dict[int, int] = defaultdict(int)

    for material_id, mapping in material_mappings.items():
        source_eids = set(mapping["sourceEcosystemIds"])
        if source_eids:
            for system_id, facts in system_sites.items():
                matched_eids = sorted(source_eids.intersection(facts["ecosystemCounts"].keys()))
                if not matched_eids:
                    continue
                site_count = sum(facts["ecosystemCounts"][eid] for eid in matched_eids)
                tags: set[str] = set()
                for eid in matched_eids:
                    tags.update(facts["ecosystemTags"].get(eid, set()))

                acc = system_acc[system_id]
                acc["materials"].add(material_id)
                acc["ecosystems"].update(matched_eids)
                acc["gradeTags"].update(tags)
                acc["siteCount"] += site_count
                material_system_counts[material_id] += 1

        material_sources["materials"][str(material_id)] = {
            "typeId": mapping["typeId"],
            "typeName": mapping["typeName"],
            "groupName": mapping["groupName"],
            "tier": mapping["tier"],
            "sourceKind": mapping["sourceKind"],
            "label": mapping["label"],
            "caveat": mapping["caveat"],
            "sourceObjectTypeIds": mapping["sourceObjectTypeIds"],
            "sourceEcosystemIds": mapping["sourceEcosystemIds"],
            "systemCount": material_system_counts[material_id],
        }

    material_index = sorted(material_mappings.keys())
    material_to_id = {type_id: i for i, type_id in enumerate(material_index)}
    ecosystem_index = sorted({eid for acc in system_acc.values() for eid in acc["ecosystems"]})
    ecosystem_to_id = {ecosystem_id: i for i, ecosystem_id in enumerate(ecosystem_index)}
    tag_index = sorted({tag for acc in system_acc.values() for tag in acc["gradeTags"]})
    tag_to_id = {tag: i for i, tag in enumerate(tag_index)}
    state_to_id = {"UNKNOWN": 0, "SETTLED": 1, "DEVASTATED": 2}

    def mask_pair(indexes: list[int]) -> list[int]:
        lo = 0
        hi = 0
        for index in indexes:
            if index < 32:
                lo |= 1 << index
            else:
                hi |= 1 << (index - 32)
        return [lo, hi]

    def mask(indexes: list[int]) -> int:
        value = 0
        for index in indexes:
            value |= 1 << index
        return value

    system_rows: list[list[Any]] = []
    for system_id, acc in sorted(system_acc.items()):
        mat_mask = mask_pair(sorted(material_to_id[type_id] for type_id in acc["materials"]))
        eco_mask = mask(sorted(ecosystem_to_id[ecosystem_id] for ecosystem_id in acc["ecosystems"]))
        tag_mask = mask(sorted(tag_to_id[tag] for tag in acc["gradeTags"]))
        state = str(system_states.get(system_id, {}).get("state") or "UNKNOWN")
        system_rows.append(
            [
                system_id,
                state_to_id.get(state, 0),
                mat_mask[0],
                mat_mask[1],
                eco_mask,
                tag_mask,
                acc["siteCount"],
            ]
        )

    system_resources = {
        "version": 1,
        "stateLegend": {str(v): k for k, v in state_to_id.items()},
        "materialTypeIds": material_index,
        "ecosystemIds": ecosystem_index,
        "tagLegend": tag_index,
        "systemRowSchema": [
            "systemId",
            "stateId",
            "materialMaskLo",
            "materialMaskHi",
            "ecosystemMask",
            "tagMask",
            "siteCount",
        ],
        "systems": system_rows,
    }
    return material_sources, system_resources


def save_json(data: Any, path: Path, *, pretty: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2 if pretty else None, ensure_ascii=False, separators=None if pretty else (",", ":"))
    size = path.stat().st_size
    print(f"  Saved {path.name} ({size:,} bytes)")


def main():
    parser = argparse.ArgumentParser(description="Extract EVE Frontier landscape source-site data")
    parser.add_argument("--game-root", default=str(GAME_ROOT), help="EVE Frontier install root")
    parser.add_argument("--server", default=SERVER, help="Server folder name")
    parser.add_argument("--output", default=None, help="Output directory")
    args = parser.parse_args()

    game_root = Path(args.game_root)
    server_dir = game_root / args.server
    bin64_dir = server_dir / "bin64"
    resfiles_dir = game_root / "ResFiles"
    index_file = server_dir / "resfileindex.txt"
    if args.output:
        output_dir = Path(args.output)
    else:
        output_dir = Path(__file__).resolve().parent.parent / "apps" / "periscope" / "public" / "data"

    if not bin64_dir.exists():
        raise FileNotFoundError(f"bin64 not found: {bin64_dir}")
    if not index_file.exists():
        raise FileNotFoundError(f"resfileindex not found: {index_file}")

    sys.path.insert(0, str(bin64_dir))

    print("EVE Frontier Landscape Data Extractor")
    print(f"  Game root: {game_root}")
    print(f"  Server:    {args.server}")
    print(f"  Output:    {output_dir}")
    print()

    start = time.time()
    print("[0/6] Resolving resfiles from index...")
    index = build_resfile_index(index_file)
    resfile_map: dict[str, str] = {}
    for key, respath in RESPATH_MAP.items():
        storage = index.get(respath.lower())
        if storage is None:
            raise KeyError(f"{respath} not found in {index_file}")
        resfile_map[key] = storage
    loc_resfile = index.get(LOCALIZATION_RESPATH.lower())
    if loc_resfile is None:
        raise KeyError(f"{LOCALIZATION_RESPATH} not found in {index_file}")

    build_number = read_build_number(server_dir)
    print(f"  Build: {build_number or 'unknown'}")
    print(f"  Landscape: {resfile_map['landscape']}")
    print()

    print("[1/6] Loading localization...")
    strings = load_localization(resfiles_dir, loc_resfile)
    print(f"  Loaded {len(strings):,} localized strings")
    print()

    print("[2/6] Loading static data...")
    types = {int(k): v for k, v in load_fsdbinary("types", resfiles_dir, resfile_map, strings).items()}
    groups = {int(k): v for k, v in load_fsdbinary("groups", resfiles_dir, resfile_map, strings).items()}
    categories = {
        int(k): v for k, v in load_fsdbinary("categories", resfiles_dir, resfile_map, strings).items()
    }
    blueprints = {
        int(k): v
        for k, v in load_fsdbinary("industry_blueprints", resfiles_dir, resfile_map, strings).items()
    }
    spacecomponents = {
        int(k): v
        for k, v in load_fsdbinary("spacecomponentsbytype", resfiles_dir, resfile_map, strings).items()
    }
    typematerials = {
        int(k): v for k, v in load_fsdbinary("typematerials", resfiles_dir, resfile_map, strings).items()
    }
    print()

    print("[3/6] Loading landscape/site data...")
    landscape = {
        int(k): v for k, v in load_fsdbinary("landscape", resfiles_dir, resfile_map, strings).items()
    }
    ecosystems = {
        int(k): v for k, v in load_fsdbinary("ecosystem", resfiles_dir, resfile_map, strings).items()
    }
    dungeons = {
        int(k): v for k, v in load_fsdbinary("dungeons", resfiles_dir, resfile_map, strings).items()
    }
    system_states = {
        int(k): v for k, v in load_fsdbinary("systemstate", resfiles_dir, resfile_map, strings).items()
    }
    print()

    print("[4/6] Building material/source indexes...")
    raw_material_ids = collect_raw_material_ids(blueprints, spacecomponents, types)
    dungeon_facts = collect_dungeon_facts(dungeons, types, groups, categories)
    gatherable_nodes = set(dungeon_facts["gatherable_nodes"])
    direct_required = REQUIRED_BYPRODUCT_NODE_IDS.intersection(dungeon_facts["object_counts"].keys())
    gatherable_nodes.update(REQUIRED_BYPRODUCT_NODE_IDS)
    missing_required = sorted(REQUIRED_BYPRODUCT_NODE_IDS - direct_required)
    if missing_required:
        print(
            "  NOTE: required byproduct nodes not direct room objects; "
            f"kept via validated ore-group parents: {missing_required}"
        )

    material_ids = set(raw_material_ids)
    material_ids.update(REQUIRED_BYPRODUCT_NODE_IDS)
    ecosystem_facts = collect_ecosystem_facts(ecosystems, dungeon_facts)
    material_mappings, ore_validation = build_material_mappings(
        material_ids, ecosystem_facts, dungeon_facts, types, groups, categories
    )
    system_sites, site_count = collect_system_sites(landscape)
    material_sources, system_resources = build_outputs(
        material_mappings, system_sites, ecosystem_facts, system_states
    )

    unmapped = [
        {
            "typeId": mapping["typeId"],
            "typeName": mapping["typeName"],
            "groupName": mapping["groupName"],
            "tier": mapping["tier"],
            "label": mapping["label"],
            "reason": mapping["caveat"],
        }
        for material_id, mapping in material_mappings.items()
        if material_id in raw_material_ids
        and (mapping["tier"] != "tier1" or not mapping["sourceEcosystemIds"])
    ]
    tier_counts = Counter(mapping["tier"] for mapping in material_mappings.values())
    print(f"  Raw leaf materials from blueprints: {len(raw_material_ids):,}")
    print(f"  Gatherable node object typeIds: {len(gatherable_nodes):,}")
    print(f"  Landscape systems: {len(landscape):,}; sites: {site_count:,}")
    print(f"  Material source records: {len(material_mappings):,}")
    print(f"  Tier counts: {dict(sorted(tier_counts.items()))}")
    print(f"  Unmapped/source-unknown records: {len(unmapped):,}")
    print()

    print("[5/6] Saving JSON outputs...")
    gatherable_output = {
        "version": 1,
        "build": build_number,
        "typeIds": sorted(gatherable_nodes),
    }
    save_json(gatherable_output, output_dir / "gatherable_nodes.json")
    save_json(material_sources, output_dir / "material_sources.json")
    save_json(system_resources, output_dir / "system_resources.json")

    elapsed = time.time() - start
    meta = {
        "version": "1.0.0",
        "source": "EVE Frontier client static data",
        "build": build_number,
        "server": args.server,
        "extractedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "extractionTimeSeconds": round(elapsed, 2),
        "resfiles": {
            key: resfile_map[key]
            for key in (
                "landscape",
                "ecosystem",
                "dungeons",
                "systemstate",
                "types",
                "groups",
                "categories",
                "industry_blueprints",
                "spacecomponentsbytype",
                "typematerials",
            )
        },
        "counts": {
            "landscapeSystems": len(landscape),
            "systemsWithResources": len(system_resources["systems"]),
            "sites": site_count,
            "ecosystems": len(ecosystems),
            "dungeons": len(dungeons),
            "rawLeafMaterials": len(raw_material_ids),
            "materialSourceRecords": len(material_mappings),
            "gatherableNodeTypeIds": len(gatherable_nodes),
            "tier1": tier_counts["tier1"],
            "tier2": tier_counts["tier2"],
            "tier3": tier_counts["tier3"],
            "unmapped": len(unmapped),
            "typematerialEntries": len(typematerials),
        },
        "requiredByproductNodes": {
            "expectedTypeIds": sorted(REQUIRED_BYPRODUCT_NODE_IDS),
            "present": sorted(REQUIRED_BYPRODUCT_NODE_IDS.intersection(gatherable_nodes)),
            "directRoomObjectTypeIds": sorted(direct_required),
            "viaValidatedOreGroupParent": missing_required,
        },
        "oreGroupHopValidation": ore_validation,
        "unmappedRaws": sorted(unmapped, key=lambda x: (x["tier"], x["typeName"])),
        "notes": [
            "Tier 1 is mineable/salvage-site mapped.",
            "Tier 2 identifies rogue-drone site types only; no static loot/drop table exists.",
            "Tier 3 is not landscape-sourced or has no validated static source.",
            "System rows are aggregate source-system summaries, not per-site records.",
        ],
    }
    save_json(meta, output_dir / "extraction_meta_landscape.json", pretty=True)

    print()
    print("[6/6] Done")
    print(f"  Completed in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
