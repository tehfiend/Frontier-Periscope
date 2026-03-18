import { useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import type { MarketInfo } from "@tehfrontier/chain-shared";
import { buildBuySellOrder } from "@tehfrontier/chain-shared";
import type { SellOrderWithName } from "@/hooks/useMarketListings";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { SSU_MARKET_PACKAGE_ID, getCoinType } from "@/lib/constants";

interface ListingCardProps {
	order: SellOrderWithName;
	config: MarketInfo;
	canBuy: boolean;
	onConnect: () => void;
}

export function ListingCard({ order, config, canBuy, onConnect }: ListingCardProps) {
	const [quantity, setQuantity] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();

	const totalPrice = order.pricePerUnit * quantity;
	const coinType = getCoinType();
	const maxQty = order.quantity;

	async function handleBuy() {
		setError(null);

		if (!account?.address || !coinType) {
			setError("Missing wallet connection or coin type configuration.");
			return;
		}

		try {
			const tx = buildBuySellOrder({
				packageId: SSU_MARKET_PACKAGE_ID,
				configObjectId: config.objectId,
				ssuObjectId: config.ssuId,
				characterObjectId: "", // TODO: resolve from chain via wallet address
				coinType,
				paymentObjectId: "", // Wallet resolves the payment coin
				typeId: order.typeId,
				quantity,
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
					<p className="text-sm font-medium text-zinc-200">{order.name}</p>
					<p className="text-xs text-zinc-500">Type ID: {order.typeId}</p>
				</div>
				<div className="text-right">
					<p className="text-sm font-medium text-cyan-400">
						{order.pricePerUnit.toLocaleString()}
					</p>
					<p className="text-xs text-zinc-500">per unit</p>
				</div>
			</div>

			<p className="mt-1 text-xs text-zinc-500">
				{maxQty.toLocaleString()} available
			</p>

			<div className="mt-3 flex items-center gap-2">
				<label className="text-xs text-zinc-500" htmlFor={`qty-${order.typeId}`}>
					Qty:
				</label>
				<input
					id={`qty-${order.typeId}`}
					type="number"
					min={1}
					max={maxQty}
					value={quantity}
					onChange={(e) => setQuantity(Math.max(1, Math.min(maxQty, Number(e.target.value))))}
					className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-600 focus:outline-none"
				/>
				<span className="text-xs text-zinc-500">
					= {totalPrice.toLocaleString()} total
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
