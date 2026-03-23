import { WORLD_API } from "./constants";

const itemNameCache = new Map<number, string>();
const itemIconCache = new Map<number, string>();
const ITEM_CACHE_LIMIT = 500;

interface TypeInfo {
	name?: string;
	icon_url?: string;
}

/** Fetch type info from World API with caching.
 * Always uses stillness API — item types are shared across tenants and utopia has no World API. */
async function fetchTypeInfo(typeId: number): Promise<TypeInfo> {
	const baseUrl = WORLD_API.stillness;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 10_000);

	try {
		const res = await fetch(`${baseUrl}/v2/types/${typeId}`, { signal: controller.signal });
		clearTimeout(timeoutId);
		if (!res.ok) return {};
		return (await res.json()) as TypeInfo;
	} catch {
		clearTimeout(timeoutId);
		return {};
	}
}

/** Resolve an item type_id to its human-readable name via the World API. */
export async function resolveItemName(typeId: number): Promise<string> {
	const cached = itemNameCache.get(typeId);
	if (cached) return cached;

	const info = await fetchTypeInfo(typeId);
	const name = info.name ?? `Item #${typeId}`;
	if (itemNameCache.size >= ITEM_CACHE_LIMIT) itemNameCache.clear();
	itemNameCache.set(typeId, name);

	if (info.icon_url) {
		if (itemIconCache.size >= ITEM_CACHE_LIMIT) itemIconCache.clear();
		itemIconCache.set(typeId, info.icon_url);
	}

	return name;
}

/** Batch-resolve multiple type IDs. Returns a map of typeId -> name. */
export async function resolveItemNames(typeIds: number[]): Promise<Map<number, string>> {
	const results = new Map<number, string>();
	const toFetch: number[] = [];

	for (const id of typeIds) {
		const cached = itemNameCache.get(id);
		if (cached) {
			results.set(id, cached);
		} else {
			toFetch.push(id);
		}
	}

	await Promise.all(
		toFetch.map(async (id) => {
			const name = await resolveItemName(id);
			results.set(id, name);
		}),
	);

	return results;
}

/** Resolve an item type_id to its icon URL. Returns null if no icon available. */
export function resolveItemIcon(typeId: number): string | null {
	return itemIconCache.get(typeId) ?? null;
}
