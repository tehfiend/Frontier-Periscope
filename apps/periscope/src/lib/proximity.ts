import { gateDistancesFrom } from "@/lib/distance";
import {
	type LandscapeMaterialSource,
	getLandscapeData,
	loadLandscapeData,
} from "@/lib/landscapeData";

export interface RankedSystem {
	systemId: number;
	jumps: number | undefined;
}

export interface SourceSiteRank {
	systemId: number;
	jumps: number | undefined;
	materials: LandscapeMaterialSource[];
	ecosystems: Array<{ id: number; name: string }>;
	gradeTags: string[];
	siteCount: number;
}

export function initProximityData(): Promise<unknown> {
	return loadLandscapeData();
}

export function rankSystemsByGatePath(
	fromSystemId: number | null | undefined,
	candidateSystemIds: Iterable<number>,
): RankedSystem[] {
	const candidates = [...new Set(candidateSystemIds)];
	const graph = getLandscapeData()?.gateGraph;
	const distances = graph && fromSystemId != null ? gateDistancesFrom(graph, fromSystemId) : null;
	return candidates
		.map((systemId, index) => ({
			systemId,
			jumps: distances?.get(systemId),
			index,
		}))
		.sort((a, b) => {
			if (a.jumps == null && b.jumps == null) return a.index - b.index;
			if (a.jumps == null) return 1;
			if (b.jumps == null) return -1;
			return a.jumps - b.jumps || a.systemId - b.systemId;
		})
		.map(({ systemId, jumps }) => ({ systemId, jumps }));
}

export function nearestSourceSites(
	fromSystemId: number | null | undefined,
	neededTypeIds: Iterable<number>,
): SourceSiteRank[] {
	const data = getLandscapeData();
	if (!data) return [];

	const bySystem = new Map<
		number,
		{
			materials: Map<number, LandscapeMaterialSource>;
			ecosystemIds: Set<number>;
			gradeTags: Set<string>;
			siteCount: number;
		}
	>();

	for (const typeId of new Set(neededTypeIds)) {
		const material = data.materials.get(typeId);
		const systemIds = data.materialSystemIds.get(typeId);
		if (!material || !systemIds) continue;
		const materialEcosystems = new Set(material.sourceEcosystemIds);
		for (const systemId of systemIds) {
			const system = data.systems.get(systemId);
			if (!system) continue;
			let entry = bySystem.get(systemId);
			if (!entry) {
				entry = {
					materials: new Map<number, LandscapeMaterialSource>(),
					ecosystemIds: new Set<number>(),
					gradeTags: new Set<string>(),
					siteCount: 0,
				};
				bySystem.set(systemId, entry);
			}
			entry.materials.set(typeId, material);
			for (const ecosystemId of system.ecosystemIds) {
				if (materialEcosystems.has(ecosystemId)) entry.ecosystemIds.add(ecosystemId);
			}
			for (const tag of system.gradeTags) entry.gradeTags.add(tag);
			entry.siteCount = Math.max(entry.siteCount, system.siteCount);
		}
	}

	const ranked = rankSystemsByGatePath(fromSystemId, bySystem.keys());
	return ranked.map(({ systemId, jumps }) => {
		const entry = bySystem.get(systemId);
		return {
			systemId,
			jumps,
			materials: [...(entry?.materials.values() ?? [])],
			ecosystems: [...(entry?.ecosystemIds ?? [])]
				.map((id) => ({ id, name: data.ecosystems.get(id) ?? `Ecosystem ${id}` }))
				.sort((a, b) => a.name.localeCompare(b.name)),
			gradeTags: [...(entry?.gradeTags ?? [])].sort(),
			siteCount: entry?.siteCount ?? 0,
		};
	});
}
