import { db } from "@/db";
import type { GameType } from "@/db/types";

const BASE_URL = "https://world-api-stillness.live.tech.evefrontier.com";

interface WorldApiTypeResponse {
	id: number;
	name: string;
	description: string;
	mass: number;
	radius: number;
	volume: number;
	portionSize: number;
	groupName: string;
	groupId: number;
	categoryName: string;
	categoryId: number;
	iconUrl: string;
}

interface PaginatedResponse<T> {
	data: T[];
	meta: { total: number; page: number; pageSize: number };
}

/** Fetch all game types from the World API and store in IndexedDB. */
export async function fetchAndStoreGameTypes(): Promise<number> {
	let page = 1;
	const pageSize = 100;
	let allTypes: GameType[] = [];

	while (true) {
		let res: Response | null = null;
		for (let attempt = 0; attempt < 2; attempt++) {
			res = await fetch(`${BASE_URL}/v2/types?page=${page}&pageSize=${pageSize}`);
			if (res.ok) break;
			if (attempt === 0 && res.status >= 500) {
				await new Promise((r) => setTimeout(r, 1000));
				continue;
			}
			throw new Error(`World API error: ${res.status}`);
		}
		const body = await res!.json();

		// Handle both paginated { data, meta } and plain array responses
		const items: WorldApiTypeResponse[] = Array.isArray(body) ? body : body.data ?? [];
		allTypes = allTypes.concat(items);

		const total = body?.meta?.total;
		if (items.length < pageSize || (total != null && allTypes.length >= total)) break;
		page++;
	}

	await db.gameTypes.clear();
	await db.gameTypes.bulkPut(allTypes);
	await db.cacheMetadata.put({
		key: "gameTypes",
		version: "world-api-v2",
		importedAt: new Date().toISOString(),
		counts: { types: allTypes.length },
	});

	return allTypes.length;
}
