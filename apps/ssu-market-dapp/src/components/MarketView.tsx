import { useMarketConfig } from "@/hooks/useMarketConfig";
import { useMarketListings } from "@/hooks/useMarketListings";
import { getConfigId } from "@/lib/constants";
import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import { useState } from "react";
import { BuyerView } from "./BuyerView";
import { OwnerView } from "./OwnerView";

const EVE_VAULT_NAME = "Eve Vault";

export function MarketView() {
	const account = useCurrentAccount();
	const wallets = useWallets();
	const dAppKit = useDAppKit();
	const [connecting, setConnecting] = useState(false);

	const configId = getConfigId();
	const { data: config, isLoading: configLoading, error: configError } = useMarketConfig();
	const { data: listings, isLoading: listingsLoading } = useMarketListings(
		config?.marketId ?? undefined,
	);

	async function handleConnect() {
		const eveVault =
			wallets.find((w) => w.name === EVE_VAULT_NAME) ??
			wallets.find((w) => w.name.toLowerCase().includes("eve"));
		if (eveVault) {
			setConnecting(true);
			try {
				await dAppKit.connectWallet({ wallet: eveVault });
			} finally {
				setConnecting(false);
			}
		}
	}

	// Missing configId
	if (!configId) {
		return (
			<div className="flex h-64 items-center justify-center text-zinc-500">
				<p>
					Missing <code className="text-zinc-400">configId</code> URL parameter. Add{" "}
					<code className="text-zinc-400">?configId=0x...</code> to the URL.
				</p>
			</div>
		);
	}

	// Loading
	if (configLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
			</div>
		);
	}

	// Errors
	if (configError) {
		return (
			<div className="flex h-64 items-center justify-center text-red-400">
				<p>Failed to load market data: {String(configError)}</p>
			</div>
		);
	}

	if (!config) {
		return (
			<div className="flex h-64 items-center justify-center text-zinc-500">
				<p>SsuConfig not found for ID: {configId}</p>
			</div>
		);
	}

	const isConnected = !!account;
	const walletAddress = account?.address ?? null;
	const isOwner = isConnected && walletAddress === config.owner;
	const isAuthorized =
		isOwner || (isConnected && !!walletAddress && config.delegates.includes(walletAddress));

	return (
		<div className="mx-auto max-w-2xl space-y-4">
			{/* SSU info header */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
				<div className="flex items-center justify-between">
					<div>
						<p className="text-xs text-zinc-500">Storage Unit</p>
						<p className="font-mono text-sm text-zinc-300">
							{config.ssuId.slice(0, 10)}...{config.ssuId.slice(-6)}
						</p>
					</div>
					{!isConnected ? (
						<button
							type="button"
							onClick={handleConnect}
							disabled={connecting}
							className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
						>
							{connecting ? "Connecting..." : "Connect Wallet"}
						</button>
					) : (
						<div className="flex items-center gap-2">
							{isAuthorized && (
								<span className="rounded bg-amber-900/50 px-2 py-0.5 text-xs text-amber-400">
									{isOwner ? "Owner" : "Delegate"}
								</span>
							)}
							<span className="font-mono text-xs text-zinc-500">
								{walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
							</span>
						</div>
					)}
				</div>
			</div>

			{/* View toggle */}
			{isAuthorized ? (
				<OwnerView
					config={config}
					listings={listings ?? []}
					listingsLoading={listingsLoading}
					characterObjectId="" // TODO: resolve from chain
				/>
			) : (
				<BuyerView
					config={config}
					listings={listings ?? []}
					listingsLoading={listingsLoading}
					isConnected={isConnected}
					onConnect={handleConnect}
				/>
			)}
		</div>
	);
}
