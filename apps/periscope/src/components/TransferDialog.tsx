import type { ManifestCharacter } from "@/db/types";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { queryOwnedCoins } from "@tehfrontier/chain-shared";
import { AlertCircle, Loader2, Send, X } from "lucide-react";
import { useCallback, useState } from "react";
import { ContactPicker } from "./ContactPicker";
import { CopyAddress } from "./CopyAddress";

// ── Types ───────────────────────────────────────────────────────────────────

interface CoinBalance {
	coinType: string;
	totalBalance: string;
}

interface CoinMeta {
	decimals: number;
	symbol: string;
	name: string;
}

interface TransferDialogProps {
	balances: CoinBalance[];
	coinMeta: Record<string, CoinMeta>;
	senderAddress: string;
	onClose: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractTokenName(coinType: string): string {
	const parts = coinType.split("::");
	if (parts.length >= 3) return parts[parts.length - 1];
	if (parts.length === 2) return parts[1];
	return coinType;
}

function isSuiCoin(coinType: string): boolean {
	return /^0x0*2::sui::SUI$/.test(coinType);
}

function formatBalance(raw: string | bigint, decimals: number): string {
	const value = typeof raw === "bigint" ? raw : BigInt(raw);
	const divisor = 10n ** BigInt(decimals);
	const whole = value / divisor;
	const frac = value % divisor;
	if (frac === 0n) return whole.toLocaleString();
	const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${whole.toLocaleString()}.${fracStr}`;
}

function parseAmount(input: string, decimals: number): bigint | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	// Remove commas
	const cleaned = trimmed.replace(/,/g, "");

	const parts = cleaned.split(".");
	if (parts.length > 2) return null;

	const whole = parts[0] || "0";
	const frac = parts[1] || "";

	if (!/^\d+$/.test(whole)) return null;
	if (frac && !/^\d+$/.test(frac)) return null;

	const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
	return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFrac);
}

// ── Component ───────────────────────────────────────────────────────────────

export function TransferDialog({
	balances,
	coinMeta,
	senderAddress,
	onClose,
}: TransferDialogProps) {
	const client = useSuiClient();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();

	// Filter out SUI (deferred -- special gas handling needed)
	const transferableBalances = balances.filter((b) => !isSuiCoin(b.coinType));

	const [selectedCoinType, setSelectedCoinType] = useState(
		transferableBalances.length > 0 ? transferableBalances[0].coinType : "",
	);
	const [recipientAddress, setRecipientAddress] = useState("");
	const [recipientName, setRecipientName] = useState<string | null>(null);
	const [amountInput, setAmountInput] = useState("");
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [txDigest, setTxDigest] = useState<string | null>(null);

	const selectedBalance = balances.find((b) => b.coinType === selectedCoinType);
	const meta = selectedCoinType ? coinMeta[selectedCoinType] : undefined;
	const decimals = meta?.decimals ?? 0;
	const symbol = meta?.symbol ?? extractTokenName(selectedCoinType);
	const availableBalance = selectedBalance?.totalBalance ?? "0";

	const handleContactSelect = useCallback((character: ManifestCharacter) => {
		setRecipientAddress(character.suiAddress);
		setRecipientName(character.name || null);
	}, []);

	const handleMax = useCallback(() => {
		setAmountInput(formatBalance(availableBalance, decimals));
	}, [availableBalance, decimals]);

	const parsedAmount = parseAmount(amountInput, decimals);
	const isValidAmount =
		parsedAmount !== null && parsedAmount > 0n && parsedAmount <= BigInt(availableBalance);
	const isValidRecipient =
		recipientAddress.trim().startsWith("0x") && recipientAddress.trim().length >= 10;
	const canSubmit = isValidAmount && isValidRecipient && !isPending && !txDigest;

	const handleTransfer = useCallback(async () => {
		if (!canSubmit || !parsedAmount) return;
		setIsPending(true);
		setError(null);

		try {
			// Fetch owned coins for selected type
			const ownedCoins = await queryOwnedCoins(client, senderAddress, selectedCoinType);
			if (ownedCoins.length === 0) {
				throw new Error("No coins found for this type");
			}

			const tx = new Transaction();
			tx.setSender(senderAddress);

			if (ownedCoins.length === 1) {
				// Single coin -- split the exact amount
				const [splitCoin] = tx.splitCoins(tx.object(ownedCoins[0].objectId), [parsedAmount]);
				tx.transferObjects([splitCoin], recipientAddress.trim());
			} else {
				// Multiple coins -- merge into first, then split
				const primary = tx.object(ownedCoins[0].objectId);
				const rest = ownedCoins.slice(1).map((c) => tx.object(c.objectId));
				tx.mergeCoins(primary, rest);

				const [splitCoin] = tx.splitCoins(primary, [parsedAmount]);
				tx.transferObjects([splitCoin], recipientAddress.trim());
			}

			const result = await signAndExecute({ transaction: tx });
			const digest =
				(result as { Transaction?: { digest?: string } })?.Transaction?.digest ??
				(result as { digest?: string })?.digest ??
				"";
			setTxDigest(digest);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsPending(false);
		}
	}, [
		canSubmit,
		parsedAmount,
		client,
		senderAddress,
		selectedCoinType,
		recipientAddress,
		signAndExecute,
	]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div
				className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={() => {}}
			>
				{/* Header */}
				<div className="mb-5 flex items-center justify-between">
					<h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
						<Send size={18} className="text-cyan-500" />
						Send Tokens
					</h2>
					<button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
						<X size={18} />
					</button>
				</div>

				{txDigest ? (
					/* Success state */
					<div className="space-y-4">
						<div className="rounded-lg border border-green-900/50 bg-green-950/20 p-4 text-center">
							<p className="text-sm font-medium text-green-400">Transfer successful!</p>
							<div className="mt-2">
								<CopyAddress
									address={txDigest}
									sliceStart={10}
									sliceEnd={6}
									explorerUrl={`https://testnet.suivision.xyz/txblock/${txDigest}`}
									className="text-xs text-zinc-400"
								/>
							</div>
						</div>
						<button
							type="button"
							onClick={onClose}
							className="w-full rounded-lg bg-zinc-800 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
						>
							Close
						</button>
					</div>
				) : (
					/* Transfer form */
					<div className="space-y-4">
						{/* Coin Type */}
						<div>
							<label className="mb-1 block text-xs font-medium text-zinc-400">Currency</label>
							{transferableBalances.length === 0 ? (
								<p className="text-sm text-zinc-600">
									No transferable tokens. SUI transfers are not yet supported.
								</p>
							) : (
								<select
									value={selectedCoinType}
									onChange={(e) => {
										setSelectedCoinType(e.target.value);
										setAmountInput("");
									}}
									className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
								>
									{transferableBalances.map((b) => {
										const m = coinMeta[b.coinType];
										const label = m?.symbol ?? extractTokenName(b.coinType);
										return (
											<option key={b.coinType} value={b.coinType}>
												{label} -- {formatBalance(b.totalBalance, m?.decimals ?? 0)}
											</option>
										);
									})}
								</select>
							)}
						</div>

						{/* Recipient */}
						<div>
							<label className="mb-1 block text-xs font-medium text-zinc-400">Recipient</label>
							{recipientName ? (
								<div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
									<span className="text-sm font-medium text-zinc-200">{recipientName}</span>
									<CopyAddress
										address={recipientAddress}
										sliceStart={6}
										sliceEnd={4}
										className="text-xs text-zinc-500"
									/>
									<button
										type="button"
										onClick={() => {
											setRecipientAddress("");
											setRecipientName(null);
										}}
										className="ml-auto text-zinc-500 hover:text-zinc-300"
									>
										<X size={14} />
									</button>
								</div>
							) : (
								<div className="space-y-2">
									<ContactPicker
										onSelect={handleContactSelect}
										placeholder="Search by name or address..."
										excludeAddresses={[senderAddress]}
									/>
									<div className="text-center text-[10px] text-zinc-600">or</div>
									<input
										type="text"
										value={recipientAddress}
										onChange={(e) => setRecipientAddress(e.target.value)}
										placeholder="Paste 0x... address"
										className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
									/>
								</div>
							)}
						</div>

						{/* Amount */}
						<div>
							<div className="mb-1 flex items-center justify-between">
								<label className="text-xs font-medium text-zinc-400">Amount</label>
								<span className="text-[10px] text-zinc-600">
									Available: {formatBalance(availableBalance, decimals)} {symbol}
								</span>
							</div>
							<div className="relative">
								<input
									type="text"
									value={amountInput}
									onChange={(e) => setAmountInput(e.target.value)}
									placeholder="0.00"
									className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 pr-16 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
								<button
									type="button"
									onClick={handleMax}
									className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-zinc-700 px-2 py-0.5 text-[10px] font-medium text-cyan-400 hover:bg-zinc-600"
								>
									MAX
								</button>
							</div>
							{amountInput && parsedAmount !== null && parsedAmount > BigInt(availableBalance) && (
								<p className="mt-1 text-xs text-red-400">Insufficient balance</p>
							)}
						</div>

						{/* Error */}
						{error && (
							<div className="flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
								<AlertCircle size={14} className="shrink-0" />
								{error}
							</div>
						)}

						{/* Submit */}
						<button
							type="button"
							onClick={handleTransfer}
							disabled={!canSubmit}
							className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
							{isPending ? "Signing..." : "Send"}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
