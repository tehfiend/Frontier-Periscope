import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	type CurrencyMarketInfo,
	queryCurrencyMarketDetails,
	queryCurrencyMarkets,
} from "@tehfrontier/chain-shared";
import { AlertCircle, Loader2, Search, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CurrencyMarketDetail } from "./CurrencyMarketDetail";

interface CurrencyMarketBrowserProps {
	packageId: string;
}

export function CurrencyMarketBrowser({ packageId }: CurrencyMarketBrowserProps) {
	const account = useCurrentAccount();
	const client = useCurrentClient() as SuiGraphQLClient;

	const [markets, setMarkets] = useState<CurrencyMarketInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const [selectedMarketId, setSelectedMarketId] = useState<string>();
	const [lookupId, setLookupId] = useState("");

	const loadMarkets = useCallback(async () => {
		if (!packageId) return;
		setLoading(true);
		setError(undefined);
		try {
			const result = await queryCurrencyMarkets(client, packageId);
			setMarkets(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load markets");
		}
		setLoading(false);
	}, [client, packageId]);

	useEffect(() => {
		loadMarkets();
	}, [loadMarkets]);

	async function handleLookup() {
		if (!lookupId.trim()) return;
		setLoading(true);
		setError(undefined);
		try {
			const details = await queryCurrencyMarketDetails(client, lookupId.trim());
			if (details) {
				setSelectedMarketId(lookupId.trim());
			} else {
				setError("Market not found for this ID");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Lookup failed");
		}
		setLoading(false);
	}

	if (selectedMarketId) {
		return (
			<CurrencyMarketDetail
				packageId={packageId}
				marketId={selectedMarketId}
				onBack={() => setSelectedMarketId(undefined)}
			/>
		);
	}

	return (
		<div className="space-y-4">
			{/* Direct lookup */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
				<h3 className="mb-2 text-sm font-medium text-zinc-400">Look up market by ID</h3>
				<div className="flex gap-2">
					<input
						type="text"
						value={lookupId}
						onChange={(e) => setLookupId(e.target.value)}
						placeholder="CurrencyMarket Object ID (0x...)"
						className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
						onKeyDown={(e) => e.key === "Enter" && handleLookup()}
					/>
					<button
						type="button"
						onClick={handleLookup}
						disabled={!lookupId.trim() || loading}
						className="rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
					>
						<Search size={16} />
					</button>
				</div>
			</div>

			{/* Markets list */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
				<div className="mb-3 flex items-center justify-between">
					<h3 className="flex items-center gap-1.5 text-sm font-medium text-zinc-400">
						<Store size={14} />
						Available Markets ({markets.length})
					</h3>
					<button
						type="button"
						onClick={loadMarkets}
						disabled={loading}
						className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:text-cyan-400 disabled:opacity-50"
					>
						Refresh
					</button>
				</div>

				{loading && (
					<div className="flex items-center gap-2 py-6 text-sm text-zinc-400">
						<Loader2 size={16} className="animate-spin" />
						Loading markets...
					</div>
				)}

				{error && (
					<div className="flex items-center gap-2 rounded border border-red-900/50 bg-red-950/20 p-2 text-xs text-red-400">
						<AlertCircle size={14} />
						{error}
					</div>
				)}

				{!loading && !error && markets.length === 0 && (
					<p className="py-6 text-center text-xs text-zinc-600">
						No currency markets found on-chain for this package.
					</p>
				)}

				{!loading && markets.length > 0 && (
					<div className="space-y-2">
						{markets.map((market) => (
							<button
								key={market.objectId}
								type="button"
								onClick={() => setSelectedMarketId(market.objectId)}
								className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
							>
								<div className="min-w-0 flex-1">
									<p className="font-mono text-xs text-zinc-300">
										{market.objectId.slice(0, 16)}...
										{market.objectId.slice(-8)}
									</p>
									<p className="mt-0.5 text-[10px] text-zinc-500">
										{market.coinType ? market.coinType.split("::").pop() : "Unknown coin"}
										{" -- "}
										Fee: {(market.feeBps / 100).toFixed(1)}%
									</p>
									<p className="text-[10px] text-zinc-600">
										{market.nextSellId} listing
										{market.nextSellId !== 1 ? "s" : ""} -- {market.nextBuyId} order
										{market.nextBuyId !== 1 ? "s" : ""}
									</p>
								</div>
								<span className="text-zinc-600">&rarr;</span>
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
