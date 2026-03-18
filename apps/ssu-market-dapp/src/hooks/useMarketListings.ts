import { useQuery } from "@tanstack/react-query";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { queryAllSellOrders } from "@tehfrontier/chain-shared";
import { resolveItemNames } from "@/lib/items";
import type { SellOrderInfo } from "@tehfrontier/chain-shared";

const client = new SuiGraphQLClient({
	url: "https://graphql.testnet.sui.io/graphql",
	network: "testnet",
});

export interface SellOrderWithName extends SellOrderInfo {
	name: string;
}

export function useMarketListings(configId: string | undefined) {
	return useQuery({
		queryKey: ["sellOrders", configId],
		queryFn: async (): Promise<SellOrderWithName[]> => {
			if (!configId) return [];
			const orders = await queryAllSellOrders(client, configId);

			const typeIds = orders.map((o) => o.typeId);
			const names = await resolveItemNames(typeIds);

			return orders.map((o) => ({
				...o,
				name: names.get(o.typeId) ?? `Item #${o.typeId}`,
			}));
		},
		enabled: !!configId,
		refetchInterval: 15_000,
	});
}
