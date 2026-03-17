import { WORLD_API, getTenant } from "./constants";

const itemNameCache = new Map<number, string>();
const itemIconCache = new Map<number, string>();

interface TypeInfo {
	name?: string;
	icon_url?: string;
}

/** Fetch type info from World API with caching */
async function fetchTypeInfo(typeId: number): Promise<TypeInfo> {
	const tenant = getTenant();
	const baseUrl = WORLD_API[tenant] ?? WORLD_API.stillness;

	try {
		const res = await fetch(`${baseUrl}/v2/types/${typeId}`);
		if (!res.ok) return {};
		return (await res.json()) as TypeInfo;
	} catch {
		return {};
	}
}

/** Resolve an item type_id to its human-readable name via the World API. */
export async function resolveItemName(typeId: number): Promise<string> {
	const cached = itemNameCache.get(typeId);
	if (cached) return cached;

	const info = await fetchTypeInfo(typeId);
	const name = info.name ?? `Item #${typeId}`;
	itemNameCache.set(typeId, name);

	if (info.icon_url) {
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
