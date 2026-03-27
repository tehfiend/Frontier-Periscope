import type { SellListingWithName } from "@/hooks/useMarketListings";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { useSuiClient } from "@/hooks/useSuiClient";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import { buildBuyFromListingWithStandings, formatBaseUnits, queryOwnedCoins } from "@tehfrontier/chain-shared";
import { useEffect, useRef, useState } from "react";

interface BuyFromListingDialogProps {
	listing: SellListingWithName;
	ssuConfig: SsuConfigResult;
	characterObjectId: string;
	coinType: string;
	ssuObjectId: string;
	coinDecimals: number;
	coinSymbol: string;
	onClose: () => void;
}

export function BuyFromListingDialog({
	listing,
	ssuConfig,
	characterObjectId,
	coinType,
	ssuObjectId,
	coinDecimals,
	coinSymbol,
	onClose,
}: BuyFromListingDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const suiClient = useSuiClient();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [quantity, setQuantity] = useState("1");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const { data: ownedCoins } = useQuery({
		queryKey: ["ownedCoins", account?.address, coinType],
		queryFn: async () => {
			if (!account?.address || !coinType) return [];
			return queryOwnedCoins(suiClient, account.address, coinType);
		},
		enabled: !!account?.address && !!coinType,
	});

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	const qty = Number(quantity) || 0;
	const maxQty = listing.quantity;
	const totalPrice = listing.pricePerUnit * BigInt(qty);

	async function handleBuy() {
		if (!account?.address || !ssuConfig.marketId) return;
		if (qty <= 0 || qty > maxQty) {
			setError(`Quantity must be between 1 and ${maxQty}`);
			return;
		}
		if (!ownedCoins?.length) {
			setError("No coins available in your wallet for this currency.");
			return;
		}

		setError(null);
		setSuccess(null);

		try {
			const tx = buildBuyFromListingWithStandings({
				packageId: ssuConfig.packageId,
				ssuConfigId: ssuConfig.ssuConfigId,
				marketId: ssuConfig.marketId,
				coinType,
				registryId: ssuConfig.registryId ?? "",
				ssuObjectId,
				characterObjectId,
				listingId: listing.listingId,
				quantity: qty,
				coinObjectIds: ownedCoins.map((c) => c.objectId),
				senderAddress: account.address,
			});

			await signAndExecute(tx);
			setSuccess(
				`Bought ${qty}x ${listing.name} for ${formatBaseUnits(totalPrice, coinDecimals)} ${coinSymbol}`,
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
					<h3 className="text-sm font-medium text-zinc-200">Buy from Listing</h3>
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
						<p className="text-[10px] text-zinc-600">Purchase items from this sell listing.</p>

						{/* Listing info */}
						<div className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2">
							<p className="text-xs text-zinc-300">Item: {listing.name}</p>
							<p className="text-[10px] text-zinc-500">
								{formatBaseUnits(listing.pricePerUnit, coinDecimals)} {coinSymbol} per unit --{" "}
								{listing.quantity.toLocaleString()} available
							</p>
						</div>

						{/* Quantity */}
						<div>
							<label htmlFor="buy-listing-qty" className="mb-1 block text-xs text-zinc-500">
								Quantity (max: {maxQty.toLocaleString()})
							</label>
							<div className="flex gap-2">
								<input
									id="buy-listing-qty"
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

						{/* Total preview */}
						{totalPrice > 0n && (
							<div className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400">
								Total cost: {formatBaseUnits(totalPrice, coinDecimals)} {coinSymbol}
							</div>
						)}

						{/* Buy button */}
						<button
							type="button"
							onClick={handleBuy}
							disabled={isPending || qty <= 0}
							className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
						>
							{isPending ? "Buying..." : "Buy"}
						</button>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}
