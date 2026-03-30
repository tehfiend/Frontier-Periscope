import { WalletConnect } from "@/components/WalletConnect";
import { getFallbackObjectId, getItemId, getTenant } from "@/lib/constants";
import { deriveObjectId } from "@/lib/deriveObjectId";
import { SsuView } from "@/views/SsuView";
import { DAppKitProvider, createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";

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
		appName: "SSU Viewer",
		origin: "https://vault.evefrontier.com",
	},
});

/**
 * Resolve the SSU object ID from URL params or env vars.
 * Priority: itemId+tenant derivation > VITE_OBJECT_ID
 */
function resolveObjectId(): string | null {
	// Direct object ID from URL param takes priority
	const params = new URLSearchParams(window.location.search);
	const directId = params.get("objectId");
	if (directId) return directId;

	const itemId = getItemId();
	const tenant = getTenant();

	if (itemId) {
		try {
			return deriveObjectId(itemId, tenant);
		} catch {
			// Fall through to env var
		}
	}

	return getFallbackObjectId();
}

export function App() {
	const objectId = useMemo(resolveObjectId, []);

	return (
		<QueryClientProvider client={queryClient}>
			<DAppKitProvider dAppKit={dAppKit}>
				<div className="flex min-h-full flex-col">
					<header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-2 py-1.5 sm:px-4 sm:py-3">
						<h1 className="shrink-0 text-xs font-semibold tracking-wide text-zinc-300 uppercase sm:text-sm">
							SSU Viewer
						</h1>
						<WalletConnect />
					</header>
					<main className="flex-1 overflow-auto p-2 sm:p-4">
						{objectId ? (
							<SsuView objectId={objectId} />
						) : (
							<div className="flex h-64 items-center justify-center">
								<div className="text-center">
									<p className="text-sm text-zinc-400">No storage unit specified</p>
									<p className="mt-2 text-xs text-zinc-600">
										Add <code className="text-zinc-400">?objectId=</code> or{" "}
										<code className="text-zinc-400">?itemId=&tenant=</code> to the URL.
									</p>
								</div>
							</div>
						)}
					</main>
					<footer className="border-t border-zinc-800/50 px-4 py-2 text-center text-xs text-zinc-700">
						Frontier Periscope &middot; EVE Frontier Cycle 5
					</footer>
				</div>
			</DAppKitProvider>
		</QueryClientProvider>
	);
}
