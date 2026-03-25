import { useMemo } from "react";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { useCurrentNetwork } from "@mysten/dapp-kit-react";

const clientCache = new Map<string, SuiGraphQLClient>();

/**
 * Returns a SuiGraphQLClient for the current network.
 * Creates a direct instance rather than relying on the dapp-kit client
 * cast, which can break when dapp-kit-core wraps the underlying client.
 */
export function useSuiClient(): SuiGraphQLClient {
	const network = useCurrentNetwork();
	return useMemo(() => {
		const key = network ?? "testnet";
		const cached = clientCache.get(key);
		if (cached) return cached;
		const client = new SuiGraphQLClient({
			url: `https://graphql.${key}.sui.io/graphql`,
			network: key as "testnet",
		});
		clientCache.set(key, client);
		return client;
	}, [network]);
}
