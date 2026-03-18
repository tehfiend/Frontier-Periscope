import type { MarketInfo } from "@tehfrontier/chain-shared";
import type { SellOrderWithName } from "@/hooks/useMarketListings";
import { ListingCard } from "./ListingCard";

interface BuyerViewProps {
	config: MarketInfo;
	orders: SellOrderWithName[];
	ordersLoading: boolean;
	isConnected: boolean;
	onConnect: () => void;
}

export function BuyerView({
	config,
	orders,
	ordersLoading,
	isConnected,
	onConnect,
}: BuyerViewProps) {
	// Only show orders with available quantity
	const activeOrders = orders.filter((o) => o.quantity > 0);

	if (ordersLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
			</div>
		);
	}

	if (activeOrders.length === 0) {
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
				{activeOrders.map((order) => (
					<ListingCard
						key={order.typeId}
						order={order}
						config={config}
						canBuy={isConnected}
						onConnect={onConnect}
					/>
				))}
			</div>
		</div>
	);
}
