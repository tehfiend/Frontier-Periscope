import type { AssemblyMetadata } from "@/hooks/useAssembly";
import type { BuyOrderWithName } from "@/hooks/useBuyOrders";
import type { InventoryItem, SsuInventories } from "@/hooks/useInventory";
import type { SellListingWithName } from "@/hooks/useMarketListings";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { useMemo, useState } from "react";
import { DelegateManager } from "./DelegateManager";
import { InventoryTabs } from "./InventoryTabs";
import { MarketContent } from "./MarketContent";
import { MetadataEditor } from "./MetadataEditor";
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
	ownerCharacterName?: string | null;
	connectedCharacterName?: string | null;
	extensionType?: string | null;
	dappUrl?: string | null;
	/** Owner's Character object ID (for metadata editing) */
	ownerCharacterForMetadata?: string | null;
	/** SSU OwnerCap (for metadata editing) */
	ownerCap?: OwnerCapInfo | null;
	/** Current on-chain metadata */
	metadata?: AssemblyMetadata | null;
	/** Connected player's Character object ID (for player sell) */
	connectedCharacterObjectId?: string | null;
	/** Connected player's Character OwnerCap (for player sell) */
	charOwnerCap?: OwnerCapInfo | null;
	/** Connected player's Character OwnerCap ID (for player sell) */
	charOwnerCapId?: string | null;
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
	ownerCharacterName,
	connectedCharacterName,
	extensionType,
	dappUrl,
	ownerCharacterForMetadata,
	ownerCap,
	metadata,
	connectedCharacterObjectId,
	charOwnerCap,
	charOwnerCapId,
}: ContentTabsProps) {
	const [activeTab, setActiveTab] = useState<TabId>("inventory");
	const [sellDialogItem, setSellDialogItem] = useState<{
		item: InventoryItem;
		isPlayerSell: boolean;
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

	// Only the SSU owner can sell from the owner inventory (escrow_and_list uses owner slot)
	const canOwnerSell = hasMarket && isConnected && isSsuOwner;
	// Any connected user can sell from their own player slot (requires resolved OwnerCap)
	const canPlayerSell = hasMarket && isConnected && !!charOwnerCap;

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
					isConnected={isConnected}
					coinType={coinType}
					walletAddress={walletAddress}
					ssuObjectId={ssuObjectId}
					ownerCharacterObjectId={ownerCharacterObjectId}
					escrowQuantities={escrowQuantities}
					connectedCharacterObjectId={connectedCharacterObjectId}
					charOwnerCap={charOwnerCap}
					charOwnerCapId={charOwnerCapId}
				/>
			)}

			{activeTab === "wallet" && isConnected && <WalletTab />}

			{activeTab === "settings" && ssuConfig && (
				<div className="space-y-3">
					<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
						<h3 className="mb-3 text-sm font-medium text-zinc-300">Info</h3>
						<div className="space-y-1.5">
							{ownerCharacterName && (
								<p className="text-xs text-zinc-500">
									Owner: <span className="font-medium text-zinc-300">{ownerCharacterName}</span>
								</p>
							)}
							{connectedCharacterName && (
								<p className="text-xs text-zinc-500">
									Connected as: <span className="font-medium text-cyan-400">{connectedCharacterName}</span>
								</p>
							)}
							{extensionType && (
								<>
									<p className="text-xs text-zinc-500">
										Extension: <span className="font-mono text-zinc-400">{formatExtensionType(extensionType)}</span>
									</p>
									<p className="text-xs text-zinc-500">
										Registered Extension
									</p>
									<p className="break-all font-mono text-xs text-zinc-400">{extensionType}</p>
								</>
							)}
							{dappUrl && (
								<p className="text-xs text-zinc-500">
									dApp URL:{" "}
									<a
										href={dappUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-cyan-500 hover:text-cyan-400"
									>
										{dappUrl}
									</a>
								</p>
							)}
						</div>
					</div>
					{isSsuOwner && ownerCharacterForMetadata && ownerCap && (
						<MetadataEditor
							ssuObjectId={ssuObjectId}
							characterObjectId={ownerCharacterForMetadata}
							ownerCap={ownerCap}
							metadata={metadata ?? null}
						/>
					)}
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
					isPlayerSell={sellDialogItem.isPlayerSell}
					connectedCharacterObjectId={connectedCharacterObjectId ?? undefined}
					charOwnerCap={charOwnerCap ?? undefined}
					charOwnerCapId={charOwnerCapId ?? undefined}
					onClose={() => setSellDialogItem(null)}
				/>
			)}
		</div>
	);
}

function formatExtensionType(ext: string): string {
	const parts = ext.split("::");
	if (parts.length >= 3) {
		return `${parts[parts.length - 2]}::${parts[parts.length - 1]}`;
	}
	return ext;
}
