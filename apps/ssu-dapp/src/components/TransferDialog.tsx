import type { CharacterSearchResult } from "@/hooks/useCharacterSearch";
import { useCharacterSearch } from "@/hooks/useCharacterSearch";
import type { InventoryItem, LabeledInventory } from "@/hooks/useInventory";
import { type OwnerCapInfo, fetchOwnerCapRef } from "@/hooks/useOwnerCap";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { useSuiClient } from "@/hooks/useSuiClient";
import { getTenant, getWorldPublishedAt } from "@/lib/constants";
import { decodeErrorMessage } from "@/lib/errors";
import { Transaction } from "@mysten/sui/transactions";
import { useEffect, useRef, useState } from "react";

export interface CapRef {
	info: OwnerCapInfo;
	typeArg: string;
}

export interface TransferContext {
	ssuObjectId: string;
	characterObjectId: string;
	characterName: string | null;
	/** Maps normalized slot key -> cap info for all writable slots */
	slotCaps: Map<string, CapRef>;
	/** SsuConfig object ID (present when SSU has extension) */
	ssuConfigId?: string;
	/** Latest extension package ID for moveCall targets */
	marketPackageId?: string;
	/** Market<T> object ID (may be null if not linked yet) */
	marketId?: string | null;
	/** Whether the connected wallet is the SsuConfig owner or delegate */
	isAuthorized: boolean;
	/** Move module name for extension functions ("ssu_unified" or "ssu_market") */
	extensionModule?: string;
}

export interface DestinationEntry {
	slot: LabeledInventory;
	/** OwnerCap for direct deposit (may be absent for market-routed transfers) */
	depositCap?: CapRef;
	/** "ownerCap" = existing borrow/deposit PTB, "market" = ssu_market extension function */
	route: "ownerCap" | "market";
	/** Character object ID of the recipient (needed for admin -> player market transfers) */
	recipientCharacterObjectId?: string;
}

/** Sentinel index for the "Send to player..." search option */
const SEARCH_PLAYER_IDX = -2;

interface TransferDialogProps {
	item: InventoryItem;
	sourceSlot: LabeledInventory;
	withdrawCap?: CapRef;
	destinations: DestinationEntry[];
	/** Visible slots the user cannot deposit to (no OwnerCap) -- shown disabled in dropdown */
	inaccessibleSlots: LabeledInventory[];
	ssuObjectId: string;
	characterObjectId: string;
	/** SsuConfig object ID for extension PTBs */
	ssuConfigId?: string;
	marketPackageId?: string;
	isAuthorized?: boolean;
	/** Move module name for extension functions */
	extensionModule?: string;
	onClose: () => void;
}

// ── PTB builders ─────────────────────────────────────────────────────────────

function buildOwnerCapTransferPtb(
	tx: Transaction,
	worldPkg: string,
	ssuObjectId: string,
	characterObjectId: string,
	item: InventoryItem,
	qty: number,
	withdrawCap: CapRef,
	depositCap: CapRef,
) {
	const sameCap = withdrawCap.info.objectId === depositCap.info.objectId;

	// 1. Borrow source cap (for withdraw)
	const [wCap, wReceipt] = tx.moveCall({
		target: `${worldPkg}::character::borrow_owner_cap`,
		typeArguments: [withdrawCap.typeArg],
		arguments: [
			tx.object(characterObjectId),
			tx.receivingRef({
				objectId: withdrawCap.info.objectId,
				version: String(withdrawCap.info.version),
				digest: withdrawCap.info.digest,
			}),
		],
	});

	// 2. Withdraw from source inventory
	const withdrawnItem = tx.moveCall({
		target: `${worldPkg}::storage_unit::withdraw_by_owner`,
		typeArguments: [withdrawCap.typeArg],
		arguments: [
			tx.object(ssuObjectId),
			tx.object(characterObjectId),
			wCap,
			tx.pure.u64(BigInt(item.typeId)),
			tx.pure.u32(qty),
		],
	});

	if (sameCap) {
		// Same cap for both slots -- deposit while still borrowed, then return once
		tx.moveCall({
			target: `${worldPkg}::storage_unit::deposit_by_owner`,
			typeArguments: [depositCap.typeArg],
			arguments: [tx.object(ssuObjectId), withdrawnItem, tx.object(characterObjectId), wCap],
		});

		tx.moveCall({
			target: `${worldPkg}::character::return_owner_cap`,
			typeArguments: [withdrawCap.typeArg],
			arguments: [tx.object(characterObjectId), wCap, wReceipt],
		});
	} else {
		// Different caps -- return source, borrow destination
		tx.moveCall({
			target: `${worldPkg}::character::return_owner_cap`,
			typeArguments: [withdrawCap.typeArg],
			arguments: [tx.object(characterObjectId), wCap, wReceipt],
		});

		const [dCap, dReceipt] = tx.moveCall({
			target: `${worldPkg}::character::borrow_owner_cap`,
			typeArguments: [depositCap.typeArg],
			arguments: [
				tx.object(characterObjectId),
				tx.receivingRef({
					objectId: depositCap.info.objectId,
					version: String(depositCap.info.version),
					digest: depositCap.info.digest,
				}),
			],
		});

		tx.moveCall({
			target: `${worldPkg}::storage_unit::deposit_by_owner`,
			typeArguments: [depositCap.typeArg],
			arguments: [tx.object(ssuObjectId), withdrawnItem, tx.object(characterObjectId), dCap],
		});

		tx.moveCall({
			target: `${worldPkg}::character::return_owner_cap`,
			typeArguments: [depositCap.typeArg],
			arguments: [tx.object(characterObjectId), dCap, dReceipt],
		});
	}
}

