import { useQuery } from "@tanstack/react-query";
import { type CoinMetadata, getCoinMetadata } from "@tehfrontier/chain-shared";
import { useSuiClient } from "./useSuiClient";

/**
 * Fetch coin metadata (decimals, symbol, name) for a coin type.
 * Metadata is immutable so staleTime is set to Infinity.
 */
export function useCoinMetadata(coinType: string | null | undefined) {
	const client = useSuiClient();

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
