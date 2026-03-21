import { WORLD_API } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";

export interface GameItem {
	typeId: number;
	name: string;
	groupName: string;
}

/**
 * Fetch all game item types from the World API.
 * Uses the stillness endpoint (item types are shared across tenants).
 */
export function useGameItems() {
	return useQuery({
		queryKey: ["gameItems"],
		queryFn: async (): Promise<GameItem[]> => {
			const baseUrl = WORLD_API.stillness;
			const items: GameItem[] = [];
			let offset = 0;
			const limit = 100;

			while (true) {
				const res = await fetch(`${baseUrl}/v2/types?limit=${limit}&offset=${offset}`);
				if (!res.ok) break;

				const data = await res.json();
				const entries = data.data ?? [];

				for (const entry of entries) {
					items.push({
						typeId: Number(entry.id),
						name: String(entry.name ?? `Item #${entry.id}`),
						groupName: String(entry.groupName ?? ""),
					});
				}

				if (entries.length < limit) break;
				offset += limit;
			}

			return items.sort((a, b) => a.name.localeCompare(b.name));
		},
		staleTime: 10 * 60_000,
	});
}
