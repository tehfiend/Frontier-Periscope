import { getMarketPackageId } from "@/lib/constants";
import { resolveItemNames } from "@/lib/items";
import { useQuery } from "@tanstack/react-query";
import { type MarketSellListing, queryMarketListings } from "@tehfrontier/chain-shared";
import { useSuiClient } from "./useSuiClient";

export interface SellListingWithName extends MarketSellListing {
	name: string;
}

/**
 * Fetch sell listings from a Market<T> by marketId.
 * Only enabled when marketId is provided.
 */
export function useMarketListings(marketId: string | null | undefined) {
	const client = useSuiClient();
	const marketPackageId = getMarketPackageId() ?? "";

	return useQuery({
		queryKey: ["marketListings", marketId, marketPackageId],
		queryFn: async (): Promise<SellListingWithName[]> => {
			if (!marketId || !marketPackageId) return [];
			const listings = await queryMarketListings(client, marketId, marketPackageId);

			const typeIds = listings.map((l) => l.typeId);
			const names = await resolveItemNames(typeIds);

			return listings.map((l) => ({
				...l,
				name: names.get(l.typeId) ?? `Item #${l.typeId}`,
			}));
		},
		enabled: !!marketId && !!marketPackageId,
		staleTime: 15_000,
		refetchInterval: 30_000,
	});
}
