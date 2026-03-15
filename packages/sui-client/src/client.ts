import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

export type SuiNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

const RPC_URLS: Record<SuiNetwork, string> = {
	mainnet: getFullnodeUrl("mainnet"),
	testnet: getFullnodeUrl("testnet"),
	devnet: getFullnodeUrl("devnet"),
	localnet: getFullnodeUrl("localnet"),
};

let clientCache: Map<string, SuiClient> = new Map();

export function createSuiClient(networkOrUrl?: SuiNetwork | string): SuiClient {
	const url =
		networkOrUrl && networkOrUrl in RPC_URLS
			? RPC_URLS[networkOrUrl as SuiNetwork]
			: networkOrUrl || process.env.SUI_RPC_URL || RPC_URLS.testnet;

	const cached = clientCache.get(url);
	if (cached) return cached;

	const client = new SuiClient({ url });
	clientCache.set(url, client);
	return client;
}
