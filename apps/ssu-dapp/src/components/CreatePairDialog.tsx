import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { useSuiClient } from "@/hooks/useSuiClient";
import { getTenant } from "@/lib/constants";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQueryClient } from "@tanstack/react-query";
import {
	type TenantId,
	buildCreatePair,
	getContractAddresses,
} from "@tehfrontier/chain-shared";
import { useCallback, useEffect, useRef, useState } from "react";

interface CreatePairDialogProps {
	onClose: () => void;
}

export function CreatePairDialog({ onClose }: CreatePairDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const suiClient = useSuiClient();
	const queryClient = useQueryClient();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();

	const [coinTypeA, setCoinTypeA] = useState("");
	const [coinTypeB, setCoinTypeB] = useState("");
	const [feeBps, setFeeBps] = useState("30");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	// Fetch wallet coin types for dropdown suggestions
	const [walletCoinTypes, setWalletCoinTypes] = useState<string[]>([]);
	const [loadingCoins, setLoadingCoins] = useState(false);

	const fetchWalletCoins = useCallback(async () => {
		if (!account?.address) return;
		setLoadingCoins(true);
		try {
			const result = await suiClient.listBalances({ owner: account.address });
			const types = result.balances.map((b) => b.coinType);
			setWalletCoinTypes(types);
		} catch {
			// non-fatal
		} finally {
			setLoadingCoins(false);
		}
	}, [account?.address, suiClient]);

	useEffect(() => {
		dialogRef.current?.showModal();
		fetchWalletCoins();
	}, [fetchWalletCoins]);

	async function handleSubmit() {
		if (!account?.address) return;
		setError(null);
		setSuccess(null);

		if (!coinTypeA.trim() || !coinTypeB.trim()) {
			setError("Both coin types are required");
			return;
		}

		if (coinTypeA.trim() === coinTypeB.trim()) {
			setError("Coin types must be different");
			return;
		}

		const bps = Number(feeBps);
		if (Number.isNaN(bps) || bps < 0 || bps > 10000) {
			setError("Fee must be between 0 and 10000 basis points");
			return;
		}

		const tenant = getTenant() as TenantId;
		const exchangePkg = getContractAddresses(tenant).exchange?.packageId;
		if (!exchangePkg) {
			setError("Exchange package not configured for this tenant");
			return;
		}

		try {
			const tx = buildCreatePair({
				packageId: exchangePkg,
				coinTypeA: coinTypeA.trim(),
				coinTypeB: coinTypeB.trim(),
				feeBps: bps,
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			// Invalidate pairs list so the new pair appears
			queryClient.invalidateQueries({ queryKey: ["exchangePairs"] });
			setSuccess("Exchange pair created successfully");
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
					<h3 className="text-sm font-medium text-zinc-200">Create Exchange Pair</h3>
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
							Create a new order book for trading between two coin types.
						</p>

						{/* Coin Type A */}
						<CoinTypeInput
							label="Coin Type A (base)"
							value={coinTypeA}
							onChange={setCoinTypeA}
							walletCoinTypes={walletCoinTypes}
							loading={loadingCoins}
						/>

						{/* Coin Type B */}
						<CoinTypeInput
							label="Coin Type B (quote)"
							value={coinTypeB}
							onChange={setCoinTypeB}
							walletCoinTypes={walletCoinTypes}
							loading={loadingCoins}
						/>

						{/* Fee BPS */}
						<div>
							<label
								htmlFor="create-pair-fee"
								className="mb-1 block text-xs text-zinc-500"
							>
								Fee (basis points)
							</label>
							<input
								id="create-pair-fee"
								type="number"
								value={feeBps}
								onChange={(e) => setFeeBps(e.target.value)}
								placeholder="30"
								min={0}
								max={10000}
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
							<p className="mt-0.5 text-[10px] text-zinc-600">
								{Number(feeBps || 0) / 100}% -- 100 bps = 1%
							</p>
						</div>

						<button
							type="button"
							onClick={handleSubmit}
							disabled={isPending}
							className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
						>
							{isPending ? "Creating..." : "Create Pair"}
						</button>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}

// ── Hybrid coin type picker: wallet dropdown + custom paste ───────────────

function CoinTypeInput({
	label,
	value,
	onChange,
	walletCoinTypes,
	loading,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	walletCoinTypes: string[];
	loading: boolean;
}) {
	const [showDropdown, setShowDropdown] = useState(false);
	const [isFocused, setIsFocused] = useState(false);
	const isWalletCoin = walletCoinTypes.includes(value);
	const displayValue = !isFocused && isWalletCoin ? formatCoinTypeName(value) : value;

	return (
		<div className="relative">
			<label className="mb-1 block text-xs text-zinc-500">{label}</label>
			<div className="flex gap-1">
				<input
					type="text"
					value={displayValue}
					onChange={(e) => onChange(e.target.value)}
					onFocus={() => {
						setIsFocused(true);
						setShowDropdown(true);
					}}
					onBlur={() => {
						setIsFocused(false);
						setTimeout(() => setShowDropdown(false), 200);
					}}
					placeholder="0x...::module::CoinType"
					title={value}
					className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>
			{showDropdown && walletCoinTypes.length > 0 && (
				<div className="absolute z-10 mt-1 max-h-36 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 shadow-lg">
					{loading && (
						<p className="px-3 py-1.5 text-xs text-zinc-600">Loading...</p>
					)}
					{walletCoinTypes.map((ct) => (
						<button
							key={ct}
							type="button"
							onMouseDown={() => {
								onChange(ct);
								setShowDropdown(false);
							}}
							className={`w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-700 ${
								ct === value ? "text-cyan-400" : "text-zinc-300"
							}`}
						>
							<span className="font-medium">{formatCoinTypeName(ct)}</span>
							<span className="ml-1 font-mono text-[10px] text-zinc-600">
								{ct.length > 40 ? `${ct.slice(0, 20)}...${ct.slice(-15)}` : ct}
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function formatCoinTypeName(coinType: string): string {
	const parts = coinType.split("::");
	const name = parts.length >= 3 ? parts[parts.length - 1] : coinType.slice(0, 16);
	return name.replace(/_TOKEN$/, "");
}
