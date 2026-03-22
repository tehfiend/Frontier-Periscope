import type { InventoryItem, SlotType, SsuInventories } from "@/hooks/useInventory";
import { useState } from "react";
import { InventoryTable } from "./InventoryTable";
import type { DestinationEntry, TransferContext } from "./TransferDialog";
import { TransferDialog } from "./TransferDialog";

interface InventoryTabsProps {
	inventories: SsuInventories;
	isLoading?: boolean;
	transferContext?: TransferContext | null;
	/** Callback when user clicks Sell on an owner inventory item */
	onSell?: (item: InventoryItem) => void;
	/** Callback when user clicks Sell on a player inventory item */
	onPlayerSell?: (item: InventoryItem) => void;
	/** Whether any Sell button should be shown */
	canSell?: boolean;
}

interface DialogState {
	item: InventoryItem;
	sourceSlotIdx: number;
}

/**
 * Color palette for inventory slots.
 * Each entry is [bg class for bar segments, border class for table accent,
 * text class for tab indicator, hex for inline styles].
 */
const SLOT_COLORS: Record<SlotType, { bar: string; border: string; text: string; hex: string }> = {
	owner: { bar: "bg-cyan-500", border: "border-l-cyan-500", text: "text-cyan-400", hex: "#06b6d4" },
	open: {
		bar: "bg-amber-500",
		border: "border-l-amber-500",
		text: "text-amber-400",
		hex: "#f59e0b",
	},
	player: { bar: "", border: "", text: "", hex: "" }, // assigned dynamically
};

/** Rotating colors for player inventory slots */
const PLAYER_COLORS = [
	{ bar: "bg-violet-500", border: "border-l-violet-500", text: "text-violet-400", hex: "#8b5cf6" },
	{
		bar: "bg-emerald-500",
		border: "border-l-emerald-500",
		text: "text-emerald-400",
		hex: "#10b981",
	},
	{ bar: "bg-rose-500", border: "border-l-rose-500", text: "text-rose-400", hex: "#f43f5e" },
	{ bar: "bg-sky-500", border: "border-l-sky-500", text: "text-sky-400", hex: "#0ea5e9" },
	{ bar: "bg-orange-500", border: "border-l-orange-500", text: "text-orange-400", hex: "#f97316" },
	{
		bar: "bg-fuchsia-500",
		border: "border-l-fuchsia-500",
		text: "text-fuchsia-400",
		hex: "#d946ef",
	},
];

/** Get the color config for a slot by type and player index */
function getSlotColor(
	slotType: SlotType,
	playerIndex: number,
): { bar: string; border: string; text: string; hex: string } {
	if (slotType !== "player") return SLOT_COLORS[slotType];
	return PLAYER_COLORS[playerIndex % PLAYER_COLORS.length];
}

