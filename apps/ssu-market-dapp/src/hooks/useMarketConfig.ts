import { useQuery } from "@tanstack/react-query";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { queryMarketConfig } from "@tehfrontier/chain-shared";
import { getConfigId } from "@/lib/constants";

const client = new SuiGraphQLClient({
	url: "https://graphql.testnet.sui.io/graphql",
	network: "testnet",
});

export function useMarketConfig() {
	const configId = getConfigId();

	return useQuery({
		queryKey: ["marketConfig", configId],
		queryFn: () => queryMarketConfig(client, configId),
		enabled: !!configId,
		refetchInterval: 30_000,
	});
}
