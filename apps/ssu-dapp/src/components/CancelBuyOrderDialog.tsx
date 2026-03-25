import type { BuyOrderWithName } from "@/hooks/useBuyOrders";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { buildCancelBuyOrder, formatBaseUnits } from "@tehfrontier/chain-shared";
import { useEffect, useRef, useState } from "react";

interface CancelBuyOrderDialogProps {
	order: BuyOrderWithName;
	marketId: string;
	marketPackageId: string;
	coinType: string;
	coinDecimals: number;
	coinSymbol: string;
	onClose: () => void;
}

export function CancelBuyOrderDialog({
	order,
	marketId,
	marketPackageId,
	coinType,
	coinDecimals,
	coinSymbol,
	onClose,
}: CancelBuyOrderDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	const escrowed = order.pricePerUnit * BigInt(order.quantity);

	async function handleCancel() {
		if (!account?.address) return;
		setError(null);
		setSuccess(null);

		try {
			const tx = buildCancelBuyOrder({
				packageId: marketPackageId,
				marketId,
				coinType,
				orderId: order.orderId,
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setSuccess("Buy order cancelled -- escrowed funds returned");
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
					<h3 className="text-sm font-medium text-zinc-200">Cancel Buy Order</h3>
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
							Are you sure you want to cancel this buy order? Escrowed funds will be returned to
							your wallet.
						</p>

						<div className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2">
							<p className="text-xs text-zinc-300">Want: {order.name}</p>
							<p className="text-[10px] text-zinc-500">
								{formatBaseUnits(order.pricePerUnit, coinDecimals)} {coinSymbol} per unit --{" "}
								{order.quantity.toLocaleString()} wanted
							</p>
							<p className="text-[10px] text-zinc-500">
								Escrowed: {formatBaseUnits(escrowed, coinDecimals)} {coinSymbol}
							</p>
						</div>

						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => {
									dialogRef.current?.close();
									onClose();
								}}
								className="flex-1 rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600"
							>
								Keep Order
							</button>
							<button
								type="button"
								onClick={handleCancel}
								disabled={isPending}
								className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
							>
								{isPending ? "Cancelling..." : "Cancel Order"}
							</button>
						</div>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}
