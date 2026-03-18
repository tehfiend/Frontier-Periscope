import { useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import type { MarketInfo } from "@tehfrontier/chain-shared";
import { buildUpdateSellPrice, buildCancelSellOrder } from "@tehfrontier/chain-shared";
import type { SellOrderWithName } from "@/hooks/useMarketListings";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { SSU_MARKET_PACKAGE_ID } from "@/lib/constants";

interface OwnerViewProps {
	config: MarketInfo;
	orders: SellOrderWithName[];
	ordersLoading: boolean;
	characterObjectId: string;
}

export function OwnerView({ config, orders, ordersLoading, characterObjectId }: OwnerViewProps) {
	const [editingTypeId, setEditingTypeId] = useState<number | null>(null);
	const [editPrice, setEditPrice] = useState("");
	const [cancellingTypeId, setCancellingTypeId] = useState<number | null>(null);
	const [cancelQty, setCancelQty] = useState("");
	const [error, setError] = useState<string | null>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();

	async function handleUpdatePrice(typeId: number) {
		if (!account?.address || !editPrice) return;
		setError(null);
		try {
			const tx = buildUpdateSellPrice({
				packageId: SSU_MARKET_PACKAGE_ID,
				configObjectId: config.objectId,
				typeId,
				pricePerUnit: Number(editPrice),
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setEditingTypeId(null);
			setEditPrice("");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleCancel(typeId: number) {
		if (!account?.address || !cancelQty || !characterObjectId) return;
		setError(null);
		try {
			const tx = buildCancelSellOrder({
				packageId: SSU_MARKET_PACKAGE_ID,
				configObjectId: config.objectId,
				ssuObjectId: config.ssuId,
				characterObjectId,
				typeId,
				quantity: Number(cancelQty),
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setCancellingTypeId(null);
			setCancelQty("");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div className="space-y-4">
			<div className="space-y-3">
				<h2 className="text-sm font-medium text-zinc-400">Sell Orders</h2>

				{ordersLoading ? (
					<div className="flex h-20 items-center justify-center">
						<div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
					</div>
				) : orders.length === 0 ? (
					<p className="text-center text-xs text-zinc-600">
						No sell orders yet. Create one by escrowing items from your SSU inventory.
					</p>
				) : (
					<div className="space-y-2">
						{orders.map((order) => (
							<div
								key={order.typeId}
								className="rounded-lg border border-zinc-800 bg-zinc-900 p-3"
							>
								<div className="flex items-center justify-between">
									<div>
										<p className="text-sm text-zinc-200">{order.name}</p>
										<p className="text-xs text-zinc-500">
											{order.pricePerUnit.toLocaleString()} per unit --{" "}
											{order.quantity.toLocaleString()} available
										</p>
									</div>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={() => {
												setEditingTypeId(order.typeId);
												setEditPrice(String(order.pricePerUnit));
											}}
											disabled={isPending}
											className="rounded px-2 py-0.5 text-xs text-cyan-500 hover:bg-zinc-800"
										>
											Edit Price
										</button>
										<button
											type="button"
											onClick={() => {
												setCancellingTypeId(order.typeId);
												setCancelQty(String(order.quantity));
											}}
											disabled={isPending}
											className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-zinc-800"
										>
											Cancel
										</button>
									</div>
								</div>

								{/* Inline edit price */}
								{editingTypeId === order.typeId && (
									<div className="mt-2 flex items-center gap-2 border-t border-zinc-800 pt-2">
										<input
											type="number"
											value={editPrice}
											onChange={(e) => setEditPrice(e.target.value)}
											className="w-28 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-600 focus:outline-none"
										/>
										<button
											type="button"
											onClick={() => handleUpdatePrice(order.typeId)}
											disabled={isPending}
											className="rounded bg-cyan-600 px-2 py-1 text-xs text-white hover:bg-cyan-500 disabled:opacity-50"
										>
											Save
										</button>
										<button
											type="button"
											onClick={() => setEditingTypeId(null)}
											className="text-xs text-zinc-500 hover:text-zinc-300"
										>
											Cancel
										</button>
									</div>
								)}

								{/* Inline cancel */}
								{cancellingTypeId === order.typeId && (
									<div className="mt-2 flex items-center gap-2 border-t border-zinc-800 pt-2">
										<label className="text-xs text-zinc-500">Qty:</label>
										<input
											type="number"
											value={cancelQty}
											onChange={(e) => setCancelQty(e.target.value)}
											max={order.quantity}
											className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-600 focus:outline-none"
										/>
										<button
											type="button"
											onClick={() => handleCancel(order.typeId)}
											disabled={isPending}
											className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500 disabled:opacity-50"
										>
											Confirm
										</button>
										<button
											type="button"
											onClick={() => setCancellingTypeId(null)}
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
