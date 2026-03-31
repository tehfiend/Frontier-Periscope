import type { BuyOrderWithName } from "@/hooks/useBuyOrders";
import { useCharacterNames } from "@/hooks/useCharacterNames";
import { useCoinMetadata } from "@/hooks/useCoinMetadata";
import type { SellListingWithName } from "@/hooks/useMarketListings";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { getMarketPackageId } from "@/lib/constants";
import { useMemo, useState } from "react";
import { CreateBuyOrderDialog } from "./CreateBuyOrderDialog";
import { type MarketOrderRow, MarketOrdersGrid } from "./MarketOrdersGrid";

interface MarketContentProps {
	ssuConfig: SsuConfigResult;
	listings: SellListingWithName[];
	buyOrders: BuyOrderWithName[];
	listingsLoading?: boolean;
	buyOrdersLoading?: boolean;
	isConnected: boolean;
	coinType: string;
	walletAddress?: string;
	ssuObjectId: string;
	/** SSU owner's Character object ID (for escrow TX builders). */
	ownerCharacterObjectId?: string | null;
	/** typeId -> quantity currently in escrow (open inventory) */
	escrowQuantities?: Map<number, number>;
	/** Connected player's Character object ID (for player fill buy order). */
	connectedCharacterObjectId?: string | null;
	/** Connected player's Character OwnerCap (for player fill buy order). */
	charOwnerCap?: import("@/hooks/useOwnerCap").OwnerCapInfo | null;
	/** Connected player's Character OwnerCap ID (for player fill buy order). */
	charOwnerCapId?: string | null;
}

export function MarketContent({
	ssuConfig,
	listings,
	buyOrders,
	listingsLoading,
	buyOrdersLoading,
	isConnected,
	coinType,
	walletAddress,
	ssuObjectId,
	ownerCharacterObjectId,
	escrowQuantities,
	connectedCharacterObjectId,
	charOwnerCap,
	charOwnerCapId,
}: MarketContentProps) {
	const [showBuyOrderDialog, setShowBuyOrderDialog] = useState(false);
	const marketPkg = getMarketPackageId();
	const { data: coinMeta } = useCoinMetadata(coinType);
	const decimals = coinMeta?.decimals ?? 9;
	const symbol = coinMeta?.symbol ?? "";

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

	const isLoading = listingsLoading || buyOrdersLoading;

	// Map listings + buy orders into unified rows
	const rows = useMemo<MarketOrderRow[]>(() => {
		const result: MarketOrderRow[] = [];

		for (const listing of listings) {
			const charName = nameMap?.get(listing.seller);
			result.push({
				id: `sell-${listing.listingId}`,
				type: "Sell",
				itemName: listing.name,
				typeId: listing.typeId,
				quantity: listing.quantity,
				pricePerUnit: listing.pricePerUnit,
				by: charName ?? listing.seller,
				byAddress: listing.seller,
				timestamp: new Date(listing.postedAtMs),
				isMine: walletAddress === listing.seller,
				listing,
			});
		}

		for (const order of buyOrders) {
			const charName = nameMap?.get(order.buyer);
			result.push({
				id: `buy-${order.orderId}`,
				type: "Buy",
				itemName: order.name,
				typeId: order.typeId,
				quantity: order.quantity,
				pricePerUnit: order.pricePerUnit,
				by: charName ?? order.buyer,
				byAddress: order.buyer,
				timestamp: new Date(order.postedAtMs),
				isMine: walletAddress === order.buyer,
				buyOrder: order,
			});
		}

		return result;
	}, [listings, buyOrders, nameMap, walletAddress]);

	return (
		<div className="space-y-4">
			{/* Header with Create Buy Order button */}
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium text-zinc-400">Market Orders</h3>
				{isConnected && (
					<button
						type="button"
						onClick={() => setShowBuyOrderDialog(true)}
						className="rounded border border-dashed border-zinc-700 px-2 py-1 text-xs text-zinc-500 hover:border-amber-600 hover:text-amber-400"
					>
						+ Create Buy Order
					</button>
				)}
			</div>

			{/* Loading state */}
			{isLoading ? (
				<p className="py-4 text-center text-xs text-zinc-600">Loading orders...</p>
			) : (
				<MarketOrdersGrid
					rows={rows}
					ssuConfig={ssuConfig}
					coinType={coinType}
					ssuObjectId={ssuObjectId}
					isConnected={isConnected}
					coinDecimals={decimals}
					coinSymbol={symbol}
					marketPackageId={marketPkg}
					ownerCharacterObjectId={ownerCharacterObjectId}
					escrowQuantities={escrowQuantities}
					connectedCharacterObjectId={connectedCharacterObjectId}
					charOwnerCap={charOwnerCap}
					charOwnerCapId={charOwnerCapId}
				/>
			)}

			{/* Create Buy Order Dialog */}
			{showBuyOrderDialog && ssuConfig.marketId && (
				<CreateBuyOrderDialog
					marketId={ssuConfig.marketId}
					packageId={marketPkg ?? ""}
					coinType={coinType}
					onClose={() => setShowBuyOrderDialog(false)}
				/>
			)}
		</div>
	);
}
