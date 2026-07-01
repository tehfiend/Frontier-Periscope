import type { Blueprint, BlueprintData, BlueprintInput } from "@/lib/bomTypes";
import { useEffect, useMemo, useState } from "react";

/**
 * Seed salvage-type leaf node typeIDs. The full set is derived at runtime from every
 * type in the game-data "Salvage" group (see salvageMaterialIds below); these two are
 * kept as a fallback in case group data fails to load.
 */
const SALVAGE_MATERIAL_IDS: Set<number> = new Set([
	88764, // Salvaged Materials
	88765, // Mummified Clone
]);

/** Game-data group name whose members are treated as salvage (looted, not produced). */
const SALVAGE_GROUP_NAME = "Salvage";

/** Offline heuristic for directly-gatherable asteroid leaf materials. */
const GATHERABLE_LEAF_GROUP_SUFFIX = " Ores";
const ASTEROID_CATEGORY_NAME = "Asteroid";
// Cross-check the name/category heuristic against the known gatherable ore groups.
const GATHERABLE_LEAF_GROUP_IDS = new Set([5012, 5013, 5014, 5015, 5017, 5018, 5019, 5020]);

interface BlueprintDataResult {
	/** Raw loaded data (keyed by blueprintID) */
	blueprints: Record<string, Blueprint>;
	/** Sorted list of all blueprints */
	blueprintList: Blueprint[];
	/** Map of output typeID -> all blueprints that produce it */
	outputToBlueprints: Map<number, Blueprint[]>;
	/** Map of typeID -> most efficient blueprintID (ore-path preferred) */
	defaultRecipes: Map<number, number>;
	/** TypeIDs that are inputs but never outputs (leaf nodes) */
	rawMaterialIds: Set<number>;
	/**
	 * Directly-gatherable leaf materials (they spawn as nodes) that a byproduct recipe may also
	 * output, so findRawMaterials would otherwise miss them. This is not an ore-vs-salvage rule.
	 */
	gatherableLeafIds: Set<number>;
	/** Known salvage-type leaf nodes */
	salvageMaterialIds: Set<number>;
	/** Map of typeID -> volume (m3) from static types.json */
	volumeMap: Map<number, number>;
	/** All game types sorted by name (for search) */
	typeList: Array<{ id: number; name: string }>;
	/** blueprintID -> list of LIVE (published) facility names that can run it */
	blueprintFacilities: Map<number, string[]>;
	/** Blueprints runnable by >= 1 published facility (buildable in the current game build) */
	buildableBlueprintIds: Set<number>;
	/**
	 * For blueprints with NO live facility, the names of the removed (published=0)
	 * facilities that used to run them -- a tooltip diagnostic only. Orphaned blueprints
	 * (listed by no facility at all) are absent from this map.
	 */
	removedFacilitiesByBlueprint: Map<number, string[]>;
	/** typeID -> group name */
	typeGroups: Map<number, string>;
	/** typeID -> category name */
	typeCategories: Map<number, string>;
	/** Whether data is still loading */
	isLoading: boolean;
}

/**
 * Deployable STRUCTURES are not in industry_blueprints; their build recipe lives in
 * spacecomponents.json under smartDeployable.constructionCost and is pre-extracted into
 * structures.json. We surface each one as a synthetic blueprint (ID = OFFSET + structureID)
 * so the Blueprint Library + Industry Calculator treat them like any other product. The
 * synthetic "facility" that runs them is the in-world Smart Assembly.
 */
const STRUCTURE_BP_ID_OFFSET = 9_000_000;
const STRUCTURE_FACILITY_NAME = "Smart Assembly";

/** A structure build recipe as stored in structures.json. */
interface RawStructure {
	structureID: number;
	structureName: string;
	buildTime: number;
	inputs: BlueprintInput[];
}
interface StructureData {
	structures: RawStructure[];
}

// Module-level cache so multiple consumers share the same fetch
let cachedStructures: RawStructure[] | null = null;
let structuresPromise: Promise<RawStructure[]> | null = null;

function fetchStructures(): Promise<RawStructure[]> {
	if (cachedStructures) return Promise.resolve(cachedStructures);
	if (structuresPromise) return structuresPromise;
	structuresPromise = fetch("/data/structures.json")
		.then((res) => {
			if (!res.ok) throw new Error(`Failed to load structures: ${res.status}`);
			return res.json() as Promise<StructureData>;
		})
		.then((d) => {
			cachedStructures = d.structures ?? [];
			return cachedStructures;
		})
		.catch(() => {
			structuresPromise = null;
			return [];
		});
	return structuresPromise;
}

