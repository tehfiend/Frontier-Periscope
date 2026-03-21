import type { SellListingWithName } from "@/hooks/useMarketListings";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { SSU_MARKET_PACKAGE_ID, getCoinType } from "@/lib/constants";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import type { SsuConfigInfo } from "@tehfrontier/chain-shared";
import { buildBuyFromListing, queryOwnedCoins } from "@tehfrontier/chain-shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface ListingCardProps {
	listing: SellListingWithName;
	config: SsuConfigInfo;
	canBuy: boolean;
	onConnect: () => void;
}

export function ListingCard({ listing, config, canBuy, onConnect }: ListingCardProps) {
	const [quantity, setQuantity] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const account = useCurrentAccount();
	const client = useCurrentClient() as SuiGraphQLClient;
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();

	const totalPrice = listing.pricePerUnit * BigInt(quantity);
	const coinType = getCoinType();

	const { data: ownedCoins } = useQuery({
		queryKey: ["ownedCoins", account?.address, coinType],
		queryFn: async () => {
			if (!account?.address || !coinType) return [];
			return queryOwnedCoins(client, account.address, coinType);
		},
		enabled: !!account?.address && !!coinType,
	});
	const maxQty = listing.quantity;

	async function handleBuy() {
		setError(null);

		if (!account?.address || !coinType || !config.marketId) {
			setError("Missing wallet connection, coin type, or market configuration.");
			return;
		}

		if (!ownedCoins?.length) {
			setError("No coins available in your wallet for this currency.");
			return;
		}

		try {
			const tx = buildBuyFromListing({
				packageId: SSU_MARKET_PACKAGE_ID,
				ssuConfigId: config.objectId,
				marketId: config.marketId,
				coinType,
				ssuObjectId: config.ssuId,
				characterObjectId: "", // TODO: resolve from chain via wallet address
				listingId: listing.listingId,
				quantity,
				coinObjectIds: ownedCoins.map((c) => c.objectId),
				senderAddress: account.address,
			});

			await signAndExecute(tx);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<div className="flex items-start justify-between">
				<div>
					<p className="text-sm font-medium text-zinc-200">{listing.name}</p>
					<p className="text-xs text-zinc-500">Type ID: {listing.typeId}</p>
				</div>
				<div className="text-right">
					<p className="text-sm font-medium text-cyan-400">
						{listing.pricePerUnit.toString()}
					</p>
					<p className="text-xs text-zinc-500">per unit</p>
				</div>
			</div>

			<p className="mt-1 text-xs text-zinc-500">{maxQty.toLocaleString()} available</p>

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
					onChange={(e) =>
						setQuantity(Math.max(1, Math.min(maxQty, Number(e.target.value))))
					}
					className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-600 focus:outline-none"
				/>
				<span className="text-xs text-zinc-500">
					= {totalPrice.toString()} total
				</span>
				<div className="flex-1" />
				{canBuy ? (
					<button
						type="button"
						onClick={handleBuy}
						disabled={isPending || !coinType}
						className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isPending ? "Buying..." : "Buy"}
					</button>
				) : (
					<button
						type="button"
						onClick={onConnect}
						className="rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-600"
					>
						Connect to Buy
					</button>
				)}
			</div>

			{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
		</div>
	);
}
