import type { SellListingWithName } from "@/hooks/useMarketListings";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import {
	buildCancelListingWithStandings,
	buildPlayerCancelListingWithStandings,
	formatBaseUnits,
} from "@tehfrontier/chain-shared";
import { useEffect, useRef, useState } from "react";

interface CancelListingDialogProps {
	listing: SellListingWithName;
	ssuConfig: SsuConfigResult;
	characterObjectId: string;
	ssuObjectId: string;
	coinType: string;
	coinDecimals: number;
	coinSymbol: string;
	onClose: () => void;
}

export function CancelListingDialog({
	listing,
	ssuConfig,
	characterObjectId,
	ssuObjectId,
	coinType,
	coinDecimals,
	coinSymbol,
	onClose,
}: CancelListingDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	async function handleCancel() {
		if (!account?.address || !ssuConfig.marketId) return;
		setError(null);
		setSuccess(null);

		const isAuthorized =
			account.address === ssuConfig.owner || ssuConfig.delegates.includes(account.address);

		try {
			const params = {
				packageId: ssuConfig.packageId,
				ssuConfigId: ssuConfig.ssuConfigId,
				marketId: ssuConfig.marketId,
				coinType,
				ssuObjectId,
				characterObjectId,
				listingId: listing.listingId,
				senderAddress: account.address,
			};
			const tx = isAuthorized
				? buildCancelListingWithStandings(params)
				: buildPlayerCancelListingWithStandings(params);
			await signAndExecute(tx);
			setSuccess("Listing cancelled successfully");
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
					<h3 className="text-sm font-medium text-zinc-200">Cancel Listing</h3>
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
							Are you sure you want to cancel this listing? Items will be returned to the SSU
							inventory.
						</p>

						{/* Listing info */}
						<div className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2">
							<p className="text-xs text-zinc-300">Item: {listing.name}</p>
							<p className="text-[10px] text-zinc-500">
								{formatBaseUnits(listing.pricePerUnit, coinDecimals)} {coinSymbol} per unit --{" "}
								{listing.quantity.toLocaleString()} listed
							</p>
						</div>

						{/* Action buttons */}
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => {
									dialogRef.current?.close();
									onClose();
								}}
								className="flex-1 rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600"
							>
								Keep Listing
							</button>
							<button
								type="button"
								onClick={handleCancel}
								disabled={isPending}
								className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
							>
								{isPending ? "Cancelling..." : "Cancel Listing"}
							</button>
						</div>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}
