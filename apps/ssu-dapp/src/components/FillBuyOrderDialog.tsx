import type { BuyOrderWithName } from "@/hooks/useBuyOrders";
import { useCoinMetadata } from "@/hooks/useCoinMetadata";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { getTenant, getWorldPublishedAt } from "@/lib/constants";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { buildPlayerFillBuyOrderWithStandings, formatBaseUnits } from "@tehfrontier/chain-shared";
import { useEffect, useRef, useState } from "react";

interface FillBuyOrderDialogProps {
	order: BuyOrderWithName;
	ssuConfig: SsuConfigResult;
	coinType: string;
	ssuObjectId: string;
	characterObjectId: string;
	ownerCapReceivingId: string;
	onClose: () => void;
}

export function FillBuyOrderDialog({
	order,
	ssuConfig,
	coinType,
	ssuObjectId,
	characterObjectId,
	ownerCapReceivingId,
	onClose,
}: FillBuyOrderDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const { data: coinMeta } = useCoinMetadata(coinType);
	const decimals = coinMeta?.decimals ?? 9;
	const [quantity, setQuantity] = useState(String(order.quantity));
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	const qty = Number(quantity) || 0;
	const maxQty = order.quantity;
	const totalPayment = order.pricePerUnit * BigInt(qty);

	async function handleFill() {
		if (!account?.address || !ssuConfig.marketId) return;
		if (qty <= 0 || qty > maxQty) {
			setError(`Quantity must be between 1 and ${maxQty}`);
			return;
		}

		setError(null);
		setSuccess(null);

		try {
			const tx = buildPlayerFillBuyOrderWithStandings({
				packageId: ssuConfig.packageId,
				ssuConfigId: ssuConfig.ssuConfigId,
				marketId: ssuConfig.marketId,
				coinType,
				worldPackageId: getWorldPublishedAt(getTenant()),
				ssuObjectId,
				characterObjectId,
				ownerCapReceivingId,
				orderId: order.orderId,
				typeId: order.typeId,
				quantity: qty,
				senderAddress: account.address,
			});

			await signAndExecute(tx);
			setSuccess(
				`Filled ${qty}x ${order.name} -- received ${formatBaseUnits(totalPayment, decimals)} payment`,
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
					<h3 className="text-sm font-medium text-zinc-200">Sell Order</h3>
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
							Sell items from your inventory to fill this buy order. You will receive the escrowed
							payment.
						</p>

						{/* Order info */}
						<div className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2">
							<p className="text-xs text-zinc-300">Item: {order.name}</p>
							<p className="text-[10px] text-zinc-500">
								{formatBaseUnits(order.pricePerUnit, decimals)} per unit --{" "}
								{order.quantity.toLocaleString()} wanted
							</p>
						</div>

						{/* Quantity */}
						<div>
							<label htmlFor="fill-order-qty" className="mb-1 block text-xs text-zinc-500">
								Quantity to sell (max: {maxQty.toLocaleString()})
							</label>
							<div className="flex gap-2">
								<input
									id="fill-order-qty"
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

						{/* Payment preview */}
						{totalPayment > 0n && (
							<div className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400">
								You will receive: {formatBaseUnits(totalPayment, decimals)} (minus fees)
							</div>
						)}

						{/* Fill button */}
						<button
							type="button"
							onClick={handleFill}
							disabled={isPending || qty <= 0}
							className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
						>
							{isPending ? "Selling..." : "Sell"}
						</button>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}
