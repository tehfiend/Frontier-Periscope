import {
	type CoinBalance,
	type CoinMeta,
	CoinTransferDialog,
} from "@/components/CoinTransferDialog";
import { CopyAddress } from "@/components/CopyAddress";
import { getTenant } from "@/lib/constants";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import {
	type TenantId,
	type WalletTransaction,
	getContractAddresses,
	getObjectJson,
	queryDecommissionedMarkets,
	queryMarkets,
	queryWalletTransactions,
} from "@tehfrontier/chain-shared";
import { useCallback, useEffect, useMemo, useState } from "react";

// ── Helpers ─────────────────────────────────────────────────────────────────

import { extractTokenName, formatBalance, isSuiCoin } from "@/lib/coin-utils";

type SortField = "time" | "amount" | "currency";
type SortDir = "asc" | "desc";

interface FlatTx {
	digest: string;
	timestampMs: number;
	coinType: string;
	amount: bigint;
}

// ── Component ───────────────────────────────────────────────────────────────

export function WalletTab() {
	const client = useSuiClient();
	const account = useCurrentAccount();
	const walletAddress = account?.address;

	const [showTransfer, setShowTransfer] = useState(false);
	const [balances, setBalances] = useState<CoinBalance[]>([]);
	const [coinMeta, setCoinMeta] = useState<Record<string, CoinMeta>>({});
	const [loading, setLoading] = useState(false);
	const [fetching, setFetching] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Valid coin types from active (non-decommissioned) markets
	const [validCoinTypes, setValidCoinTypes] = useState<Set<string> | null>(null);

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
		if (!walletAddress) return;
		setFetching(true);
		setError(null);
		try {
			const result = await client.listBalances({ owner: walletAddress });
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
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setFetching(false);
			setLoading(false);
		}
	}, [walletAddress, client]);

	const fetchTransactions = useCallback(async () => {
		if (!walletAddress) return;
		setTxLoading(true);
		setTxError(null);
		try {
			const result = await queryWalletTransactions(client, walletAddress, { limit: 50 });
			setRawTxs(result.data);

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
			setTxError(err instanceof Error ? err.message : String(err));
		} finally {
			setTxLoading(false);
		}
	}, [walletAddress, client]);

	useEffect(() => {
		if (walletAddress) {
			setLoading(true);
			fetchBalances();
			fetchTransactions();
		} else {
			setBalances([]);
			setRawTxs([]);
			setLoading(false);
		}
	}, [walletAddress, fetchBalances, fetchTransactions]);

	// Discover active market coin types (same approach as Periscope Wallet)
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const addrs = getContractAddresses(getTenant() as TenantId);

				// Discover all markets across current + previous package lineages
				const marketCfg = addrs.market;
				const pkgIds = [
					marketCfg?.packageId,
					...(marketCfg?.previousOriginalPackageIds ?? []),
				].filter(Boolean) as string[];

				const allCoinTypes = new Set<string>();
				const allMarketIds = new Set<string>();
				for (const pkgId of pkgIds) {
					const markets = await queryMarkets(client, pkgId);
					for (const m of markets) {
						if (allMarketIds.has(m.objectId)) continue;
						allMarketIds.add(m.objectId);
						if (m.coinType) allCoinTypes.add(m.coinType);
					}
				}

				// Remove decommissioned market coin types
				const decomPkg = addrs.decommission?.packageId;
				if (decomPkg) {
					const decomMarketIds = await queryDecommissionedMarkets(client, decomPkg);
					for (const mId of decomMarketIds) {
						try {
							const obj = await getObjectJson(client, mId);
							const match = obj.type?.match(/::(?:market_standings|market)::Market<(.+)>$/);
							if (match) allCoinTypes.delete(match[1]);
						} catch { /* skip */ }
					}
				}

				if (!cancelled) setValidCoinTypes(allCoinTypes);
			} catch { /* non-fatal */ }
		})();
		return () => { cancelled = true; };
	}, [client]);

	// ── Flatten transactions ────────────────────────────────────────────────

	const { flatTxs, txCoinTypes } = useMemo(() => {
		const flat: FlatTx[] = [];
		const types = new Set<string>();
		for (const tx of rawTxs) {
			for (const bc of tx.balanceChanges) {
				if (validCoinTypes && !isSuiCoin(bc.coinType) && !validCoinTypes.has(bc.coinType)) continue;
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
	}, [rawTxs, validCoinTypes]);

	// ── Filter + sort ───────────────────────────────────────────────────────

	// Stabilize coinMeta dependency -- only recompute when the serialized meta changes,
	// not on every object reference change from setCoinMeta merges
	const coinMetaKey = useMemo(() => JSON.stringify(coinMeta), [coinMeta]);

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
				case "amount": {
					const diff = a.amount - b.amount;
					return (diff < 0n ? -1 : diff > 0n ? 1 : 0) * dir;
				}
				case "currency": {
					const sa = coinMeta[a.coinType]?.symbol ?? extractTokenName(a.coinType);
					const sb = coinMeta[b.coinType]?.symbol ?? extractTokenName(b.coinType);
					return sa.localeCompare(sb) * dir;
				}
				default:
					return 0;
			}
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [flatTxs, filterCoin, filterDir, search, sortField, sortDir, coinMetaKey]);

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

	// ── No wallet connected ─────────────────────────────────────────────────

	if (!walletAddress) {
		return (
			<div className="flex h-48 items-center justify-center">
				<p className="text-sm text-zinc-500">Connect your wallet to view balances</p>
			</div>
		);
	}

	// ── Derived data ────────────────────────────────────────────────────────

	const activeBalances = validCoinTypes
		? balances.filter((b) => isSuiCoin(b.coinType) || validCoinTypes.has(b.coinType))
		: balances;
	const suiBalance = activeBalances.find((b) => isSuiCoin(b.coinType));
	const suiMist = suiBalance?.totalBalance ?? "0";
	const suiHuman = formatBalance(suiMist, 9);
	const tokenCount = activeBalances.length;

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<CopyAddress
						address={walletAddress}
						sliceStart={10}
						sliceEnd={6}
						explorerUrl={`https://suiscan.xyz/testnet/account/${walletAddress}`}
						className="text-sm text-zinc-300"
					/>
					<p className="mt-0.5 text-[10px] text-zinc-600">
						{loading
							? "Loading balances..."
							: `${tokenCount} coin type${tokenCount !== 1 ? "s" : ""}`}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setShowTransfer(true)}
						className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
					>
						Send
					</button>
					<button
						type="button"
						onClick={() => {
							fetchBalances();
							fetchTransactions();
						}}
						disabled={fetching || txLoading}
						className="rounded-lg bg-cyan-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
					>
						{fetching || txLoading ? "..." : "Refresh"}
					</button>
				</div>
			</div>

			{/* Error banner */}
			{error && (
				<div className="rounded border border-red-900/50 bg-red-950/20 p-3">
					<p className="text-xs text-red-400">{error}</p>
				</div>
			)}

			{/* Loading state */}
			{loading ? (
				<div className="flex items-center justify-center py-8">
					<div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
					<span className="ml-2 text-xs text-zinc-400">Fetching balances...</span>
				</div>
			) : (
				<>
					{/* SUI Balance Card */}
					<div className="rounded-lg border border-zinc-800 bg-zinc-800/50 p-3">
						<p className="text-[10px] text-zinc-500">SUI Balance</p>
						<p className="mt-0.5 text-lg font-bold text-zinc-100">{suiHuman} SUI</p>
						<p className="font-mono text-[10px] text-zinc-600">
							{BigInt(suiMist).toLocaleString()} MIST
						</p>
					</div>

					{/* Token Balances Table */}
					<div className="rounded-lg border border-zinc-800 bg-zinc-800/30">
						<div className="border-b border-zinc-800 px-3 py-2">
							<h3 className="text-xs font-medium text-zinc-400">Token Balances</h3>
						</div>
						{activeBalances.length === 0 ? (
							<div className="px-3 py-6 text-center text-xs text-zinc-600">
								No coins found in this wallet.
							</div>
						) : (
							<table className="w-full">
								<thead>
									<tr className="border-b border-zinc-800 text-left text-[10px] text-zinc-500">
										<th className="px-3 py-1.5 font-medium">Coin Type</th>
										<th className="px-3 py-1.5 font-medium">Balance</th>
									</tr>
								</thead>
								<tbody>
									{activeBalances.map((b) => {
										const meta = coinMeta[b.coinType];
										const name = meta?.symbol || extractTokenName(b.coinType);
										const dec = meta?.decimals ?? 9;
										const isSui = isSuiCoin(b.coinType);
										const displayBal = `${formatBalance(b.totalBalance, dec)} ${isSui ? "SUI" : name}`;

										return (
											<tr key={b.coinType} className="border-b border-zinc-800/50 last:border-b-0">
												<td className="px-3 py-2">
													<span className="text-xs font-medium text-zinc-200">
														{meta?.name || name}
													</span>
													{meta?.symbol && meta.symbol !== (meta.name || name) && (
														<span className="ml-1 text-[10px] text-zinc-500">({meta.symbol})</span>
													)}
													{!isSui && (
														<span
															className="ml-1.5 block truncate font-mono text-[10px] text-zinc-600"
															title={b.coinType}
														>
															{b.coinType.length > 50
																? `${b.coinType.slice(0, 20)}...${b.coinType.slice(-16)}`
																: b.coinType}
														</span>
													)}
												</td>
												<td className="px-3 py-2 font-mono text-xs text-zinc-200">{displayBal}</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						)}
					</div>

					{/* Currency Transactions */}
					<div className="rounded-lg border border-zinc-800 bg-zinc-800/30">
						<div className="border-b border-zinc-800 px-3 py-2">
							<h3 className="text-xs font-medium text-zinc-400">Currency Transactions</h3>
						</div>

						{/* Filters */}
						<div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/50 px-3 py-2">
							<select
								value={filterCoin}
								onChange={(e) => setFilterCoin(e.target.value)}
								className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200 focus:border-cyan-500 focus:outline-none"
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
								className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200 focus:border-cyan-500 focus:outline-none"
							>
								<option value="all">All</option>
								<option value="in">Received</option>
								<option value="out">Sent</option>
							</select>

							<input
								type="text"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search digest..."
								className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>

							<span className="text-[10px] text-zinc-600">
								{filtered.length}/{flatTxs.length}
							</span>
						</div>

						{/* Grid */}
						{txLoading ? (
							<div className="flex items-center justify-center py-6">
								<div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
								<span className="ml-2 text-[10px] text-zinc-500">Loading transactions...</span>
							</div>
						) : txError ? (
							<div className="px-3 py-4 text-center text-[10px] text-red-400">{txError}</div>
						) : filtered.length === 0 ? (
							<div className="px-3 py-6 text-center text-[10px] text-zinc-600">
								{flatTxs.length === 0
									? "No currency transactions found."
									: "No transactions match filters."}
							</div>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full text-left text-[10px]">
									<thead>
										<tr className="border-b border-zinc-800 text-[10px] text-zinc-500 uppercase">
											<ThSort onClick={() => handleSort("time")}>Time{sortIcon("time")}</ThSort>
											<ThSort onClick={() => handleSort("currency")}>
												Currency{sortIcon("currency")}
											</ThSort>
											<ThSort onClick={() => handleSort("amount")} align="right">
												Amount{sortIcon("amount")}
											</ThSort>
											<th className="px-3 py-1.5 font-medium">Tx</th>
										</tr>
									</thead>
									<tbody>
										{filtered.map((tx, i) => {
											const meta = coinMeta[tx.coinType];
											const sym = meta?.symbol ?? extractTokenName(tx.coinType);
											const dec = meta?.decimals ?? 0;
											const isPositive = tx.amount > 0n;
											const absAmount = tx.amount < 0n ? -tx.amount : tx.amount;
											const displayAmt =
												dec > 0 ? formatBalance(absAmount, dec) : absAmount.toLocaleString();
											const date = new Date(tx.timestampMs);
											const timeStr = `${date.toLocaleDateString([], { month: "numeric", day: "numeric" })} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
											return (
												<tr
													key={`${tx.digest}-${tx.coinType}-${i}`}
													className="border-b border-zinc-800/30 hover:bg-zinc-800/20"
												>
													<td className="whitespace-nowrap px-3 py-2 text-zinc-400">{timeStr}</td>
													<td className="px-3 py-2 text-zinc-300">{sym}</td>
													<td className="whitespace-nowrap px-3 py-2 text-right font-mono">
														<span className={isPositive ? "text-emerald-400" : "text-red-400"}>
															{isPositive ? "+" : "-"}
															{displayAmt}
														</span>
													</td>
													<td className="px-3 py-2">
														<CopyAddress
															address={tx.digest}
															sliceStart={6}
															sliceEnd={4}
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
				</>
			)}

			{/* Transfer Dialog */}
			{showTransfer && walletAddress && (
				<CoinTransferDialog
					balances={balances}
					coinMeta={coinMeta}
					senderAddress={walletAddress}
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
			className={`cursor-pointer select-none px-3 py-1.5 font-medium hover:text-zinc-300 ${
				align === "right" ? "text-right" : ""
			}`}
			onClick={onClick}
			onKeyDown={(e) => e.key === "Enter" && onClick()}
		>
			{children}
		</th>
	);
}
