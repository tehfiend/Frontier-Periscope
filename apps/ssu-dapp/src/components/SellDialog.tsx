import type { InventoryItem } from "@/hooks/useInventory";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { getTenant, getWorldPackageId } from "@/lib/constants";
import { decodeErrorMessage } from "@/lib/errors";
import { buildEscrowAndList } from "@tehfrontier/chain-shared";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useEffect, useRef, useState } from "react";

interface SellDialogProps {
	item: InventoryItem;
	ssuObjectId: string;
	characterObjectId: string;
	ownerCap: OwnerCapInfo;
	ssuConfig: SsuConfigResult;
	coinType: string;
	onClose: () => void;
}

export function SellDialog({
	item,
	ssuObjectId,
	characterObjectId,
	ownerCap,
	ssuConfig,
	coinType,
	onClose,
}: SellDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [quantity, setQuantity] = useState("1");
	const [pricePerUnit, setPricePerUnit] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	const qty = Number(quantity) || 0;
	const priceBase = BigInt(pricePerUnit || 0);
	const totalValue = priceBase * BigInt(qty);
	const maxQty = item.quantity;

	async function handleSell() {
		if (!account?.address || !ssuConfig.marketId) return;
		if (qty <= 0 || qty > maxQty) {
			setError(`Quantity must be between 1 and ${maxQty}`);
			return;
		}
		if (priceBase <= 0n) {
			setError("Price per unit must be greater than 0");
			return;
		}

		setError(null);
		setSuccess(null);

		try {
			const tx = buildEscrowAndList({
				packageId: ssuConfig.packageId,
				ssuConfigId: ssuConfig.ssuConfigId,
				marketId: ssuConfig.marketId,
				coinType,
				worldPackageId: getWorldPackageId(getTenant()),
				ssuObjectId,
				characterObjectId,
				ownerCapReceivingId: ownerCap.objectId,
				typeId: item.typeId,
				quantity: qty,
				pricePerUnit: priceBase,
				senderAddress: account.address,
			});

			await signAndExecute(tx);
			setSuccess(`Listed ${qty}x ${item.name} at ${priceBase.toString()} per unit`);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	return (
		<dialog
			ref={dialogRef}
			className="m-auto w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-900 p-0 text-zinc-100 backdrop:bg-black/60"
			onClose={onClose}
		>
			<div className="p-4">
				<div className="mb-4 flex items-center justify-between">
					<h3 className="text-sm font-medium text-zinc-200">Sell Item</h3>
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
						{/* Item info */}
						<div>
							<label className="mb-1 block text-xs text-zinc-500">Item</label>
							<div className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
								{item.name} (x{item.quantity.toLocaleString()})
							</div>
						</div>

						{/* Quantity */}
						<div>
							<label className="mb-1 block text-xs text-zinc-500">
								Quantity (max: {maxQty.toLocaleString()})
							</label>
							<div className="flex gap-2">
								<input
									type="number"
									min={1}
									max={maxQty}
									value={quantity}
									onChange={(e) => {
										setQuantity(e.target.value);
										setError(null);
									}}
									className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
								/>
								<button
									type="button"
									onClick={() => setQuantity(String(maxQty))}
									className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200"
								>
									Max
								</button>
							</div>
						</div>

						{/* Price per unit */}
						<div>
							<label className="mb-1 block text-xs text-zinc-500">
								Price per unit
							</label>
							<input
								type="number"
								min={1}
								value={pricePerUnit}
								onChange={(e) => {
									setPricePerUnit(e.target.value);
									setError(null);
								}}
								placeholder="Token amount per unit"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
							/>
						</div>

						{/* Total preview */}
						{totalValue > 0n && (
							<div className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400">
								Total value: {totalValue.toString()}
							</div>
						)}

						{/* Sell button */}
						<button
							type="button"
							onClick={handleSell}
							disabled={isPending || qty <= 0 || priceBase <= 0n}
							className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
						>
							{isPending ? "Creating listing..." : "Create Sell Listing"}
						</button>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}
