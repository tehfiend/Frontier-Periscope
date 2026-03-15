import { useState, useEffect, useCallback } from "react";
import { useSuiClient } from "@mysten/dapp-kit";
import { Wallet as WalletIcon, Loader2, RefreshCw, ExternalLink, Info, AlertCircle } from "lucide-react";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";

// ── Types ───────────────────────────────────────────────────────────────────

interface CoinBalance {
	coinType: string;
	totalBalance: string;
	coinObjectCount: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Convert MIST (raw balance string) to human-readable SUI. */
function formatSui(mist: string): string {
	const raw = BigInt(mist);
	const whole = raw / 1_000_000_000n;
	const frac = raw % 1_000_000_000n;
	if (frac === 0n) return whole.toLocaleString();
	const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
	return `${whole.toLocaleString()}.${fracStr}`;
}

/** Extract a human-readable token name from a coin type string.
 *  e.g. "0xabc::gold_token::GOLD_TOKEN" -> "GOLD_TOKEN" */
function extractTokenName(coinType: string): string {
	const parts = coinType.split("::");
	if (parts.length >= 3) return parts[parts.length - 1];
	if (parts.length === 2) return parts[1];
	return coinType;
}

/** Check if a coin type is the native SUI coin. */
function isSuiCoin(coinType: string): boolean {
	return coinType === "0x2::sui::SUI";
}

// ── Component ───────────────────────────────────────────────────────────────

export function Wallet() {
	const { activeCharacter } = useActiveCharacter();
	const client = useSuiClient();

	const suiAddress = activeCharacter?.suiAddress;

	const [balances, setBalances] = useState<CoinBalance[]>([]);
	const [loading, setLoading] = useState(false);
	const [fetching, setFetching] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchBalances = useCallback(async () => {
		if (!suiAddress) return;
		setFetching(true);
		setError(null);
		try {
			const allBalances = await client.getAllBalances({ owner: suiAddress });
			setBalances(allBalances as CoinBalance[]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setFetching(false);
			setLoading(false);
		}
	}, [suiAddress, client]);

	useEffect(() => {
		if (suiAddress) {
			setLoading(true);
			fetchBalances();
		} else {
			setBalances([]);
			setLoading(false);
		}
	}, [suiAddress, fetchBalances]);

	// ── No character selected ───────────────────────────────────────────────

	if (!activeCharacter || !suiAddress) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<WalletIcon size={48} className="mx-auto mb-4 text-zinc-700" />
					<p className="text-sm text-zinc-500">
						{!activeCharacter
							? "Select a character to view their wallet"
							: "No Sui address linked to this character"}
					</p>
					<a
						href="/manifest"
						className="mt-2 inline-block text-xs text-cyan-400 hover:text-cyan-300"
					>
						Go to Manifest &rarr;
					</a>
				</div>
			</div>
		);
	}

	// ── Derived data ────────────────────────────────────────────────────────

	const suiBalance = balances.find((b) => isSuiCoin(b.coinType));
	const suiMist = suiBalance?.totalBalance ?? "0";
	const suiHuman = formatSui(suiMist);
	const tokenCount = balances.length;

	return (
		<div className="mx-auto max-w-3xl p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<WalletIcon size={24} className="text-cyan-500" />
						Wallet
					</h1>
					<p className="mt-1 font-mono text-sm text-zinc-300">
						{suiAddress}
					</p>
					<p className="mt-0.5 text-xs text-zinc-600">
						{activeCharacter.characterName ?? "Unknown character"}
						{" \u00b7 "}
						{loading
							? "Loading balances..."
							: `${tokenCount} coin type${tokenCount !== 1 ? "s" : ""}`}
					</p>
				</div>
				<button
					type="button"
					onClick={fetchBalances}
					disabled={fetching}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{fetching ? (
						<Loader2 size={14} className="animate-spin" />
					) : (
						<RefreshCw size={14} />
					)}
					Refresh
				</button>
			</div>

			{/* Error banner */}
			{error && (
				<div className="mb-6 rounded-lg border border-red-900/50 bg-red-950/20 p-4">
					<p className="text-sm text-red-400">{error}</p>
				</div>
			)}

			{/* Loading state */}
			{loading ? (
				<div className="flex items-center justify-center py-16">
					<Loader2 size={24} className="animate-spin text-cyan-500" />
					<span className="ml-3 text-sm text-zinc-400">Fetching balances...</span>
				</div>
			) : (
				<>
					{/* Summary Cards */}
					<div className="mb-6 grid grid-cols-2 gap-4">
						{/* SUI Balance Card */}
						<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
							<p className="text-xs text-zinc-500">SUI Balance</p>
							<p className="mt-1 text-2xl font-bold text-zinc-100">
								{suiHuman} SUI
							</p>
							<p className="mt-1 font-mono text-xs text-zinc-600">
								{BigInt(suiMist).toLocaleString()} MIST
							</p>
						</div>

						{/* Faucet Card */}
						<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
							<p className="text-xs text-zinc-500">Need testnet SUI?</p>
							<p className="mt-1 text-sm text-zinc-400">
								Get free SUI tokens for testing on the Sui testnet faucet.
							</p>
							<a
								href={`https://faucet.sui.io/?address=${suiAddress}`}
								target="_blank"
								rel="noopener noreferrer"
								className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-cyan-400 transition-colors hover:text-cyan-300"
							>
								Get from Faucet
								<ExternalLink size={14} />
							</a>
						</div>
					</div>

					{/* Token Balances Table */}
					<div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50">
						<div className="border-b border-zinc-800 px-4 py-3">
							<h2 className="text-sm font-medium text-zinc-400">
								Token Balances
							</h2>
						</div>
						{balances.length === 0 ? (
							<div className="px-4 py-8 text-center text-sm text-zinc-600">
								No coins found in this wallet.
							</div>
						) : (
							<table className="w-full">
								<thead>
									<tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
										<th className="px-4 py-2 font-medium">Coin Type</th>
										<th className="px-4 py-2 font-medium">Balance</th>
										<th className="px-4 py-2 text-right font-medium">
											Objects
										</th>
									</tr>
								</thead>
								<tbody>
									{balances.map((b) => {
										const name = extractTokenName(b.coinType);
										const isSui = isSuiCoin(b.coinType);
										// All Sui coins default to 9 decimals
										const displayBalance = `${formatSui(b.totalBalance)} ${isSui ? "SUI" : name}`;

										return (
											<tr
												key={b.coinType}
												className="border-b border-zinc-800/50 last:border-b-0"
											>
												<td className="px-4 py-3">
													<span className="font-medium text-zinc-200">
														{name}
													</span>
													{!isSui && (
														<span
															className="ml-2 block truncate font-mono text-xs text-zinc-600"
															title={b.coinType}
														>
															{b.coinType.length > 50
																? `${b.coinType.slice(0, 24)}...${b.coinType.slice(-20)}`
																: b.coinType}
														</span>
													)}
												</td>
												<td className="px-4 py-3 font-mono text-sm text-zinc-200">
													{displayBalance}
												</td>
												<td className="px-4 py-3 text-right font-mono text-sm text-zinc-400">
													{b.coinObjectCount}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						)}
					</div>

					{/* Info Box */}
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
						<div className="flex items-start gap-3">
							<Info size={16} className="mt-0.5 shrink-0 text-zinc-600" />
							<p className="text-xs text-zinc-500">
								Read-only view of on-chain balances for{" "}
								<span className="text-zinc-400">
									{activeCharacter.characterName}
								</span>
								. Connect EVE Vault only when signing transactions.
							</p>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
