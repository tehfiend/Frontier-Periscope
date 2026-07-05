import { db } from "@/db";
import { useLiveQuery } from "dexie-react-hooks";

/**
 * Resolve each SSU object id to its solar-system id using synced structure intel
 * (db.deployables + db.assemblies), inheriting a parent node's system when the unit itself has none
 * (parentId references a node by id or objectId). Shared by the Stock panel and the Assets page so a
 * storage's location can be shown before its live inventory is fetched.
 */
export function useSsuSystemMap(objectIds: string[]): Map<string, number> | undefined {
	const key = objectIds.join(",");
	return useLiveQuery(async () => {
		const map = new Map<string, number>();
		if (objectIds.length === 0) return map;
		const [deps, asms] = await Promise.all([db.deployables.toArray(), db.assemblies.toArray()]);
		const byKey = new Map<string, { systemId?: number; parentId?: string }>();
		for (const rec of [...deps, ...asms]) {
			if (!byKey.has(rec.id)) byKey.set(rec.id, rec);
			if (!byKey.has(rec.objectId)) byKey.set(rec.objectId, rec);
		}
		const resolve = (k: string, depth = 0): number | undefined => {
			const rec = byKey.get(k);
			if (!rec || depth > 4) return undefined;
			if (rec.systemId != null) return rec.systemId;
			return rec.parentId ? resolve(rec.parentId, depth + 1) : undefined;
		};
		for (const objectId of objectIds) {
			const sys = resolve(objectId);
			if (sys != null) map.set(objectId, sys);
		}
		return map;
		// biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the stable form of objectIds
	}, [key]);
}
