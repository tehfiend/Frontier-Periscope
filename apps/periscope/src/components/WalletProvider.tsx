import { DAppKitProvider, createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import type { ReactNode } from "react";

const dAppKit = createDAppKit({
	networks: ["testnet"] as const,
	defaultNetwork: "testnet",
	createClient: (network) =>
		new SuiGraphQLClient({
			url: `https://graphql.${network}.sui.io/graphql`,
			network: network as "testnet",
		}),
	slushWalletConfig: {
		appName: "Frontier Periscope",
		origin: "https://vault.evefrontier.com",
	},
	autoConnect: true,
});

export function WalletProvider({ children }: { children: ReactNode }) {
	return (
		<DAppKitProvider dAppKit={dAppKit}>
			{children}
		</DAppKitProvider>
	);
}
