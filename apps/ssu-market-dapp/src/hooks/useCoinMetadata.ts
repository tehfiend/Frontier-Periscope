import { useQuery } from "@tanstack/react-query";
import { type CoinMetadata, getCoinMetadata } from "@tehfrontier/chain-shared";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";

export function useCoinMetadata(coinType: string | null | undefined) {
	const client = useCurrentClient() as SuiGraphQLClient;

	return useQuery({
		queryKey: ["coinMetadata", coinType],
		queryFn: async (): Promise<CoinMetadata | null> => {
			if (!coinType) return null;
			return getCoinMetadata(client, coinType);
		},
		enabled: !!coinType,
		staleTime: Number.POSITIVE_INFINITY,
	});
}