/** Format a build time (seconds) the same way the Python extractor formats runTime. */
function formatBuildTime(seconds: number): string {
	if (seconds <= 0) return "instant";
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;
	const parts: string[] = [];
	if (hours) parts.push(`${hours}h`);
	if (minutes) parts.push(`${minutes}m`);
	if (secs) parts.push(`${secs}s`);
	return parts.length ? parts.join(" ") : "0s";
}

/** Build a synthetic Blueprint from a structure recipe. */
function structureToBlueprint(s: RawStructure): Blueprint {
	return {
		blueprintID: STRUCTURE_BP_ID_OFFSET + s.structureID,
		primaryTypeID: s.structureID,
		primaryTypeName: s.structureName,
		runTime: s.buildTime,
		runTimeFormatted: formatBuildTime(s.buildTime),
		inputs: s.inputs,
		outputs: [{ typeID: s.structureID, typeName: s.structureName, quantity: 1 }],
	};
}

// Module-level cache so multiple consumers share the same fetch
let cachedData: BlueprintData | null = null;
let fetchPromise: Promise<BlueprintData | null> | null = null;

function fetchBlueprintData(): Promise<BlueprintData | null> {
	if (cachedData) return Promise.resolve(cachedData);
	if (fetchPromise) return fetchPromise;
	fetchPromise = Promise.all([
		fetch("/data/blueprints.json").then((res) => {
			if (!res.ok) throw new Error(`Failed to load blueprints: ${res.status}`);
			return res.json() as Promise<BlueprintData>;
		}),
		fetchStructures(),
	])
		.then(([d, structures]) => {
			// Merge synthetic structure blueprints so all downstream useMemo derivations
			// (outputToBlueprints/defaultRecipes/rawMaterialIds) include structures automatically.
			const blueprints: Record<string, Blueprint> = { ...d.blueprints };
			for (const s of structures) {
				const bp = structureToBlueprint(s);
				blueprints[String(bp.blueprintID)] = bp;
			}
			cachedData = { ...d, blueprints };
			return cachedData;
		})
		.catch(() => {
			fetchPromise = null;
			return null;
		});
	return fetchPromise;
}

// Static game data cache -- types.json + facilities.json
interface StaticGameData {
	volumeMap: Map<number, number>;
	typeList: Array<{ id: number; name: string }>;
	/** blueprintID -> list of LIVE (published) facility names that can run it */
	blueprintFacilities: Map<number, string[]>;
	/** Blueprints runnable by >= 1 published facility */
	buildableBlueprintIds: Set<number>;
	/** blueprintID (no live facility) -> names of removed facilities that used to run it */
	removedFacilitiesByBlueprint: Map<number, string[]>;
	/** typeID -> group name */
	typeGroups: Map<number, string>;
	/** typeID -> category name */
	typeCategories: Map<number, string>;
	/**
	 * Directly-gatherable leaf materials from the offline group/category heuristic. These spawn as
	 * nodes and remain raw even when a byproduct recipe also outputs them.
	 */
	gatherableLeafIds: Set<number>;
}

let cachedGameData: StaticGameData | null = null;
let gameDataPromise: Promise<StaticGameData> | null = null;

interface RawTypeEntry {
	typeID: number;
	typeNameID: string;
	volume: number;
	groupID?: number;
	/** 1 = live in the current game build, 0 = removed/not-yet-released */
	published?: number;
}
interface RawFacilityEntry {
	facilityID: number;
	blueprints: Array<{ blueprintID: number }>;
}
interface RawGroupEntry {
	groupID: number;
	groupNameID: string;
	categoryID: number;
}
interface RawCategoryEntry {
	categoryID: number;
	categoryNameID: string;
}

