import { useCoinMetadata } from "@/hooks/useCoinMetadata";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { useSuiClient } from "@/hooks/useSuiClient";
import { decodeErrorMessage } from "@/lib/errors";
import { resolveItemName } from "@/lib/items";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import {
	type MarketSellListing,
	buildBuyFromListingWithStandings,
	formatBaseUnits,
	queryOwnedCoins,
} from "@tehfrontier/chain-shared";
import { useState } from "react";
import { CopyAddress } from "./CopyAddress";

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
	const suiClient = useSuiClient();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const { data: coinMeta } = useCoinMetadata(coinType);
	const decimals = coinMeta?.decimals ?? 9;

	const { data: itemName } = useQuery({
		queryKey: ["typeName", listing.typeId],
		queryFn: () => resolveItemName(listing.typeId),
		staleTime: 5 * 60_000,
	});

	const { data: ownedCoins } = useQuery({
		queryKey: ["ownedCoins", account?.address, coinType],
		queryFn: async () => {
			if (!account?.address || !coinType) return [];
			return queryOwnedCoins(suiClient, account.address, coinType);
		},
		enabled: !!account?.address && !!coinType,
	});

	const totalPrice = listing.pricePerUnit * BigInt(quantity);
	const maxQty = listing.quantity;

	async function handleBuy() {
		setError(null);

		if (!account?.address || !coinType || !ssuConfig.marketId) {
			setError("Missing wallet connection, coin type, or market configuration.");
			return;
		}

		if (!ownedCoins?.length) {
			setError("No coins available in your wallet for this currency.");
			return;
		}

		try {
			const tx = buildBuyFromListingWithStandings({
				packageId: ssuConfig.packageId,
				ssuConfigId: ssuConfig.ssuConfigId,
				marketId: ssuConfig.marketId,
				coinType,
				registryId: ssuConfig.registryId ?? "",
				ssuObjectId,
				characterObjectId: characterObjectId ?? "",
				listingId: listing.listingId,
				quantity,
				coinObjectIds: ownedCoins.map((c) => c.objectId),
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
						{formatBaseUnits(listing.pricePerUnit, decimals)}
					</p>
					<p className="text-xs text-zinc-500">per unit</p>
				</div>
			</div>

			<p className="mt-1 text-xs text-zinc-500">{maxQty.toLocaleString()} available</p>
			<p className="text-[10px] text-zinc-600">
				Seller:{" "}
				{nameMap?.get(listing.seller) ?? (
					<CopyAddress
						address={listing.seller}
						sliceStart={10}
						sliceEnd={4}
						className="text-zinc-600"
					/>
				)}
			</p>

			<div className="mt-3 flex items-center gap-2">
				<label className="text-xs text-zinc-500" htmlFor={`qty-${listing.listingId}`}>
					Qty:
				</label>
				<input
					id={`qty-${listing.listingId}`}
					type="number"
					min={1}
					max={maxQty}
					value={quantity}
					onChange={(e) => setQuantity(Math.max(1, Math.min(maxQty, Number(e.target.value))))}
					className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-600 focus:outline-none"
				/>
				<span className="text-xs text-zinc-500">
					= {formatBaseUnits(totalPrice, decimals)} total
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
