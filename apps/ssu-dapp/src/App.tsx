import { WalletConnect } from "@/components/WalletConnect";
import { getFallbackObjectId, getItemId, getTenant } from "@/lib/constants";
import { deriveObjectId } from "@/lib/deriveObjectId";
import { SsuView } from "@/views/SsuView";
import { DAppKitProvider, createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";

function PeriscopeIcon({ size = 16 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 1200 1200" fill="currentColor">
			<path d="m525 806.26c0 62.109-50.391 112.5-112.5 112.5s-112.5-50.391-112.5-112.5c0-62.109 50.391-112.5 112.5-112.5s112.5 50.391 112.5 112.5" />
			<path d="m787.5 693.74c-62.016 0-112.5 50.484-112.5 112.5 0 30.094 11.672 58.359 32.906 79.594 21.234 21.234 49.5 32.906 79.594 32.906 62.016 0 112.5-50.484 112.5-112.5 0-30.891-11.859-58.406-34.359-79.547-21.328-21.703-48.188-32.953-78.141-32.953z" />
			<path d="m787.5 618.74h-375c-103.12 0-187.5 84.375-187.5 187.5 0 103.12 84.375 187.5 187.5 187.5h375c103.12 0 187.5-84.375 187.5-187.5 0-103.12-84.375-187.5-187.5-187.5zm-375 300c-62.109 0-112.5-50.391-112.5-112.5 0-62.109 50.391-112.5 112.5-112.5s112.5 50.391 112.5 112.5c0 62.109-50.391 112.5-112.5 112.5zm375 0c-62.109 0-112.5-50.391-112.5-112.5 0-62.109 50.391-112.5 112.5-112.5s112.5 50.391 112.5 112.5c0 62.109-50.391 112.5-112.5 112.5z" />
			<path d="m746.81 1065.6c-55.688-8.625-107.06-35.25-146.81-75.938-39.75 40.688-91.125 67.312-146.81 75.938-13.312 2.0625-27 3.1875-40.688 3.1875-1.3125 0-2.4375 0-3.75-0.1875 19.5 33.75 55.875 56.438 97.5 56.438h187.5c41.625 0 78-22.688 97.5-56.438-1.3125 0.1875-2.4375 0.1875-3.75 0.1875-13.688 0-27.375-1.125-40.688-3.1875z" />
			<path d="m393.74 543.74v0.75c6.1875-0.5625 12.375-0.75 18.75-0.75h375c6.375 0 12.562 0.1875 18.75 0.75v-0.75c0-41.438-33.562-75-75-75h-262.5c-41.438 0-75 33.562-75 75z" />
			<path d="m712.5 92.812c-0.5625-9.9375-8.8125-17.812-18.75-17.812h-187.5c-9.9375 0-18.188 7.875-18.75 17.812l-16.125 338.44h257.26z" />
			<path d="m377.44 337.5c7.125 27.75 29.625 49.312 58.125 54.938l1.875-38.438 7.125-147.37 1.6875-37.688c-33.188 1.5-60.75 24.75-68.812 56.062h-171.19c-30.938 0-56.25 25.312-56.25 56.25s25.312 56.25 56.25 56.25z" />
			<path d="m993.74 225h-171.19c-8.0625-31.312-35.625-54.562-68.812-56.062l1.6875 37.688 7.125 147.37 1.875 38.25c28.5-5.4375 51-27 58.125-54.75h171.19c30.938 0 56.25-25.312 56.25-56.25s-25.312-56.25-56.25-56.25z" />
		</svg>
	);
}

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
		appName: "Periscope Smart Storage Unit",
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
						<h1 className="flex shrink-0 items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-300 uppercase sm:text-sm">
							<PeriscopeIcon size={18} />
							Periscope SSU
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
