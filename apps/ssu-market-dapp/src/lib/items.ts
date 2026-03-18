import { WORLD_API, getTenant } from "./constants";

const itemNameCache = new Map<number, string>();

/** Resolve an item type_id to its human-readable name via the World API. */
export async function resolveItemName(typeId: number): Promise<string> {
	const cached = itemNameCache.get(typeId);
	if (cached) return cached;

	const tenant = getTenant();
	const baseUrl = WORLD_API[tenant] ?? WORLD_API.stillness;

	try {
		const res = await fetch(`${baseUrl}/v2/types/${typeId}`);
		if (!res.ok) return `Item #${typeId}`;

		const data = (await res.json()) as { name?: string };
		const name = data.name ?? `Item #${typeId}`;
		itemNameCache.set(typeId, name);
		return name;
	} catch {
		return `Item #${typeId}`;
	}
}

/** Batch-resolve multiple type IDs. Returns a map of typeId → name. */
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
