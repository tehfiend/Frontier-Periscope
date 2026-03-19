import { useQuery } from "@tanstack/react-query";
import { type MarketBuyOrder, queryMarketBuyOrders } from "@tehfrontier/chain-shared";
import { getMarketPackageId } from "@/lib/constants";
import { useSuiClient } from "./useSuiClient";

/**
 * Fetch buy orders from a Market<T> by marketId.
 * Only enabled when marketId is provided.
 */
export function useBuyOrders(marketId: string | null | undefined) {
	const client = useSuiClient();
	const marketPackageId = getMarketPackageId() ?? "";

	return useQuery({
		queryKey: ["marketBuyOrders", marketId],
		queryFn: async (): Promise<MarketBuyOrder[]> => {
			if (!marketId || !marketPackageId) return [];
			return queryMarketBuyOrders(client, marketId, marketPackageId);
		},
		enabled: !!marketId && !!marketPackageId,
		staleTime: 15_000,
		refetchInterval: 30_000,
	});
}
