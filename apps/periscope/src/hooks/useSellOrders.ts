import { useQuery } from "@tanstack/react-query";
import { useSuiClient } from "@/hooks/useSuiClient";
import type { SellOrderInfo } from "@tehfrontier/chain-shared";
import { queryAllSellOrders } from "@tehfrontier/chain-shared";

export function useSellOrders(marketConfigId: string | undefined) {
	const client = useSuiClient();
	return useQuery({
		queryKey: ["sellOrders", marketConfigId],
		queryFn: () => queryAllSellOrders(client, marketConfigId!),
		enabled: !!marketConfigId,
		refetchInterval: 15_000,
	});
}
