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
	// Passive reconnect on load, exactly like the official EVE Frontier dApp. dapp-kit's autoConnect
	// only restores the connection from local storage (it looks up the saved account on the already-
	// injected wallet); it never calls the wallet's connect(), so it opens NO PIN or approval window
	// on its own. This is what lets the official dApp stay connected across reloads without popping
	// the approval window every time -- the window only appears on a genuine first connect(). If EVE
	// Vault has locked itself, the passive restore simply finds no account and does nothing (you then
	// connect manually); any PIN you see on reload is the vault auto-unlocking, not this setting.
	autoConnect: true,
});

export function WalletProvider({ children }: { children: ReactNode }) {
	return (
		<DAppKitProvider dAppKit={dAppKit}>
			{children}
		</DAppKitProvider>
	);
}
