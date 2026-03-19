import type { SellListingWithName } from "@/hooks/useMarketListings";
import type { SsuConfigInfo } from "@tehfrontier/chain-shared";
import { ListingCard } from "./ListingCard";

interface BuyerViewProps {
	config: SsuConfigInfo;
	listings: SellListingWithName[];
	listingsLoading: boolean;
	isConnected: boolean;
	onConnect: () => void;
}

export function BuyerView({
	config,
	listings,
	listingsLoading,
	isConnected,
	onConnect,
}: BuyerViewProps) {
	// Only show listings with available quantity
	const activeListings = listings.filter((l) => l.quantity > 0);

	if (listingsLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
			</div>
		);
	}

	if (activeListings.length === 0) {
		return (
			<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-500">
				<p className="text-sm">No items for sale at this SSU.</p>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<h2 className="text-sm font-medium text-zinc-400">Items for Sale</h2>
			<div className="space-y-2">
				{activeListings.map((listing) => (
					<ListingCard
						key={listing.listingId}
						listing={listing}
						config={config}
						canBuy={isConnected}
						onConnect={onConnect}
					/>
				))}
			</div>
		</div>
	);
}
