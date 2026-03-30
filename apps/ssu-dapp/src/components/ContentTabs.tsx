import type { BuyOrderWithName } from "@/hooks/useBuyOrders";
import type { InventoryItem, SsuInventories } from "@/hooks/useInventory";
import type { SellListingWithName } from "@/hooks/useMarketListings";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { useMemo, useState } from "react";
import { InventoryTabs } from "./InventoryTabs";
import { MarketContent } from "./MarketContent";
import { SellDialog } from "./SellDialog";
import type { TransferContext } from "./TransferDialog";
import { WalletTab } from "./WalletTab";

type TabId = "inventory" | "market" | "wallet";

interface ContentTabsProps {
	inventories: SsuInventories;
	inventoryLoading?: boolean;
	transferContext: TransferContext | null;
	ssuConfig: SsuConfigResult | null;
	ssuObjectId: string;
	isConnected: boolean;
	coinType: string;
	listings: SellListingWithName[];
	buyOrders: BuyOrderWithName[];
	listingsLoading?: boolean;
	buyOrdersLoading?: boolean;
	walletAddress?: string;
	/** SSU owner's Character object ID (for escrow TX builders). */
	ownerCharacterObjectId?: string | null;
}

export function ContentTabs({
	inventories,
	inventoryLoading,
	transferContext,
	ssuConfig,
	ssuObjectId,
	isConnected,
	coinType,
	listings,
	buyOrders,
	listingsLoading,
	buyOrdersLoading,
	walletAddress,
	ownerCharacterObjectId,
}: ContentTabsProps) {
	const [activeTab, setActiveTab] = useState<TabId>("inventory");
	const [sellDialogItem, setSellDialogItem] = useState<{
		item: InventoryItem;
	} | null>(null);

	const hasMarket = !!ssuConfig?.marketId;

	// Build a map of typeId -> quantity in escrow (open inventory) for cancel logic
	const escrowQuantities = useMemo(() => {
		const openSlot = inventories.slots.find((s) => s.slotType === "open");
		const map = new Map<number, number>();
		for (const item of openSlot?.items ?? []) {
			map.set(item.typeId, (map.get(item.typeId) ?? 0) + item.quantity);
		}
		return map;
	}, [inventories]);

	// Sell: market linked + connected + authorized (owner/delegate)
	const isSsuAuthorized =
		!!ssuConfig &&
		!!walletAddress &&
		(ssuConfig.owner === walletAddress || ssuConfig.delegates.includes(walletAddress));
	const canSell = hasMarket && isConnected && isSsuAuthorized;

	function handleSell(item: InventoryItem) {
		setSellDialogItem({ item });
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
				{isConnected && (
					<button
						type="button"
						onClick={() => setActiveTab("wallet")}
						className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
							activeTab === "wallet"
								? "bg-zinc-700 text-zinc-100"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						Wallet
					</button>
				)}
			</div>

			{/* Active tab content */}
			{activeTab === "inventory" && (
				<InventoryTabs
					inventories={inventories}
					isLoading={inventoryLoading}
					transferContext={transferContext}
					onSell={canSell ? (item) => handleSell(item) : undefined}
					onPlayerSell={canSell ? (item) => handleSell(item) : undefined}
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
					isConnected={isConnected}
					coinType={coinType}
					walletAddress={walletAddress}
					ssuObjectId={ssuObjectId}
					ownerCharacterObjectId={ownerCharacterObjectId}
					escrowQuantities={escrowQuantities}
				/>
			)}

			{activeTab === "wallet" && isConnected && <WalletTab />}

			{/* Sell dialog */}
			{sellDialogItem && ssuConfig?.marketId && (
				<SellDialog
					item={sellDialogItem.item}
					ssuObjectId={ssuObjectId}
					ssuConfig={ssuConfig}
					coinType={coinType}
					ownerCharacterObjectId={ownerCharacterObjectId ?? null}
					onClose={() => setSellDialogItem(null)}
				/>
			)}
		</div>
	);
}