/** Build an extension admin transfer PTB (no cap borrow needed) */
function buildAdminMarketPtb(
	tx: Transaction,
	extensionPkg: string,
	extensionModule: string,
	ssuConfigId: string,
	ssuObjectId: string,
	characterObjectId: string,
	item: InventoryItem,
	qty: number,
	fnName: string,
	recipientCharacterObjectId?: string,
) {
	const args: Parameters<typeof tx.moveCall>[0]["arguments"] = [
		tx.object(ssuConfigId),
		tx.object(ssuObjectId),
		tx.object(characterObjectId),
	];

	// admin_to_player / admin_escrow_to_player need recipient_character as 4th arg
	if (recipientCharacterObjectId) {
		args.push(tx.object(recipientCharacterObjectId));
	}

	args.push(tx.pure.u64(BigInt(item.typeId)), tx.pure.u32(qty));

	tx.moveCall({
		target: `${extensionPkg}::${extensionModule}::${fnName}`,
		arguments: args,
	});
}

/** Build a player -> escrow/owner PTB (borrow cap, withdraw, return cap, then extension deposit) */
function buildPlayerMarketPtb(
	tx: Transaction,
	worldPkg: string,
	extensionPkg: string,
	extensionModule: string,
	ssuConfigId: string,
	ssuObjectId: string,
	characterObjectId: string,
	item: InventoryItem,
	qty: number,
	withdrawCap: CapRef,
	fnName: "player_to_escrow" | "player_to_owner",
) {
	// 1. Borrow player's OwnerCap<Character>
	const [wCap, wReceipt] = tx.moveCall({
		target: `${worldPkg}::character::borrow_owner_cap`,
		typeArguments: [withdrawCap.typeArg],
		arguments: [
			tx.object(characterObjectId),
			tx.receivingRef({
				objectId: withdrawCap.info.objectId,
				version: String(withdrawCap.info.version),
				digest: withdrawCap.info.digest,
			}),
		],
	});

	// 2. Withdraw from player's inventory
	const withdrawnItem = tx.moveCall({
		target: `${worldPkg}::storage_unit::withdraw_by_owner`,
		typeArguments: [withdrawCap.typeArg],
		arguments: [
			tx.object(ssuObjectId),
			tx.object(characterObjectId),
			wCap,
			tx.pure.u64(BigInt(item.typeId)),
			tx.pure.u32(qty),
		],
	});

	// 3. Return player's cap
	tx.moveCall({
		target: `${worldPkg}::character::return_owner_cap`,
		typeArguments: [withdrawCap.typeArg],
		arguments: [tx.object(characterObjectId), wCap, wReceipt],
	});

	// 4. Call the extension function with the withdrawn item
	tx.moveCall({
		target: `${extensionPkg}::${extensionModule}::${fnName}`,
		arguments: [
			tx.object(ssuConfigId),
			tx.object(ssuObjectId),
			tx.object(characterObjectId),
			withdrawnItem,
		],
	});
}

