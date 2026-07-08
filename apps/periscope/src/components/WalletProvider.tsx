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
	// Do NOT auto-restore the session on load. In practice EVE Vault prompts its unlock (PIN) window
	// during dapp-kit's passive `autoConnect` restore -- it ignores the wallet-standard `silent` flag --
	// so `autoConnect: true` pops a PIN on every page load. We want the PIN to appear only on a genuine
	// user-initiated connect (the "Connect EVE Vault" button), so we start disconnected each load. The
	// tradeoff is the user reconnects once per session instead of persisting across reloads.
	autoConnect: false,
});

export function WalletProvider({ children }: { children: ReactNode }) {
	return (
		<DAppKitProvider dAppKit={dAppKit}>
			{children}
		</DAppKitProvider>
	);
}