function fetchStaticGameData(): Promise<StaticGameData> {
	if (cachedGameData) return Promise.resolve(cachedGameData);
	if (gameDataPromise) return gameDataPromise;
	gameDataPromise = Promise.all([
		fetch("/data/types.json").then((r) =>
			r.ok
				? (r.json() as Promise<Record<string, RawTypeEntry>>)
				: ({} as Record<string, RawTypeEntry>),
		),
		fetch("/data/facilities.json").then((r) =>
			r.ok
				? (r.json() as Promise<Record<string, RawFacilityEntry>>)
				: ({} as Record<string, RawFacilityEntry>),
		),
		fetch("/data/groups.json").then((r) =>
			r.ok
				? (r.json() as Promise<Record<string, RawGroupEntry>>)
				: ({} as Record<string, RawGroupEntry>),
		),
		fetch("/data/categories.json").then((r) =>
			r.ok
				? (r.json() as Promise<Record<string, RawCategoryEntry>>)
				: ({} as Record<string, RawCategoryEntry>),
		),
		fetchStructures(),
	])
		.then(([types, facilities, groups, categories, structures]) => {
			const volumeMap = new Map<number, number>();
			const typeList: Array<{ id: number; name: string }> = [];
			const typeNames = new Map<number, string>();
			const typeGroupIds = new Map<number, number>();
			const publishedTypeIds = new Set<number>();
			for (const t of Object.values(types)) {
				if (t.volume != null) volumeMap.set(t.typeID, t.volume);
				if (t.typeNameID) {
					typeList.push({ id: t.typeID, name: t.typeNameID });
					typeNames.set(t.typeID, t.typeNameID);
				}
				if (t.groupID != null) typeGroupIds.set(t.typeID, t.groupID);
				if (t.published === 1) publishedTypeIds.add(t.typeID);
			}
			typeList.sort((a, b) => a.name.localeCompare(b.name));

			// Build group and category lookups
			const groupMap = new Map<number, RawGroupEntry>();
			for (const g of Object.values(groups)) groupMap.set(g.groupID, g);
			const categoryMap = new Map<number, string>();
			for (const c of Object.values(categories)) categoryMap.set(c.categoryID, c.categoryNameID);

			const typeGroups = new Map<number, string>();
			const typeCategories = new Map<number, string>();
			const gatherableLeafIds = new Set<number>();
			for (const [typeId, groupId] of typeGroupIds) {
				const group = groupMap.get(groupId);
				if (group) {
					typeGroups.set(typeId, group.groupNameID);
					const catName = categoryMap.get(group.categoryID);
					if (catName) typeCategories.set(typeId, catName);
					if (
						group.groupNameID.endsWith(GATHERABLE_LEAF_GROUP_SUFFIX) &&
						catName === ASTEROID_CATEGORY_NAME &&
						GATHERABLE_LEAF_GROUP_IDS.has(groupId)
					) {
						gatherableLeafIds.add(typeId);
					}
				}
			}

			// Only LIVE (published) facilities can run a blueprint in the current game build.
			// Removed facilities (published=0, e.g. the Assembler/Berths removed in Cycle 6) are tracked
			// separately so the UI can explain why a blueprint is Unavailable.
			const blueprintFacilities = new Map<number, string[]>();
			const removedFacilitiesByBlueprint = new Map<number, string[]>();
			for (const fac of Object.values(facilities)) {
				const facName = typeNames.get(fac.facilityID) ?? `Facility #${fac.facilityID}`;
				const isPublished = publishedTypeIds.has(fac.facilityID);
				for (const bp of fac.blueprints) {
					if (isPublished) {
						const existing = blueprintFacilities.get(bp.blueprintID);
						if (existing) {
							existing.push(facName);
						} else {
							blueprintFacilities.set(bp.blueprintID, [facName]);
						}
					} else {
						const existing = removedFacilitiesByBlueprint.get(bp.blueprintID);
						if (existing) {
							existing.push(facName);
						} else {
							removedFacilitiesByBlueprint.set(bp.blueprintID, [facName]);
						}
					}
				}
			}
			// Keep removed-facility detail only for blueprints with NO live facility:
			// a blueprint runnable by both a live and a removed facility is buildable.
			for (const bpId of removedFacilitiesByBlueprint.keys()) {
				if (blueprintFacilities.has(bpId)) removedFacilitiesByBlueprint.delete(bpId);
			}

			const buildableBlueprintIds = new Set<number>(blueprintFacilities.keys());

			// Synthetic structure blueprints run on the in-world Smart Assembly. A structure is
			// buildable only if its underlying type is published in the current game build;
			// otherwise it is surfaced as removed so the UI can explain the unavailability.
			for (const s of structures) {
				const bpId = STRUCTURE_BP_ID_OFFSET + s.structureID;
				blueprintFacilities.set(bpId, [STRUCTURE_FACILITY_NAME]);
				if (publishedTypeIds.has(s.structureID)) {
					buildableBlueprintIds.add(bpId);
				} else {
					removedFacilitiesByBlueprint.set(bpId, [STRUCTURE_FACILITY_NAME]);
				}
			}

			cachedGameData = {
				volumeMap,
				typeList,
				blueprintFacilities,
				buildableBlueprintIds,
				removedFacilitiesByBlueprint,
				typeGroups,
				typeCategories,
				gatherableLeafIds,
			};
			return cachedGameData;
		})
		.catch(() => {
			gameDataPromise = null;
			return {
				volumeMap: new Map<number, number>(),
				typeList: [],
				blueprintFacilities: new Map<number, string[]>(),
				buildableBlueprintIds: new Set<number>(),
				removedFacilitiesByBlueprint: new Map<number, string[]>(),
				typeGroups: new Map<number, string>(),
				typeCategories: new Map<number, string>(),
				gatherableLeafIds: new Set<number>(),
			};
		});
	return gameDataPromise;
}

