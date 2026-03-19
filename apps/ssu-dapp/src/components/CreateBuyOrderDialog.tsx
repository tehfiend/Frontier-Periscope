import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { buildPostBuyOrder } from "@tehfrontier/chain-shared";
import { useEffect, useRef, useState } from "react";

interface CreateBuyOrderDialogProps {
	marketId: string;
	packageId: string;
	coinType: string;
	onClose: () => void;
}

export function CreateBuyOrderDialog({
	marketId,
	packageId,
	coinType,
	onClose,
}: CreateBuyOrderDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();

	const [paymentObjectId, setPaymentObjectId] = useState("");
	const [typeId, setTypeId] = useState("");
	const [pricePerUnit, setPricePerUnit] = useState("");
	const [quantity, setQuantity] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	const totalCost = Number(pricePerUnit || 0) * Number(quantity || 0);

	async function handleSubmit() {
		if (!account?.address) return;
		setError(null);
		setSuccess(null);

		if (!paymentObjectId.trim() || !typeId || !pricePerUnit || !quantity) {
			setError("All fields are required");
			return;
		}

		try {
			const tx = buildPostBuyOrder({
				packageId,
				marketId,
				coinType,
				paymentObjectId: paymentObjectId.trim(),
				typeId: Number(typeId),
				pricePerUnit: Number(pricePerUnit),
				quantity: Number(quantity),
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setSuccess("Buy order created successfully");
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
					<h3 className="text-sm font-medium text-zinc-200">Create Buy Order</h3>
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
							Post a buy order with escrowed payment. Sellers fill orders and
							receive payment.
						</p>

						<div>
							<label className="mb-1 block text-xs text-zinc-500">
								Payment Coin Object ID
							</label>
							<input
								type="text"
								value={paymentObjectId}
								onChange={(e) => setPaymentObjectId(e.target.value)}
								placeholder="0x... (Coin object with sufficient balance)"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
						</div>

						<div className="flex gap-2">
							<div className="flex-1">
								<label className="mb-1 block text-xs text-zinc-500">
									Item Type ID
								</label>
								<input
									type="number"
									value={typeId}
									onChange={(e) => setTypeId(e.target.value)}
									placeholder="e.g., 77708"
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
							</div>
							<div className="flex-1">
								<label className="mb-1 block text-xs text-zinc-500">
									Quantity
								</label>
								<input
									type="number"
									value={quantity}
									onChange={(e) => setQuantity(e.target.value)}
									placeholder="Amount"
									min={1}
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
							</div>
						</div>

						<div>
							<label className="mb-1 block text-xs text-zinc-500">
								Price per unit
							</label>
							<input
								type="number"
								value={pricePerUnit}
								onChange={(e) => setPricePerUnit(e.target.value)}
								placeholder="Token amount per unit"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
						</div>

						{totalCost > 0 && (
							<p className="text-xs text-zinc-500">
								Total escrow required: {totalCost.toLocaleString()}
							</p>
						)}

						<button
							type="button"
							onClick={handleSubmit}
							disabled={isPending}
							className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
						>
							{isPending ? "Creating..." : "Create Buy Order"}
						</button>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}
