import { useCoinMetadata } from "@/hooks/useCoinMetadata";
import { useExchangeOrders } from "@/hooks/useExchangeOrders";
import { useExchangePairs } from "@/hooks/useExchangePairs";
import { formatBaseUnits } from "@/lib/coin-format";
import type { OrderBookInfo, OrderInfo } from "@tehfrontier/chain-shared";
import { useState } from "react";
import { CancelOrderDialog } from "./CancelOrderDialog";
import { CreatePairDialog } from "./CreatePairDialog";
import { PlaceOrderDialog } from "./PlaceOrderDialog";

interface ExchangeContentProps {
	isConnected: boolean;
	walletAddress?: string;
}

export function ExchangeContent({ isConnected, walletAddress }: ExchangeContentProps) {
	const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
	const [showPlaceOrder, setShowPlaceOrder] = useState(false);
	const [showCreatePair, setShowCreatePair] = useState(false);
	const [cancelOrder, setCancelOrder] = useState<OrderInfo | null>(null);

	const pairsQuery = useExchangePairs();
	const pairs = pairsQuery.data as OrderBookInfo[] | undefined;
	const ordersQuery = useExchangeOrders(selectedPairId);
	const orders = ordersQuery.data as OrderInfo[] | undefined;

	const selectedPair = pairs?.find((p) => p.objectId === selectedPairId) ?? null;

	// Sort orders: bids first (descending by price), then asks (ascending by price)
	const sortedOrders = [...(orders ?? [])].sort((a, b) => {
		if (a.isBid !== b.isBid) return a.isBid ? -1 : 1;
		const pa = BigInt(a.price);
		const pb = BigInt(b.price);
		if (a.isBid) return pa > pb ? -1 : pa < pb ? 1 : 0;
		return pa < pb ? -1 : pa > pb ? 1 : 0;
	});

	return (
		<div className="space-y-3">
			{/* Header row */}
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium text-zinc-300">Exchange Pairs</h3>
				<div className="flex gap-1.5">
					<button
						type="button"
						onClick={() => {
							pairsQuery.refetch();
							if (selectedPairId) ordersQuery.refetch();
						}}
						disabled={pairsQuery.isLoading}
						className="rounded bg-zinc-800 px-2.5 py-1 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-50"
					>
						{pairsQuery.isLoading ? "Loading..." : "Refresh"}
					</button>
					{isConnected && (
						<button
							type="button"
							onClick={() => setShowCreatePair(true)}
							className="rounded bg-cyan-700 px-2.5 py-1 text-[10px] text-white hover:bg-cyan-600"
						>
							Create Pair
						</button>
					)}
				</div>
			</div>

			{/* Pair list */}
			{pairsQuery.isLoading && !pairs?.length && (
				<p className="py-4 text-center text-xs text-zinc-600">Loading exchange pairs...</p>
			)}
			{!pairsQuery.isLoading && !pairs?.length && (
				<p className="py-4 text-center text-xs text-zinc-600">No exchange pairs found</p>
			)}
			{pairs && pairs.length > 0 && (
				<div className="space-y-1">
					{pairs.map((pair) => (
						<PairRow
							key={pair.objectId}
							pair={pair}
							isSelected={pair.objectId === selectedPairId}
							onSelect={() =>
								setSelectedPairId(
									pair.objectId === selectedPairId ? null : pair.objectId,
								)
							}
						/>
					))}
				</div>
			)}

			{/* Order book detail */}
			{selectedPair && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
					<div className="mb-2 flex items-center justify-between">
						<h4 className="text-xs font-medium text-zinc-300">Order Book</h4>
						{isConnected && (
							<button
								type="button"
								onClick={() => setShowPlaceOrder(true)}
								className="rounded bg-amber-600 px-2.5 py-1 text-[10px] text-white hover:bg-amber-500"
							>
								Place Order
							</button>
						)}
					</div>

					{ordersQuery.isLoading && (
						<p className="py-3 text-center text-xs text-zinc-600">Loading orders...</p>
					)}
					{!ordersQuery.isLoading && sortedOrders.length === 0 && (
						<p className="py-3 text-center text-xs text-zinc-600">No open orders</p>
					)}
					{sortedOrders.length > 0 && (
						<OrderTable
							orders={sortedOrders}
							pair={selectedPair}
							walletAddress={walletAddress}
							onCancel={isConnected ? setCancelOrder : undefined}
						/>
					)}
				</div>
			)}

			{/* Dialogs */}
			{showPlaceOrder && selectedPair && (
				<PlaceOrderDialog
					bookObjectId={selectedPair.objectId}
					coinTypeA={selectedPair.coinTypeA}
					coinTypeB={selectedPair.coinTypeB}
					feeBps={selectedPair.feeBps}
					onClose={() => setShowPlaceOrder(false)}
				/>
			)}
			{cancelOrder && selectedPair && (
				<CancelOrderDialog
					bookObjectId={selectedPair.objectId}
					coinTypeA={selectedPair.coinTypeA}
					coinTypeB={selectedPair.coinTypeB}
					orderId={cancelOrder.orderId}
					isBid={cancelOrder.isBid}
					price={cancelOrder.price}
					amount={cancelOrder.amount}
					onClose={() => setCancelOrder(null)}
				/>
			)}
			{showCreatePair && <CreatePairDialog onClose={() => setShowCreatePair(false)} />}
		</div>
	);
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PairRow({
	pair,
	isSelected,
	onSelect,
}: {
	pair: OrderBookInfo;
	isSelected: boolean;
	onSelect: () => void;
}) {
	const { data: metaA } = useCoinMetadata(pair.coinTypeA);
	const { data: metaB } = useCoinMetadata(pair.coinTypeB);

	const symbolA = metaA?.symbol ?? formatCoinTypeName(pair.coinTypeA);
	const symbolB = metaB?.symbol ?? formatCoinTypeName(pair.coinTypeB);

	return (
		<button
			type="button"
			onClick={onSelect}
			className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
				isSelected
					? "border-cyan-600 bg-cyan-900/20 text-cyan-300"
					: "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/50"
			}`}
		>
			<div>
				<span className="text-xs font-medium">
					{symbolA} / {symbolB}
				</span>
				<span className="ml-2 text-[10px] text-zinc-600">
					fee: {(pair.feeBps / 100).toFixed(2)}%
				</span>
			</div>
			<div className="text-[10px] text-zinc-500">
				{pair.bidCount}B / {pair.askCount}A
			</div>
		</button>
	);
}

function OrderTable({
	orders,
	pair,
	walletAddress,
	onCancel,
}: {
	orders: OrderInfo[];
	pair: OrderBookInfo;
	walletAddress?: string;
	onCancel?: (order: OrderInfo) => void;
}) {
	const { data: metaA } = useCoinMetadata(pair.coinTypeA);
	const { data: metaB } = useCoinMetadata(pair.coinTypeB);

	const symbolA = metaA?.symbol ?? formatCoinTypeName(pair.coinTypeA);
	const symbolB = metaB?.symbol ?? formatCoinTypeName(pair.coinTypeB);
	const decimalsA = metaA?.decimals ?? 9;
	const decimalsB = metaB?.decimals ?? 9;

	return (
		<div className="overflow-x-auto">
			<table className="w-full text-xs">
				<thead>
					<tr className="border-b border-zinc-800 text-left text-zinc-500">
						<th className="pb-1.5 pr-2 font-medium">Side</th>
						<th className="pb-1.5 pr-2 font-medium">Price ({symbolB})</th>
						<th className="pb-1.5 pr-2 font-medium">Amount ({symbolA})</th>
						<th className="pb-1.5 pr-2 font-medium">Owner</th>
						<th className="pb-1.5 font-medium" />
					</tr>
				</thead>
				<tbody>
					{orders.map((order) => {
						const isOwn =
							walletAddress &&
							order.owner.toLowerCase() === walletAddress.toLowerCase();
						return (
							<tr
								key={`${order.isBid ? "bid" : "ask"}-${order.orderId}`}
								className={`border-b border-zinc-800/50 ${isOwn ? "bg-cyan-900/10" : ""}`}
							>
								<td
									className={`py-1.5 pr-2 font-medium ${
										order.isBid ? "text-emerald-400" : "text-red-400"
									}`}
								>
									{order.isBid ? "Bid" : "Ask"}
								</td>
								<td className="py-1.5 pr-2 text-zinc-300">
									{formatBaseUnits(BigInt(order.price), decimalsB)}
								</td>
								<td className="py-1.5 pr-2 text-zinc-300">
									{formatBaseUnits(BigInt(order.amount), decimalsA)}
								</td>
								<td className="py-1.5 pr-2 font-mono text-zinc-500">
									{isOwn ? (
										<span className="text-cyan-400">You</span>
									) : (
										`${order.owner.slice(0, 6)}...${order.owner.slice(-4)}`
									)}
								</td>
								<td className="py-1.5 text-right">
									{isOwn && onCancel && (
										<button
											type="button"
											onClick={() => onCancel(order)}
											className="text-red-400 hover:text-red-300"
										>
											Cancel
										</button>
									)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function formatCoinTypeName(coinType: string): string {
	const parts = coinType.split("::");
	return parts.length >= 3 ? parts[parts.length - 1] : coinType.slice(0, 12);
}