/**
 * Whether a blueprint can be built in the current game build, i.e. at least one
 * published (live) facility can run it.
 */
export function isBuildable(blueprintID: number, buildableBlueprintIds: Set<number>): boolean {
	return buildableBlueprintIds.has(blueprintID);
}

/**
 * Refinery-class facility names. The Cycle 6 "Material Processor" is the entry-tier
 * refinery (reprocesses ore -> minerals) but its name lacks the "Refinery" substring,
 * so it must be matched explicitly. Used for facility grouping and for refinery-specific
 * display (time-per-input, input-material labels) across the Industry/Blueprint views.
 */
export function isRefineryFacility(facilityName: string): boolean {
	return facilityName.includes("Refinery") || facilityName === "Material Processor";
}

/**
 * Find all typeIDs that are inputs but never outputs of any blueprint (raw/leaf nodes).
 */
export function findRawMaterials(
	blueprints: Record<string, Blueprint>,
	alwaysRawIds?: Set<number>,
): Set<number> {
	const allOutputIds = new Set<number>();
	const allInputIds = new Set<number>();
	for (const bp of Object.values(blueprints)) {
		for (const out of bp.outputs) allOutputIds.add(out.typeID);
		for (const inp of bp.inputs) allInputIds.add(inp.typeID);
	}
	const raw = new Set<number>();
	for (const id of allInputIds) {
		if (!allOutputIds.has(id)) raw.add(id);
	}
	if (alwaysRawIds) {
		for (const id of alwaysRawIds) raw.add(id);
	}
	return raw;
}

/**
 * Compute default recipes: for each producible typeID, pick the primary-output recipe.
 *
 * Efficiency = total input quantity / target output quantity per run.
 * Sole-output recipes rank first; otherwise a strict unique-largest-output recipe ranks next.
 */
export function computeDefaultRecipes(
	outputToBlueprints: Map<number, Blueprint[]>,
	rawMaterialIds: Set<number>,
): Map<number, number> {
	const defaults = new Map<number, number>();

	for (const [typeId, bps] of outputToBlueprints) {
		if (rawMaterialIds.has(typeId)) continue;
		if (bps.length === 1) {
			defaults.set(typeId, bps[0].blueprintID);
			continue;
		}

		const scored = bps.map((bp) => {
			const outputQty = bp.outputs.find((o) => o.typeID === typeId)?.quantity ?? 1;
			const totalInputQty = bp.inputs.reduce((sum, i) => sum + i.quantity, 0);
			const efficiency = totalInputQty / outputQty;
			const soleOutput = bp.outputs.length === 1 && bp.outputs[0].typeID === typeId;
			const maxOutputQty = Math.max(...bp.outputs.map((o) => o.quantity));
			const maxOutputCount = bp.outputs.filter((o) => o.quantity === maxOutputQty).length;
			const uniqueLargestOutput = outputQty === maxOutputQty && maxOutputCount === 1;
			return { bp, efficiency, soleOutput, uniqueLargestOutput };
		});

		scored.sort((a, b) => {
			if (a.soleOutput !== b.soleOutput) return a.soleOutput ? -1 : 1;
			if (a.uniqueLargestOutput !== b.uniqueLargestOutput) return a.uniqueLargestOutput ? -1 : 1;
			if (a.efficiency !== b.efficiency) return a.efficiency - b.efficiency;
			return a.bp.blueprintID - b.bp.blueprintID;
		});

		defaults.set(typeId, scored[0].bp.blueprintID);
	}

	return defaults;
}

