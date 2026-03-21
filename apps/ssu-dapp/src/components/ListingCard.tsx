import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { decodeErrorMessage } from "@/lib/errors";
import { resolveItemName } from "@/lib/items";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { type MarketSellListing, buildBuyFromListing } from "@tehfrontier/chain-shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface ListingCardProps {
	listing: MarketSellListing;
	ssuConfig: SsuConfigResult;
	characterObjectId?: string;
	canBuy: boolean;
	coinType: string;
	ssuObjectId: string;
	nameMap?: Map<string, string>;
}

export function ListingCard({
	listing,
	ssuConfig,
	characterObjectId,
	canBuy,
	coinType,
	ssuObjectId,
	nameMap,
}: ListingCardProps) {
	const [quantity, setQuantity] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();

	const { data: itemName } = useQuery({
		queryKey: ["typeName", listing.typeId],
		queryFn: () => resolveItemName(listing.typeId),
		staleTime: 5 * 60_000,
	});

	const totalPrice = listing.pricePerUnit * quantity;
	const maxQty = listing.quantity;

	async function handleBuy() {
		setError(null);

		if (!account?.address || !coinType || !ssuConfig.marketId) {
			setError("Missing wallet connection, coin type, or market configuration.");
			return;
		}

		try {
			const tx = buildBuyFromListing({
				packageId: ssuConfig.packageId,
				ssuConfigId: ssuConfig.ssuConfigId,
				marketId: ssuConfig.marketId,
				coinType,
				ssuObjectId,
				characterObjectId: characterObjectId ?? "",
				listingId: listing.listingId,
				quantity,
				paymentObjectId: "", // Wallet resolves the payment coin
				senderAddress: account.address,
			});

			await signAndExecute(tx);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<div className="flex items-start justify-between">
				<div>
					<p className="text-sm font-medium text-zinc-200">
						{itemName ?? `Item #${listing.typeId}`}
					</p>
					<p className="text-xs text-zinc-500">Type ID: {listing.typeId}</p>
				</div>
				<div className="text-right">
					<p className="text-sm font-medium text-cyan-400">
						{listing.pricePerUnit.toLocaleString()}
					</p>
					<p className="text-xs text-zinc-500">per unit</p>
				</div>
			</div>

			<p className="mt-1 text-xs text-zinc-500">
				{maxQty.toLocaleString()} available
			</p>
			<p className="text-[10px] text-zinc-600">
				Seller: {nameMap?.get(listing.seller) ?? `${listing.seller.slice(0, 10)}...`}
			</p>

			<div className="mt-3 flex items-center gap-2">
				<label
					className="text-xs text-zinc-500"
					htmlFor={`qty-${listing.listingId}`}
				>
					Qty:
				</label>
				<input
					id={`qty-${listing.listingId}`}
					type="number"
					min={1}
					max={maxQty}
					value={quantity}
					onChange={(e) =>
						setQuantity(Math.max(1, Math.min(maxQty, Number(e.target.value))))
					}
					className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-600 focus:outline-none"
				/>
				<span className="text-xs text-zinc-500">
					= {totalPrice.toLocaleString()} total
				</span>
				<div className="flex-1" />
				{canBuy && (
					<button
						type="button"
						onClick={handleBuy}
						disabled={isPending || !coinType}
						className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isPending ? "Buying..." : "Buy"}
					</button>
				)}
			</div>

			{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
		</div>
	);
}
