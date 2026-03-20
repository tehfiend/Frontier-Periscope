import type { InventoryItem, SsuInventories } from "@/hooks/useInventory";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import type { MarketBuyOrder, MarketSellListing } from "@tehfrontier/chain-shared";
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
	isOwner: boolean;
	isAuthorized: boolean;
	isConnected: boolean;
	coinType: string;
	listings: MarketSellListing[];
	buyOrders: MarketBuyOrder[];
	listingsLoading?: boolean;
	buyOrdersLoading?: boolean;
	walletAddress?: string;
}

export function ContentTabs({
	inventories,
	inventoryLoading,
	transferContext,
	ssuConfig,
	ssuObjectId,
	characterObjectId,
	ownerCap,
	isOwner,
	isAuthorized,
	isConnected,
	coinType,
	listings,
	buyOrders,
	listingsLoading,
	buyOrdersLoading,
	walletAddress,
}: ContentTabsProps) {
	const [activeTab, setActiveTab] = useState<TabId>("inventory");
	const [sellDialogItem, setSellDialogItem] = useState<InventoryItem | null>(null);

	const hasMarket = !!ssuConfig?.marketId;

	// Sell button visible: isOwner + market linked + owner slot + connected
	const canSell = isOwner && hasMarket && isConnected;

	function handleSell(item: InventoryItem) {
		setSellDialogItem(item);
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
					onSell={canSell ? handleSell : undefined}
					canSell={canSell}
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
				/>
			)}

			{/* Sell dialog */}
			{sellDialogItem && ssuConfig?.marketId && characterObjectId && ownerCap && (
				<SellDialog
					item={sellDialogItem}
					ssuObjectId={ssuObjectId}
					characterObjectId={characterObjectId}
					ownerCap={ownerCap}
					ssuConfig={ssuConfig}
					coinType={coinType}
					onClose={() => setSellDialogItem(null)}
				/>
			)}
		</div>
	);
}
