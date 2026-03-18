import { getTenant, getWorldPackageId } from "@/lib/constants";
import { resolveItemNames } from "@/lib/items";
import { useQuery } from "@tanstack/react-query";
import { useSuiClient } from "./useSuiClient";

/** A wallet-held Item object (previously withdrawn from an SSU or received via transfer) */
export interface WalletItem {
	objectId: string;
	typeId: number;
	quantity: number;
	volume: number;
	tenant: string;
	itemId: number;
	name: string;
}

// ── GraphQL query for wallet-owned Item objects ─────────────────────────────

const LIST_WALLET_ITEMS = `
	query($owner: SuiAddress!, $itemType: String!, $first: Int, $after: String) {
		address(address: $owner) {
			objects(filter: { type: $itemType }, first: $first, after: $after) {
				nodes {
					address
					asMoveObject {
						contents { json }
					}
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	}
`;

interface GqlWalletItemsResponse {
	address: {
		objects: {
			nodes: Array<{
				address: string;
				asMoveObject?: {
					contents?: { json: Record<string, unknown> };
				};
			}>;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	} | null;
}

/**
 * Query wallet-held Item objects owned by the connected wallet address.
 *
 * These are `${worldPkg}::inventory::Item` objects that exist in the wallet --
 * typically from previous withdraw operations or transfers from other players.
 */
export function useWalletItems(walletAddress: string | undefined) {
	const client = useSuiClient();

	const rawQuery = useQuery({
		queryKey: ["wallet-items", walletAddress],
		queryFn: async (): Promise<WalletItem[]> => {
			if (!walletAddress) return [];

			const tenant = getTenant();
			const worldPkg = getWorldPackageId(tenant);
			const itemType = `${worldPkg}::inventory::Item`;

			const allItems: WalletItem[] = [];
			let cursor: string | null = null;

			// Paginate through all wallet-held Item objects
			for (let page = 0; page < 10; page++) {
				const result: { data?: GqlWalletItemsResponse | null } = await client.query({
					query: LIST_WALLET_ITEMS,
					variables: {
						owner: walletAddress,
						itemType,
						first: 50,
						after: cursor,
					},
				});

				const nodes = result.data?.address?.objects?.nodes ?? [];

				for (const node of nodes) {
					const json = node.asMoveObject?.contents?.json;
					if (!json) continue;

					allItems.push({
						objectId: node.address,
						typeId: Number(json.type_id ?? 0),
						quantity: Number(json.quantity ?? 0),
						volume: Number(json.volume ?? 0),
						tenant: String(json.tenant ?? ""),
						itemId: Number(json.item_id ?? 0),
						name: "", // resolved after
					});
				}

				const pi: { hasNextPage: boolean; endCursor: string | null } | undefined =
					result.data?.address?.objects?.pageInfo;
				if (!pi?.hasNextPage) break;
				cursor = pi.endCursor;
			}

			// Resolve item names
			const typeIds = [...new Set(allItems.map((i) => i.typeId))];
			if (typeIds.length > 0) {
				const nameMap = await resolveItemNames(typeIds);
				for (const item of allItems) {
					item.name = nameMap.get(item.typeId) ?? `Item #${item.typeId}`;
				}
			}

			return allItems;
		},
		enabled: !!walletAddress,
		staleTime: 15_000,
		refetchInterval: 30_000,
	});

	return {
		data: rawQuery.data ?? [],
		isLoading: rawQuery.isLoading,
	};
}
