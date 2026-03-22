import type { SellListingWithName } from "@/hooks/useMarketListings";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import {
	buildUpdateSellListing,
	formatBaseUnits,
	parseDisplayPrice,
} from "@tehfrontier/chain-shared";
import { useEffect, useRef, useState } from "react";

interface EditListingDialogProps {
	listing: SellListingWithName;
	ssuConfig: SsuConfigResult;
	coinType: string;
	coinDecimals: number;
	coinSymbol: string;
	onClose: () => void;
}

export function EditListingDialog({
	listing,
	ssuConfig,
	coinType,
	coinDecimals,
	coinSymbol,
	onClose,
}: EditListingDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [price, setPrice] = useState(formatBaseUnits(listing.pricePerUnit, coinDecimals));
	const [qty, setQty] = useState(String(listing.quantity));
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	async function handleUpdate() {
		if (!account?.address || !ssuConfig.marketId) return;
		setError(null);
		setSuccess(null);

		try {
			const tx = buildUpdateSellListing({
				packageId: ssuConfig.packageId,
				marketId: ssuConfig.marketId,
				coinType,
				listingId: listing.listingId,
				pricePerUnit: parseDisplayPrice(price, coinDecimals),
				quantity: Number(qty),
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setSuccess("Listing updated successfully");
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
					<h3 className="text-sm font-medium text-zinc-200">Edit Listing</h3>
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
						{/* Listing info */}
						<div className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2">
							<p className="text-xs text-zinc-300">Item: {listing.name}</p>
							<p className="text-[10px] text-zinc-500">
								Current: {formatBaseUnits(listing.pricePerUnit, coinDecimals)} {coinSymbol} per unit
								-- {listing.quantity.toLocaleString()} available
							</p>
						</div>

						{/* Price */}
						<div>
							<label htmlFor="edit-listing-price" className="mb-1 block text-xs text-zinc-500">
								Price per unit{coinSymbol ? ` (${coinSymbol})` : ""}
							</label>
							<input
								id="edit-listing-price"
								type="number"
								value={price}
								onChange={(e) => {
									setPrice(e.target.value);
									setError(null);
								}}
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
							/>
						</div>

						{/* Quantity */}
						<div>
							<label htmlFor="edit-listing-qty" className="mb-1 block text-xs text-zinc-500">
								Quantity
							</label>
							<input
								id="edit-listing-qty"
								type="number"
								min={1}
								value={qty}
								onChange={(e) => {
									setQty(e.target.value);
									setError(null);
								}}
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
							/>
						</div>

						{/* Update button */}
						<button
							type="button"
							onClick={handleUpdate}
							disabled={isPending}
							className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
						>
							{isPending ? "Saving..." : "Save Changes"}
						</button>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}
