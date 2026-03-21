import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { getMarketPackageId } from "@/lib/constants";
import type { MarketSellListing } from "@tehfrontier/chain-shared";
import type { BuyOrderWithName } from "@/hooks/useBuyOrders";
import { useCharacterNames } from "@/hooks/useCharacterNames";
import { useMemo, useState } from "react";
import { CreateBuyOrderDialog } from "./CreateBuyOrderDialog";
import { FillBuyOrderDialog } from "./FillBuyOrderDialog";
import { ListingAdminList } from "./ListingAdminList";
import { ListingBuyerList } from "./ListingBuyerList";

interface MarketContentProps {
	ssuConfig: SsuConfigResult;
	listings: MarketSellListing[];
	buyOrders: BuyOrderWithName[];
	listingsLoading?: boolean;
	buyOrdersLoading?: boolean;
	isAuthorized: boolean;
	characterObjectId?: string;
	isConnected: boolean;
	coinType: string;
	walletAddress?: string;
	ssuObjectId: string;
	ownerCapReceivingId?: string;
}

export function MarketContent({
	ssuConfig,
	listings,
	buyOrders,
	listingsLoading,
	buyOrdersLoading,
	isAuthorized,
	characterObjectId,
	isConnected,
	coinType,
	walletAddress,
	ssuObjectId,
	ownerCapReceivingId,
}: MarketContentProps) {
	const [showBuyOrderDialog, setShowBuyOrderDialog] = useState(false);
	const [fillOrder, setFillOrder] = useState<BuyOrderWithName | null>(null);
	const marketPkg = getMarketPackageId();

	// Collect all addresses that need name resolution
	const allAddresses = useMemo(() => {
		const addrs: string[] = [];
		for (const l of listings) addrs.push(l.seller);
		for (const o of buyOrders) addrs.push(o.buyer);
		return addrs;
	}, [listings, buyOrders]);

	const { data: nameMap } = useCharacterNames(allAddresses);

	const marketId = ssuConfig.marketId;
	if (!marketId) return null;

	function formatAddress(addr: string): string {
		const name = nameMap?.get(addr);
		if (name) return name;
		return `${addr.slice(0, 10)}...`;
	}

	return (
		<div className="space-y-6">
			{/* Sell Orders Section */}
			<div>
				<h3 className="mb-3 text-sm font-medium text-zinc-400">Sell Orders</h3>
				{listingsLoading ? (
					<p className="py-4 text-center text-xs text-zinc-600">Loading sell orders...</p>
				) : isAuthorized ? (
					<ListingAdminList
						listings={listings}
						ssuConfig={ssuConfig}
						characterObjectId={characterObjectId}
						ssuObjectId={ssuObjectId}
						coinType={coinType}
						nameMap={nameMap}
					/>
				) : (
					<ListingBuyerList
						listings={listings}
						ssuConfig={ssuConfig}
						characterObjectId={characterObjectId}
						isConnected={isConnected}
						coinType={coinType}
						ssuObjectId={ssuObjectId}
						nameMap={nameMap}
					/>
				)}
			</div>

			{/* Buy Orders Section */}
			<div>
				<div className="mb-3 flex items-center justify-between">
					<h3 className="text-sm font-medium text-zinc-400">Buy Orders</h3>
					{isConnected && (
						<button
							type="button"
							onClick={() => setShowBuyOrderDialog(true)}
							className="rounded border border-dashed border-zinc-700 px-2 py-1 text-xs text-zinc-500 hover:border-cyan-600 hover:text-cyan-400"
						>
							+ Create Buy Order
						</button>
					)}
				</div>

				{buyOrdersLoading ? (
					<p className="py-4 text-center text-xs text-zinc-600">Loading buy orders...</p>
				) : buyOrders.length === 0 ? (
					<p className="py-4 text-center text-xs text-zinc-600">No buy orders yet.</p>
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
											Want: {order.name}
										</p>
										<p className="text-[10px] text-zinc-500">
											{order.pricePerUnit.toLocaleString()} per unit --{" "}
											{order.quantity.toLocaleString()} wanted
										</p>
										<p className="text-[10px] text-zinc-500">
											Total escrowed:{" "}
											{(order.pricePerUnit * order.quantity).toLocaleString()}
										</p>
										<p className="text-[10px] text-zinc-600">
											Buyer: {formatAddress(order.buyer)}
										</p>
									</div>
									<div className="flex flex-col items-end gap-1">
										{walletAddress === order.buyer && (
											<span className="rounded bg-cyan-900/30 px-1.5 py-0.5 text-[10px] text-cyan-400">
												Your order
											</span>
										)}
										{isConnected && walletAddress !== order.buyer && (
											<button
												type="button"
												onClick={() => setFillOrder(order)}
												className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-amber-500"
											>
												Fill
											</button>
										)}
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Create Buy Order Dialog */}
			{showBuyOrderDialog && ssuConfig.marketId && (
				<CreateBuyOrderDialog
					marketId={ssuConfig.marketId}
					packageId={marketPkg ?? ""}
					coinType={coinType}
					onClose={() => setShowBuyOrderDialog(false)}
				/>
			)}

			{/* Fill Buy Order Dialog */}
			{fillOrder && ssuConfig.marketId && characterObjectId && ownerCapReceivingId && (
				<FillBuyOrderDialog
					order={fillOrder}
					ssuConfig={ssuConfig}
					coinType={coinType}
					ssuObjectId={ssuObjectId}
					characterObjectId={characterObjectId}
					ownerCapReceivingId={ownerCapReceivingId}
					onClose={() => setFillOrder(null)}
				/>
			)}
		</div>
	);
}
