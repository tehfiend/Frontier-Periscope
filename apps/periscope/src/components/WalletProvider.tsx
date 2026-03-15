import {
	SuiClientProvider,
	WalletProvider as DappKitWalletProvider,
} from "@mysten/dapp-kit";
import { getFullnodeUrl } from "@mysten/sui/client";
import type { ReactNode } from "react";

const networks = {
	testnet: { url: getFullnodeUrl("testnet") },
};

export function WalletProvider({ children }: { children: ReactNode }) {
	return (
		<SuiClientProvider networks={networks} defaultNetwork="testnet">
			<DappKitWalletProvider
				autoConnect={false}
				preferredWallets={["EVE Vault"]}
			>
				{children}
			</DappKitWalletProvider>
		</SuiClientProvider>
	);
}