export function useBlueprintData(): BlueprintDataResult {
	const [data, setData] = useState<BlueprintData | null>(cachedData);
	const [volumeMap, setVolumeMap] = useState<Map<number, number>>(
		cachedGameData?.volumeMap ?? new Map(),
	);
	const [typeList, setTypeList] = useState<Array<{ id: number; name: string }>>(
		cachedGameData?.typeList ?? [],
	);
	const [blueprintFacilities, setBlueprintFacilities] = useState<Map<number, string[]>>(
		cachedGameData?.blueprintFacilities ?? new Map(),
	);
	const [buildableBlueprintIds, setBuildableBlueprintIds] = useState<Set<number>>(
		cachedGameData?.buildableBlueprintIds ?? new Set(),
	);
	const [removedFacilitiesByBlueprint, setRemovedFacilitiesByBlueprint] = useState<
		Map<number, string[]>
	>(cachedGameData?.removedFacilitiesByBlueprint ?? new Map());
	const [typeGroups, setTypeGroups] = useState<Map<number, string>>(
		cachedGameData?.typeGroups ?? new Map(),
	);
	const [typeCategories, setTypeCategories] = useState<Map<number, string>>(
		cachedGameData?.typeCategories ?? new Map(),
	);
	const [gatherableLeafIds, setGatherableLeafIds] = useState<Set<number>>(
		cachedGameData?.gatherableLeafIds ?? new Set(),
	);
	const [isLoading, setIsLoading] = useState(!cachedData || !cachedGameData);

	useEffect(() => {
		let active = true;
		Promise.all([fetchBlueprintData(), fetchStaticGameData()]).then(([d, gd]) => {
			if (!active) return;
			setData(d);
			setVolumeMap(gd.volumeMap);
			setTypeList(gd.typeList);
			setBlueprintFacilities(gd.blueprintFacilities);
			setBuildableBlueprintIds(gd.buildableBlueprintIds);
			setRemovedFacilitiesByBlueprint(gd.removedFacilitiesByBlueprint);
			setTypeGroups(gd.typeGroups);
			setTypeCategories(gd.typeCategories);
			setGatherableLeafIds(gd.gatherableLeafIds);
			setIsLoading(false);
		});
		return () => {
			active = false;
		};
	}, []);

	const blueprints = data?.blueprints ?? {};

	const blueprintList = useMemo(() => {
		return Object.values(blueprints).sort((a, b) =>
			a.primaryTypeName.localeCompare(b.primaryTypeName),
		);
	}, [blueprints]);

	const outputToBlueprints = useMemo(() => {
		const map = new Map<number, Blueprint[]>();
		for (const bp of Object.values(blueprints)) {
			for (const out of bp.outputs) {
				const existing = map.get(out.typeID);
				if (existing) {
					existing.push(bp);
				} else {
					map.set(out.typeID, [bp]);
				}
			}
		}
		return map;
	}, [blueprints]);

	const rawMaterialIds = useMemo(
		() => findRawMaterials(blueprints, gatherableLeafIds),
		[blueprints, gatherableLeafIds],
	);

	// Derive the salvage set from the "Salvage" group so ALL salvage materials (e.g. Cargo
	// Debris, Cinderwrack) are gated, not just the two hardcoded seeds. Falls back to the
	// seed set if group data has not loaded yet.
	const salvageMaterialIds = useMemo(() => {
		const ids = new Set<number>(SALVAGE_MATERIAL_IDS);
		for (const [typeId, groupName] of typeGroups) {
			// Only LEAF raws: the "Salvage" group also contains ore-craftable items
			// (e.g. Brace Weld, Coolant Reservoir) that must NOT be treated as salvage,
			// or recipes consuming them get mislabeled salvage-path.
			if (groupName === SALVAGE_GROUP_NAME && rawMaterialIds.has(typeId)) ids.add(typeId);
		}
		return ids;
	}, [typeGroups, rawMaterialIds]);

	const defaultRecipes = useMemo(
		() => computeDefaultRecipes(outputToBlueprints, rawMaterialIds),
		[outputToBlueprints, rawMaterialIds],
	);

	return {
		blueprints,
		blueprintList,
		outputToBlueprints,
		defaultRecipes,
		rawMaterialIds,
		gatherableLeafIds,
		salvageMaterialIds,
		volumeMap,
		typeList,
		blueprintFacilities,
		buildableBlueprintIds,
		removedFacilitiesByBlueprint,
		typeGroups,
		typeCategories,
		isLoading,
	};
}
