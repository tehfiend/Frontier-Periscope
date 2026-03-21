import { useGameItems } from "@/hooks/useGameItems";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { useSuiClient } from "@/hooks/useSuiClient";
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

	const [paymentObjectId, setPaymentObjectId] = useState("");
	const [typeId, setTypeId] = useState("");
	const [itemSearch, setItemSearch] = useState("");
	const [showItemResults, setShowItemResults] = useState(false);
	const [pricePerUnit, setPricePerUnit] = useState("");
	const [quantity, setQuantity] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	// Auto-load user's coins of the market currency
	const {
		data: ownedCoins,
		isLoading: coinsLoading,
		error: coinsError,
	} = useQuery({
		queryKey: ["ownedCoins", account?.address, coinType],
		queryFn: async () => {
			if (!account?.address || !coinType) return [];
			console.log("[coins] querying", { owner: account.address, coinType });
			const result = await queryOwnedCoins(suiClient, account.address, coinType);
			console.log("[coins] result:", result);
			return result;
		},
		enabled: !!account?.address && !!coinType,
	});

	// Load all game items for autocomplete
	const { data: gameItems } = useGameItems();

	// Filter items by search query
	const filteredItems = useMemo(() => {
		if (!gameItems || !itemSearch.trim()) return [];
		const q = itemSearch.toLowerCase();
		return gameItems
			.filter((item) => item.name.toLowerCase().includes(q))
			.slice(0, 20);
	}, [gameItems, itemSearch]);

	// Selected item name for display
	const selectedItemName = useMemo(() => {
		if (!typeId || !gameItems) return "";
		return gameItems.find((i) => i.typeId === Number(typeId))?.name ?? "";
	}, [typeId, gameItems]);

	// Auto-select the first coin if only one exists
	useEffect(() => {
		if (ownedCoins?.length === 1 && !paymentObjectId) {
			setPaymentObjectId(ownedCoins[0].objectId);
		}
	}, [ownedCoins, paymentObjectId]);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	const totalCost = Number(pricePerUnit || 0) * Number(quantity || 0);

	function handleSelectItem(id: number, name: string) {
		setTypeId(String(id));
		setItemSearch(name);
		setShowItemResults(false);
	}

	async function handleSubmit() {
		if (!account?.address) return;
		setError(null);
		setSuccess(null);

		if (!paymentObjectId.trim() || !typeId || !pricePerUnit || !quantity) {
			setError("All fields are required");
			return;
		}

		try {
			const tx = buildPostBuyOrder({
				packageId,
				marketId,
				coinType,
				paymentObjectId: paymentObjectId.trim(),
				typeId: Number(typeId),
				pricePerUnit: Number(pricePerUnit),
				quantity: Number(quantity),
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
							Post a buy order with escrowed payment. Sellers fill orders and
							receive payment.
						</p>

						{/* DEBUG */}
						<div className="rounded bg-zinc-800 p-2 text-[10px] font-mono text-zinc-600">
							<p>coinType: {coinType || "(empty)"}</p>
							<p>wallet: {account?.address?.slice(0, 16) || "(not connected)"}</p>
							<p>coins: {coinsLoading ? "loading..." : coinsError ? `ERROR: ${coinsError}` : `${ownedCoins?.length ?? 0} found`}</p>
						</div>

						{/* Payment coin selector */}
						<div>
							<label className="mb-1 block text-xs text-zinc-500">
								Payment Coin
							</label>
							{coinsLoading ? (
								<p className="py-2 text-xs text-zinc-600">Loading coins...</p>
							) : !ownedCoins?.length ? (
								<p className="py-2 text-xs text-amber-400">
									No coins found in your wallet.
									{!coinType && " (Market coin type not detected)"}
								</p>
							) : (
								<select
									value={paymentObjectId}
									onChange={(e) => setPaymentObjectId(e.target.value)}
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
								>
									<option value="">Select coin...</option>
									{ownedCoins.map((c) => (
										<option key={c.objectId} value={c.objectId}>
											{formatBalance(c.balance)} -- {c.objectId.slice(0, 10)}...
										</option>
									))}
								</select>
							)}
						</div>

						{/* Item autocomplete */}
						<div className="relative">
							<label className="mb-1 block text-xs text-zinc-500">Item</label>
							<input
								type="text"
								value={typeId ? (itemSearch || selectedItemName) : itemSearch}
								onChange={(e) => {
									setItemSearch(e.target.value);
									setTypeId("");
									setShowItemResults(true);
								}}
								onFocus={() => itemSearch && setShowItemResults(true)}
								onBlur={() => setTimeout(() => setShowItemResults(false), 200)}
								placeholder="Type to search items..."
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
							{typeId && (
								<span className="absolute right-2 top-7 text-[10px] text-zinc-600">
									#{typeId}
								</span>
							)}
							{showItemResults && filteredItems.length > 0 && (
								<div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 shadow-lg">
									{filteredItems.map((item) => (
										<button
											key={item.typeId}
											type="button"
											onMouseDown={() =>
												handleSelectItem(item.typeId, item.name)
											}
											className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700"
										>
											<span>{item.name}</span>
											<span className="ml-2 text-[10px] text-zinc-600">
												{item.groupName}
											</span>
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
								<label className="mb-1 block text-xs text-zinc-500">
									Quantity
								</label>
								<input
									type="number"
									value={quantity}
									onChange={(e) => setQuantity(e.target.value)}
									placeholder="Amount"
									min={1}
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
							</div>
							<div className="flex-1">
								<label className="mb-1 block text-xs text-zinc-500">
									Price per unit
								</label>
								<input
									type="number"
									value={pricePerUnit}
									onChange={(e) => setPricePerUnit(e.target.value)}
									placeholder="Token amount"
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
							</div>
						</div>

						{totalCost > 0 && (
							<p className="text-xs text-zinc-500">
								Total escrow required: {totalCost.toLocaleString()}
							</p>
						)}

						<button
							type="button"
							onClick={handleSubmit}
							disabled={isPending}
							className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
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

function formatBalance(raw: bigint): string {
	const decimals = 9;
	const divisor = 10n ** BigInt(decimals);
	const whole = raw / divisor;
	const frac = raw % divisor;
	if (frac === 0n) return whole.toString();
	const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${whole}.${fracStr}`;
}
