import { useCoinMetadata } from "@/hooks/useCoinMetadata";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { buildPostBuyOrder, formatBaseUnits, parseDisplayPrice, queryOwnedCoins } from "@tehfrontier/chain-shared";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { useState } from "react";

interface PostBuyOrderFormProps {
	packageId: string;
	marketId: string;
	coinType: string;
	onPosted: () => void;
	onCancel: () => void;
}

export function PostBuyOrderForm({
	packageId,
	marketId,
	coinType,
	onPosted,
	onCancel,
}: PostBuyOrderFormProps) {
	const account = useCurrentAccount();
	const client = useCurrentClient() as SuiGraphQLClient;
	const { mutateAsync, isPending } = useSignAndExecute();

	const { data: coinMeta } = useCoinMetadata(coinType);
	const decimals = coinMeta?.decimals ?? 9;

	const [typeId, setTypeId] = useState("");
	const [pricePerUnit, setPricePerUnit] = useState("");
	const [quantity, setQuantity] = useState("");
	const [error, setError] = useState<string>();

	const { data: ownedCoins, isLoading: coinsLoading } = useQuery({
		queryKey: ["ownedCoins", account?.address, coinType],
		queryFn: async () => {
			if (!account?.address || !coinType) return [];
			return queryOwnedCoins(client, account.address, coinType);
		},
		enabled: !!account?.address && !!coinType,
	});

	const priceBase = parseDisplayPrice(pricePerUnit || "0", decimals);
	const qtyNum = Number(quantity || 0);
	const totalBaseUnits = priceBase * BigInt(qtyNum || 0);
	const totalBalance = ownedCoins?.reduce((sum, c) => sum + c.balance, 0n) ?? 0n;

	async function handleSubmit() {
		if (!account) return;
		setError(undefined);

		if (!typeId || !pricePerUnit || !quantity) {
			setError("All fields are required");
			return;
		}

		if (!ownedCoins?.length) {
			setError("No coins available in your wallet");
			return;
		}

		if (totalBalance < totalBaseUnits) {
			setError("Insufficient balance for this buy order");
			return;
		}

		try {
			const tx = buildPostBuyOrder({
				packageId,
				marketId,
				coinType,
				coinObjectIds: ownedCoins.map((c) => c.objectId),
				totalAmount: totalBaseUnits,
				typeId: Number(typeId),
				pricePerUnit: priceBase,
				quantity: qtyNum,
				senderAddress: account.address,
			});
			await mutateAsync(tx);
			onPosted();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h3 className="mb-3 text-sm font-medium text-zinc-400">Post Buy Order</h3>
			<p className="mb-3 text-[10px] text-zinc-600">
				Post a buy order with escrowed payment. Sellers fill orders and receive payment upon buyer
				confirmation.
			</p>

			<div className="space-y-2">
				<div>
					<label className="mb-0.5 block text-[10px] text-zinc-500">Wallet Balance</label>
					{coinsLoading ? (
						<p className="py-1 text-[10px] text-zinc-600">Loading balance...</p>
					) : !ownedCoins?.length ? (
						<p className="py-1 text-[10px] text-amber-400">No coins found</p>
					) : (
						<div className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300">
							{formatBaseUnits(totalBalance, decimals)}
							{totalBaseUnits > 0n && totalBalance < totalBaseUnits && (
								<span className="ml-2 text-red-400">(insufficient)</span>
							)}
						</div>
					)}
				</div>
				<div className="flex gap-2">
					<div className="flex-1">
						<label className="mb-0.5 block text-[10px] text-zinc-500">Item Type ID</label>
						<input
							type="number"
							value={typeId}
							onChange={(e) => setTypeId(e.target.value)}
							placeholder="e.g., 77708"
							className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
						/>
					</div>
					<div className="flex-1">
						<label className="mb-0.5 block text-[10px] text-zinc-500">Quantity</label>
						<input
							type="number"
							value={quantity}
							onChange={(e) => setQuantity(e.target.value)}
							placeholder="Amount"
							min={1}
							className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
						/>
					</div>
				</div>
				<div>
					<label className="mb-0.5 block text-[10px] text-zinc-500">Price per unit</label>
					<input
						type="number"
						value={pricePerUnit}
						onChange={(e) => setPricePerUnit(e.target.value)}
						placeholder="Price in token smallest unit"
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</div>
				{totalBaseUnits > 0n && (
					<p className="text-[10px] text-zinc-500">
						Total escrow required: {formatBaseUnits(totalBaseUnits, decimals)}
					</p>
				)}
			</div>

			{error && (
				<div className="mt-2 flex items-center gap-2 rounded border border-red-900/50 bg-red-950/20 p-2 text-[10px] text-red-400">
					<AlertCircle size={12} />
					{error}
				</div>
			)}

			<div className="mt-3 flex gap-2">
				<button
					type="button"
					onClick={handleSubmit}
					disabled={isPending}
					className="flex-1 rounded bg-cyan-600 py-2 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending ? (
						<span className="flex items-center justify-center gap-1">
							<Loader2 size={12} className="animate-spin" />
							Posting...
						</span>
					) : (
						"Post Buy Order"
					)}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="rounded bg-zinc-800 px-4 py-2 text-xs text-zinc-400 hover:text-zinc-300"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
