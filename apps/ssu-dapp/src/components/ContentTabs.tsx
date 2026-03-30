import type { BuyOrderWithName } from "@/hooks/useBuyOrders";
import type { InventoryItem, SsuInventories } from "@/hooks/useInventory";
import type { SellListingWithName } from "@/hooks/useMarketListings";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { useMemo, useState } from "react";
import { InventoryTabs } from "./InventoryTabs";
import { MarketContent } from "./MarketContent";
import { DelegateManager } from "./DelegateManager";
import type { PlayerSellInfo } from "./SellDialog";
import { SellDialog } from "./SellDialog";
import { SsuConfigInfo } from "./SsuConfigInfo";
import type { TransferContext } from "./TransferDialog";
import { VisibilitySettings } from "./VisibilitySettings";
import { WalletTab } from "./WalletTab";

type TabId = "inventory" | "market" | "wallet" | "settings";

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
	/** Whether the connected wallet is the SsuConfig owner */
	isSsuOwner?: boolean;
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
	isSsuOwner,
}: ContentTabsProps) {
	const [activeTab, setActiveTab] = useState<TabId>("inventory");
	const [sellDialogItem, setSellDialogItem] = useState<{
		item: InventoryItem;
		playerSell?: PlayerSellInfo;
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

	// Owner sell: market linked + connected + authorized (owner/delegate)
	const isSsuAuthorized =
		!!ssuConfig &&
		!!walletAddress &&
		(ssuConfig.owner === walletAddress || ssuConfig.delegates.includes(walletAddress));
	const canOwnerSell = hasMarket && isConnected && isSsuAuthorized;

	// Player sell: delegates/owner can sell from their own player inventory.
	// Regular players can't list -- market::post_sell_listing requires authorization.
	const canPlayerSell = hasMarket && isConnected && isSsuAuthorized;

	function handleOwnerSell(item: InventoryItem) {
		setSellDialogItem({ item });
	}

	function handlePlayerSell(item: InventoryItem) {
		if (!transferContext) return;
		setSellDialogItem({
			item,
			playerSell: { characterObjectId: transferContext.characterObjectId },
		});
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
				{ssuConfig && (
					<button
						type="button"
						onClick={() => setActiveTab("settings")}
						className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
							activeTab === "settings"
								? "bg-zinc-700 text-zinc-100"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						Settings
					</button>
				)}
			</div>

			{/* Active tab content */}
			{activeTab === "inventory" && (
				<InventoryTabs
					inventories={inventories}
					isLoading={inventoryLoading}
					transferContext={transferContext}
					onSell={canOwnerSell ? handleOwnerSell : undefined}
					onPlayerSell={canPlayerSell ? handlePlayerSell : undefined}
					canSell={canOwnerSell}
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

			{activeTab === "settings" && ssuConfig && (
				<div className="space-y-3">
					{isSsuOwner && <VisibilitySettings ssuConfig={ssuConfig} />}
					<SsuConfigInfo ssuConfig={ssuConfig} />
					{isSsuOwner && <DelegateManager ssuConfig={ssuConfig} />}
				</div>
			)}

			{/* Sell dialog */}
			{sellDialogItem && ssuConfig?.marketId && (
				<SellDialog
					item={sellDialogItem.item}
					ssuObjectId={ssuObjectId}
					ssuConfig={ssuConfig}
					coinType={coinType}
					ownerCharacterObjectId={ownerCharacterObjectId ?? null}
					playerSell={sellDialogItem.playerSell}
					onClose={() => setSellDialogItem(null)}
				/>
			)}
		</div>
	);
}
