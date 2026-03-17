import { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { getWorldPackageId, getTenant } from "@/lib/constants";
import type { InventoryData } from "@/hooks/useInventory";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";

interface DepositWithdrawPanelProps {
	ssuObjectId: string;
	characterObjectId: string;
	ownerCap: OwnerCapInfo;
	ownerInventory: InventoryData;
}

/**
 * Owner-only withdraw panel. Builds a PTB that:
 * 1. borrow_owner_cap from Character
 * 2. withdraw_by_owner from StorageUnit
 * 3. return_owner_cap to Character
 */
export function DepositWithdrawPanel({
	ssuObjectId,
	characterObjectId,
	ownerCap,
	ownerInventory,
}: DepositWithdrawPanelProps) {
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [selectedTypeId, setSelectedTypeId] = useState<string>("");
	const [quantity, setQuantity] = useState<string>("1");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const selectedItem = ownerInventory.items.find(
		(i) => String(i.typeId) === selectedTypeId,
	);
	const maxQty = selectedItem?.quantity ?? 0;

	async function handleWithdraw() {
		if (!selectedTypeId || !quantity) return;

		setError(null);
		setSuccess(null);

		const qty = Number(quantity);
		if (qty <= 0 || qty > maxQty) {
			setError(`Quantity must be between 1 and ${maxQty}`);
			return;
		}

		try {
			const tenant = getTenant();
			const worldPkg = getWorldPackageId(tenant);
			const tx = new Transaction();

			// 1. Borrow OwnerCap from Character
			const ownerCapType = `${worldPkg}::access::OwnerCap<${worldPkg}::storage_unit::StorageUnit>`;
			const [borrowedCap, receipt] = tx.moveCall({
				target: `${worldPkg}::character::borrow_owner_cap`,
				typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
				arguments: [
					tx.object(characterObjectId),
					tx.receivingRef({
						objectId: ownerCap.objectId,
						version: String(ownerCap.version),
						digest: ownerCap.digest,
					}),
				],
			});

			// 2. Withdraw by owner
			const withdrawnItem = tx.moveCall({
				target: `${worldPkg}::storage_unit::withdraw_by_owner`,
				typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
				arguments: [
					tx.object(ssuObjectId),
					tx.object(characterObjectId),
					borrowedCap,
					tx.pure.u64(BigInt(selectedTypeId)),
					tx.pure.u32(qty),
				],
			});

			// 3. Return OwnerCap
			tx.moveCall({
				target: `${worldPkg}::character::return_owner_cap`,
				typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
				arguments: [tx.object(characterObjectId), borrowedCap, receipt],
			});

			// Transfer withdrawn item to sender
			tx.transferObjects([withdrawnItem], tx.pure.address(characterObjectId));

			await signAndExecute(tx);
			setSuccess(`Withdrew ${qty}x ${selectedItem?.name ?? selectedTypeId}`);
			setQuantity("1");
		} catch (err) {
			setError(String(err));
		}
	}

	if (ownerInventory.items.length === 0) {
		return (
			<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
				<h3 className="mb-2 text-sm font-medium text-zinc-300">Withdraw Items</h3>
				<p className="text-xs text-zinc-600">No items in owner inventory to withdraw.</p>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h3 className="mb-3 text-sm font-medium text-zinc-300">Withdraw Items</h3>

			<div className="space-y-3">
				{/* Item selector */}
				<div>
					<label className="mb-1 block text-xs text-zinc-500">Item</label>
					<select
						value={selectedTypeId}
						onChange={(e) => {
							setSelectedTypeId(e.target.value);
							setQuantity("1");
						}}
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
					>
						<option value="">Select item...</option>
						{ownerInventory.items.map((item) => (
							<option key={item.typeId} value={String(item.typeId)}>
								{item.name} (x{item.quantity})
							</option>
						))}
					</select>
				</div>

				{/* Quantity */}
				{selectedItem && (
					<div>
						<label className="mb-1 block text-xs text-zinc-500">
							Quantity (max: {maxQty})
						</label>
						<input
							type="number"
							min={1}
							max={maxQty}
							value={quantity}
							onChange={(e) => setQuantity(e.target.value)}
							className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
						/>
					</div>
				)}

				{/* Withdraw button */}
				<button
					type="button"
					onClick={handleWithdraw}
					disabled={!selectedTypeId || isPending}
					className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
				>
					{isPending ? "Withdrawing..." : "Withdraw"}
				</button>

				{error && <p className="text-xs text-red-400">{error}</p>}
				{success && <p className="text-xs text-emerald-400">{success}</p>}
			</div>
		</div>
	);
}
