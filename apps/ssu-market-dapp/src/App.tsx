import { MarketBrowser } from "@/components/MarketBrowser";
import { MarketView } from "@/components/MarketView";
import { DAppKitProvider, createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShoppingBag, Store } from "lucide-react";
import { useState } from "react";

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

type TabId = "ssu-market" | "market-browser";

function getUrlParam(key: string): string | null {
	const params = new URLSearchParams(window.location.search);
	return params.get(key);
}

export function App() {
	// Auto-detect tab based on URL params
	const hasMarketPkg = !!getUrlParam("marketPackageId");
	const [activeTab, setActiveTab] = useState<TabId>(
		hasMarketPkg ? "market-browser" : "ssu-market",
	);
	const [marketPackageId, setMarketPackageId] = useState(
		getUrlParam("marketPackageId") ?? "",
	);

	return (
		<QueryClientProvider client={queryClient}>
			<DAppKitProvider dAppKit={dAppKit}>
				<div className="flex min-h-full flex-col">
					<header className="border-b border-zinc-800 px-4 py-3">
						<div className="mx-auto flex max-w-2xl items-center justify-between">
							<h1 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">
								SSU Market
							</h1>
							{/* Tab switcher */}
							<div className="flex gap-1 rounded bg-zinc-900 p-0.5">
								<button
									type="button"
									onClick={() => setActiveTab("ssu-market")}
									className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium ${
										activeTab === "ssu-market"
											? "bg-zinc-800 text-cyan-400"
											: "text-zinc-500 hover:text-zinc-400"
									}`}
								>
									<Store size={12} />
									SSU Market
								</button>
								<button
									type="button"
									onClick={() => setActiveTab("market-browser")}
									className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium ${
										activeTab === "market-browser"
											? "bg-zinc-800 text-cyan-400"
											: "text-zinc-500 hover:text-zinc-400"
									}`}
								>
									<ShoppingBag size={12} />
									Market Browser
								</button>
							</div>
						</div>
					</header>
					<main className="flex-1 overflow-auto p-4">
						{activeTab === "ssu-market" && <MarketView />}
						{activeTab === "market-browser" && (
							<div className="mx-auto max-w-2xl space-y-4">
								{/* Package ID config */}
								<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
									<h3 className="mb-2 text-sm font-medium text-zinc-400">
										Market Package
									</h3>
									<input
										type="text"
										value={marketPackageId}
										onChange={(e) => setMarketPackageId(e.target.value)}
										placeholder="0x... (market package ID)"
										className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
									/>
								</div>

								{marketPackageId ? (
									<MarketBrowser packageId={marketPackageId} />
								) : (
									<div className="flex flex-col items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 py-12">
										<ShoppingBag size={32} className="text-zinc-700" />
										<p className="text-xs text-zinc-600">
											Enter the Market package ID to browse markets
										</p>
									</div>
								)}
							</div>
						)}
					</main>
				</div>
			</DAppKitProvider>
		</QueryClientProvider>
	);
}
