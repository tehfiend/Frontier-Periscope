import type { Blueprint, BlueprintData } from "@/lib/bomTypes";
import { useEffect, useMemo, useState } from "react";

/** Known salvage-type leaf node typeIDs */
const SALVAGE_MATERIAL_IDS: Set<number> = new Set([
	88764, // Salvaged Materials
	88765, // Mummified Clone
]);

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
	/** Known salvage-type leaf nodes */
	salvageMaterialIds: Set<number>;
	/** Map of typeID -> volume (m3) from static types.json */
	volumeMap: Map<number, number>;
	/** All game types sorted by name (for search) */
	typeList: Array<{ id: number; name: string }>;
	/** blueprintID -> list of facility names that can run it */
	blueprintFacilities: Map<number, string[]>;
	/** Whether data is still loading */
	isLoading: boolean;
}

// Module-level cache so multiple consumers share the same fetch
let cachedData: BlueprintData | null = null;
let fetchPromise: Promise<BlueprintData | null> | null = null;

function fetchBlueprintData(): Promise<BlueprintData | null> {
	if (cachedData) return Promise.resolve(cachedData);
	if (fetchPromise) return fetchPromise;
	fetchPromise = fetch("/data/blueprints.json")
		.then((res) => {
			if (!res.ok) throw new Error(`Failed to load blueprints: ${res.status}`);
			return res.json() as Promise<BlueprintData>;
		})
		.then((d) => {
			cachedData = d;
			return d;
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
	/** blueprintID -> list of facility names that can run it */
	blueprintFacilities: Map<number, string[]>;
}

let cachedGameData: StaticGameData | null = null;
let gameDataPromise: Promise<StaticGameData> | null = null;

interface RawTypeEntry {
	typeID: number;
	typeNameID: string;
	volume: number;
}
interface RawFacilityEntry {
	facilityID: number;
	blueprints: Array<{ blueprintID: number }>;
}

function fetchStaticGameData(): Promise<StaticGameData> {
	if (cachedGameData) return Promise.resolve(cachedGameData);
	if (gameDataPromise) return gameDataPromise;
	gameDataPromise = Promise.all([
		fetch("/data/types.json").then((r) =>
			r.ok ? (r.json() as Promise<Record<string, RawTypeEntry>>) : ({} as Record<string, RawTypeEntry>),
		),
		fetch("/data/facilities.json").then((r) =>
			r.ok ? (r.json() as Promise<Record<string, RawFacilityEntry>>) : ({} as Record<string, RawFacilityEntry>),
		),
	])
		.then(([types, facilities]) => {
			const volumeMap = new Map<number, number>();
			const typeList: Array<{ id: number; name: string }> = [];
			const typeNames = new Map<number, string>();
			for (const t of Object.values(types)) {
				if (t.volume != null) volumeMap.set(t.typeID, t.volume);
				if (t.typeNameID) {
					typeList.push({ id: t.typeID, name: t.typeNameID });
					typeNames.set(t.typeID, t.typeNameID);
				}
			}
			typeList.sort((a, b) => a.name.localeCompare(b.name));

			const blueprintFacilities = new Map<number, string[]>();
			for (const fac of Object.values(facilities)) {
				const facName = typeNames.get(fac.facilityID) ?? `Facility #${fac.facilityID}`;
				for (const bp of fac.blueprints) {
					const existing = blueprintFacilities.get(bp.blueprintID);
					if (existing) {
						existing.push(facName);
					} else {
						blueprintFacilities.set(bp.blueprintID, [facName]);
					}
				}
			}

			cachedGameData = { volumeMap, typeList, blueprintFacilities };
			return cachedGameData;
		})
		.catch(() => {
			gameDataPromise = null;
			return {
				volumeMap: new Map<number, number>(),
				typeList: [],
				blueprintFacilities: new Map<number, string[]>(),
			};
		});
	return gameDataPromise;
}

/**
 * Classify whether a blueprint's recipe path is "ore" or "salvage".
 * A recipe is salvage-path if any of its recursive leaf-node inputs are salvage materials.
 */
export function classifyRecipePath(
	blueprint: Blueprint,
	outputToBlueprints: Map<number, Blueprint[]>,
	rawMaterialIds: Set<number>,
	salvageMaterialIds: Set<number>,
): "ore" | "salvage" {
	const visited = new Set<number>();
	const queue = blueprint.inputs.map((i) => i.typeID);

	while (queue.length > 0) {
		const typeId = queue.pop() as number;
		if (visited.has(typeId)) continue;
		visited.add(typeId);

		if (salvageMaterialIds.has(typeId)) return "salvage";
		if (rawMaterialIds.has(typeId)) continue;

		// Recurse into the first available blueprint for this intermediate
		const producers = outputToBlueprints.get(typeId);
		if (producers && producers.length > 0) {
			for (const input of producers[0].inputs) {
				queue.push(input.typeID);
			}
		}
	}
	return "ore";
}

/**
 * Find all typeIDs that are inputs but never outputs of any blueprint (raw/leaf nodes).
 */
export function findRawMaterials(blueprints: Record<string, Blueprint>): Set<number> {
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
	return raw;
}

/**
 * Compute default recipes: for each producible typeID, pick the most efficient
 * blueprint, preferring ore-path over salvage-path.
 *
 * Efficiency = total input quantity / target output quantity per run.
 * Lower is better. Ore-path recipes are ranked first; salvage-path only wins
 * when no ore-path recipe exists.
 */
export function computeDefaultRecipes(
	outputToBlueprints: Map<number, Blueprint[]>,
	rawMaterialIds: Set<number>,
	salvageMaterialIds: Set<number>,
): Map<number, number> {
	const defaults = new Map<number, number>();

	for (const [typeId, bps] of outputToBlueprints) {
		if (bps.length === 1) {
			defaults.set(typeId, bps[0].blueprintID);
			continue;
		}

		// Score each blueprint
		const scored = bps.map((bp) => {
			const outputQty = bp.outputs.find((o) => o.typeID === typeId)?.quantity ?? 1;
			const totalInputQty = bp.inputs.reduce((sum, i) => sum + i.quantity, 0);
			const efficiency = totalInputQty / outputQty;
			const path = classifyRecipePath(bp, outputToBlueprints, rawMaterialIds, salvageMaterialIds);
			return { bp, efficiency, path };
		});

		// Sort: ore-path first, then by efficiency (ascending)
		scored.sort((a, b) => {
			if (a.path !== b.path) return a.path === "ore" ? -1 : 1;
			return a.efficiency - b.efficiency;
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
	const [isLoading, setIsLoading] = useState(!cachedData || !cachedGameData);

	useEffect(() => {
		let active = true;
		Promise.all([fetchBlueprintData(), fetchStaticGameData()]).then(([d, gd]) => {
			if (!active) return;
			setData(d);
			setVolumeMap(gd.volumeMap);
			setTypeList(gd.typeList);
			setBlueprintFacilities(gd.blueprintFacilities);
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

	const rawMaterialIds = useMemo(() => findRawMaterials(blueprints), [blueprints]);

	const salvageMaterialIds = useMemo(() => SALVAGE_MATERIAL_IDS, []);

	const defaultRecipes = useMemo(
		() => computeDefaultRecipes(outputToBlueprints, rawMaterialIds, salvageMaterialIds),
		[outputToBlueprints, rawMaterialIds, salvageMaterialIds],
	);

	return {
		blueprints,
		blueprintList,
		outputToBlueprints,
		defaultRecipes,
		rawMaterialIds,
		salvageMaterialIds,
		volumeMap,
		typeList,
		blueprintFacilities,
		isLoading,
	};
}
