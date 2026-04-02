import { useCoinMetadata } from "@/hooks/useCoinMetadata";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { useSuiClient } from "@/hooks/useSuiClient";
import { formatBaseUnits, parseDisplayPrice } from "@/lib/coin-format";
import { getTenant } from "@/lib/constants";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import {
	type TenantId,
	buildPlaceAsk,
	buildPlaceBid,
	getContractAddresses,
	queryOwnedCoins,
} from "@tehfrontier/chain-shared";
import { useEffect, useRef, useState } from "react";

interface PlaceOrderDialogProps {
	bookObjectId: string;
	coinTypeA: string;
	coinTypeB: string;
	feeBps: number;
	onClose: () => void;
}

export function PlaceOrderDialog({
	bookObjectId,
	coinTypeA,
	coinTypeB,
	feeBps,
	onClose,
}: PlaceOrderDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const suiClient = useSuiClient();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();

	const [side, setSide] = useState<"bid" | "ask">("bid");
	const [priceInput, setPriceInput] = useState("");
	const [amountInput, setAmountInput] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const { data: metaA } = useCoinMetadata(coinTypeA);
	const { data: metaB } = useCoinMetadata(coinTypeB);

	const symbolA = metaA?.symbol ?? formatCoinTypeName(coinTypeA);
	const symbolB = metaB?.symbol ?? formatCoinTypeName(coinTypeB);
	const decimalsA = metaA?.decimals ?? 9;
	const decimalsB = metaB?.decimals ?? 9;

	// The coin type the user pays with depends on side
	const payCoinType = side === "bid" ? coinTypeB : coinTypeA;
	const payDecimals = side === "bid" ? decimalsB : decimalsA;
	const paySymbol = side === "bid" ? symbolB : symbolA;

	// Fetch owned coins for the payment coin type
	const queryEnabled = !!account?.address && !!payCoinType;
	const {
		data: ownedCoins,
		isLoading: coinsLoading,
		error: coinsError,
	} = useQuery({
		queryKey: ["ownedCoins", account?.address, payCoinType],
		queryFn: async () => {
			if (!account?.address || !payCoinType) return [];
			return queryOwnedCoins(suiClient, account.address, payCoinType);
		},
		enabled: queryEnabled,
	});

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	const priceBaseUnits = parseDisplayPrice(priceInput || "0", decimalsB);
	const amountBaseUnits = parseDisplayPrice(amountInput || "0", decimalsA);

	// For bids: deposit = price * amount (in coinTypeB base units)
	// For asks: deposit = amount (in coinTypeA base units)
	const totalDeposit = side === "bid"
		? (priceBaseUnits * amountBaseUnits) / BigInt(10 ** decimalsA)
		: amountBaseUnits;

	const totalBalance = ownedCoins?.reduce((sum, c) => sum + c.balance, 0n) ?? 0n;

	async function handleSubmit() {
		if (!account?.address) return;
		setError(null);
		setSuccess(null);

		if (!priceInput || !amountInput) {
			setError("Price and amount are required");
			return;
		}

		if (priceBaseUnits <= 0n || amountBaseUnits <= 0n) {
			setError("Price and amount must be greater than zero");
			return;
		}

		if (!ownedCoins?.length) {
			setError(`No ${paySymbol} coins available in your wallet`);
			return;
		}

		if (totalBalance < totalDeposit) {
			setError(`Insufficient ${paySymbol} balance for this order`);
			return;
		}

		const tenant = getTenant() as TenantId;
		const exchangePkg = getContractAddresses(tenant).exchange?.packageId;
		if (!exchangePkg) {
			setError("Exchange package not configured for this tenant");
			return;
		}

		try {
			const params = {
				packageId: exchangePkg,
				coinTypeA,
				coinTypeB,
				bookObjectId,
				coinObjectIds: ownedCoins.map((c) => c.objectId),
				totalAmount: totalDeposit,
				price: priceBaseUnits,
				amount: Number(amountBaseUnits),
				senderAddress: account.address,
			};

			const tx = side === "bid" ? buildPlaceBid(params) : buildPlaceAsk(params);
			await signAndExecute(tx);
			setSuccess(`${side === "bid" ? "Bid" : "Ask"} order placed successfully`);
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
					<h3 className="text-sm font-medium text-zinc-200">Place Exchange Order</h3>
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
							{symbolA} / {symbolB} -- fee: {(feeBps / 100).toFixed(2)}%
						</p>

						{/* Side toggle */}
						<div className="flex gap-1 rounded-lg bg-zinc-800/50 p-1">
							<button
								type="button"
								onClick={() => setSide("bid")}
								className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
									side === "bid"
										? "bg-emerald-700 text-emerald-100"
										: "text-zinc-500 hover:text-zinc-300"
								}`}
							>
								Bid (Buy)
							</button>
							<button
								type="button"
								onClick={() => setSide("ask")}
								className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
									side === "ask"
										? "bg-red-700 text-red-100"
										: "text-zinc-500 hover:text-zinc-300"
								}`}
							>
								Ask (Sell)
							</button>
						</div>

						{/* Balance display */}
						<div>
							<span className="mb-1 block text-xs text-zinc-500">
								Wallet Balance ({paySymbol})
							</span>
							{!queryEnabled ? (
								<p className="py-2 text-xs text-amber-400">
									{!account?.address
										? "Connect wallet to see balance"
										: "Coin type not detected"}
								</p>
							) : coinsLoading ? (
								<p className="py-2 text-xs text-zinc-600">Loading balance...</p>
							) : coinsError ? (
								<p className="py-2 text-xs text-red-400">
									Error loading coins:{" "}
									{coinsError instanceof Error
										? coinsError.message
										: String(coinsError)}
								</p>
							) : !ownedCoins?.length ? (
								<p className="py-2 text-xs text-amber-400">
									No {paySymbol} in wallet
								</p>
							) : (
								<div className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
									{formatBaseUnits(totalBalance, payDecimals)} {paySymbol}
									{totalDeposit > 0n && totalBalance < totalDeposit && (
										<span className="ml-2 text-xs text-red-400">
											(insufficient)
										</span>
									)}
								</div>
							)}
						</div>

						{/* Price + Amount inputs */}
						<div className="flex gap-2">
							<div className="flex-1">
								<label
									htmlFor="exchange-price"
									className="mb-1 block text-xs text-zinc-500"
								>
									Price ({symbolB})
								</label>
								<input
									id="exchange-price"
									type="number"
									value={priceInput}
									onChange={(e) => setPriceInput(e.target.value)}
									placeholder="Price per unit"
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
								/>
							</div>
							<div className="flex-1">
								<label
									htmlFor="exchange-amount"
									className="mb-1 block text-xs text-zinc-500"
								>
									Amount ({symbolA})
								</label>
								<input
									id="exchange-amount"
									type="number"
									value={amountInput}
									onChange={(e) => setAmountInput(e.target.value)}
									placeholder="Quantity"
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
								/>
							</div>
						</div>

						{/* Total deposit display */}
						{totalDeposit > 0n && (
							<p className="text-xs text-zinc-500">
								{side === "bid" ? "Total deposit" : "Deposit"}:{" "}
								{formatBaseUnits(totalDeposit, payDecimals)} {paySymbol}
							</p>
						)}

						<button
							type="button"
							onClick={handleSubmit}
							disabled={isPending}
							className={`w-full rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
								side === "bid"
									? "bg-emerald-600 hover:bg-emerald-500"
									: "bg-red-600 hover:bg-red-500"
							}`}
						>
							{isPending
								? "Submitting..."
								: side === "bid"
									? "Place Bid"
									: "Place Ask"}
						</button>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}

function formatCoinTypeName(coinType: string): string {
	const parts = coinType.split("::");
	return parts.length >= 3 ? parts[parts.length - 1] : coinType.slice(0, 12);
}
