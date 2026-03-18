import { useQuery } from "@tanstack/react-query";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	getObjectJson,
	listDynamicFieldsGql,
	getDynamicFieldJson,
} from "@tehfrontier/chain-shared";
import { resolveItemNames } from "@/lib/items";

const client = new SuiGraphQLClient({
	url: "https://graphql.testnet.sui.io/graphql",
	network: "testnet",
});

export interface InventoryItem {
	typeId: number;
	quantity: number;
	name: string;
}

/**
 * Fetch SSU owner inventory items by querying dynamic fields on the SSU's
 * inventory object.
 */
export function useInventory(ssuId: string | undefined) {
	return useQuery({
		queryKey: ["ssuInventory", ssuId],
		queryFn: async (): Promise<InventoryItem[]> => {
			if (!ssuId) return [];

			// Fetch SSU object to find the inventory field
			const ssuObj = await getObjectJson(client, ssuId);
			if (!ssuObj?.json) return [];

			const inventoryField = (ssuObj.json as Record<string, unknown>).inventory as {
				fields?: { id?: { id?: string } };
			};
			const inventoryId = inventoryField?.fields?.id?.id;
			if (!inventoryId) return [];

			// Enumerate inventory items via dynamic fields
			const items: InventoryItem[] = [];
			let cursor: string | null = null;
			let hasMore = true;

			while (hasMore) {
				const page = await listDynamicFieldsGql(client, inventoryId, {
					cursor,
					limit: 50,
				});

				for (const df of page.entries) {
					try {
						const dfFields = await getDynamicFieldJson(client, inventoryId, {
							type: df.nameType,
							value: String(df.nameJson),
						});
						if (!dfFields) continue;

						const typeId = Number(df.nameJson);
						const quantity = Number(
							(dfFields as Record<string, unknown>).quantity ?? 0,
						);
						items.push({ typeId, quantity, name: "" });
					} catch {
						// skip
					}
				}

				hasMore = page.hasNextPage;
				cursor = page.cursor;
			}

			// Resolve names
			const names = await resolveItemNames(items.map((i) => i.typeId));
			return items.map((i) => ({
				...i,
				name: names.get(i.typeId) ?? `Item #${i.typeId}`,
			}));
		},
		enabled: !!ssuId,
		refetchInterval: 30_000,
	});
}
