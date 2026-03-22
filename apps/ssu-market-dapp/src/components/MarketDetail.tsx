import { useCoinMetadata } from "@/hooks/useCoinMetadata";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	type MarketBuyOrder,
	type MarketInfo,
	type MarketSellListing,
	buildCancelBuyOrder,
	buildCancelSellListing,
	formatBaseUnits,
	queryMarketBuyOrders,
	queryMarketDetails,
	queryMarketListings,
} from "@tehfrontier/chain-shared";
import { AlertCircle, ArrowLeft, Loader2, RefreshCw, ShoppingCart, Tag } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PostBuyOrderForm } from "./PostBuyOrderForm";
import { PostSellListingForm } from "./PostSellListingForm";

interface MarketDetailProps {
	packageId: string;
	marketId: string;
	onBack: () => void;
}

type TabId = "listings" | "orders";

export function MarketDetail({ packageId, marketId, onBack }: MarketDetailProps) {
	const account = useCurrentAccount();
	const client = useCurrentClient() as SuiGraphQLClient;
	const { mutateAsync, isPending } = useSignAndExecute();

	const [market, setMarket] = useState<MarketInfo | null>(null);
	const [listings, setListings] = useState<MarketSellListing[]>([]);
	const [buyOrders, setBuyOrders] = useState<MarketBuyOrder[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [activeTab, setActiveTab] = useState<TabId>("listings");
	const [showPostListing, setShowPostListing] = useState(false);
	const [showPostOrder, setShowPostOrder] = useState(false);

	const { data: coinMeta } = useCoinMetadata(market?.coinType);
	const decimals = coinMeta?.decimals ?? 9;

	const loadMarketData = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			const [details, ls, orders] = await Promise.all([
				queryMarketDetails(client, marketId),
				queryMarketListings(client, marketId, packageId),
				queryMarketBuyOrders(client, marketId, packageId),
			]);
			setMarket(details);
			setListings(ls);
			setBuyOrders(orders);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load market");
		}
		setLoading(false);
	}, [client, marketId, packageId]);

	useEffect(() => {
		loadMarketData();
	}, [loadMarketData]);

	async function handleCancelListing(listingId: number) {
		if (!account || !market) return;
		setError(undefined);
		try {
			const tx = buildCancelSellListing({
				packageId,
				marketId,
				coinType: market.coinType,
				listingId,
				senderAddress: account.address,
			});
			await mutateAsync(tx);
			await loadMarketData();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleCancelBuyOrder(orderId: number) {
		if (!account || !market) return;
		setError(undefined);
		try {
			const tx = buildCancelBuyOrder({
				packageId,
				marketId,
				coinType: market.coinType,
				orderId,
				senderAddress: account.address,
			});
			await mutateAsync(tx);
			await loadMarketData();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	if (loading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 size={24} className="animate-spin text-zinc-600" />
			</div>
		);
	}

	if (!market) {
		return (
			<div className="space-y-4">
				<button
					type="button"
					onClick={onBack}
					className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
				>
					<ArrowLeft size={14} />
					Back
				</button>
				<p className="text-sm text-zinc-500">Market not found.</p>
			</div>
		);
	}

	const coinName = market.coinType ? market.coinType.split("::").pop() : "Unknown";
	const isConnected = !!account;

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onBack}
							className="text-zinc-500 hover:text-zinc-300"
						>
							<ArrowLeft size={16} />
						</button>
						<div>
							<h2 className="text-sm font-medium text-zinc-200">
								{coinName} Market
							</h2>
							<p className="font-mono text-[10px] text-zinc-600">
								{marketId.slice(0, 16)}...{marketId.slice(-8)}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
							Fee: {(market.feeBps / 100).toFixed(1)}%
						</span>
						<button
							type="button"
							onClick={loadMarketData}
							disabled={loading}
							className="text-zinc-500 hover:text-cyan-400"
						>
							<RefreshCw size={14} />
						</button>
					</div>
				</div>
			</div>

			{/* Error */}
			{error && (
				<div className="flex items-center gap-2 rounded border border-red-900/50 bg-red-950/20 p-2 text-xs text-red-400">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			{/* Tabs */}
			<div className="flex gap-1 rounded-lg bg-zinc-900 p-1">
				<button
					type="button"
					onClick={() => setActiveTab("listings")}
					className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
						activeTab === "listings"
							? "bg-zinc-800 text-cyan-400"
							: "text-zinc-500 hover:text-zinc-400"
					}`}
				>
					<Tag size={14} />
					Sell Listings ({listings.length})
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("orders")}
					className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
						activeTab === "orders"
							? "bg-zinc-800 text-cyan-400"
							: "text-zinc-500 hover:text-zinc-400"
					}`}
				>
					<ShoppingCart size={14} />
					Buy Orders ({buyOrders.length})
				</button>
			</div>

			{/* Sell Listings Tab */}
			{activeTab === "listings" && (
				<div className="space-y-3">
					{isConnected && (
						<button
							type="button"
							onClick={() => setShowPostListing(!showPostListing)}
							className="w-full rounded-lg border border-dashed border-zinc-700 py-2 text-xs text-zinc-500 hover:border-cyan-600 hover:text-cyan-400"
						>
							{showPostListing ? "Cancel" : "+ Post Sell Listing"}
						</button>
					)}

					{showPostListing && market && account && (
						<PostSellListingForm
							packageId={packageId}
							marketId={marketId}
							coinType={market.coinType}
							onPosted={() => {
								setShowPostListing(false);
								loadMarketData();
							}}
							onCancel={() => setShowPostListing(false)}
						/>
					)}

					{listings.length === 0 ? (
						<p className="py-6 text-center text-xs text-zinc-600">
							No sell listings yet.
						</p>
					) : (
						<div className="space-y-2">
							{listings.map((listing) => (
								<div
									key={listing.listingId}
									className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
								>
									<div className="flex items-start justify-between">
										<div>
											<p className="text-xs text-zinc-300">
												Item #{listing.typeId}
											</p>
											<p className="text-[10px] text-zinc-500">
												{formatBaseUnits(listing.pricePerUnit, decimals)} per unit
												-- {listing.quantity.toLocaleString()} available
											</p>
											<p className="text-[10px] text-zinc-600">
												SSU: {listing.ssuId.slice(0, 10)}...
											</p>
											<p className="text-[10px] text-zinc-600">
												Seller: {listing.seller.slice(0, 10)}...
											</p>
										</div>
										{account?.address === listing.seller && (
											<button
												type="button"
												onClick={() =>
													handleCancelListing(listing.listingId)
												}
												disabled={isPending}
												className="rounded px-2 py-0.5 text-[10px] text-red-400 hover:bg-zinc-800 disabled:opacity-50"
											>
												Cancel
											</button>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{/* Buy Orders Tab */}
			{activeTab === "orders" && (
				<div className="space-y-3">
					{isConnected && (
						<button
							type="button"
							onClick={() => setShowPostOrder(!showPostOrder)}
							className="w-full rounded-lg border border-dashed border-zinc-700 py-2 text-xs text-zinc-500 hover:border-cyan-600 hover:text-cyan-400"
						>
							{showPostOrder ? "Cancel" : "+ Post Buy Order"}
						</button>
					)}

					{showPostOrder && market && account && (
						<PostBuyOrderForm
							packageId={packageId}
							marketId={marketId}
							coinType={market.coinType}
							onPosted={() => {
								setShowPostOrder(false);
								loadMarketData();
							}}
							onCancel={() => setShowPostOrder(false)}
						/>
					)}

					{buyOrders.length === 0 ? (
						<p className="py-6 text-center text-xs text-zinc-600">
							No buy orders yet.
						</p>
					) : (
						<div className="space-y-2">
							{buyOrders.map((order) => (
								<div
									key={order.orderId}
									className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
								>
									<div className="flex items-start justify-between">
										<div>
											<p className="text-xs text-zinc-300">
												Want: Item #{order.typeId}
											</p>
											<p className="text-[10px] text-zinc-500">
												{formatBaseUnits(order.pricePerUnit, decimals)} per unit --{" "}
												{order.quantity.toLocaleString()} wanted
												{order.originalQuantity > 0 &&
													order.originalQuantity !== order.quantity && (
														<span className="text-zinc-600">
															{" "}(of {order.originalQuantity.toLocaleString()})
														</span>
													)}
											</p>
											<p className="text-[10px] text-zinc-500">
												Total escrowed:{" "}
												{formatBaseUnits(
													order.pricePerUnit * BigInt(order.quantity),
													decimals,
												)}
											</p>
											<p className="text-[10px] text-zinc-600">
												Buyer: {order.buyer.slice(0, 10)}...
											</p>
											{order.postedAtMs > 0 && (
												<p className="text-[10px] text-zinc-600">
													Posted: {new Date(order.postedAtMs).toLocaleString()}
												</p>
											)}
										</div>
										<div className="flex flex-col gap-1">
											{account?.address === order.buyer && (
												<button
													type="button"
													onClick={() =>
														handleCancelBuyOrder(order.orderId)
													}
													disabled={isPending}
													className="rounded px-2 py-0.5 text-[10px] text-red-400 hover:bg-zinc-800 disabled:opacity-50"
												>
													Cancel
												</button>
											)}
										</div>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
