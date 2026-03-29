import { useCoinMetadata } from "@/hooks/useCoinMetadata";
import type { InventoryItem } from "@/hooks/useInventory";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { buildEscrowAndList, formatBaseUnits, parseDisplayPrice } from "@tehfrontier/chain-shared";
import { useEffect, useRef, useState } from "react";

interface SellDialogProps {
	item: InventoryItem;
	ssuObjectId: string;
	ssuConfig: SsuConfigResult;
	coinType: string;
	/** SSU owner's Character object ID (for escrow TX builders). */
	ownerCharacterObjectId: string | null;
	onClose: () => void;
}

export function SellDialog({
	item,
	ssuObjectId,
	ssuConfig,
	coinType,
	ownerCharacterObjectId,
	onClose,
}: SellDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const { data: coinMeta } = useCoinMetadata(coinType);
	const decimals = coinMeta?.decimals ?? 9;
	const symbol = coinMeta?.symbol ?? "";
	const [quantity, setQuantity] = useState("1");
	const [pricePerUnit, setPricePerUnit] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	const qty = Number(quantity) || 0;
	const priceBase = parseDisplayPrice(pricePerUnit || "0", decimals);
	const totalValue = priceBase * BigInt(qty);
	const maxQty = item.quantity;

	async function handleSell() {
		if (!account?.address || !ssuConfig.marketId || !coinType) return;
		if (!ownerCharacterObjectId) {
			setError("SSU owner character not resolved");
			return;
		}
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
				ssuUnifiedPackageId: ssuConfig.packageId,
				ssuConfigId: ssuConfig.ssuConfigId,
				ssuObjectId,
				characterObjectId: ownerCharacterObjectId,
				coinType,
				marketId: ssuConfig.marketId,
				typeId: item.typeId,
				pricePerUnit: priceBase,
				quantity: qty,
				senderAddress: account.address,
			});

			await signAndExecute(tx);
			setSuccess(
				`Listed ${qty}x ${item.name} at ${formatBaseUnits(priceBase, decimals)} ${symbol} per unit`,
			);
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
						<p className="text-[10px] text-zinc-600">
							Items will be listed as a virtual sell listing.
						</p>

						{/* Item info */}
						<div>
							<span className="mb-1 block text-xs text-zinc-500">Item</span>
							<div className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
								{item.name} (x{item.quantity.toLocaleString()})
							</div>
						</div>

						{/* Quantity */}
						<div>
							<label htmlFor="sell-qty" className="mb-1 block text-xs text-zinc-500">
								Quantity (max: {maxQty.toLocaleString()})
							</label>
							<div className="flex gap-2">
								<input
									id="sell-qty"
									type="number"
									min={1}
									max={maxQty}
									value={quantity}
									onChange={(e) => {
										setQuantity(e.target.value);
										setError(null);
									}}
									className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
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
							<label htmlFor="sell-price" className="mb-1 block text-xs text-zinc-500">
								Price per unit{symbol ? ` (${symbol})` : ""}
							</label>
							<input
								id="sell-price"
								type="number"
								min={1}
								value={pricePerUnit}
								onChange={(e) => {
									setPricePerUnit(e.target.value);
									setError(null);
								}}
								placeholder="Token amount per unit"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
							/>
						</div>

						{/* Total preview */}
						{totalValue > 0n && (
							<div className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400">
								Total value: {formatBaseUnits(totalValue, decimals)} {symbol}
							</div>
						)}

						{/* Sell button */}
						<button
							type="button"
							onClick={handleSell}
							disabled={isPending || qty <= 0 || priceBase <= 0n}
							className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
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
