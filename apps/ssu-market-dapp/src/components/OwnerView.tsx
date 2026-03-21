import type { SellListingWithName } from "@/hooks/useMarketListings";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { getMarketPackageId, SSU_MARKET_PACKAGE_ID } from "@/lib/constants";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import type { SsuConfigInfo } from "@tehfrontier/chain-shared";
import { buildCancelListing, buildUpdateSellListing } from "@tehfrontier/chain-shared";
import { useState } from "react";

interface OwnerViewProps {
	config: SsuConfigInfo;
	listings: SellListingWithName[];
	listingsLoading: boolean;
	characterObjectId: string;
}

export function OwnerView({
	config,
	listings,
	listingsLoading,
	characterObjectId,
}: OwnerViewProps) {
	const [editingId, setEditingId] = useState<number | null>(null);
	const [editPrice, setEditPrice] = useState("");
	const [editQty, setEditQty] = useState("");
	const [cancellingId, setCancellingId] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();

	async function handleUpdateListing(listingId: number) {
		if (!account?.address || !editPrice || !editQty || !config.marketId) return;
		setError(null);
		try {
			const tx = buildUpdateSellListing({
				packageId: getMarketPackageId(),
				marketId: config.marketId,
				coinType: "", // TODO: resolve coin type
				listingId,
				pricePerUnit: BigInt(editPrice),
				quantity: Number(editQty),
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setEditingId(null);
			setEditPrice("");
			setEditQty("");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleCancel(listingId: number) {
		if (!account?.address || !config.marketId) return;
		setError(null);
		try {
			const tx = buildCancelListing({
				packageId: SSU_MARKET_PACKAGE_ID,
				ssuConfigId: config.objectId,
				marketId: config.marketId,
				coinType: "", // TODO: resolve coin type
				ssuObjectId: config.ssuId,
				characterObjectId,
				listingId,
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setCancellingId(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div className="space-y-4">
			<div className="space-y-3">
				<h2 className="text-sm font-medium text-zinc-400">Sell Listings</h2>

				{listingsLoading ? (
					<div className="flex h-20 items-center justify-center">
						<div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
					</div>
				) : listings.length === 0 ? (
					<p className="text-center text-xs text-zinc-600">
						No sell listings yet. Create one by escrowing items from your SSU inventory.
					</p>
				) : (
					<div className="space-y-2">
						{listings.map((listing) => (
							<div
								key={listing.listingId}
								className="rounded-lg border border-zinc-800 bg-zinc-900 p-3"
							>
								<div className="flex items-center justify-between">
									<div>
										<p className="text-sm text-zinc-200">{listing.name}</p>
										<p className="text-xs text-zinc-500">
											{listing.pricePerUnit.toString()} per unit --{" "}
											{listing.quantity.toLocaleString()} available
										</p>
									</div>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={() => {
												setEditingId(listing.listingId);
												setEditPrice(String(listing.pricePerUnit));
												setEditQty(String(listing.quantity));
											}}
											disabled={isPending}
											className="rounded px-2 py-0.5 text-xs text-cyan-500 hover:bg-zinc-800"
										>
											Edit
										</button>
										<button
											type="button"
											onClick={() => setCancellingId(listing.listingId)}
											disabled={isPending}
											className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-zinc-800"
										>
											Cancel
										</button>
									</div>
								</div>

								{/* Inline edit */}
								{editingId === listing.listingId && (
									<div className="mt-2 flex items-center gap-2 border-t border-zinc-800 pt-2">
										<input
											type="number"
											value={editPrice}
											onChange={(e) => setEditPrice(e.target.value)}
											placeholder="Price"
											className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-600 focus:outline-none"
										/>
										<input
											type="number"
											value={editQty}
											onChange={(e) => setEditQty(e.target.value)}
											placeholder="Qty"
											className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-600 focus:outline-none"
										/>
										<button
											type="button"
											onClick={() => handleUpdateListing(listing.listingId)}
											disabled={isPending}
											className="rounded bg-cyan-600 px-2 py-1 text-xs text-white hover:bg-cyan-500 disabled:opacity-50"
										>
											Save
										</button>
										<button
											type="button"
											onClick={() => setEditingId(null)}
											className="text-xs text-zinc-500 hover:text-zinc-300"
										>
											Cancel
										</button>
									</div>
								)}

								{/* Inline cancel confirm */}
								{cancellingId === listing.listingId && (
									<div className="mt-2 flex items-center gap-2 border-t border-zinc-800 pt-2">
										<p className="text-xs text-zinc-500">
											Cancel this listing?
										</p>
										<button
											type="button"
											onClick={() => handleCancel(listing.listingId)}
											disabled={isPending}
											className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500 disabled:opacity-50"
										>
											Confirm
										</button>
										<button
											type="button"
											onClick={() => setCancellingId(null)}
											className="text-xs text-zinc-500 hover:text-zinc-300"
										>
											Dismiss
										</button>
									</div>
								)}
							</div>
						))}
					</div>
				)}
			</div>

			{error && <p className="text-xs text-red-400">{error}</p>}
		</div>
	);
}
