import { useSuiClient } from "./useSuiClient";
import { type OrderInfo, queryOrders } from "@tehfrontier/chain-shared";
import { useQuery } from "@tanstack/react-query";

/**
 * Fetch all bid/ask orders for a specific OrderBook.
 * Delegates to queryOrders from chain-shared which enumerates
 * dynamic fields with full pagination.
 */
export function useExchangeOrders(bookObjectId: string | null) {
	const client = useSuiClient();

	return useQuery({
		queryKey: ["exchangeOrders", bookObjectId],
		queryFn: async (): Promise<OrderInfo[]> => {
			if (!bookObjectId) return [];
			return queryOrders(client, bookObjectId);
		},
		enabled: !!bookObjectId,
		staleTime: 15_000,
	});
}
