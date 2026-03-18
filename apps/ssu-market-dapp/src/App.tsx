import { createDAppKit, DAppKitProvider } from "@mysten/dapp-kit-react";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MarketView } from "@/components/MarketView";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 15_000,
			retry: 1,
		},
	},
});

const dAppKit = createDAppKit({
	networks: ["testnet"],
	createClient: (network) =>
		new SuiGraphQLClient({
			url: `https://graphql.${network}.sui.io/graphql`,
			network: network as "testnet",
		}),
	defaultNetwork: "testnet",
	autoConnect: false,
	slushWalletConfig: {
		appName: "SSU Market",
		origin: "https://vault.evefrontier.com",
	},
});

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<DAppKitProvider dAppKit={dAppKit}>
				<div className="flex min-h-full flex-col">
					<header className="border-b border-zinc-800 px-4 py-3">
						<h1 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">
							SSU Market
						</h1>
					</header>
					<main className="flex-1 overflow-auto p-4">
						<MarketView />
					</main>
				</div>
			</DAppKitProvider>
		</QueryClientProvider>
	);
}
