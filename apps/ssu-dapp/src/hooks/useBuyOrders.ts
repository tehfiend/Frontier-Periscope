import { resolveItemNames } from "@/lib/items";
import { useQuery } from "@tanstack/react-query";
import { type MarketBuyOrder, queryMarketBuyOrders } from "@tehfrontier/chain-shared";
import { getMarketPackageId } from "@/lib/constants";
import { useSuiClient } from "./useSuiClient";

export interface BuyOrderWithName extends MarketBuyOrder {
	name: string;
}

/**
 * Fetch buy orders from a Market<T> by marketId.
 * Only enabled when marketId is provided.
 */
export function useBuyOrders(marketId: string | null | undefined) {
	const client = useSuiClient();
	const marketPackageId = getMarketPackageId() ?? "";

	return useQuery({
		queryKey: ["marketBuyOrders", marketId, marketPackageId],
		queryFn: async (): Promise<BuyOrderWithName[]> => {
			if (!marketId || !marketPackageId) return [];
			const orders = await queryMarketBuyOrders(client, marketId, marketPackageId);

			const typeIds = orders.map((o) => o.typeId);
			const names = await resolveItemNames(typeIds);

			return orders.map((o) => ({
				...o,
				name: names.get(o.typeId) ?? `Item #${o.typeId}`,
			}));
		},
		enabled: !!marketId && !!marketPackageId,
		staleTime: 15_000,
		refetchInterval: 30_000,
	});
}
