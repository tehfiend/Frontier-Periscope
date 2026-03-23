import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import type { MarketSellListing } from "@tehfrontier/chain-shared";
import { ListingCard } from "./ListingCard";

interface ListingBuyerListProps {
	listings: MarketSellListing[];
	ssuConfig: SsuConfigResult;
	characterObjectId?: string;
	isConnected: boolean;
	coinType: string;
	ssuObjectId: string;
	nameMap?: Map<string, string>;
}

export function ListingBuyerList({
	listings,
	ssuConfig,
	characterObjectId,
	isConnected,
	coinType,
	ssuObjectId,
	nameMap,
}: ListingBuyerListProps) {
	const activeListings = listings.filter((l) => l.quantity > 0);

	if (activeListings.length === 0) {
		return <p className="py-4 text-center text-xs text-zinc-600">No items for sale at this SSU.</p>;
	}

	return (
		<div className="space-y-2">
			{activeListings.map((listing) => (
				<ListingCard
					key={listing.listingId}
					listing={listing}
					ssuConfig={ssuConfig}
					characterObjectId={characterObjectId}
					canBuy={isConnected}
					coinType={coinType}
					ssuObjectId={ssuObjectId}
					nameMap={nameMap}
				/>
			))}
		</div>
	);
}
