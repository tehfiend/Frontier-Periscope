import { useCoinMetadata } from "@/hooks/useCoinMetadata";
import { useGameItems } from "@/hooks/useGameItems";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { useSuiClient } from "@/hooks/useSuiClient";
import { formatBaseUnits, parseDisplayPrice } from "@/lib/coin-format";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import { buildPostBuyOrder, queryOwnedCoins } from "@tehfrontier/chain-shared";
import { useEffect, useMemo, useRef, useState } from "react";

interface CreateBuyOrderDialogProps {
	marketId: string;
	packageId: string;
	coinType: string;
	onClose: () => void;
}

export function CreateBuyOrderDialog({
	marketId,
	packageId,
	coinType,
	onClose,
}: CreateBuyOrderDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const suiClient = useSuiClient();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();

	const [typeId, setTypeId] = useState("");
	const [itemSearch, setItemSearch] = useState("");
	const [showItemResults, setShowItemResults] = useState(false);
	const [pricePerUnit, setPricePerUnit] = useState("");
	const [quantity, setQuantity] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const { data: coinMeta } = useCoinMetadata(coinType);
	const decimals = coinMeta?.decimals ?? 9;
	const symbol = coinMeta?.symbol ?? "";

	// Auto-load user's coins of the market currency
	const queryEnabled = !!account?.address && !!coinType;
	const {
		data: ownedCoins,
		isLoading: coinsLoading,
		error: coinsError,
	} = useQuery({
		queryKey: ["ownedCoins", account?.address, coinType],
		queryFn: async () => {
			if (!account?.address || !coinType) return [];
			return queryOwnedCoins(suiClient, account.address, coinType);
		},
		enabled: queryEnabled,
	});

	// Load all game items for autocomplete
	const { data: gameItems } = useGameItems();

	// Filter items by search query
	const filteredItems = useMemo(() => {
		if (!gameItems || !itemSearch.trim()) return [];
		const q = itemSearch.toLowerCase();
		return gameItems.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 20);
	}, [gameItems, itemSearch]);

	// Selected item name for display
	const selectedItemName = useMemo(() => {
		if (!typeId || !gameItems) return "";
		return gameItems.find((i) => i.typeId === Number(typeId))?.name ?? "";
	}, [typeId, gameItems]);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	const priceBaseUnits = parseDisplayPrice(pricePerUnit || "0", decimals);
	const qtyNum = Number(quantity || 0);
	const totalBaseUnits = priceBaseUnits * BigInt(qtyNum || 0);
	const totalBalance = ownedCoins?.reduce((sum, c) => sum + c.balance, 0n) ?? 0n;

	function handleSelectItem(id: number, name: string) {
		setTypeId(String(id));
		setItemSearch(name);
		setShowItemResults(false);
	}

	async function handleSubmit() {
		if (!account?.address) return;
		setError(null);
		setSuccess(null);

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
				pricePerUnit: priceBaseUnits,
				quantity: qtyNum,
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setSuccess("Buy order created successfully");
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	return (
		<dialog
			ref={dialogRef}
			className="m-auto w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-900 p-0 text-zinc-100 backdrop:bg-black/60"
			onClose={onClose}
		>
			<div className="p-4">
				<div className="mb-4 flex items-center justify-between">
					<h3 className="text-sm font-medium text-zinc-200">Create Buy Order</h3>
					<button
						type="button"
						onClick={() => {
							dialogRef.current?.close();
							onClose();
						}}
						className="text-zinc-500 hover:text-zinc-300"
					>
						&times;
					</button>
				</div>

				{success ? (
					<div className="space-y-3">
						<p className="text-xs text-emerald-400">{success}</p>
						<button
							type="button"
							onClick={() => {
								dialogRef.current?.close();
								onClose();
							}}
							className="w-full rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600"
						>
							Close
						</button>
					</div>
				) : (
					<div className="space-y-3">
						<p className="text-[10px] text-zinc-600">
							Post a buy order with escrowed payment. Sellers fill orders and receive payment.
						</p>

						{/* Balance display */}
						<div>
							<span className="mb-1 block text-xs text-zinc-500">
								Wallet Balance{symbol ? ` (${symbol})` : ""}
							</span>
							{!queryEnabled ? (
								<p className="py-2 text-xs text-amber-400">
									{!account?.address
										? "Connect wallet to see balance"
										: "Market coin type not detected"}
								</p>
							) : coinsLoading ? (
								<p className="py-2 text-xs text-zinc-600">Loading balance...</p>
							) : coinsError ? (
								<p className="py-2 text-xs text-red-400">
									Error loading coins:{" "}
									{coinsError instanceof Error ? coinsError.message : String(coinsError)}
								</p>
							) : !ownedCoins?.length ? (
								<p className="py-2 text-xs text-amber-400">
									No {symbol || "coins"} in wallet
									<span className="block mt-1 text-[10px] text-zinc-600">
										{coinType.split("::").pop()}
									</span>
								</p>
							) : (
								<div className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
									{formatBaseUnits(totalBalance, decimals)} {symbol}
									{totalBaseUnits > 0n && totalBalance < totalBaseUnits && (
										<span className="ml-2 text-xs text-red-400">(insufficient)</span>
									)}
								</div>
							)}
						</div>

						{/* Item autocomplete */}
						<div className="relative">
							<label htmlFor="buy-order-item" className="mb-1 block text-xs text-zinc-500">
								Item
							</label>
							<input
								id="buy-order-item"
								type="text"
								value={typeId ? itemSearch || selectedItemName : itemSearch}
								onChange={(e) => {
									setItemSearch(e.target.value);
									setTypeId("");
									setShowItemResults(true);
								}}
								onFocus={() => itemSearch && setShowItemResults(true)}
								onBlur={() => setTimeout(() => setShowItemResults(false), 200)}
								placeholder="Type to search items..."
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
							/>
							{typeId && (
								<span className="absolute right-2 top-7 text-[10px] text-zinc-600">#{typeId}</span>
							)}
							{showItemResults && filteredItems.length > 0 && (
								<div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 shadow-lg">
									{filteredItems.map((item) => (
										<button
											key={item.typeId}
											type="button"
											onMouseDown={() => handleSelectItem(item.typeId, item.name)}
											className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700"
										>
											<span>{item.name}</span>
											<span className="ml-2 text-[10px] text-zinc-600">{item.groupName}</span>
										</button>
									))}
								</div>
							)}
							{showItemResults &&
								itemSearch.length >= 2 &&
								filteredItems.length === 0 &&
								gameItems && (
									<div className="absolute z-10 mt-1 w-full rounded border border-zinc-700 bg-zinc-800 p-2 text-xs text-zinc-500">
										No items found
									</div>
								)}
						</div>

						{/* Quantity + Price */}
						<div className="flex gap-2">
							<div className="flex-1">
								<label htmlFor="buy-order-qty" className="mb-1 block text-xs text-zinc-500">
									Quantity
								</label>
								<input
									id="buy-order-qty"
									type="number"
									value={quantity}
									onChange={(e) => setQuantity(e.target.value)}
									placeholder="Amount"
									min={1}
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
								/>
							</div>
							<div className="flex-1">
								<label htmlFor="buy-order-price" className="mb-1 block text-xs text-zinc-500">
									Price per unit{symbol ? ` (${symbol})` : ""}
								</label>
								<input
									id="buy-order-price"
									type="number"
									value={pricePerUnit}
									onChange={(e) => setPricePerUnit(e.target.value)}
									placeholder="Token amount"
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
								/>
							</div>
						</div>

						{totalBaseUnits > 0n && (
							<p className="text-xs text-zinc-500">
								Total escrow: {formatBaseUnits(totalBaseUnits, decimals)} {symbol}
							</p>
						)}

						<button
							type="button"
							onClick={handleSubmit}
							disabled={isPending}
							className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
						>
							{isPending ? "Creating..." : "Create Buy Order"}
						</button>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}
