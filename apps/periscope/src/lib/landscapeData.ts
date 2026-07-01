import type { Jump } from "@/db/types";
import { type GateGraph, buildGateGraph } from "@/lib/distance";
import { useEffect, useState } from "react";

export type LandscapeSourceTier = "tier1" | "tier2" | "tier3";

export interface LandscapeMaterialSource {
	typeId: number;
	typeName: string;
	groupName: string;
	tier: LandscapeSourceTier;
	sourceKind: string;
	label: string;
	caveat: string | null;
	sourceObjectTypeIds: number[];
	sourceEcosystemIds: number[];
	systemCount: number;
}

export interface LandscapeSystemResource {
	systemId: number;
	state: string;
	materialTypeIds: Set<number>;
	ecosystemIds: Set<number>;
	gradeTags: Set<string>;
	siteCount: number;
}

export interface LandscapeData {
	materials: Map<number, LandscapeMaterialSource>;
	ecosystems: Map<number, string>;
	systems: Map<number, LandscapeSystemResource>;
	materialSystemIds: Map<number, Set<number>>;
	gatherableNodeIds: Set<number>;
	gateGraph: GateGraph;
}

interface MaterialSourcesJson {
	ecosystems: Record<string, string>;
	materials: Record<string, LandscapeMaterialSource>;
}

interface SystemResourcesJson {
	stateLegend: Record<string, string>;
	materialTypeIds: number[];
	ecosystemIds: number[];
	tagLegend: string[];
	systems: Array<[number, number, number, number, number, number, number]>;
}

interface GatherableNodesJson {
	typeIds: number[];
}

let cachedData: LandscapeData | null = null;
let loadPromise: Promise<LandscapeData | null> | null = null;
let gatherableNodeIds: Set<number> | null = null;
let gatherablePromise: Promise<Set<number>> | null = null;
const listeners = new Set<(data: LandscapeData | null) => void>();

function hasMaskBit(lo: number, hi: number, index: number): boolean {
	if (index < 32) return (lo & (1 << index)) !== 0;
	return (hi & (1 << (index - 32))) !== 0;
}

function expandMask<T>(values: T[], mask: number): T[] {
	const out: T[] = [];
	for (let i = 0; i < values.length; i++) {
		if ((mask & (1 << i)) !== 0) out.push(values[i]);
	}
	return out;
}

async function fetchJson<T>(file: string): Promise<T> {
	const res = await fetch(`/data/${file}`);
	if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
	return res.json() as Promise<T>;
}

function notify() {
	for (const listener of listeners) listener(cachedData);
}

export async function loadGatherableNodeIds(): Promise<Set<number>> {
	if (gatherableNodeIds) return gatherableNodeIds;
	if (cachedData) return cachedData.gatherableNodeIds;
	if (gatherablePromise) return gatherablePromise;
	gatherablePromise = fetchJson<GatherableNodesJson>("gatherable_nodes.json")
		.then((json) => {
			gatherableNodeIds = new Set(json.typeIds ?? []);
			return gatherableNodeIds;
		})
		.catch((err) => {
			console.warn("[landscapeData] gatherable_nodes.json load failed:", err);
			gatherablePromise = null;
			return new Set<number>();
		});
	return gatherablePromise;
}

export async function loadLandscapeData(): Promise<LandscapeData | null> {
	if (cachedData) return cachedData;
	if (loadPromise) return loadPromise;
	loadPromise = Promise.all([
		fetchJson<MaterialSourcesJson>("material_sources.json"),
		fetchJson<SystemResourcesJson>("system_resources.json"),
		loadGatherableNodeIds(),
		fetchJson<Jump[]>("stellar_jumps.json"),
	])
		.then(([materialJson, systemJson, gatheredIds, jumps]) => {
			const ecosystems = new Map<number, string>();
			for (const [id, name] of Object.entries(materialJson.ecosystems ?? {})) {
				ecosystems.set(Number(id), name);
			}

			const materials = new Map<number, LandscapeMaterialSource>();
			for (const source of Object.values(materialJson.materials ?? {})) {
				materials.set(source.typeId, source);
			}

			const systems = new Map<number, LandscapeSystemResource>();
			const materialSystemIds = new Map<number, Set<number>>();
			for (const row of systemJson.systems ?? []) {
				const [systemId, stateId, matLo, matHi, ecoMask, tagMask, siteCount] = row;
				const materialTypeIds = new Set<number>();
				for (let i = 0; i < systemJson.materialTypeIds.length; i++) {
					if (hasMaskBit(matLo, matHi, i)) {
						const typeId = systemJson.materialTypeIds[i];
						materialTypeIds.add(typeId);
						let set = materialSystemIds.get(typeId);
						if (!set) {
							set = new Set<number>();
							materialSystemIds.set(typeId, set);
						}
						set.add(systemId);
					}
				}
				systems.set(systemId, {
					systemId,
					state: systemJson.stateLegend[String(stateId)] ?? "UNKNOWN",
					materialTypeIds,
					ecosystemIds: new Set(expandMask(systemJson.ecosystemIds, ecoMask)),
					gradeTags: new Set(expandMask(systemJson.tagLegend, tagMask)),
					siteCount,
				});
			}

			cachedData = {
				materials,
				ecosystems,
				systems,
				materialSystemIds,
				gatherableNodeIds: gatheredIds,
				gateGraph: buildGateGraph(jumps),
			};
			notify();
			return cachedData;
		})
		.catch((err) => {
			console.warn("[landscapeData] landscape data load failed:", err);
			loadPromise = null;
			return null;
		});
	return loadPromise;
}

export function getLandscapeData(): LandscapeData | null {
	return cachedData;
}

export function useLandscapeData(): LandscapeData | null {
	const [data, setData] = useState<LandscapeData | null>(cachedData);

	useEffect(() => {
		listeners.add(setData);
		if (!cachedData) void loadLandscapeData();
		return () => {
			listeners.delete(setData);
		};
	}, []);

	return data;
}
