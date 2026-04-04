import { CopyAddress } from "@/components/CopyAddress";
import { TransferDialog } from "@/components/TransferDialog";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useSuiClient } from "@/hooks/useSuiClient";
import { ErrorMessage } from "@/components/ErrorMessage";
import { walletErrorMessage } from "@/lib/format";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import {
	type TenantId,
	type WalletTransaction,
	getContractAddresses,
	queryDecommissionedMarkets,
	queryWalletTransactions,
} from "@tehfrontier/chain-shared";
import { db } from "@/db";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import {
	ArrowDownLeft,
	ArrowUpRight,
	ExternalLink,
	Info,
	Loader2,
	RefreshCw,
	Wallet as WalletIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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

interface FlatTx {
	digest: string;
	timestampMs: number;
	coinType: string;
	amount: bigint;
}

type SortField = "time" | "amount" | "currency";
type SortDir = "asc" | "desc";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatBalance(raw: string | bigint, decimals: number): string {
	const value = typeof raw === "bigint" ? raw : BigInt(raw);
	const divisor = 10n ** BigInt(decimals);
	const whole = value / divisor;
	const frac = value % divisor;
	if (frac === 0n) return whole.toLocaleString();
	const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${whole.toLocaleString()}.${fracStr}`;
}

function extractTokenName(coinType: string): string {
	const parts = coinType.split("::");
	if (parts.length >= 3) return parts[parts.length - 1];
	if (parts.length === 2) return parts[1];
	return coinType;
}

function isSuiCoin(coinType: string): boolean {
	return /^0x0*2::sui::SUI$/.test(coinType);
}

// ── Component ───────────────────────────────────────────────────────────────

export function Wallet() {
	const { activeCharacter } = useActiveCharacter();
	const client = useSuiClient();
	const account = useCurrentAccount();
	const tenant = useActiveTenant();

	const suiAddress = activeCharacter?.suiAddress;
	const [showTransfer, setShowTransfer] = useState(false);

	const [balances, setBalances] = useState<CoinBalance[]>([]);
	const [coinMeta, setCoinMeta] = useState<Record<string, CoinMeta>>({});
	const [loading, setLoading] = useState(false);
	const [fetching, setFetching] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Transaction state
	const [rawTxs, setRawTxs] = useState<WalletTransaction[]>([]);
	const [txLoading, setTxLoading] = useState(false);
	const [txError, setTxError] = useState<string | null>(null);
	const [filterCoin, setFilterCoin] = useState("all");
	const [filterDir, setFilterDir] = useState("all");
	const [search, setSearch] = useState("");
	const [sortField, setSortField] = useState<SortField>("time");
	const [sortDir, setSortDir] = useState<SortDir>("desc");

	const fetchBalances = useCallback(async () => {
		if (!suiAddress) return;
		setFetching(true);
		setError(null);
		try {
			const result = await client.listBalances({ owner: suiAddress });
			const mapped: CoinBalance[] = result.balances.map((b) => ({
				coinType: b.coinType,
				totalBalance: String(b.balance),
			}));
			setBalances(mapped);

			const metaMap: Record<string, CoinMeta> = {};
			for (const b of mapped) {
				if (metaMap[b.coinType]) continue;
				try {
					const metaResult = await client.getCoinMetadata({ coinType: b.coinType });
					const meta = metaResult.coinMetadata;
					if (meta) {
						metaMap[b.coinType] = {
							decimals: meta.decimals,
							symbol: meta.symbol,
							name: meta.name,
						};
					}
				} catch {
					// Fallback if metadata not available
				}
			}
			setCoinMeta(metaMap);
		} catch (err) {
			setError(walletErrorMessage(err));
		} finally {
			setFetching(false);
			setLoading(false);
		}
	}, [suiAddress, client]);

	const fetchTransactions = useCallback(async () => {
		if (!suiAddress) return;
		setTxLoading(true);
		setTxError(null);
		try {
			const result = await queryWalletTransactions(client, suiAddress, { limit: 50 });
			setRawTxs(result.data);

			// Resolve metadata for any coin types seen in transactions
			const seenTypes = new Set<string>();
			for (const tx of result.data) {
				for (const bc of tx.balanceChanges) {
					seenTypes.add(bc.coinType);
				}
			}
			const newMeta: Record<string, CoinMeta> = {};
			for (const ct of seenTypes) {
				try {
					const metaResult = await client.getCoinMetadata({ coinType: ct });
					const meta = metaResult.coinMetadata;
					if (meta) {
						newMeta[ct] = { decimals: meta.decimals, symbol: meta.symbol, name: meta.name };
					}
				} catch {
					// skip
				}
			}
			if (Object.keys(newMeta).length > 0) {
				setCoinMeta((prev) => ({ ...prev, ...newMeta }));
			}
		} catch (err) {
			setTxError(walletErrorMessage(err));
		} finally {
			setTxLoading(false);
		}
	}, [suiAddress, client]);

	useEffect(() => {
		if (suiAddress) {
			setLoading(true);
			fetchBalances();
			fetchTransactions();
		} else {
			setBalances([]);
			setRawTxs([]);
			setLoading(false);
		}
	}, [suiAddress, fetchBalances, fetchTransactions]);

	// Resolve decommissioned coin types to filter out
	const [decomCoinTypes, setDecomCoinTypes] = useState<Set<string>>(new Set());
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const addrs = getContractAddresses(tenant as TenantId);
				const decomPkg = addrs.decommission?.packageId;
				if (!decomPkg) return;
				const decomMarketIds = await queryDecommissionedMarkets(client, decomPkg);
				const coinTypes = new Set<string>();
				for (const mId of decomMarketIds) {
					// Look up each decommissioned market in manifest to get its coinType
					const market = await db.manifestMarkets.get(mId);
					if (market) {
						coinTypes.add(market.coinType);
					}
				}
				if (!cancelled) setDecomCoinTypes(coinTypes);
			} catch { /* non-fatal */ }
		})();
		return () => { cancelled = true; };
	}, [client, tenant]);

	const [showDecommissioned, setShowDecommissioned] = useState(false);
	const decomCount = useMemo(
		() => balances.filter((b) => decomCoinTypes.has(b.coinType)).length,
		[balances, decomCoinTypes],
	);

	const visibleBalances = useMemo(
		() => balances.filter((b) => showDecommissioned || !decomCoinTypes.has(b.coinType)),
		[balances, decomCoinTypes, showDecommissioned],
	);

	// ── Flatten transactions ─────────────────────────────────────────────────

	const { flatTxs, txCoinTypes } = useMemo(() => {
		const flat: FlatTx[] = [];
		const types = new Set<string>();
		for (const tx of rawTxs) {
			for (const bc of tx.balanceChanges) {
				if (decomCoinTypes.has(bc.coinType)) continue;
				types.add(bc.coinType);
				flat.push({
					digest: tx.digest,
					timestampMs: tx.timestampMs,
					coinType: bc.coinType,
					amount: BigInt(bc.amount),
				});
			}
		}
		return { flatTxs: flat, txCoinTypes: Array.from(types).sort() };
	}, [rawTxs]);

	// ── Filter + sort ────────────────────────────────────────────────────────

	const filtered = useMemo(() => {
		let rows = flatTxs;

		if (filterCoin !== "all") {
			rows = rows.filter((r) => r.coinType === filterCoin);
		}
		if (filterDir === "in") {
			rows = rows.filter((r) => r.amount > 0n);
		} else if (filterDir === "out") {
			rows = rows.filter((r) => r.amount < 0n);
		}
		if (search.trim()) {
			const q = search.toLowerCase();
			rows = rows.filter((r) => r.digest.toLowerCase().includes(q));
		}

		const dir = sortDir === "asc" ? 1 : -1;
		return [...rows].sort((a, b) => {
			switch (sortField) {
				case "time":
					return (a.timestampMs - b.timestampMs) * dir;
				case "amount":
					return Number(a.amount - b.amount) * dir;
				case "currency": {
					const sa = coinMeta[a.coinType]?.symbol ?? extractTokenName(a.coinType);
					const sb = coinMeta[b.coinType]?.symbol ?? extractTokenName(b.coinType);
					return sa.localeCompare(sb) * dir;
				}
				default:
					return 0;
			}
		});
	}, [flatTxs, filterCoin, filterDir, search, sortField, sortDir, coinMeta]);

	function handleSort(field: SortField) {
		if (sortField === field) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortField(field);
			setSortDir(field === "time" ? "desc" : "asc");
		}
	}

	function sortIcon(field: SortField): string {
		if (sortField !== field) return "";
		return sortDir === "asc" ? " \u25B2" : " \u25BC";
	}

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

	const suiBalance = visibleBalances.find((b) => isSuiCoin(b.coinType));
	const suiMist = suiBalance?.totalBalance ?? "0";
	const suiHuman = formatBalance(suiMist, 9);
	const tokenCount = visibleBalances.length;

	return (
		<div className="mx-auto max-w-3xl p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<WalletIcon size={24} className="text-cyan-500" />
						Wallet
					</h1>
					<CopyAddress
						address={suiAddress}
						sliceStart={20}
						sliceEnd={8}
						explorerUrl={`https://suiscan.xyz/testnet/account/${suiAddress}`}
						className="mt-1 text-sm text-zinc-300"
					/>
					<p className="mt-0.5 text-xs text-zinc-600">
						{activeCharacter.characterName ?? "Unknown character"}
						{" \u00b7 "}
						{loading
							? "Loading balances..."
							: `${tokenCount} coin type${tokenCount !== 1 ? "s" : ""}`}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{account && (
						<button
							type="button"
							onClick={() => setShowTransfer(true)}
							className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
						>
							<ArrowUpRight size={14} />
							Send
						</button>
					)}
					<button
						type="button"
						onClick={() => {
							fetchBalances();
							fetchTransactions();
						}}
						disabled={fetching || txLoading}
						className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
					>
						{fetching || txLoading ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							<RefreshCw size={14} />
						)}
						Refresh
					</button>
				</div>
			</div>

			{/* Error banner */}
			{error && (
				<div className="mb-6 rounded-lg border border-red-900/50 bg-red-950/20 p-4">
					<p className="text-sm text-red-400">
						<ErrorMessage text={error} />
					</p>
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
						<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
							<p className="text-xs text-zinc-500">SUI Balance</p>
							<p className="mt-1 text-2xl font-bold text-zinc-100">{suiHuman} SUI</p>
							<p className="mt-1 font-mono text-xs text-zinc-600">
								{BigInt(suiMist).toLocaleString()} MIST
							</p>
						</div>

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
						<div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
							<h2 className="text-sm font-medium text-zinc-400">Token Balances</h2>
							{decomCount > 0 && (
								<button
									type="button"
									onClick={() => setShowDecommissioned(!showDecommissioned)}
									className={`text-xs transition-colors ${
										showDecommissioned
											? "text-amber-400 hover:text-amber-300"
											: "text-zinc-600 hover:text-zinc-400"
									}`}
								>
									{showDecommissioned
										? `Hide ${decomCount} deprecated`
										: `Show ${decomCount} deprecated`}
								</button>
							)}
						</div>
						{visibleBalances.length === 0 ? (
							<div className="px-4 py-8 text-center text-sm text-zinc-600">
								No coins found in this wallet.
							</div>
						) : (
							<table className="w-full">
								<thead>
									<tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
										<th className="px-4 py-2 font-medium">Token</th>
										<th className="px-4 py-2 font-medium">Balance</th>
									</tr>
								</thead>
								<tbody>
									{visibleBalances.map((b) => {
										const meta = coinMeta[b.coinType];
										const name = meta?.symbol || extractTokenName(b.coinType);
										const decimals = meta?.decimals ?? 9;
										const isSui = isSuiCoin(b.coinType);
										const isDecom = decomCoinTypes.has(b.coinType);
										const displayBal = `${formatBalance(b.totalBalance, decimals)} ${isSui ? "SUI" : name}`;

										return (
											<tr
												key={b.coinType}
												className={`border-b border-zinc-800/50 last:border-b-0 ${isDecom ? "opacity-50" : ""}`}
											>
												<td className="px-4 py-3">
													<div className="flex items-center gap-2">
														<span className="font-medium text-zinc-200">{meta?.name || name}</span>
														{meta?.symbol && meta.symbol !== (meta.name || name) && (
															<span className="text-xs text-zinc-500">({meta.symbol})</span>
														)}
														{isDecom && (
															<span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
																Deprecated
															</span>
														)}
													</div>
													{!isSui && (
														<div className="mt-0.5 flex items-center gap-1.5">
															<span
																className="min-w-0 truncate font-mono text-xs text-zinc-600"
																title={b.coinType}
															>
																{b.coinType.length > 50
																	? `${b.coinType.slice(0, 24)}...${b.coinType.slice(-20)}`
																	: b.coinType}
															</span>
															<button
																type="button"
																onClick={() => navigator.clipboard.writeText(b.coinType)}
																className="shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-600 hover:text-zinc-300"
																title="Copy token identifier for Eve Vault"
															>
																Copy
															</button>
														</div>
													)}
												</td>
												<td className="px-4 py-3 font-mono text-sm text-zinc-200">{displayBal}</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						)}
					</div>

					{/* ── Currency Transactions ─────────────────────────────── */}
					<div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50">
						<div className="border-b border-zinc-800 px-4 py-3">
							<h2 className="text-sm font-medium text-zinc-400">Currency Transactions</h2>
						</div>

						{/* Filters */}
						<div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/50 px-4 py-2">
							<select
								value={filterCoin}
								onChange={(e) => setFilterCoin(e.target.value)}
								className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none"
							>
								<option value="all">All Currencies</option>
								{txCoinTypes.map((ct) => (
									<option key={ct} value={ct}>
										{coinMeta[ct]?.symbol ?? extractTokenName(ct)}
									</option>
								))}
							</select>

							<select
								value={filterDir}
								onChange={(e) => setFilterDir(e.target.value)}
								className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none"
							>
								<option value="all">All Directions</option>
								<option value="in">Received</option>
								<option value="out">Sent</option>
							</select>

							<input
								type="text"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search by tx digest..."
								className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>

							<span className="text-[10px] text-zinc-600">
								{filtered.length} of {flatTxs.length}
							</span>
						</div>

						{/* Grid */}
						{txLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 size={16} className="animate-spin text-cyan-500" />
								<span className="ml-2 text-xs text-zinc-500">Loading transactions...</span>
							</div>
						) : txError ? (
							<div className="px-4 py-6 text-center text-xs text-red-400">
								<ErrorMessage text={txError} />
							</div>
						) : filtered.length === 0 ? (
							<div className="px-4 py-8 text-center text-xs text-zinc-600">
								{flatTxs.length === 0
									? "No currency transactions found."
									: "No transactions match the current filters."}
							</div>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full text-left text-xs">
									<thead>
										<tr className="border-b border-zinc-800 text-[10px] text-zinc-500 uppercase">
											<ThSort onClick={() => handleSort("time")}>Time{sortIcon("time")}</ThSort>
											<ThSort onClick={() => handleSort("currency")}>
												Currency{sortIcon("currency")}
											</ThSort>
											<ThSort onClick={() => handleSort("amount")} align="right">
												Amount{sortIcon("amount")}
											</ThSort>
											<th className="px-4 py-2 font-medium">Tx Digest</th>
										</tr>
									</thead>
									<tbody>
										{filtered.map((tx, i) => {
											const meta = coinMeta[tx.coinType];
											const symbol = meta?.symbol ?? extractTokenName(tx.coinType);
											const decimals = meta?.decimals ?? 0;
											const isPositive = tx.amount > 0n;
											const absAmount = tx.amount < 0n ? -tx.amount : tx.amount;
											const displayAmt =
												decimals > 0
													? formatBalance(absAmount, decimals)
													: absAmount.toLocaleString();
											const date = new Date(tx.timestampMs);
											const timeStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
											return (
												<tr
													key={`${tx.digest}-${tx.coinType}-${i}`}
													className="border-b border-zinc-800/30 hover:bg-zinc-800/20"
												>
													<td className="whitespace-nowrap px-4 py-2.5 text-zinc-400">{timeStr}</td>
													<td className="px-4 py-2.5 text-zinc-300">{symbol}</td>
													<td className="whitespace-nowrap px-4 py-2.5 text-right font-mono">
														<span
															className={`inline-flex items-center gap-1 ${isPositive ? "text-emerald-400" : "text-red-400"}`}
														>
															{isPositive ? (
																<ArrowDownLeft size={12} />
															) : (
																<ArrowUpRight size={12} />
															)}
															{isPositive ? "+" : "-"}
															{displayAmt}
														</span>
													</td>
													<td className="px-4 py-2.5">
														<CopyAddress
															address={tx.digest}
															sliceStart={8}
															sliceEnd={6}
															explorerUrl={`https://testnet.suivision.xyz/txblock/${tx.digest}`}
															className="text-zinc-600"
														/>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</div>

					{/* Info Box */}
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
						<div className="flex items-start gap-3">
							<Info size={16} className="mt-0.5 shrink-0 text-zinc-600" />
							<p className="text-xs text-zinc-500">
								Read-only view of on-chain balances for{" "}
								<span className="text-zinc-400">{activeCharacter.characterName}</span>. Connect EVE
								Vault only when signing transactions.
							</p>
						</div>
					</div>
				</>
			)}

			{showTransfer && suiAddress && (
				<TransferDialog
					balances={visibleBalances}
					coinMeta={coinMeta}
					senderAddress={suiAddress}
					onClose={() => {
						setShowTransfer(false);
						fetchBalances();
					}}
				/>
			)}
		</div>
	);
}

function ThSort({
	children,
	onClick,
	align,
}: { children: React.ReactNode; onClick: () => void; align?: "right" }) {
	return (
		<th
			className={`cursor-pointer select-none px-4 py-2 font-medium hover:text-zinc-300 ${
				align === "right" ? "text-right" : ""
			}`}
			onClick={onClick}
		>
			{children}
		</th>
	);
}