export function InventoryTabs({
	inventories,
	isLoading,
	transferContext,
	onSell,
	onPlayerSell,
	canSell,
}: InventoryTabsProps) {
	const [activeIdx, setActiveIdx] = useState(0);
	const [dialogState, setDialogState] = useState<DialogState | null>(null);

	const { slots } = inventories;
	if (slots.length === 0) {
		return (
			<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
				<p className="text-center text-sm text-zinc-600">No inventories found</p>
			</div>
		);
	}

	const currentSlot = slots[activeIdx] ?? slots[0];

	// Compute total capacity (same across all slots -- property of the SSU)
	// Raw values are in milli-m3, divide by 1000 for m3
	const maxCapacity = (slots.length > 0 ? slots[0].maxCapacity : 0) / 1000;
	const totalUsed = slots.reduce((sum, s) => sum + s.usedCapacity, 0) / 1000;

	// Build color assignments: track player index for rotation
	let playerIdx = 0;
	const slotColors = slots.map((slot) => {
		if (slot.slotType === "player") {
			const color = getSlotColor("player", playerIdx);
			playerIdx++;
			return color;
		}
		return getSlotColor(slot.slotType, 0);
	});

	// Get the active slot's color for the table accent
	const activeColor = slotColors[activeIdx] ?? slotColors[0];

	// Transfer logic: can the user transfer items from the active slot?
	const hasMarket = !!transferContext?.ssuConfigId;
	const isAuthorized = !!transferContext?.isAuthorized;

	const canTransferFromActive = (() => {
		if (!transferContext) return false;

		// OwnerCap path: source has a cap AND at least one other cap key
		const hasCapForSource = transferContext.slotCaps.has(currentSlot.key);
		const hasOtherCap = [...transferContext.slotCaps.keys()].some(
			(k) => k !== currentSlot.key,
		);
		if (hasCapForSource && hasOtherCap) return true;

		// Market path: admin can transfer from owner/escrow slots
		if (hasMarket && isAuthorized) {
			if (currentSlot.slotType === "owner" || currentSlot.slotType === "open") return true;
		}

		// Market path: player can transfer from their own player slot to owner/escrow
		if (hasMarket && hasCapForSource && currentSlot.slotType === "player") {
			// Player has cap for their own slot -- they can use player_to_escrow/player_to_owner
			return true;
		}

		return false;
	})();

	function handleTransfer(item: InventoryItem) {
		setDialogState({ item, sourceSlotIdx: activeIdx });
	}

	// Build TransferDialog props when dialog is open
	const transferDialogProps = (() => {
		if (!dialogState || !transferContext) return null;

		const sourceSlot = slots[dialogState.sourceSlotIdx];
		if (!sourceSlot) return null;

		const withdrawCap = transferContext.slotCaps.get(sourceSlot.key);
		// For admin market transfers, withdrawCap may not exist (admin doesn't need a cap)
		// For OwnerCap transfers, withdrawCap is required
		if (!withdrawCap && !hasMarket) return null;

		const destinations: DestinationEntry[] = [];
		const addedKeys = new Set<string>();

		if (hasMarket) {
			// Market-enabled SSU: build destinations based on role and source type
			for (const s of slots) {
				if (s.key === sourceSlot.key) continue;
				if (addedKeys.has(s.key)) continue;

				// Check if this destination is reachable via market extension
				let marketReachable = false;
				if (isAuthorized) {
					// Admin can reach escrow + any player from owner/escrow
					if (sourceSlot.slotType === "owner" && (s.slotType === "open" || s.slotType === "player"))
						marketReachable = true;
					if (sourceSlot.slotType === "open" && (s.slotType === "owner" || s.slotType === "player"))
						marketReachable = true;
				}
				// Player can reach escrow + owner from their own player slot
				if (sourceSlot.slotType === "player" && withdrawCap) {
					if (s.slotType === "open" || s.slotType === "owner") marketReachable = true;
				}

				if (marketReachable) {
					destinations.push({
						slot: s,
						route: "market",
						recipientCharacterObjectId: s.characterObjectId,
					});
					addedKeys.add(s.key);
				}
			}
		}

		// OwnerCap direct destinations (always available when both caps exist)
		for (const s of slots) {
			if (s.key === sourceSlot.key) continue;
			if (addedKeys.has(s.key)) continue;
			const depositCap = transferContext.slotCaps.get(s.key);
			if (withdrawCap && depositCap) {
				destinations.push({ slot: s, depositCap, route: "ownerCap" });
				addedKeys.add(s.key);
			}
		}

		// Non-visible slots for which we have caps (e.g., player inventory not yet created)
		for (const [capKey, capRef] of transferContext.slotCaps) {
			if (capKey === sourceSlot.key) continue;
			if (addedKeys.has(capKey)) continue;
			if (slots.some((s) => s.key === capKey)) continue;
			if (!withdrawCap) continue;
			destinations.push({
				slot: {
					key: capKey,
					slotType: "player",
					label: transferContext.characterName
						? `Player: ${transferContext.characterName}`
						: "My Player Inventory",
					items: [],
					maxCapacity: sourceSlot.maxCapacity,
					usedCapacity: 0,
				},
				depositCap: capRef,
				route: "ownerCap",
			});
			addedKeys.add(capKey);
		}

		if (destinations.length === 0 && !(isAuthorized && hasMarket)) return null;

		// Visible slots the user cannot deposit to
		const inaccessibleSlots = hasMarket
			? [] // market-enabled SSUs have no inaccessible slots (admin/player routes cover all)
			: slots.filter(
					(s) =>
						s.key !== sourceSlot.key &&
						!addedKeys.has(s.key),
				);

		return {
			item: dialogState.item,
			sourceSlot,
			withdrawCap,
			destinations,
			inaccessibleSlots,
			ssuObjectId: transferContext.ssuObjectId,
			characterObjectId: transferContext.characterObjectId,
			ssuConfigId: transferContext.ssuConfigId,
			marketPackageId: transferContext.marketPackageId,
			isAuthorized: transferContext.isAuthorized,
		};
	})();

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			{/* Global capacity bar */}
			<div className="mb-4">
				<div className="mb-1.5 flex items-center justify-between text-xs text-zinc-500">
					<span>
						Capacity: {totalUsed.toLocaleString()} / {maxCapacity.toLocaleString()} m³
					</span>
					{maxCapacity > 0 && (
						<span className="text-zinc-600">{Math.round((totalUsed / maxCapacity) * 100)}%</span>
					)}
				</div>
				<div className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
					{slots.map((slot, idx) => {
						const used = slot.usedCapacity / 1000;
						if (used === 0 || maxCapacity === 0) return null;
						const widthPct = (used / maxCapacity) * 100;
						return (
							<div
								key={slot.key}
								className={`${slotColors[idx].bar} transition-all`}
								style={{ width: `${widthPct}%` }}
								title={`${slot.label}: ${used.toLocaleString()} m\u00B3`}
							/>
						);
					})}
				</div>
				{/* Legend */}
				{slots.length > 1 && (
					<div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
						{slots.map((slot, idx) => (
							<div key={slot.key} className="flex items-center gap-1 text-xs text-zinc-500">
								<div className={`h-2 w-2 rounded-full ${slotColors[idx].bar}`} />
								<span>{slot.label}</span>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Tab bar */}
			<div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-zinc-800/50 p-1">
				{slots.map((slot, idx) => (
					<button
						key={slot.key}
						type="button"
						onClick={() => setActiveIdx(idx)}
						className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors sm:px-3 ${
							activeIdx === idx ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						<span className="flex items-center justify-center gap-1">
							<span
								className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${slotColors[idx].bar}`}
							/>
							<span className="truncate">{slot.label}</span>
						</span>
						{slot.items.length > 0 && (
							<span className="ml-1 rounded-full bg-zinc-600/50 px-1.5 py-0.5 text-xs">
								{slot.items.length}
							</span>
						)}
					</button>
				))}
			</div>

			{/* Content -- inventory table with colored left border */}
			<div className={`border-l-2 pl-3 ${activeColor.border}`}>
				<InventoryTable
					inventory={currentSlot}
					isLoading={isLoading}
					canTransfer={canTransferFromActive}
					onTransfer={handleTransfer}
					canSell={canSell && (currentSlot.slotType === "owner" ? !!onSell : currentSlot.slotType === "player" ? !!onPlayerSell : false)}
					onSell={currentSlot.slotType === "owner" ? onSell : currentSlot.slotType === "player" ? onPlayerSell : undefined}
				/>
			</div>

			{/* Transfer dialog */}
			{dialogState && transferDialogProps && (
				<TransferDialog
					{...transferDialogProps}
					onClose={() => setDialogState(null)}
				/>
			)}
		</div>
	);
}
