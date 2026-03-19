import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import type { MarketBuyOrder, MarketSellListing } from "@tehfrontier/chain-shared";
import { useState } from "react";
import { CreateBuyOrderDialog } from "./CreateBuyOrderDialog";
import { ListingAdminList } from "./ListingAdminList";
import { ListingBuyerList } from "./ListingBuyerList";

interface MarketContentProps {
	ssuConfig: SsuConfigResult;
	listings: MarketSellListing[];
	buyOrders: MarketBuyOrder[];
	isAuthorized: boolean;
	characterObjectId?: string;
	isConnected: boolean;
	coinType: string;
	walletAddress?: string;
	ssuObjectId: string;
}

export function MarketContent({
	ssuConfig,
	listings,
	buyOrders,
	isAuthorized,
	characterObjectId,
	isConnected,
	coinType,
	walletAddress,
	ssuObjectId,
}: MarketContentProps) {
	const [showBuyOrderDialog, setShowBuyOrderDialog] = useState(false);

	const marketId = ssuConfig.marketId;
	if (!marketId) return null;

	return (
		<div className="space-y-6">
			{/* Sell Listings Section */}
			<div>
				<h3 className="mb-3 text-sm font-medium text-zinc-400">Sell Listings</h3>
				{isAuthorized ? (
					<ListingAdminList
						listings={listings}
						ssuConfig={ssuConfig}
						characterObjectId={characterObjectId}
						ssuObjectId={ssuObjectId}
						coinType={coinType}
					/>
				) : (
					<ListingBuyerList
						listings={listings}
						ssuConfig={ssuConfig}
						characterObjectId={characterObjectId}
						isConnected={isConnected}
						coinType={coinType}
						ssuObjectId={ssuObjectId}
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

				{buyOrders.length === 0 ? (
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
											Want: Item #{order.typeId}
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
											Buyer: {order.buyer.slice(0, 10)}...
										</p>
									</div>
									{walletAddress === order.buyer && (
										<span className="rounded bg-cyan-900/30 px-1.5 py-0.5 text-[10px] text-cyan-400">
											Your order
										</span>
									)}
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
					packageId={ssuConfig.packageId}
					coinType={coinType}
					onClose={() => setShowBuyOrderDialog(false)}
				/>
			)}
		</div>
	);
}
