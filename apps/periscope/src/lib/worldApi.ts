import { db } from "@/db";
import type { GameType } from "@/db/types";

/** Cache version for gameTypes -- bump to force a re-import. Item names are now sourced from the
 *  local client-extracted data files (types.json + groups.json + categories.json) so they resolve
 *  offline; the World API host has been down since the Cycle 6 cutover. DataInitializer compares the
 *  stored cacheMetadata.gameTypes.version against this to decide whether to re-import. */
export const GAME_TYPES_VERSION = "local-types-cycle6";

interface RawTypeEntry {
	typeID: number;
	/** Resolved display name (the field name is a legacy misnomer -- it holds the plain name). */
	typeNameID?: string;
	mass?: number;
	radius?: number;
	volume?: number;
	portionSize?: number;
	groupID?: number;
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

async function fetchJson<T>(path: string): Promise<T> {
	const res = await fetch(path);
	if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
	return res.json() as Promise<T>;
}

/**
 * Populate db.gameTypes from the local client-extracted data files. This replaces the old World API
 * fetch: names, groups and categories all come from the same static data that powers the Build Queue
 * and Blueprint Library, so item names resolve everywhere (Sonar events, field storage, Assets)
 * without a live World API. Returns the number of types stored.
 */
export async function fetchAndStoreGameTypes(): Promise<number> {
	const [types, groups, categories] = await Promise.all([
		fetchJson<Record<string, RawTypeEntry>>("/data/types.json"),
		fetchJson<Record<string, RawGroupEntry>>("/data/groups.json"),
		fetchJson<Record<string, RawCategoryEntry>>("/data/categories.json"),
	]);

	const groupMap = new Map<number, RawGroupEntry>();
	for (const g of Object.values(groups)) groupMap.set(g.groupID, g);
	const categoryNameMap = new Map<number, string>();
	for (const c of Object.values(categories)) categoryNameMap.set(c.categoryID, c.categoryNameID);

	const allTypes: GameType[] = [];
	for (const t of Object.values(types)) {
		if (!t.typeNameID) continue; // skip unnamed placeholder rows
		const group = t.groupID != null ? groupMap.get(t.groupID) : undefined;
		const categoryId = group?.categoryID ?? 0;
		allTypes.push({
			id: t.typeID,
			name: t.typeNameID,
			description: "",
			mass: t.mass ?? 0,
			radius: t.radius ?? 0,
			volume: t.volume ?? 0,
			portionSize: t.portionSize ?? 1,
			groupId: t.groupID ?? 0,
			groupName: group?.groupNameID ?? "",
			categoryId,
			categoryName: categoryNameMap.get(categoryId) ?? "",
			iconUrl: "",
		});
	}

	await db.gameTypes.clear();
	await db.gameTypes.bulkPut(allTypes);
	await db.cacheMetadata.put({
		key: "gameTypes",
		version: GAME_TYPES_VERSION,
		importedAt: new Date().toISOString(),
		counts: { types: allTypes.length },
	});

	return allTypes.length;
}
