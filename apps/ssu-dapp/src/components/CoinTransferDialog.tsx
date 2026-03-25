import { CopyAddress } from "@/components/CopyAddress";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { useSuiClient } from "@/hooks/useSuiClient";
import { extractTokenName, formatBalance, isSuiCoin } from "@/lib/coin-utils";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { queryOwnedCoins } from "@tehfrontier/chain-shared";
import { useEffect, useRef, useState } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CoinBalance {
	coinType: string;
	totalBalance: string;
}

export interface CoinMeta {
	decimals: number;
	symbol: string;
	name: string;
}

interface CoinTransferDialogProps {
	balances: CoinBalance[];
	coinMeta: Record<string, CoinMeta>;
	senderAddress: string;
	onClose: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseAmount(input: string, decimals: number): bigint | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

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

export function CoinTransferDialog({
	balances,
	coinMeta,
	senderAddress,
	onClose,
}: CoinTransferDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const client = useSuiClient();
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();

	// Filter out SUI (special gas handling needed)
	const transferableBalances = balances.filter((b) => !isSuiCoin(b.coinType));

	const [selectedCoinType, setSelectedCoinType] = useState(
		transferableBalances.length > 0 ? transferableBalances[0].coinType : "",
	);
	const [recipientAddress, setRecipientAddress] = useState("");
	const [amountInput, setAmountInput] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [txDigest, setTxDigest] = useState<string | null>(null);

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	const selectedBalance = balances.find((b) => b.coinType === selectedCoinType);
	const meta = selectedCoinType ? coinMeta[selectedCoinType] : undefined;
	const decimals = meta?.decimals ?? 0;
	const symbol = meta?.symbol ?? extractTokenName(selectedCoinType);
	const availableBalance = selectedBalance?.totalBalance ?? "0";

	const parsedAmount = parseAmount(amountInput, decimals);
	const isValidAmount =
		parsedAmount !== null && parsedAmount > 0n && parsedAmount <= BigInt(availableBalance);
	const isValidRecipient = /^0x[0-9a-fA-F]{1,64}$/.test(recipientAddress.trim());
	const canSubmit = isValidAmount && isValidRecipient && !isPending && !txDigest;

	async function handleTransfer() {
		if (!canSubmit || !parsedAmount || !account?.address) return;
		setError(null);

		try {
			const ownedCoins = await queryOwnedCoins(client, senderAddress, selectedCoinType);
			if (ownedCoins.length === 0) {
				throw new Error("No coins found for this type");
			}

			const tx = new Transaction();
			tx.setSender(senderAddress);

			if (ownedCoins.length === 1) {
				const [splitCoin] = tx.splitCoins(tx.object(ownedCoins[0].objectId), [parsedAmount]);
				tx.transferObjects([splitCoin], recipientAddress.trim());
			} else {
				const primary = tx.object(ownedCoins[0].objectId);
				const rest = ownedCoins.slice(1).map((c) => tx.object(c.objectId));
				tx.mergeCoins(primary, rest);

				const [splitCoin] = tx.splitCoins(primary, [parsedAmount]);
				tx.transferObjects([splitCoin], recipientAddress.trim());
			}

			const result = await signAndExecute(tx);
			const digest =
				typeof result === "object" && result !== null
					? (((result as Record<string, unknown>).digest as string) ?? "")
					: "";
			setTxDigest(digest);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<dialog
			ref={dialogRef}
			className="m-auto w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-0 text-zinc-100 backdrop:bg-black/60"
			onClose={onClose}
		>
			<div className="p-5">
				{/* Header */}
				<div className="mb-4 flex items-center justify-between">
					<h3 className="text-sm font-medium text-zinc-200">Send Tokens</h3>
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

				{txDigest ? (
					<div className="space-y-3">
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
					<div className="space-y-4">
						{/* Coin Type */}
						<div>
							<label
								htmlFor="transfer-currency"
								className="mb-1 block text-xs font-medium text-zinc-400"
							>
								Currency
							</label>
							{transferableBalances.length === 0 ? (
								<p className="text-sm text-zinc-600">
									No transferable tokens. SUI transfers are not yet supported.
								</p>
							) : (
								<select
									id="transfer-currency"
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
							<label
								htmlFor="transfer-recipient"
								className="mb-1 block text-xs font-medium text-zinc-400"
							>
								Recipient
							</label>
							<input
								id="transfer-recipient"
								type="text"
								value={recipientAddress}
								onChange={(e) => setRecipientAddress(e.target.value)}
								placeholder="Paste 0x... address"
								className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
						</div>

						{/* Amount */}
						<div>
							<div className="mb-1 flex items-center justify-between">
								<label htmlFor="transfer-amount" className="text-xs font-medium text-zinc-400">
									Amount
								</label>
								<span className="text-[10px] text-zinc-600">
									Available: {formatBalance(availableBalance, decimals)} {symbol}
								</span>
							</div>
							<div className="relative">
								<input
									id="transfer-amount"
									type="text"
									value={amountInput}
									onChange={(e) => setAmountInput(e.target.value)}
									placeholder="0.00"
									className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 pr-16 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
								<button
									type="button"
									onClick={() => setAmountInput(formatBalance(availableBalance, decimals))}
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
						{error && <p className="text-xs text-red-400">{error}</p>}

						{/* Submit */}
						<button
							type="button"
							onClick={handleTransfer}
							disabled={!canSubmit}
							className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
						>
							{isPending ? "Signing..." : "Send"}
						</button>
					</div>
				)}
			</div>
		</dialog>
	);
}
