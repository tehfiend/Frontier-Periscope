import { db } from "@/db";
import type { StructureExtensionConfig } from "@/db/types";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";

/**
 * Hook to fetch and cache extension configs for owned structures.
 *
 * Reads from the structureExtensionConfigs IndexedDB table, which is populated
 * by the StandingsExtensionPanel when a user configures an extension.
 *
 * Returns a Map<assemblyId, StructureExtensionConfig> for efficient lookup.
 */
export function useStructureExtensions() {
	const configs = useLiveQuery(() => db.structureExtensionConfigs.toArray(), []);

	const configMap = useMemo(() => {
		const map = new Map<string, StructureExtensionConfig>();
		for (const config of configs ?? []) {
			map.set(config.assemblyId, config);
		}
		return map;
	}, [configs]);

	return {
		configs: configs ?? [],
		configMap,
		getConfig: (assemblyId: string) => configMap.get(assemblyId) ?? null,
	};
}

/**
 * Hook to get a single structure's extension config.
 * Reactive via useLiveQuery -- updates automatically when the config changes.
 */
export function useStructureExtensionConfig(assemblyId: string | null) {
	const config = useLiveQuery(
		() => (assemblyId ? db.structureExtensionConfigs.get(assemblyId) : undefined),
		[assemblyId],
	);

	return config ?? null;
}
