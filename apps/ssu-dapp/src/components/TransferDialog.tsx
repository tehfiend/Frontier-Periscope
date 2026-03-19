import type { InventoryItem, LabeledInventory } from "@/hooks/useInventory";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { getTenant, getWorldPackageId } from "@/lib/constants";
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
}

export interface DestinationEntry {
	slot: LabeledInventory;
	depositCap: CapRef;
}

interface TransferDialogProps {
	item: InventoryItem;
	sourceSlot: LabeledInventory;
	withdrawCap: CapRef;
	destinations: DestinationEntry[];
	/** Visible slots the user cannot deposit to (no OwnerCap) -- shown disabled in dropdown */
	inaccessibleSlots: LabeledInventory[];
	ssuObjectId: string;
	characterObjectId: string;
	onClose: () => void;
}

export function TransferDialog({
	item,
	sourceSlot,
	withdrawCap,
	destinations,
	inaccessibleSlots,
	ssuObjectId,
	characterObjectId,
	onClose,
}: TransferDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [selectedDestIdx, setSelectedDestIdx] = useState(0);
	const [quantity, setQuantity] = useState("1");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	const dest = destinations[selectedDestIdx];
	if (!dest) return null;

	const remainingCapacity = dest.slot.maxCapacity - dest.slot.usedCapacity;
	const maxByCapacity =
		item.volume > 0 ? Math.floor(remainingCapacity / item.volume) : item.quantity;
	const maxTransfer = Math.min(item.quantity, maxByCapacity);

	async function handleTransfer() {
		if (!dest) return;
		const qty = Number(quantity);
		if (qty <= 0 || qty > maxTransfer) {
			setError(`Quantity must be between 1 and ${maxTransfer}`);
			return;
		}

		setError(null);
		setSuccess(null);

		try {
			const worldPkg = getWorldPackageId(getTenant());
			const tx = new Transaction();

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

			// 3. Return source cap
			tx.moveCall({
				target: `${worldPkg}::character::return_owner_cap`,
				typeArguments: [withdrawCap.typeArg],
				arguments: [tx.object(characterObjectId), wCap, wReceipt],
			});

			// 4. Borrow destination cap (for deposit)
			const [dCap, dReceipt] = tx.moveCall({
				target: `${worldPkg}::character::borrow_owner_cap`,
				typeArguments: [dest.depositCap.typeArg],
				arguments: [
					tx.object(characterObjectId),
					tx.receivingRef({
						objectId: dest.depositCap.info.objectId,
						version: String(dest.depositCap.info.version),
						digest: dest.depositCap.info.digest,
					}),
				],
			});

			// 5. Deposit to destination inventory
			// NOTE: deposit_by_owner arg order is (su, item, character, cap) -- item before character
			tx.moveCall({
				target: `${worldPkg}::storage_unit::deposit_by_owner`,
				typeArguments: [dest.depositCap.typeArg],
				arguments: [tx.object(ssuObjectId), withdrawnItem, tx.object(characterObjectId), dCap],
			});

			// 6. Return destination cap
			tx.moveCall({
				target: `${worldPkg}::character::return_owner_cap`,
				typeArguments: [dest.depositCap.typeArg],
				arguments: [tx.object(characterObjectId), dCap, dReceipt],
			});

			await signAndExecute(tx);
			setSuccess(`Transferred ${qty}x ${item.name} to ${dest.slot.label}`);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	const remainingM3 = (remainingCapacity / 1000).toLocaleString();
	const usedPct =
		dest.slot.maxCapacity > 0
			? Math.round((dest.slot.usedCapacity / dest.slot.maxCapacity) * 100)
			: 0;

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
							<label className="mb-1 block text-xs text-zinc-500">Item</label>
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
							<label className="mb-1 block text-xs text-zinc-500">
								Destination
							</label>
							<select
								value={selectedDestIdx}
								onChange={(e) => {
									const val = Number(e.target.value);
									if (val >= 0) {
										setSelectedDestIdx(val);
										setError(null);
									}
								}}
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
							>
								{destinations.map((d, idx) => (
									<option key={d.slot.key} value={idx}>
										{d.slot.label}
									</option>
								))}
								{inaccessibleSlots.map((s) => (
									<option key={s.key} value={-1} disabled>
										{s.label} (no access)
									</option>
								))}
							</select>
							{inaccessibleSlots.length > 0 && (
								<p className="mt-1 text-xs text-zinc-600">
									Grayed-out slots require extension permissions.
								</p>
							)}
						</div>

						{/* Destination capacity indicator */}
						<div className="text-xs text-zinc-500">
							Destination capacity: {remainingM3} m{"\u00B3"} available ({usedPct}%
							used)
						</div>

						{/* Quantity input */}
						<div>
							<label className="mb-1 block text-xs text-zinc-500">
								Quantity (max: {maxTransfer.toLocaleString()})
							</label>
							<div className="flex gap-2">
								<input
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

						{maxTransfer === 0 && (
							<p className="text-xs text-red-400">
								Destination has no remaining capacity for this item.
							</p>
						)}

						{/* Transfer button */}
						<button
							type="button"
							onClick={handleTransfer}
							disabled={isPending || maxTransfer === 0}
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