/**
 * Determine the market function name based on source/dest slot types and admin status.
 * Returns null if this transfer cannot be routed via the market extension.
 */
function getMarketFunctionName(
	sourceType: string,
	destType: string,
	isAuthorized: boolean,
	isSelfPlayer: boolean,
): string | null {
	if (isAuthorized) {
		if (sourceType === "owner" && destType === "open") return "admin_to_escrow";
		if (sourceType === "open" && destType === "owner") return "admin_from_escrow";
		if (sourceType === "owner" && destType === "player") return "admin_to_player";
		if (sourceType === "open" && destType === "player" && isSelfPlayer)
			return "admin_escrow_to_self";
		if (sourceType === "open" && destType === "player") return "admin_escrow_to_player";
	}
	// Player functions (anyone can call)
	if (sourceType === "player" && destType === "open") return "player_to_escrow";
	if (sourceType === "player" && destType === "owner") return "player_to_owner";
	return null;
}

// ── Component ────────────────────────────────────────────────────────────────

export function TransferDialog({
	item,
	sourceSlot,
	withdrawCap,
	destinations,
	inaccessibleSlots,
	ssuObjectId,
	characterObjectId,
	ssuConfigId,
	marketPackageId,
	isAuthorized,
	extensionModule = "ssu_unified",
	onClose,
}: TransferDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const client = useSuiClient();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [selectedDestIdx, setSelectedDestIdx] = useState(0);
	const [quantity, setQuantity] = useState("1");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	// Phase 5: character search state for admin -> new player transfers
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCharacter, setSelectedCharacter] = useState<CharacterSearchResult | null>(null);
	const { data: searchResults, isLoading: searchLoading } = useCharacterSearch(
		selectedDestIdx === SEARCH_PLAYER_IDX ? searchQuery : "",
	);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	// When "Send to player..." is selected, use the searched character as destination
	const isSearchMode = selectedDestIdx === SEARCH_PLAYER_IDX;

	const dest = isSearchMode ? null : destinations[selectedDestIdx];

	// For search mode, compute capacity from SSU's max capacity with 0 used
	const searchDestCapacity = destinations[0]?.slot.maxCapacity ?? 0;

	const remainingCapacity = isSearchMode
		? searchDestCapacity
		: dest
			? dest.slot.maxCapacity - dest.slot.usedCapacity
			: 0;
	const maxByCapacity =
		item.volume > 0 ? Math.floor(remainingCapacity / item.volume) : item.quantity;
	const maxTransfer = Math.min(item.quantity, maxByCapacity);

	// Show the "Send to player..." option if admin + market + source is owner or escrow
	const showSearchOption =
		isAuthorized &&
		!!ssuConfigId &&
		(sourceSlot.slotType === "owner" || sourceSlot.slotType === "open");

	async function handleTransfer() {
		const qty = Number(quantity);
		if (qty <= 0 || qty > maxTransfer) {
			setError(`Quantity must be between 1 and ${maxTransfer}`);
			return;
		}

		setError(null);
		setSuccess(null);

		try {
			const worldPkg = getWorldPublishedAt(getTenant());
			const tx = new Transaction();

			if (isSearchMode) {
				// Phase 5: admin -> new player (character search)
				if (!selectedCharacter || !ssuConfigId || !marketPackageId) {
					setError("Please select a recipient character");
					return;
				}
				const fnName =
					sourceSlot.slotType === "owner" ? "admin_to_player" : "admin_escrow_to_player";
				buildAdminMarketPtb(
					tx,
					marketPackageId,
					extensionModule,
					ssuConfigId,
					ssuObjectId,
					characterObjectId,
					item,
					qty,
					fnName,
					selectedCharacter.characterObjectId,
				);
				await signAndExecute(tx);
				setSuccess(`Transferred ${qty}x ${item.name} to ${selectedCharacter.characterName}`);
				return;
			}

			if (!dest) return;

			if (dest.route === "market" && ssuConfigId && marketPackageId) {
				// Market-routed transfer
				const isSelfDest =
					dest.recipientCharacterObjectId === characterObjectId ||
					dest.slot.characterObjectId === characterObjectId;
				const fnName = getMarketFunctionName(
					sourceSlot.slotType,
					dest.slot.slotType,
					!!isAuthorized,
					isSelfDest,
				);

				if (!fnName) {
					setError("This transfer route is not supported");
					return;
				}

				const needsPlayerWithdraw = fnName === "player_to_escrow" || fnName === "player_to_owner";

				if (needsPlayerWithdraw) {
					// Player functions: borrow cap + withdraw + return cap, then extension fn
					if (!withdrawCap) {
						setError("Missing withdraw capability");
						return;
					}
					// Fetch fresh OwnerCap ref to avoid stale version/digest
					const freshInfo = await fetchOwnerCapRef(client, withdrawCap.info.objectId);
					buildPlayerMarketPtb(
						tx,
						worldPkg,
						marketPackageId,
						extensionModule,
						ssuConfigId,
						ssuObjectId,
						characterObjectId,
						item,
						qty,
						{ ...withdrawCap, info: freshInfo },
						fnName as "player_to_escrow" | "player_to_owner",
					);
				} else {
					// Admin functions: simple moveCall, no cap borrow needed
					const recipientCharId = dest.recipientCharacterObjectId ?? dest.slot.characterObjectId;
					buildAdminMarketPtb(
						tx,
						marketPackageId,
						extensionModule,
						ssuConfigId,
						ssuObjectId,
						characterObjectId,
						item,
						qty,
						fnName,
						fnName === "admin_to_player" || fnName === "admin_escrow_to_player"
							? recipientCharId
							: undefined,
					);
				}
			} else {
				// OwnerCap direct transfer (existing path)
				if (!withdrawCap || !dest.depositCap) {
					setError("Missing transfer capabilities");
					return;
				}
				// Fetch fresh OwnerCap refs to avoid stale version/digest
				const freshWithdraw = await fetchOwnerCapRef(client, withdrawCap.info.objectId);
				const freshDeposit = withdrawCap.info.objectId === dest.depositCap.info.objectId
					? freshWithdraw
					: await fetchOwnerCapRef(client, dest.depositCap.info.objectId);
				buildOwnerCapTransferPtb(
					tx,
					worldPkg,
					ssuObjectId,
					characterObjectId,
					item,
					qty,
					{ ...withdrawCap, info: freshWithdraw },
					{ ...dest.depositCap, info: freshDeposit },
				);
			}

			await signAndExecute(tx);
			setSuccess(`Transferred ${qty}x ${item.name} to ${dest.slot.label}`);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	const displayCapacity = isSearchMode ? searchDestCapacity : (dest?.slot.maxCapacity ?? 0);
	const displayUsed = isSearchMode ? 0 : (dest?.slot.usedCapacity ?? 0);
	const displayRemaining = displayCapacity - displayUsed;
	const remainingM3 = (displayRemaining / 1000).toLocaleString();
	const usedPct = displayCapacity > 0 ? Math.round((displayUsed / displayCapacity) * 100) : 0;

	// Disable transfer button in search mode if no character is selected
	const transferDisabled = isPending || maxTransfer === 0 || (isSearchMode && !selectedCharacter);

	return (
		<dialog
			ref={dialogRef}
			className="m-auto w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-900 p-0 text-zinc-100 backdrop:bg-black/60"
			onClose={onClose}
		>
			<div className="p-4">
				<div className="mb-4 flex items-center justify-between">
					<h3 className="text-sm font-medium text-zinc-200">Transfer Item</h3>
					<button
						type="button"
						onClick={() => {
							dialogRef.current?.close();
							onClose();
						}}
						className="text-zinc-500 hover:text-zinc-300"
					>
						&times;
					</button>
				</div>

				{success ? (
					<div className="space-y-3">
						<p className="text-xs text-emerald-400">{success}</p>
						<button
							type="button"
							onClick={() => {
								dialogRef.current?.close();
								onClose();
							}}
							className="w-full rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600"
						>
							Close
						</button>
					</div>
				) : (
					<div className="space-y-3">
						{/* Item name */}
						<div>
							<span className="mb-1 block text-xs text-zinc-500">Item</span>
							<div className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
								{item.name} (x{item.quantity.toLocaleString()})
							</div>
						</div>

						{/* Source slot */}
						<div className="text-xs text-zinc-500">
							From: <span className="text-zinc-400">{sourceSlot.label}</span>
						</div>

						{/* Destination selector */}
						<div>
							<span className="mb-1 block text-xs text-zinc-500">
								Destination
							</span>
							<div className="space-y-1">
								{destinations.map((d, idx) => (
									<button
										key={d.slot.key}
										type="button"
										onClick={() => {
											setSelectedDestIdx(idx);
											setError(null);
											setSearchQuery("");
											setSelectedCharacter(null);
										}}
										className={`w-full rounded border px-3 py-2 text-left text-sm transition-colors ${
											selectedDestIdx === idx
												? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
												: "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600"
										}`}
									>
										{d.slot.label}
									</button>
								))}
								{showSearchOption && (
									<button
										type="button"
										onClick={() => {
											setSelectedDestIdx(SEARCH_PLAYER_IDX);
											setError(null);
										}}
										className={`w-full rounded border px-3 py-2 text-left text-sm transition-colors ${
											isSearchMode
												? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
												: "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600"
										}`}
									>
										Send to player...
									</button>
								)}
								{inaccessibleSlots.map((s) => (
									<div
										key={s.key}
										className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-600"
									>
										{s.label} (no access)
									</div>
								))}
							</div>
							{inaccessibleSlots.length > 0 && (
								<p className="mt-1 text-xs text-zinc-600">
									Grayed-out slots require extension permissions.
								</p>
							)}
						</div>

						{/* Phase 5: Character search UI */}
						{isSearchMode && (
							<div className="space-y-2">
								<label htmlFor="transfer-search" className="block text-xs text-zinc-500">
									Search character by name
								</label>
								<input
									id="transfer-search"
									type="text"
									value={searchQuery}
									onChange={(e) => {
										setSearchQuery(e.target.value);
										setSelectedCharacter(null);
										setError(null);
									}}
									placeholder="Enter character name..."
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
								/>
								{searchLoading && searchQuery.length >= 2 && (
									<p className="text-xs text-zinc-500">Searching...</p>
								)}
								{searchResults && searchResults.length > 0 && !selectedCharacter && (
									<div className="max-h-32 overflow-y-auto rounded border border-zinc-700 bg-zinc-800">
										{searchResults.map((c) => (
											<button
												key={c.characterObjectId}
												type="button"
												onClick={() => setSelectedCharacter(c)}
												className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700"
											>
												{c.characterName}
											</button>
										))}
									</div>
								)}
								{searchResults &&
									searchResults.length === 0 &&
									searchQuery.length >= 2 &&
									!searchLoading && <p className="text-xs text-zinc-500">No characters found</p>}
								{selectedCharacter && (
									<div className="flex items-center justify-between rounded border border-cyan-800 bg-cyan-900/20 px-3 py-1.5 text-sm">
										<span className="text-cyan-300">{selectedCharacter.characterName}</span>
										<button
											type="button"
											onClick={() => setSelectedCharacter(null)}
											className="text-xs text-zinc-500 hover:text-zinc-300"
										>
											Change
										</button>
									</div>
								)}
							</div>
						)}

						{/* Destination capacity indicator */}
						<div className="text-xs text-zinc-500">
							Destination capacity: {remainingM3} m{"\u00B3"} available ({usedPct}% used)
						</div>

						{/* Quantity input */}
						<div>
							<label htmlFor="transfer-qty" className="mb-1 block text-xs text-zinc-500">
								Quantity (max: {maxTransfer.toLocaleString()})
							</label>
							<div className="flex gap-2">
								<input
									id="transfer-qty"
									type="number"
									min={1}
									max={maxTransfer}
									value={quantity}
									onChange={(e) => {
										setQuantity(e.target.value);
										setError(null);
									}}
									className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
								/>
								<button
									type="button"
									onClick={() => setQuantity(String(maxTransfer))}
									className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200"
								>
									Max
								</button>
							</div>
						</div>

						{maxTransfer === 0 && !isSearchMode && (
							<p className="text-xs text-red-400">
								Destination has no remaining capacity for this item.
							</p>
						)}

						{/* Transfer button */}
						<button
							type="button"
							onClick={handleTransfer}
							disabled={transferDisabled}
							className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
						>
							{isPending ? "Transferring..." : "Transfer"}
						</button>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}
