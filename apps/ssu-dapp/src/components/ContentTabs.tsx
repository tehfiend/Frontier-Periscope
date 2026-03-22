import type { InventoryItem, SsuInventories } from "@/hooks/useInventory";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import type { BuyOrderWithName } from "@/hooks/useBuyOrders";
import type { MarketSellListing } from "@tehfrontier/chain-shared";
import { useState } from "react";
import { InventoryTabs } from "./InventoryTabs";
import { MarketContent } from "./MarketContent";
import { SellDialog } from "./SellDialog";
import type { TransferContext } from "./TransferDialog";

type TabId = "inventory" | "market";

interface ContentTabsProps {
	inventories: SsuInventories;
	inventoryLoading?: boolean;
	transferContext: TransferContext | null;
	ssuConfig: SsuConfigResult | null;
	ssuObjectId: string;
	characterObjectId?: string;
	ownerCap?: OwnerCapInfo;
	/** Player's Character OwnerCap (for player sell) */
	charOwnerCap?: OwnerCapInfo;
	charOwnerCapId?: string;
	isOwner: boolean;
	isAuthorized: boolean;
	isConnected: boolean;
	coinType: string;
	listings: MarketSellListing[];
	buyOrders: BuyOrderWithName[];
	listingsLoading?: boolean;
	buyOrdersLoading?: boolean;
	walletAddress?: string;
	/** Character's own OwnerCap ID (for player fill buy order) */
	characterOwnerCapId?: string;
}

export function ContentTabs({
	inventories,
	inventoryLoading,
	transferContext,
	ssuConfig,
	ssuObjectId,
	characterObjectId,
	ownerCap,
	charOwnerCap,
	charOwnerCapId,
	isOwner,
	isAuthorized,
	isConnected,
	coinType,
	listings,
	buyOrders,
	listingsLoading,
	buyOrdersLoading,
	walletAddress,
	characterOwnerCapId,
}: ContentTabsProps) {
	const [activeTab, setActiveTab] = useState<TabId>("inventory");
	const [sellDialogItem, setSellDialogItem] = useState<{
		item: InventoryItem;
		isPlayerSell: boolean;
	} | null>(null);

	const hasMarket = !!ssuConfig?.marketId;

	// Owner sell: isOwner + market linked + connected
	const canOwnerSell = isOwner && hasMarket && isConnected;

	// Player sell: not owner + market linked + connected + has character cap
	const canPlayerSell = !isOwner && hasMarket && isConnected && !!charOwnerCap;

	function handleSell(item: InventoryItem, isPlayerSell: boolean) {
		setSellDialogItem({ item, isPlayerSell });
	}

	return (
		<div>
			{/* Tab bar */}
			<div className="mb-4 flex gap-1 rounded-lg bg-zinc-800/50 p-1">
				<button
					type="button"
					onClick={() => setActiveTab("inventory")}
					className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
						activeTab === "inventory"
							? "bg-zinc-700 text-zinc-100"
							: "text-zinc-500 hover:text-zinc-300"
					}`}
				>
					Inventory
				</button>
				{hasMarket && (
					<button
						type="button"
						onClick={() => setActiveTab("market")}
						className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
							activeTab === "market"
								? "bg-zinc-700 text-zinc-100"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						Market
					</button>
				)}
			</div>

			{/* Active tab content */}
			{activeTab === "inventory" && (
				<InventoryTabs
					inventories={inventories}
					isLoading={inventoryLoading}
					transferContext={transferContext}
					onSell={canOwnerSell ? (item) => handleSell(item, false) : undefined}
					onPlayerSell={canPlayerSell ? (item) => handleSell(item, true) : undefined}
					canSell={canOwnerSell || canPlayerSell}
				/>
			)}

			{activeTab === "market" && hasMarket && ssuConfig && (
				<MarketContent
					ssuConfig={ssuConfig}
					listings={listings}
					buyOrders={buyOrders}
					listingsLoading={listingsLoading}
					buyOrdersLoading={buyOrdersLoading}
					isAuthorized={isAuthorized}
					characterObjectId={characterObjectId}
					isConnected={isConnected}
					coinType={coinType}
					walletAddress={walletAddress}
					ssuObjectId={ssuObjectId}
					ownerCapReceivingId={characterOwnerCapId}
				/>
			)}

			{/* Sell dialog -- owner or player */}
			{sellDialogItem && ssuConfig?.marketId && characterObjectId && (
				<SellDialog
					item={sellDialogItem.item}
					ssuObjectId={ssuObjectId}
					characterObjectId={characterObjectId}
					ownerCap={sellDialogItem.isPlayerSell ? undefined : ownerCap}
					charOwnerCap={sellDialogItem.isPlayerSell ? charOwnerCap : undefined}
					charOwnerCapId={sellDialogItem.isPlayerSell ? charOwnerCapId : undefined}
					ssuConfig={ssuConfig}
					coinType={coinType}
					isPlayerSell={sellDialogItem.isPlayerSell}
					onClose={() => setSellDialogItem(null)}
				/>
			)}
		</div>
	);
}
