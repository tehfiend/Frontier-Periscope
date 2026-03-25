import { SuiGraphQLClient } from "@mysten/sui/graphql";

export type SuiNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

const GRAPHQL_URLS: Record<SuiNetwork, string> = {
	mainnet: "https://graphql.mainnet.sui.io/graphql",
	testnet: "https://graphql.testnet.sui.io/graphql",
	devnet: "https://graphql.devnet.sui.io/graphql",
	localnet: "http://localhost:9125/graphql",
};

const clientCache: Map<string, SuiGraphQLClient> = new Map();

export function createSuiClient(networkOrUrl?: SuiNetwork | string): SuiGraphQLClient {
	const network: SuiNetwork =
		networkOrUrl && networkOrUrl in GRAPHQL_URLS
			? (networkOrUrl as SuiNetwork)
			: "testnet";

	const url =
		networkOrUrl && networkOrUrl in GRAPHQL_URLS
			? GRAPHQL_URLS[networkOrUrl as SuiNetwork]
			: networkOrUrl || process.env.SUI_RPC_URL || GRAPHQL_URLS.testnet;

	const cached = clientCache.get(url);
	if (cached) return cached;

	const client = new SuiGraphQLClient({ url, network });
	clientCache.set(url, client);
	return client;
}
