import { getConfigId } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { querySsuConfig } from "@tehfrontier/chain-shared";

const client = new SuiGraphQLClient({
	url: "https://graphql.testnet.sui.io/graphql",
	network: "testnet",
});

export function useMarketConfig() {
	const configId = getConfigId();

	return useQuery({
		queryKey: ["ssuConfig", configId],
		queryFn: () => querySsuConfig(client, configId),
		enabled: !!configId,
		refetchInterval: 30_000,
	});
}
