import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
	Ban,
	ChevronDown,
	ChevronUp,
	Coins,
	Flame,
	Loader2,
	Plus,
	RefreshCw,
	Send,
	Settings,
	UserMinus,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { TenantId } from "@/chain/config";
import { syncCurrenciesFromManifest } from "@/chain/currency-sync";
import { discoverExchangePairs, fetchExchangeOrders } from "@/chain/exchange-queries";
import { ContactPicker } from "@/components/ContactPicker";
import { CopyAddress } from "@/components/CopyAddress";
import { ErrorMessage } from "@/components/ErrorMessage";
import { type ColumnDef, DataGrid, excelFilterFn } from "@/components/DataGrid";
import { ConnectWalletButton } from "@/components/WalletConnect";
import { db, notDeleted } from "@/db";
import { walletErrorMessage } from "@/lib/format";
import type { CurrencyRecord, ManifestExchangePair, ManifestMarket } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useMarketTenantMap } from "@/hooks/useMarketTenantMap";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import {
	buildAddAuthorized,
	buildBurn,
	buildCreateMarket,
	buildCreateTreasury,
	buildDecommission,
	buildMint,
	buildMintToTreasury,
	buildPublishToken,
	buildRecommission,
	buildRemoveAuthorized,
	buildAddTreasuryAdmin,
	buildRemoveTreasuryAdmin,
	buildTreasuryDeposit,
	buildTreasuryWithdraw,
	buildUpdateFee,
	getContractAddresses,
	parsePublishResult,
	queryDecommissionedMarkets,
	queryMarketBuyOrders,
	queryMarketDetails,
	queryMarketListings,
	queryMarkets,
	queryOwnedCoins,
	queryTreasuryBalances,
	queryTreasuryCap,
	queryTreasuryDetails,
	discoverTreasuries,
} from "@tehfrontier/chain-shared";
import type {
	MarketBuyOrder,
	MarketInfo,
	MarketSellListing,
	OrderInfo,
	TreasuryBalance,
	TreasuryInfo,
} from "@tehfrontier/chain-shared";

// ── Types ────────────────────────────────────────────────────────────────────

type BuildStatus = "idle" | "building" | "minting" | "burning" | "done" | "error";

interface UnifiedCurrencyRow {
	id: string;
	coinType: string;
	symbol: string;
	name: string;
	totalSupply?: string;
	treasuryBalance?: string;
	creator: string;
	creatorName?: string;
	feeBps: number;
	status: "mine" | "authorized" | "public";
	decommissioned: boolean;
	currencyRecordId?: string;
	treasuryId?: string;
	packageId: string;
	decimals: number;
	marketId?: string;
}

interface MarketOrderRow {
	id: string;
	type: "Sell" | "Buy";
	itemName: string;
	typeId: number;
	quantity: number;
	pricePerUnit: bigint;
	by: string;
	byAddress: string;
	location: string;
	timestamp: Date;
}

interface ExchangeOrderRow {
	id: string;
	side: "Bid" | "Ask";
	price: number;
	amount: number;
	owner: string;
	ownerName?: string;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function formatTokenAmount(raw: bigint, decimals: number): string {
	if (decimals === 0) return raw.toLocaleString("en-US");
	const divisor = 10n ** BigInt(decimals);
	const whole = raw / divisor;
	const frac = raw % divisor;
	const wholeStr = whole.toLocaleString("en-US");
	if (frac === 0n) return wholeStr;
	const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${wholeStr}.${fracStr}`;
}

function formatPrice(raw: bigint, decimals: number): string {
	if (decimals === 0) return raw.toLocaleString("en-US");
	const divisor = 10n ** BigInt(decimals);
	const whole = raw / divisor;
	const frac = raw % divisor;
	const wholeStr = whole.toLocaleString("en-US");
	if (frac === 0n) return wholeStr;
	const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${wholeStr}.${fracStr}`;
}

// ── Shared UI Components ─────────────────────────────────────────────────────

function StatusBanner({
	status,
	error,
	onDismiss,
}: {
	status: BuildStatus;
	error: string;
	onDismiss: () => void;
}) {
	const messages: Record<string, string> = {
		building: "Building and publishing token on-chain...",
		minting: "Minting tokens...",
		burning: "Burning tokens...",
		error: "Operation failed",
	};

	const isError = status === "error";

	return (
		<div
			className={`rounded-lg border p-4 ${
				isError ? "border-red-900/50 bg-red-950/20" : "border-cyan-900/50 bg-cyan-950/20"
			}`}
		>
			<div className="flex items-center gap-2">
				{isError ? (
					<AlertCircle size={16} className="text-red-400" />
				) : (
					<Loader2 size={16} className="animate-spin text-cyan-400" />
				)}
				<span className={`text-sm ${isError ? "text-red-300" : "text-cyan-300"}`}>
					{messages[status] ?? "Processing..."}
				</span>
			</div>
			{error && (
				<p className="mt-2 text-xs text-red-400">
					<ErrorMessage text={error} />
				</p>
			)}
			{isError && (
				<button
					type="button"
					onClick={onDismiss}
					className="mt-2 text-xs text-zinc-400 hover:text-zinc-300"
				>
					Dismiss
				</button>
			)}
		</div>
	);
}

function StatBox({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5">
			<p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
			<p className="mt-0.5 text-sm font-semibold text-zinc-200">{value}</p>
		</div>
	);
}

function AdminToggle({
	active,
	onClick,
	icon,
	label,
	color,
}: {
	active: boolean;
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
	color: "cyan" | "red" | "amber" | "purple";
}) {
	const colorMap = {
		cyan: {
			active: "bg-cyan-600/20 text-cyan-400",
			idle: "bg-zinc-800 text-zinc-400 hover:text-zinc-200",
		},
		red: {
			active: "bg-red-600/20 text-red-400",
			idle: "bg-zinc-800 text-zinc-400 hover:text-zinc-200",
		},
		amber: {
			active: "bg-amber-600/20 text-amber-400",
			idle: "bg-zinc-800 text-zinc-400 hover:text-zinc-200",
		},
		purple: {
			active: "bg-purple-600/20 text-purple-400",
			idle: "bg-zinc-800 text-zinc-400 hover:text-zinc-200",
		},
	};

	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
				active ? colorMap[color].active : colorMap[color].idle
			}`}
		>
			{icon}
			{label}
		</button>
	);
}

function AdminPanel({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
			<h4 className="mb-3 text-xs font-medium text-zinc-400">{title}</h4>
			{children}
		</div>
	);
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="block">
			<span className="mb-1 block text-xs text-zinc-500">{label}</span>
			{children}
		</div>
	);
}

// ── Main Component ───────────────────────────────────────────────────────────

export function Currencies() {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute, connectWallet } = useDAppKit();
	const wallets = useWallets();
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const walletAddress = account?.address;
	const tenant = useActiveTenant();
	const { isOnTenant } = useMarketTenantMap();
	const suiClient = useSuiClient();

	// ── Data from IndexedDB ──────────────────────────────────────────────────
	const manifestMarkets = useLiveQuery(() => db.manifestMarkets.toArray()) ?? [];
	const currencies = useLiveQuery(() => db.currencies.filter(notDeleted).toArray()) ?? [];
	const manifestChars = useLiveQuery(() => db.manifestCharacters.toArray()) ?? [];
	const exchangePairs = useLiveQuery(() => db.manifestExchangePairs.toArray()) ?? [];
	const treasuries = useLiveQuery(() => db.treasuries.toArray()) ?? [];

	// ── State ────────────────────────────────────────────────────────────────
	const [showDecommissioned, setShowDecommissioned] = useState(false);
	const [decommissionedSet, setDecommissionedSet] = useState<Set<string>>(new Set());
	const [decommissionedLoaded, setDecommissionedLoaded] = useState(false);
	const [selectedCurrencyId, setSelectedCurrencyId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [symbol, setSymbol] = useState("");
	const [tokenName, setTokenName] = useState("");
	const [description, setDescription] = useState("");
	const [decimals, setDecimals] = useState(2);
	const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
	const [buildError, setBuildError] = useState("");
	const [isSyncing, setIsSyncing] = useState(false);

	const isProcessing =
		buildStatus === "building" || buildStatus === "minting" || buildStatus === "burning";

	// ── Character name lookup ────────────────────────────────────────────────
	const charNameMap = useMemo(() => {
		const m = new Map<string, string>();
		for (const c of manifestChars) {
			if (c.suiAddress && c.name) m.set(c.suiAddress, c.name);
		}
		return m;
	}, [manifestChars]);

	// ── Build unified rows ───────────────────────────────────────────────────
	const unifiedRows = useMemo<UnifiedCurrencyRow[]>(() => {
		// Index currencies by coinType for fast join
		const currencyByCoinType = new Map<string, CurrencyRecord>();
		for (const c of currencies) {
			currencyByCoinType.set(c.coinType, c);
		}

		// Index manifest markets by coinType
		const marketByCoinType = new Map<string, ManifestMarket>();
		for (const m of manifestMarkets) {
			marketByCoinType.set(m.coinType, m);
		}

		// Index treasuries by coinType (1:1 relationship)
		const treasuryByCoinType = new Map<string, { id: string; balance?: string }>();
		for (const t of treasuries) {
			if (!t.coinType) continue;
			const bal = t.balances.find((b) => b.coinType === t.coinType);
			treasuryByCoinType.set(t.coinType, {
				id: t.id,
				balance: bal?.amount,
			});
		}

		// Collect all unique coinTypes
		const allCoinTypes = new Set<string>();
		for (const m of manifestMarkets) allCoinTypes.add(m.coinType);
		for (const c of currencies) allCoinTypes.add(c.coinType);

		const rows: UnifiedCurrencyRow[] = [];

		for (const coinType of allCoinTypes) {
			const market = marketByCoinType.get(coinType);
			const currency = currencyByCoinType.get(coinType);
			const treasury = treasuryByCoinType.get(coinType);

			// Determine status relative to the active character
			let status: "mine" | "authorized" | "public" = "public";
			if (suiAddress && market) {
				if (market.creator === suiAddress || market.creator === walletAddress) {
					status = "mine";
				} else if (
					market.authorized.includes(suiAddress) ||
					(walletAddress && market.authorized.includes(walletAddress))
				) {
					status = "authorized";
				}
			} else if (suiAddress && currency && !market) {
				// Currency record without manifest market -- likely user-created
				status = "mine";
			}

			const marketObjectId = market?.id ?? currency?.marketId;
			const decommissioned = marketObjectId ? decommissionedSet.has(marketObjectId) : false;
			const creator = market?.creator ?? "";
			const parts = coinType.split("::");
			const pkgId = currency?.packageId ?? parts[0] ?? "";
			const structName = parts.length >= 3 ? parts[2] : (parts[1] ?? "");
			const sym = currency?.symbol ?? structName.replace(/_TOKEN$/, "");

			rows.push({
				id: currency?.id ?? market?.id ?? coinType,
				coinType,
				symbol: sym,
				name: currency?.name ?? `${sym} Token`,
				totalSupply: market?.totalSupply,
				treasuryBalance: treasury?.balance,
				creator,
				creatorName: charNameMap.get(creator),
				feeBps: market?.feeBps ?? 0,
				status,
				decommissioned,
				currencyRecordId: currency?.id,
				treasuryId: treasury?.id ?? currency?.treasuryId,
				packageId: pkgId,
				decimals: currency?.decimals ?? 9,
				marketId: currency?.marketId ?? market?.id,
			});
		}

		return rows;
	}, [manifestMarkets, currencies, treasuries, decommissionedSet, suiAddress, walletAddress, charNameMap]);

	// ── Filtered rows (decommission toggle) ─────────────────────────────────
	// Hide all rows with a marketId until decommissioned set is loaded to prevent flash
	const filteredRows = useMemo(
		() =>
			unifiedRows.filter((r) => {
				if (!isOnTenant(r.marketId, tenant)) return false;
				if (r.decommissioned && !showDecommissioned) return false;
				if (!decommissionedLoaded && r.marketId) return false;
				return true;
			}),
		[unifiedRows, showDecommissioned, decommissionedLoaded, isOnTenant, tenant],
	);

	// ── Sync ─────────────────────────────────────────────────────────────────
	const addresses = getContractAddresses(tenant);

	const handleSync = useCallback(async () => {
		setIsSyncing(true);
		try {
			if (suiAddress) {
				await syncCurrenciesFromManifest(suiClient, suiAddress, walletAddress);
			}
			await discoverExchangePairs(suiClient, tenant);
			// Query on-chain decommission registry via events
			const decomPkgId = addresses.decommission?.packageId;
			if (decomPkgId) {
				const set = await queryDecommissionedMarkets(suiClient, decomPkgId);
				setDecommissionedSet(set);
			}
			setDecommissionedLoaded(true);
		} catch {
			// Silent
		} finally {
			setIsSyncing(false);
		}
	}, [suiClient, suiAddress, walletAddress, tenant, addresses.decommission?.registryObjectId]);

	// Auto-sync on mount
	useEffect(() => {
		handleSync();
	}, [handleSync]);

	// ── Auto-select first row ────────────────────────────────────────────────
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedCurrencyId intentionally omitted
	useEffect(() => {
		if (!selectedCurrencyId && filteredRows.length > 0) {
			setSelectedCurrencyId(filteredRows[0].id);
		}
	}, [filteredRows]);

	// ── Decommission toggle ─────────────────────────────────────────────────
	const handleDecommission = async (row: UnifiedCurrencyRow, decommission: boolean) => {
		if (!row.marketId) return;
		const decomPkg = addresses.decommission;
		if (!decomPkg?.packageId || !decomPkg.registryObjectId) return;

		// Connect wallet if needed
		let senderAddress = account?.address;
		if (!senderAddress) {
			const eveVault = wallets.find(
				(w) => w.name === "Eve Vault" || w.name.includes("Eve Frontier"),
			);
			const wallet = eveVault || wallets[0];
			if (!wallet) return;
			const result = await connectWallet({ wallet });
			senderAddress = result.accounts[0]?.address;
			if (!senderAddress) return;
		}

		setBuildStatus("building");
		setBuildError("");

		try {
			const tx = decommission
				? buildDecommission({
						packageId: decomPkg.packageId,
						registryObjectId: decomPkg.registryObjectId,
						marketId: row.marketId,
						senderAddress,
					})
				: buildRecommission({
						packageId: decomPkg.packageId,
						registryObjectId: decomPkg.registryObjectId,
						marketId: row.marketId,
						senderAddress,
					});

			await signAndExecute({ transaction: tx });

			// Update local state immediately
			setDecommissionedSet((prev) => {
				const next = new Set(prev);
				if (decommission) {
					next.add(row.marketId!);
				} else {
					next.delete(row.marketId!);
				}
				return next;
			});

			if (decommission && selectedCurrencyId === row.id) setSelectedCurrencyId(null);
			setBuildStatus("done");
		} catch (err) {
			setBuildStatus("error");
			setBuildError(walletErrorMessage(err));
		}
	};

	// ── Create currency ──────────────────────────────────────────────────────
	async function handleCreateCurrency() {
		if (!symbol.trim() || !tokenName.trim()) return;

		// Connect wallet if needed
		if (!account?.address) {
			const eveVault = wallets.find(
				(w) => w.name === "Eve Vault" || w.name.includes("Eve Frontier"),
			);
			const wallet = eveVault || wallets[0];
			if (!wallet) return;
			await connectWallet({ wallet });
		}

		setBuildStatus("building");
		setBuildError("");

		try {
			const sym = symbol.trim().toUpperCase();
			const tx = await buildPublishToken({
				symbol: sym,
				name: tokenName.trim(),
				description: description.trim() || `${tokenName.trim()} token`,
				decimals,
			});

			// Append treasury creation to the same PTB (single wallet prompt)
			const treasuryPkg = addresses.treasury?.packageId;
			if (treasuryPkg) {
				tx.moveCall({
					target: `${treasuryPkg}::treasury::create_treasury`,
					arguments: [
						tx.pure.vector("u8", Array.from(new TextEncoder().encode(`${sym} Treasury`))),
					],
				});
			}

			const result = await signAndExecute({ transaction: tx });

			const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";
			const fullResult = await suiClient.waitForTransaction({
				digest,
				include: { effects: true, objectTypes: true },
			});
			const fullTx = fullResult.Transaction ?? fullResult.FailedTransaction;
			const changedObjects = fullTx?.effects?.changedObjects ?? [];
			const objectTypesMap = fullTx?.objectTypes ?? {};

			const objectChanges: Array<{
				type: string;
				packageId?: string;
				objectType?: string;
				objectId?: string;
				modules?: string[];
			}> = changedObjects.map((change) => {
				if (change.outputState === "PackageWrite" && change.idOperation === "Created") {
					return { type: "published", packageId: change.objectId };
				}
				return {
					type: change.idOperation === "Created" ? "created" : "mutated",
					objectId: change.objectId,
					objectType: objectTypesMap[change.objectId],
				};
			});

			const parsed = parsePublishResult(objectChanges);
			if (!parsed) {
				throw new Error(
					"Token published but could not parse result." + " Check transaction on explorer.",
				);
			}

			// Find the Treasury object created in the same TX
			let newTreasuryId: string | undefined;
			for (const change of objectChanges) {
				if (
					change.type === "created" &&
					change.objectType?.includes("::treasury::Treasury")
				) {
					newTreasuryId = change.objectId;
					break;
				}
			}

			if (newTreasuryId && suiAddress) {
				await db.treasuries.put({
					id: newTreasuryId,
					name: `${sym} Treasury`,
					owner: suiAddress,
					admins: [],
					balances: [],
					coinType: parsed.coinType,
				});
			}

			const now = new Date().toISOString();
			await db.currencies.add({
				id: crypto.randomUUID(),
				symbol: sym,
				name: tokenName.trim(),
				description: description.trim(),
				moduleName: parsed.moduleName,
				coinType: parsed.coinType,
				packageId: parsed.packageId,
				marketId: parsed.marketId,
				treasuryId: newTreasuryId,
				decimals,
				createdAt: now,
				updatedAt: now,
			});

			setSymbol("");
			setTokenName("");
			setDescription("");
			setCreating(false);
			setBuildStatus("done");
		} catch (err) {
			setBuildStatus("error");
			setBuildError(walletErrorMessage(err));
		}
	}

	// ── DataGrid columns ─────────────────────────────────────────────────────
	const columns = useMemo<ColumnDef<UnifiedCurrencyRow, unknown>[]>(
		() => [
			{
				accessorKey: "symbol",
				header: "Symbol",
				size: 80,
				filterFn: excelFilterFn,
				cell: ({ row }) => <span className="font-medium text-zinc-100">{row.original.symbol}</span>,
			},
			{
				accessorKey: "name",
				header: "Name",
				size: 150,
				filterFn: excelFilterFn,
			},
			{
				accessorKey: "totalSupply",
				header: "Total Supply",
				size: 120,
				enableColumnFilter: false,
				cell: ({ row }) => {
					const { totalSupply, decimals } = row.original;
					if (totalSupply == null) return <span className="text-zinc-600">--</span>;
					return (
						<span className="font-mono text-xs">
							{formatTokenAmount(BigInt(totalSupply), decimals)}
						</span>
					);
				},
			},
			{
				accessorKey: "treasuryBalance",
				header: "Treasury",
				size: 110,
				enableColumnFilter: false,
				cell: ({ row }) => {
					const { treasuryBalance, decimals, symbol } = row.original;
					if (!treasuryBalance) return <span className="text-zinc-600">--</span>;
					return (
						<span className="font-mono text-xs">
							{formatTokenAmount(BigInt(treasuryBalance), decimals)}
						</span>
					);
				},
			},
			{
				accessorKey: "feeBps",
				header: "Fee (bps)",
				size: 80,
				enableColumnFilter: false,
				cell: ({ row }) => <span className="font-mono text-xs">{row.original.feeBps}</span>,
			},
			{
				id: "creator",
				accessorFn: (row) => row.creatorName ?? row.creator,
				header: "Creator",
				size: 120,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const { creator, creatorName } = row.original;
					if (creatorName) {
						return (
							<span className="text-xs" title={creator}>
								{creatorName}
							</span>
						);
					}
					if (!creator) return <span className="text-zinc-600">--</span>;
					return (
						<CopyAddress
							address={creator}
							sliceStart={6}
							sliceEnd={4}
							className="text-xs text-zinc-500"
						/>
					);
				},
			},
			{
				accessorKey: "status",
				header: "Status",
				size: 90,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					if (row.original.decommissioned) {
						return (
							<span className="rounded bg-red-900/40 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
								decommissioned
							</span>
						);
					}
					const s = row.original.status;
					const colorMap = {
						mine: "bg-cyan-900/40 text-cyan-400",
						authorized: "bg-amber-900/40 text-amber-400",
						public: "bg-zinc-800 text-zinc-500",
					};
					return (
						<span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${colorMap[s]}`}>
							{s}
						</span>
					);
				},
			},
		],
		[],
	);

	const selectedRow = filteredRows.find((r) => r.id === selectedCurrencyId);

	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
			{/* Status Banner */}
			{buildStatus !== "idle" && buildStatus !== "done" && (
				<StatusBanner
					status={buildStatus}
					error={buildError}
					onDismiss={() => {
						setBuildStatus("idle");
						setBuildError("");
					}}
				/>
			)}

			{buildStatus === "done" && (
				<div className="rounded-lg border border-green-900/50 bg-green-950/20 p-4">
					<p className="text-sm text-green-400">Operation completed successfully.</p>
					<button
						type="button"
						onClick={() => setBuildStatus("idle")}
						className="mt-2 text-xs text-zinc-400 hover:text-zinc-300"
					>
						Dismiss
					</button>
				</div>
			)}

			{/* Create Currency Form */}
			{creating && (
				<CreateCurrencyForm
					symbol={symbol}
					tokenName={tokenName}
					description={description}
					decimals={decimals}
					isProcessing={isProcessing}
					onSymbolChange={setSymbol}
					onNameChange={setTokenName}
					onDescChange={setDescription}
					onDecimalsChange={setDecimals}
					onCreate={handleCreateCurrency}
					onCancel={() => setCreating(false)}
				/>
			)}

			{/* DataGrid */}
			<DataGrid
				columns={columns}
				data={filteredRows}
				keyFn={(r) => r.id}
				searchPlaceholder="Search currencies..."
				emptyMessage="No currencies found"
				selectedRowId={selectedCurrencyId ?? undefined}
				onRowClick={(id) => setSelectedCurrencyId(id)}
				actions={
					<>
						{/* Decommissioned toggle */}
						<button
							type="button"
							onClick={() => setShowDecommissioned(!showDecommissioned)}
							title={showDecommissioned ? "Hide decommissioned" : "Show decommissioned"}
							className={`shrink-0 rounded-lg p-2 text-xs transition-colors ${
								showDecommissioned
									? "bg-amber-900/30 text-amber-400"
									: "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
							}`}
						>
							<Ban size={14} />
						</button>

						{/* Create toggle */}
						{creating ? (
							<button
								type="button"
								onClick={() => setCreating(false)}
								className="shrink-0 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
							>
								Cancel
							</button>
						) : (
							<button
								type="button"
								onClick={() => setCreating(true)}
								className="flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-5 py-2 text-sm text-zinc-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
							>
								<Plus size={14} />
								Create Currency
							</button>
						)}

						{/* Refresh */}
						<button
							type="button"
							onClick={handleSync}
							disabled={isSyncing}
							title="Refresh currencies"
							className="shrink-0 rounded-lg p-2 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400 disabled:opacity-50"
						>
							<RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
						</button>
					</>
				}
			/>

			{/* Detail Panel */}
			{selectedRow && (
				<CurrencyDetail
					row={selectedRow}
					tenant={tenant}
					suiAddress={suiAddress}
					charNameMap={charNameMap}
					exchangePairs={exchangePairs}
					onStatusChange={(s, e) => {
						setBuildStatus(s);
						setBuildError(e ?? "");
					}}
					onSync={handleSync}
					onDecommission={(decom) => handleDecommission(selectedRow, decom)}
				/>
			)}
		</div>
	);
}

// ── Currency Detail Panel ────────────────────────────────────────────────────

function CurrencyDetail({
	row,
	tenant,
	suiAddress,
	charNameMap,
	exchangePairs,
	onStatusChange,
	onSync,
	onDecommission,
}: {
	row: UnifiedCurrencyRow;
	tenant: TenantId;
	suiAddress: string | undefined;
	charNameMap: Map<string, string>;
	exchangePairs: ManifestExchangePair[];
	onStatusChange: (status: BuildStatus, error?: string) => void;
	onSync: () => void;
	onDecommission: (decommission: boolean) => void;
}) {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute, connectWallet } = useDAppKit();
	const wallets = useWallets();
	const suiClient = useSuiClient();

	async function ensureWallet(): Promise<boolean> {
		if (account) return true;
		const eveVault = wallets.find(
			(w) => w.name === "Eve Vault" || w.name.includes("Eve Frontier"),
		);
		const wallet = eveVault || wallets[0];
		if (!wallet) return false;
		try {
			await connectWallet({ wallet });
			return true;
		} catch {
			return false;
		}
	}

	const [marketInfo, setMarketInfo] = useState<MarketInfo | null>(null);
	const [loadingMarket, setLoadingMarket] = useState(false);
	const [totalSupply, setTotalSupply] = useState<bigint | null>(null);
	const [sellListings, setSellListings] = useState<MarketSellListing[]>([]);
	const [buyOrders, setBuyOrders] = useState<MarketBuyOrder[]>([]);
	const [loadingOrders, setLoadingOrders] = useState(false);
	const [itemNameMap, setItemNameMap] = useState<Map<number, string>>(new Map());

	// Admin panel state
	const [showMint, setShowMint] = useState(false);
	const [mintAmount, setMintAmount] = useState("");
	const [showBurn, setShowBurn] = useState(false);
	const [burnCoinId, setBurnCoinId] = useState("");
	const [ownedCoins, setOwnedCoins] = useState<Array<{ objectId: string; balance: bigint }>>([]);
	const [loadingCoins, setLoadingCoins] = useState(false);
	const [showAuth, setShowAuth] = useState(false);
	const [authAddress, setAuthAddress] = useState("");
	const [showFees, setShowFees] = useState(false);
	const [feeBps, setFeeBps] = useState("");
	const [feeRecipient, setFeeRecipient] = useState("");

	// Treasury state
	const [treasuryId, setTreasuryId] = useState<string | null>(row.treasuryId ?? null);
	const [treasuryInfo, setTreasuryInfo] = useState<TreasuryInfo | null>(null);
	const [treasuryBalances, setTreasuryBalances] = useState<TreasuryBalance[]>([]);
	const [loadingTreasury, setLoadingTreasury] = useState(false);
	const [showDeposit, setShowDeposit] = useState(false);
	const [depositAmount, setDepositAmount] = useState("");
	const [showWithdraw, setShowWithdraw] = useState(false);
	const [withdrawAmount, setWithdrawAmount] = useState("");
	const [showTreasuryAdmins, setShowTreasuryAdmins] = useState(false);
	const [treasuryAdminAddress, setTreasuryAdminAddress] = useState("");

	// Exchange section
	const [exchangeOrders, setExchangeOrders] = useState<Map<string, OrderInfo[]>>(new Map());
	const [loadingExchange, setLoadingExchange] = useState(false);
	const [expandedPair, setExpandedPair] = useState<string | null>(null);

	const hasMarket = !!row.marketId;
	const addresses = getContractAddresses(tenant);
	const marketPkg = addresses.market?.packageId;
	const isCreator = !!suiAddress && marketInfo?.creator === suiAddress;
	const isAuthorized = isCreator || (!!suiAddress && (marketInfo?.authorized ?? []).includes(suiAddress));

	// SSU location lookup for market orders
	const manifestLocs = useLiveQuery(() => db.manifestLocations.toArray()) ?? [];
	const mapLocs = useLiveQuery(() => db.manifestMapLocations.toArray()) ?? [];
	const systems = useLiveQuery(() => db.solarSystems.toArray()) ?? [];
	const allDeployables = useLiveQuery(() => db.deployables.toArray()) ?? [];

	const SSU_TYPE_NAMES = useMemo(
		() =>
			new Set([
				"Smart Storage Unit",
				"Heavy Storage",
				"Protocol Depot",
				"Portable Storage",
				"Gatekeeper",
			]),
		[],
	);
	const allSsus = useMemo(
		() => allDeployables.filter((d) => SSU_TYPE_NAMES.has(d.assemblyType)),
		[allDeployables, SSU_TYPE_NAMES],
	);

	const ssuLocationMap = useMemo(() => {
		const sysNames = new Map<number, string>();
		for (const s of systems) {
			if (s.name) sysNames.set(s.id, s.name);
		}

		const loc = new Map<string, string>();
		for (const m of manifestLocs) {
			const name = sysNames.get(m.solarsystem);
			if (name) loc.set(m.id, m.lPoint ? `${name} ${m.lPoint}` : name);
		}
		for (const m of mapLocs) {
			if (m.structureId && m.solarSystemId && !loc.has(m.structureId)) {
				const name = sysNames.get(m.solarSystemId);
				if (name) {
					const lp = m.planet && m.lPoint ? ` P${m.planet}L${m.lPoint}` : "";
					loc.set(m.structureId, `${name}${lp}`);
				}
			}
		}
		for (const d of allSsus) {
			if (d.objectId && d.systemId && !loc.has(d.objectId)) {
				const name = sysNames.get(d.systemId);
				if (name) loc.set(d.objectId, d.lPoint ? `${name} ${d.lPoint}` : name);
			}
		}
		return loc;
	}, [manifestLocs, mapLocs, systems, allSsus]);

	// Exchange pairs for this currency
	const currencyPairs = useMemo(
		() => exchangePairs.filter((p) => p.coinTypeA === row.coinType || p.coinTypeB === row.coinType),
		[exchangePairs, row.coinType],
	);

	// Market order rows
	const coinDecimals = row.decimals;
	const coinSymbol = row.symbol;

	const orderRows = useMemo<MarketOrderRow[]>(() => {
		const rows: MarketOrderRow[] = [];
		for (const l of sellListings) {
			rows.push({
				id: `sell-${l.listingId}`,
				type: "Sell",
				itemName: itemNameMap.get(l.typeId) ?? `Item #${l.typeId}`,
				typeId: l.typeId,
				quantity: l.quantity,
				pricePerUnit: l.pricePerUnit,
				by: charNameMap.get(l.seller) ?? l.seller,
				byAddress: l.seller,
				location: ssuLocationMap.get(l.ssuId) ?? "Unknown",
				timestamp: new Date(l.postedAtMs),
			});
		}
		for (const o of buyOrders) {
			rows.push({
				id: `buy-${o.orderId}`,
				type: "Buy",
				itemName: itemNameMap.get(o.typeId) ?? `Item #${o.typeId}`,
				typeId: o.typeId,
				quantity: o.quantity,
				pricePerUnit: o.pricePerUnit,
				by: charNameMap.get(o.buyer) ?? o.buyer,
				byAddress: o.buyer,
				location: "--",
				timestamp: new Date(o.postedAtMs),
			});
		}
		return rows;
	}, [sellListings, buyOrders, itemNameMap, charNameMap, ssuLocationMap]);

	const orderColumns = useMemo<ColumnDef<MarketOrderRow, unknown>[]>(
		() => [
			{
				accessorKey: "type",
				header: "Type",
				size: 56,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const t = row.original.type;
					return (
						<span
							className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
								t === "Sell"
									? "bg-emerald-900/40 text-emerald-400"
									: "bg-amber-900/40 text-amber-400"
							}`}
						>
							{t}
						</span>
					);
				},
			},
			{
				accessorKey: "itemName",
				header: "Item",
				size: 130,
				filterFn: excelFilterFn,
			},
			{
				accessorKey: "quantity",
				header: "Qty",
				size: 56,
				enableColumnFilter: false,
				cell: ({ row }) => row.original.quantity.toLocaleString(),
			},
			{
				id: "price",
				accessorFn: (row) => row.pricePerUnit,
				header: "Price",
				enableColumnFilter: false,
				sortingFn: (a, b) => {
					const av = a.original.pricePerUnit;
					const bv = b.original.pricePerUnit;
					return av < bv ? -1 : av > bv ? 1 : 0;
				},
				size: 100,
				cell: ({ row }) => (
					<span>
						{formatPrice(row.original.pricePerUnit, coinDecimals)} {coinSymbol}
					</span>
				),
			},
			{
				accessorKey: "by",
				header: "By",
				size: 90,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const { by, byAddress } = row.original;
					if (by !== byAddress) {
						return (
							<span className="text-xs" title={byAddress}>
								{by}
							</span>
						);
					}
					return (
						<CopyAddress
							address={byAddress}
							sliceStart={6}
							sliceEnd={4}
							className="text-xs text-zinc-500"
						/>
					);
				},
			},
			{
				accessorKey: "location",
				header: "Location",
				size: 110,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const loc = row.original.location;
					if (loc === "--" || loc === "Unknown") {
						return <span className="text-xs text-zinc-600">{loc}</span>;
					}
					return <span className="text-xs text-zinc-300">{loc}</span>;
				},
			},
			{
				accessorKey: "timestamp",
				header: "Time",
				size: 100,
				enableColumnFilter: false,
				cell: ({ row }) => {
					const d = row.original.timestamp;
					return (
						<span className="whitespace-nowrap text-xs text-zinc-500" title={d.toLocaleString()}>
							{d.toLocaleDateString([], { month: "numeric", day: "numeric" })}{" "}
							{d.toLocaleTimeString([], {
								hour: "2-digit",
								minute: "2-digit",
								hour12: false,
							})}
						</span>
					);
				},
			},
		],
		[coinDecimals, coinSymbol],
	);

	// Exchange order columns
	const exchangeColumns = useMemo<ColumnDef<ExchangeOrderRow, unknown>[]>(
		() => [
			{
				accessorKey: "side",
				header: "Side",
				size: 56,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const s = row.original.side;
					return (
						<span
							className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
								s === "Bid" ? "bg-emerald-900/40 text-emerald-400" : "bg-red-900/40 text-red-400"
							}`}
						>
							{s}
						</span>
					);
				},
			},
			{
				accessorKey: "price",
				header: "Price",
				size: 100,
				enableColumnFilter: false,
				cell: ({ row }) => <span className="font-mono text-xs">{row.original.price}</span>,
			},
			{
				accessorKey: "amount",
				header: "Amount",
				size: 100,
				enableColumnFilter: false,
				cell: ({ row }) => (
					<span className="font-mono text-xs">{row.original.amount.toLocaleString()}</span>
				),
			},
			{
				id: "owner",
				accessorFn: (r) => r.ownerName ?? r.owner,
				header: "Owner",
				size: 120,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const { owner, ownerName } = row.original;
					if (ownerName) {
						return (
							<span className="text-xs" title={owner}>
								{ownerName}
							</span>
						);
					}
					return (
						<CopyAddress
							address={owner}
							sliceStart={6}
							sliceEnd={4}
							className="text-xs text-zinc-500"
						/>
					);
				},
			},
		],
		[],
	);

	// ── Data loading ─────────────────────────────────────────────────────────

	async function loadMarketInfo() {
		if (!row.marketId) return;
		setLoadingMarket(true);
		try {
			const info = await queryMarketDetails(suiClient, row.marketId);
			setMarketInfo(info);
			if (info?.totalSupply != null) {
				setTotalSupply(BigInt(info.totalSupply));
			}
		} catch {
			setMarketInfo(null);
		} finally {
			setLoadingMarket(false);
		}
	}

	async function loadOrders() {
		if (!row.marketId || !marketPkg) return;
		setLoadingOrders(true);
		try {
			const [sells, buys] = await Promise.all([
				queryMarketListings(suiClient, row.marketId, marketPkg),
				queryMarketBuyOrders(suiClient, row.marketId, marketPkg),
			]);
			setSellListings(sells);
			setBuyOrders(buys);

			// Resolve item names
			const typeIds = new Set<number>();
			for (const l of sells) typeIds.add(l.typeId);
			for (const o of buys) typeIds.add(o.typeId);
			if (typeIds.size > 0) {
				const names = new Map<number, string>();
				const dbTypes = await db.gameTypes.bulkGet([...typeIds]);
				for (const t of dbTypes) {
					if (t) names.set(t.id, t.name);
				}
				const missing = [...typeIds].filter((id) => !names.has(id));
				await Promise.all(
					missing.map(async (id) => {
						try {
							const res = await fetch(
								`https://world-api-stillness.live.tech.evefrontier.com/v2/types/${id}`,
							);
							if (!res.ok) return;
							const info = await res.json();
							if (info?.name) names.set(id, info.name);
						} catch {
							// Non-fatal
						}
					}),
				);
				setItemNameMap(names);
			}
		} catch {
			setSellListings([]);
			setBuyOrders([]);
		} finally {
			setLoadingOrders(false);
		}
	}

	async function loadTreasuryData() {
		let tid = treasuryId ?? row.treasuryId;

		// Discover treasury on-chain if not found locally
		if (!tid && addresses.treasury?.packageId && suiAddress) {
			try {
				const discovered = await discoverTreasuries(suiClient, addresses.treasury.packageId, suiAddress);
				for (const t of discovered) {
					// Match by name convention: "SYMBOL Treasury"
					if (t.name.startsWith(row.symbol)) {
						tid = t.treasuryId;
						// Persist for future lookups
						if (row.currencyRecordId) {
							await db.currencies.update(row.currencyRecordId, { treasuryId: tid });
						}
						await db.treasuries.put({
							id: tid,
							name: t.name,
							owner: suiAddress,
							admins: [],
							balances: [],
							coinType: row.coinType,
						});
						break;
					}
				}
			} catch {
				// non-fatal
			}
		}

		if (!tid) return;
		setLoadingTreasury(true);
		try {
			const [info, balances] = await Promise.all([
				queryTreasuryDetails(suiClient, tid),
				queryTreasuryBalances(suiClient, tid),
			]);
			setTreasuryInfo(info);
			setTreasuryBalances(balances);
			setTreasuryId(tid);

			// Persist balances to IndexedDB so the currency list shows them
			if (balances.length > 0) {
				const existing = await db.treasuries.get(tid);
				if (existing) {
					await db.treasuries.update(tid, {
						balances: balances.map((b) => ({
							coinType: b.coinType,
							symbol: b.coinType.split("::").pop()?.replace(/_TOKEN$/, "") ?? "?",
							amount: String(b.amount),
						})),
					});
				}
			}
		} catch {
			setTreasuryInfo(null);
			setTreasuryBalances([]);
		} finally {
			setLoadingTreasury(false);
		}
	}

	async function loadAll() {
		await Promise.all([loadMarketInfo(), loadOrders(), loadTreasuryData()]);
	}

	async function loadOwnedCoins() {
		if (!row.coinType || !suiAddress) return;
		setLoadingCoins(true);
		try {
			const coins = await queryOwnedCoins(suiClient, suiAddress, row.coinType);
			setOwnedCoins(coins);
		} catch {
			setOwnedCoins([]);
		} finally {
			setLoadingCoins(false);
		}
	}

	async function loadExchangeOrders(pairId: string) {
		setLoadingExchange(true);
		try {
			const orders = await fetchExchangeOrders(suiClient, pairId);
			setExchangeOrders((prev) => new Map(prev).set(pairId, orders));
		} catch {
			setExchangeOrders((prev) => new Map(prev).set(pairId, []));
		} finally {
			setLoadingExchange(false);
		}
	}

	// Load market info + orders + treasury on selection change
	// biome-ignore lint/correctness/useExhaustiveDependencies: loadAll changes every render
	useEffect(() => {
		// Reset local state on row change
		setTreasuryId(row.treasuryId ?? null);
		setTreasuryInfo(null);
		setTreasuryBalances([]);
		setShowMint(false);
		setShowBurn(false);
		setShowAuth(false);
		setShowFees(false);
		setShowDeposit(false);
		setShowWithdraw(false);

		if (hasMarket && row.marketId) {
			loadAll();
		} else if (row.treasuryId) {
			loadTreasuryData();
		}
	}, [row.id]);

	// ── Treasury handlers ────────────────────────────────────────────────────

	const treasuryPkg = addresses.treasury?.packageId;
	const isTreasuryAdmin =
		treasuryInfo != null &&
		!!suiAddress &&
		(treasuryInfo.owner === suiAddress || treasuryInfo.admins.includes(suiAddress));

	async function handleCreateTreasury() {
		if (!treasuryPkg || !suiAddress) return;

		onStatusChange("building");
		try {
			const tx = buildCreateTreasury({
				packageId: treasuryPkg,
				name: `${row.symbol} Treasury`,
				senderAddress: suiAddress,
			});

			const result = await signAndExecute({ transaction: tx });

			// Find the created Treasury object
			const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";
			const fullResult = await suiClient.waitForTransaction({
				digest,
				include: { effects: true, objectTypes: true },
			});
			const fullTx = fullResult.Transaction ?? fullResult.FailedTransaction;
			const changedObjects = fullTx?.effects?.changedObjects ?? [];
			const objectTypesMap = fullTx?.objectTypes ?? {};

			let newTreasuryId: string | undefined;
			for (const change of changedObjects) {
				const objType = objectTypesMap[change.objectId] ?? "";
				if (objType.includes("::treasury::Treasury")) {
					newTreasuryId = change.objectId;
					break;
				}
			}

			if (newTreasuryId) {
				// Save to local DB for future lookups
				await db.treasuries.put({
					id: newTreasuryId,
					name: `${row.symbol} Treasury`,
					owner: suiAddress,
					admins: [],
					balances: [],
					coinType: row.coinType,
				});
				// Also persist on the currency record
				if (row.currencyRecordId) {
					await db.currencies.update(row.currencyRecordId, { treasuryId: newTreasuryId });
				}
				setTreasuryId(newTreasuryId);
				onStatusChange("done");
				setTimeout(() => loadTreasuryData(), 1500);
			} else {
				onStatusChange("done");
			}
		} catch (err) {
			onStatusChange("error", walletErrorMessage(err));
		}
	}

	async function handleDeposit() {
		if (!depositAmount || !treasuryId || !row.coinType || !treasuryPkg || !suiAddress) return;
		if (!(await ensureWallet())) return;

		onStatusChange("building");
		try {
			const amount = BigInt(Math.floor(Number(depositAmount) * 10 ** row.decimals));
			const coins = await queryOwnedCoins(suiClient, suiAddress, row.coinType);
			if (coins.length === 0) {
				onStatusChange("error", `No ${row.symbol} coins in your wallet to deposit.`);
				return;
			}

			const tx = buildTreasuryDeposit({
				packageId: treasuryPkg,
				treasuryId,
				coinType: row.coinType,
				coinObjectIds: coins.map((c) => c.objectId),
				amount,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowDeposit(false);
			setDepositAmount("");
			onStatusChange("done");
			setTimeout(() => loadTreasuryData(), 1500);
		} catch (err) {
			onStatusChange("error", walletErrorMessage(err));
		}
	}

	async function handleWithdraw() {
		if (!withdrawAmount || !treasuryId || !row.coinType || !treasuryPkg || !suiAddress) return;
		if (!(await ensureWallet())) return;

		onStatusChange("building");
		try {
			const amount = BigInt(Math.floor(Number(withdrawAmount) * 10 ** row.decimals));

			const tx = buildTreasuryWithdraw({
				packageId: treasuryPkg,
				treasuryId,
				coinType: row.coinType,
				amount,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowWithdraw(false);
			setWithdrawAmount("");
			onStatusChange("done");
			setTimeout(() => loadTreasuryData(), 1500);
		} catch (err) {
			onStatusChange("error", walletErrorMessage(err));
		}
	}

	const isTreasuryOwner =
		treasuryInfo != null && !!suiAddress && treasuryInfo.owner === suiAddress;

	async function handleAddTreasuryAdmin() {
		if (!treasuryAdminAddress.trim() || !treasuryId || !treasuryPkg || !suiAddress) return;
		if (!(await ensureWallet())) return;

		onStatusChange("building");
		try {
			const tx = buildAddTreasuryAdmin({
				packageId: treasuryPkg,
				treasuryId,
				adminAddress: treasuryAdminAddress.trim(),
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setTreasuryAdminAddress("");
			onStatusChange("done");
			setTimeout(() => loadTreasuryData(), 1500);
		} catch (err) {
			onStatusChange("error", walletErrorMessage(err));
		}
	}

	async function handleRemoveTreasuryAdmin(addr: string) {
		if (!treasuryId || !treasuryPkg || !suiAddress) return;
		if (!(await ensureWallet())) return;

		onStatusChange("building");
		try {
			const tx = buildRemoveTreasuryAdmin({
				packageId: treasuryPkg,
				treasuryId,
				adminAddress: addr,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			onStatusChange("done");
			setTimeout(() => loadTreasuryData(), 1500);
		} catch (err) {
			onStatusChange("error", walletErrorMessage(err));
		}
	}

	// ── Admin handlers ───────────────────────────────────────────────────────

	async function handleMint() {
		if (!mintAmount || !row.marketId || !row.coinType || !marketPkg || !suiAddress) return;
		if (!(await ensureWallet())) return;

		onStatusChange("minting");
		try {
			const amount = BigInt(Math.floor(Number(mintAmount) * 10 ** row.decimals));

			// Resolve treasury: check local state, then row, then query DB directly
			const tid =
				treasuryId ??
				row.treasuryId ??
				(await db.treasuries.filter((t) => t.coinType === row.coinType).first())?.id ??
				null;

			let tx: import("@mysten/sui/transactions").Transaction;
			if (tid) {
				// Single-TX: mint directly into treasury
				tx = buildMintToTreasury({
					packageId: marketPkg,
					marketId: row.marketId,
					coinType: row.coinType,
					treasuryId: tid,
					amount,
					senderAddress: suiAddress,
				});
			} else {
				// No treasury: mint to self
				tx = buildMint({
					packageId: marketPkg,
					marketId: row.marketId,
					coinType: row.coinType,
					amount,
					recipient: suiAddress,
					senderAddress: suiAddress,
				});
			}
			await signAndExecute({ transaction: tx });

			setShowMint(false);
			setMintAmount("");
			onStatusChange("done");
			setTimeout(() => {
				loadMarketInfo();
				loadTreasuryData();
			}, 1500);
		} catch (err) {
			onStatusChange("error", walletErrorMessage(err));
		}
	}

	async function handleBurn() {
		if (!burnCoinId || !row.marketId || !row.coinType || !marketPkg || !suiAddress) return;
		if (!(await ensureWallet())) return;

		onStatusChange("burning");
		try {
			const tx = buildBurn({
				packageId: marketPkg,
				marketId: row.marketId,
				coinType: row.coinType,
				coinObjectId: burnCoinId,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowBurn(false);
			setBurnCoinId("");
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", walletErrorMessage(err));
		}
	}

	async function handleAddAuthorized() {
		if (!authAddress.trim() || !row.marketId || !row.coinType || !marketPkg || !suiAddress) return;
		if (!(await ensureWallet())) return;

		onStatusChange("building");
		try {
			const tx = buildAddAuthorized({
				packageId: marketPkg,
				marketId: row.marketId,
				coinType: row.coinType,
				addr: authAddress.trim(),
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setAuthAddress("");
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", walletErrorMessage(err));
		}
	}

	async function handleRemoveAuthorized(addr: string) {
		if (!row.marketId || !row.coinType || !marketPkg || !suiAddress) return;
		if (!(await ensureWallet())) return;

		onStatusChange("building");
		try {
			const tx = buildRemoveAuthorized({
				packageId: marketPkg,
				marketId: row.marketId,
				coinType: row.coinType,
				addr,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", walletErrorMessage(err));
		}
	}

	async function handleUpdateFee() {
		if (!row.marketId || !row.coinType || !marketPkg || !suiAddress) return;
		if (!(await ensureWallet())) return;

		onStatusChange("building");
		try {
			const tx = buildUpdateFee({
				packageId: marketPkg,
				marketId: row.marketId,
				coinType: row.coinType,
				feeBps: Number(feeBps) || 0,
				feeRecipient: feeRecipient.trim() || suiAddress,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowFees(false);
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", walletErrorMessage(err));
		}
	}

	async function handleDiscoverMarket() {
		if (!row.coinType || !marketPkg || !suiAddress) return;
		if (!(await ensureWallet())) return;

		onStatusChange("building");
		try {
			// Search current + previous original package IDs (objects retain original type)
			const prevPkgs = addresses.market?.previousOriginalPackageIds ?? [];
			let markets: Awaited<ReturnType<typeof queryMarkets>> = [];
			for (const pkg of [marketPkg, ...prevPkgs]) {
				markets = await queryMarkets(suiClient, pkg, row.coinType);
				if (markets.length > 0) break;
			}

			if (markets.length === 0) {
				const treasuryCapId = await queryTreasuryCap(suiClient, row.coinType, suiAddress);
				if (!treasuryCapId) {
					onStatusChange(
						"error",
						"No Market found on-chain and no TreasuryCap" +
							" in your wallet. The Market may have been" +
							" created with a different market package version.",
					);
					return;
				}

				const tx = buildCreateMarket({
					packageId: marketPkg,
					coinType: row.coinType,
					treasuryCapId,
					senderAddress: suiAddress,
				});

				const result = await signAndExecute({ transaction: tx });

				const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";
				const fullResult = await suiClient.waitForTransaction({
					digest,
					include: { effects: true, objectTypes: true },
				});
				const fullTx = fullResult.Transaction ?? fullResult.FailedTransaction;
				const changedObjects = fullTx?.effects?.changedObjects ?? [];
				const objectTypesMap = fullTx?.objectTypes ?? {};

				let newMarketId: string | undefined;
				for (const change of changedObjects) {
					const objType = objectTypesMap[change.objectId] ?? "";
					if (objType.includes("::market::Market<")) {
						newMarketId = change.objectId;
						break;
					}
				}

				if (newMarketId && row.currencyRecordId) {
					await db.currencies.update(row.currencyRecordId, {
						marketId: newMarketId,
						updatedAt: new Date().toISOString(),
					});
				}

				onStatusChange("done");
				onSync();
				return;
			}

			const market = markets[0];
			if (row.currencyRecordId) {
				await db.currencies.update(row.currencyRecordId, {
					marketId: market.objectId,
					updatedAt: new Date().toISOString(),
				});
			}

			onStatusChange("done");
			onSync();
		} catch (err) {
			onStatusChange("error", walletErrorMessage(err));
		}
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Market Identity */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<div className="mb-4 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="rounded-lg bg-zinc-800 p-2.5">
							<Coins size={20} className="text-cyan-500" />
						</div>
						<div>
							<h2 className="text-lg font-bold text-zinc-100">
								{row.symbol}
								<span className="ml-2 text-sm font-normal text-zinc-400">{row.name}</span>
							</h2>
							{row.decommissioned ? (
								<span className="rounded bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-400">
									Decommissioned
								</span>
							) : hasMarket ? (
								<span className="rounded bg-green-500/10 px-1.5 py-0.5 text-xs font-medium text-green-400">
									Market Active
								</span>
							) : (
								<span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-400">
									No Market
								</span>
							)}
						</div>
					</div>
					<div className="flex items-center gap-2">
						{row.status === "mine" && row.marketId && (
							<button
								type="button"
								onClick={() => onDecommission(!row.decommissioned)}
								title={row.decommissioned ? "Recommission" : "Decommission"}
								className={`rounded-lg p-2 transition-colors ${
									row.decommissioned
										? "text-amber-400 hover:bg-amber-900/30"
										: "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
								}`}
							>
								<Ban size={14} />
							</button>
						)}
					{hasMarket && (
						<button
							type="button"
							onClick={loadAll}
							className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
							title="Refresh all data"
						>
							<RefreshCw size={12} />
							Refresh
						</button>
					)}
					</div>
				</div>

				{/* Market metadata */}
				{loadingMarket ? (
					<div className="flex items-center gap-2 py-4 text-xs text-zinc-500">
						<Loader2 size={14} className="animate-spin" />
						Loading market data...
					</div>
				) : hasMarket && marketInfo ? (
					<>
						<div className="mb-4 grid grid-cols-3 gap-3">
							<StatBox
								label="Total Supply"
								value={
									totalSupply != null
										? `${formatTokenAmount(totalSupply, row.decimals)} ${row.symbol}`
										: "--"
								}
							/>
							<StatBox label="Fee" value={`${marketInfo.feeBps} bps`} />
							<StatBox label="Currency Admins" value={String(marketInfo.authorized.length)} />
						</div>

						<div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-zinc-800 pt-3 text-xs">
							<div>
								<span className="text-zinc-500">Market ID</span>
								<CopyAddress
									address={row.marketId ?? ""}
									sliceStart={12}
									sliceEnd={6}
									className="font-mono text-zinc-400"
								/>
							</div>
							<div>
								<span className="text-zinc-500">Creator</span>
								<div className="flex items-center gap-1">
									{charNameMap.get(marketInfo.creator) ? (
										<span className="text-zinc-300" title={marketInfo.creator}>
											{charNameMap.get(marketInfo.creator)}
										</span>
									) : (
										<CopyAddress
											address={marketInfo.creator}
											sliceStart={12}
											sliceEnd={6}
											className="font-mono text-zinc-400"
										/>
									)}
									{isCreator && <span className="text-cyan-400">(you)</span>}
								</div>
							</div>
							<div className="col-span-2">
								<span className="text-zinc-500">Token Identifier</span>
								<div className="mt-0.5 flex items-center gap-2">
									<p className="min-w-0 truncate font-mono text-zinc-400">{row.coinType}</p>
									<button
										type="button"
										onClick={() => navigator.clipboard.writeText(row.coinType)}
										className="shrink-0 rounded bg-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-600"
										title="Copy to add this token in Eve Vault"
									>
										Copy
									</button>
								</div>
								<p className="mt-1 text-[10px] text-zinc-600">
									Use this identifier to add the token in Eve Vault
								</p>
							</div>
						</div>
					</>
				) : hasMarket ? (
					<p className="text-xs text-zinc-600">Loading market data...</p>
				) : null}

				{/* No market -- discover/create prompt */}
				{row.packageId && !hasMarket && (
					<div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
						<h4 className="mb-2 text-xs font-medium text-amber-400">No Market Linked</h4>
						<p className="mb-3 text-xs text-zinc-500">
							Search for the existing Market on-chain, or create one if none exists.
						</p>
						{account ? (
							<button
								type="button"
								onClick={handleDiscoverMarket}
								className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500"
							>
								Find / Create Market
							</button>
						) : (
							<ConnectWalletButton />
						)}
					</div>
				)}

				{/* Admin Actions */}
				{hasMarket && isAuthorized && (
					<div className="mt-3 border-t border-zinc-800 pt-3">
						<div className="flex flex-wrap items-center gap-2">
							<AdminToggle
								active={showMint}
								onClick={() => {
									setShowMint(!showMint);
									setShowBurn(false);
									setShowAuth(false);
									setShowFees(false);
								}}
								icon={<Send size={12} />}
								label="Mint"
								color="cyan"
							/>
							<AdminToggle
								active={showBurn}
								onClick={() => {
									setShowBurn(!showBurn);
									setShowMint(false);
									setShowAuth(false);
									setShowFees(false);
									if (!showBurn) loadOwnedCoins();
								}}
								icon={<Flame size={12} />}
								label="Burn"
								color="red"
							/>
							{isCreator && (
								<>
									<AdminToggle
										active={showAuth}
										onClick={() => {
											setShowAuth(!showAuth);
											setShowMint(false);
											setShowBurn(false);
											setShowFees(false);
										}}
										icon={<UserPlus size={12} />}
										label="Currency Admins"
										color="amber"
									/>
									<AdminToggle
										active={showFees}
										onClick={() => {
											setShowFees(!showFees);
											setShowMint(false);
											setShowBurn(false);
											setShowAuth(false);
											if (marketInfo) {
												setFeeBps(String(marketInfo.feeBps));
												setFeeRecipient(marketInfo.feeRecipient);
											}
										}}
										icon={<Settings size={12} />}
										label="Fees"
										color="purple"
									/>
								</>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Admin Panels */}
			{hasMarket && isAuthorized && (showMint || showBurn || showAuth || showFees) && (
				<div className="space-y-3">
					{/* Mint Form */}
					{showMint && (
						<AdminPanel title={`Mint ${row.symbol}`}>
							<div className="space-y-3">
								<FormField label="Amount">
									<input
										type="number"
										value={mintAmount}
										onChange={(e) => setMintAmount(e.target.value)}
										placeholder="e.g., 1000"
										min={0}
										step="any"
										className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
									/>
								</FormField>
								{row.treasuryId && (
									<p className="text-xs text-zinc-500">
										Minted tokens will be sent to the treasury.
									</p>
								)}
								{account ? (
									<button
										type="button"
										onClick={handleMint}
										disabled={!mintAmount}
										className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
									>
										Mint {row.symbol}
									</button>
								) : (
									<ConnectWalletButton />
								)}
							</div>
						</AdminPanel>
					)}

					{/* Burn Form */}
					{showBurn && (
						<AdminPanel title={`Burn ${row.symbol}`}>
							{loadingCoins ? (
								<div className="flex items-center gap-2 text-xs text-zinc-500">
									<Loader2 size={12} className="animate-spin" />
									Loading your coins...
								</div>
							) : ownedCoins.length === 0 ? (
								<p className="text-xs text-zinc-600">No {row.symbol} coins in your wallet.</p>
							) : (
								<div className="space-y-2">
									<FormField label="Select Coin to Burn">
										<select
											value={burnCoinId}
											onChange={(e) => setBurnCoinId(e.target.value)}
											className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
										>
											<option value="">Choose a coin...</option>
											{ownedCoins.map((c) => (
												<option key={c.objectId} value={c.objectId}>
													{formatTokenAmount(c.balance, row.decimals)} {row.symbol} (
													{c.objectId.slice(0, 10)}
													...)
												</option>
											))}
										</select>
									</FormField>
									{account ? (
										<button
											type="button"
											onClick={handleBurn}
											disabled={!burnCoinId}
											className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
										>
											Burn Selected Coin
										</button>
									) : (
										<ConnectWalletButton />
									)}
								</div>
							)}
						</AdminPanel>
					)}

					{/* Authorization Form */}
					{showAuth && isCreator && (
						<AdminPanel title="Manage Currency Admins">
							<div className="space-y-3">
								<FormField label="Search Character or Paste Address">
									<ContactPicker
										placeholder="Search characters or paste 0x address..."
										onSelect={(char) => setAuthAddress(char.suiAddress)}
										excludeAddresses={marketInfo?.authorized}
									/>
									{authAddress && (
										<div className="mt-1.5 flex items-center justify-between rounded border border-zinc-700 bg-zinc-800/50 px-3 py-1.5">
											<span className="font-mono text-xs text-zinc-300">
												{authAddress.slice(0, 16)}...{authAddress.slice(-8)}
											</span>
											<button
												type="button"
												onClick={() => setAuthAddress("")}
												className="text-xs text-zinc-500 hover:text-zinc-300"
											>
												clear
											</button>
										</div>
									)}
								</FormField>
								<button
									type="button"
									onClick={handleAddAuthorized}
									disabled={!authAddress.trim()}
									className="flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<UserPlus size={12} />
									Add Currency Admin
								</button>
							</div>

							{marketInfo && marketInfo.authorized.length > 0 && (
								<div className="mt-3 border-t border-zinc-800 pt-3">
									<p className="mb-1.5 text-xs text-zinc-500">
										Currency Admins ({marketInfo.authorized.length})
									</p>
									<div className="space-y-1">
										{marketInfo.authorized.map((addr) => (
											<div key={addr} className="flex items-center gap-2">
												<span className="text-xs text-zinc-400">
													{charNameMap.get(addr) ?? `${addr.slice(0, 12)}...${addr.slice(-6)}`}
													{addr === suiAddress && <span className="ml-1 text-cyan-400">(you)</span>}
												</span>
												<button
													type="button"
													onClick={() => handleRemoveAuthorized(addr)}
													className="text-zinc-600 transition-colors hover:text-red-400"
													title="Remove"
												>
													<UserMinus size={12} />
												</button>
											</div>
										))}
									</div>
								</div>
							)}
						</AdminPanel>
					)}

					{/* Fee Management */}
					{showFees && isCreator && (
						<AdminPanel title="Update Fee Configuration">
							<div className="space-y-3">
								<FormField label="Fee (basis points, 100 = 1%)">
									<input
										type="number"
										value={feeBps}
										onChange={(e) => setFeeBps(e.target.value)}
										placeholder="e.g., 250"
										min={0}
										max={10000}
										className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
									/>
								</FormField>
								<FormField label="Fee Recipient">
									<input
										type="text"
										value={feeRecipient}
										onChange={(e) => setFeeRecipient(e.target.value)}
										placeholder="0x..."
										className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
									/>
								</FormField>
								<button
									type="button"
									onClick={handleUpdateFee}
									className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-500"
								>
									<Settings size={12} />
									Update Fee
								</button>
							</div>
						</AdminPanel>
					)}
				</div>
			)}

			{/* Treasury Section */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<div className="mb-3 flex items-center justify-between">
					<h3 className="text-sm font-medium text-zinc-300">Treasury</h3>
					{treasuryId && (
						<button
							type="button"
							onClick={loadTreasuryData}
							disabled={loadingTreasury}
							className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
						>
							<RefreshCw
								size={12}
								className={loadingTreasury ? "animate-spin" : ""}
							/>
							Refresh
						</button>
					)}
				</div>

				{!treasuryId ? (
					<div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
						<p className="mb-3 text-xs text-zinc-500">
							No treasury linked to this currency. Create one to hold {row.symbol}{" "}
							balances and manage deposits/withdrawals.
						</p>
						{account ? (
							<button
								type="button"
								onClick={handleCreateTreasury}
								className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
							>
								Create Treasury
							</button>
						) : (
							<ConnectWalletButton />
						)}
					</div>
				) : loadingTreasury && !treasuryInfo ? (
					<div className="flex items-center gap-2 py-4 text-xs text-zinc-500">
						<Loader2 size={14} className="animate-spin" />
						Loading treasury data...
					</div>
				) : (
					<>
						{/* Balance + metadata */}
						<div className="mb-3 grid grid-cols-3 gap-3">
							{treasuryBalances.length > 0 ? (
								treasuryBalances.map((b) => {
									const sym =
										b.coinType
											.split("::")
											.pop()
											?.replace(/_TOKEN$/, "") ?? "?";
									const dec = b.coinType === row.coinType ? row.decimals : 9;
									return (
										<StatBox
											key={b.coinType}
											label={`${sym} Balance`}
											value={formatTokenAmount(b.amount, dec)}
										/>
									);
								})
							) : (
								<StatBox label="Balance" value="0" />
							)}
							<StatBox
								label="Owner"
								value={
									treasuryInfo
										? (charNameMap.get(treasuryInfo.owner) ??
											`${treasuryInfo.owner.slice(0, 8)}...`)
										: "--"
								}
							/>
							<StatBox
								label="Treasury Admins"
								value={String((treasuryInfo?.admins.length ?? 0) + (treasuryInfo ? 1 : 0))}
							/>
						</div>

						{/* Treasury ID */}
						<div className="mb-3 text-xs">
							<span className="text-zinc-500">Treasury ID: </span>
							<CopyAddress
								address={treasuryId}
								sliceStart={12}
								sliceEnd={6}
								className="font-mono text-zinc-400"
							/>
						</div>

						{/* Deposit / Withdraw / Admins actions */}
						<div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
							<AdminToggle
								active={showDeposit}
								onClick={() => {
									setShowDeposit(!showDeposit);
									setShowWithdraw(false);
									setShowTreasuryAdmins(false);
								}}
								icon={<Send size={12} />}
								label="Deposit"
								color="cyan"
							/>
							{isTreasuryAdmin && (
								<AdminToggle
									active={showWithdraw}
									onClick={() => {
										setShowWithdraw(!showWithdraw);
										setShowDeposit(false);
										setShowTreasuryAdmins(false);
									}}
									icon={<Send size={12} className="rotate-180" />}
									label="Withdraw"
									color="amber"
								/>
							)}
							{isTreasuryOwner && (
								<AdminToggle
									active={showTreasuryAdmins}
									onClick={() => {
										setShowTreasuryAdmins(!showTreasuryAdmins);
										setShowDeposit(false);
										setShowWithdraw(false);
									}}
									icon={<UserPlus size={12} />}
									label="Treasury Admins"
									color="purple"
								/>
							)}
						</div>

						{/* Deposit form */}
						{showDeposit && (
							<AdminPanel title={`Deposit ${row.symbol} to Treasury`}>
								<div className="space-y-3">
									<FormField label="Amount">
										<input
											type="number"
											value={depositAmount}
											onChange={(e) => setDepositAmount(e.target.value)}
											placeholder="e.g., 100"
											min={0}
											step="any"
											className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
										/>
									</FormField>
									{account ? (
										<button
											type="button"
											onClick={handleDeposit}
											disabled={!depositAmount}
											className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
										>
											Deposit {row.symbol}
										</button>
									) : (
										<ConnectWalletButton />
									)}
								</div>
							</AdminPanel>
						)}

						{/* Withdraw form */}
						{showWithdraw && isTreasuryAdmin && (
							<AdminPanel title={`Withdraw ${row.symbol} from Treasury`}>
								<div className="space-y-3">
									<FormField label="Amount">
										<input
											type="number"
											value={withdrawAmount}
											onChange={(e) => setWithdrawAmount(e.target.value)}
											placeholder="e.g., 50"
											min={0}
											step="any"
											className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
										/>
									</FormField>
									{account ? (
										<button
											type="button"
											onClick={handleWithdraw}
											disabled={!withdrawAmount}
											className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
										>
											Withdraw {row.symbol}
										</button>
									) : (
										<ConnectWalletButton />
									)}
								</div>
							</AdminPanel>
						)}

						{/* Treasury Admins management */}
						{showTreasuryAdmins && isTreasuryOwner && (
							<AdminPanel title="Manage Treasury Admins">
								<div className="space-y-3">
									<FormField label="Search Character or Paste Address">
										<ContactPicker
											placeholder="Search characters or paste 0x address..."
											onSelect={(char) => setTreasuryAdminAddress(char.suiAddress)}
											excludeAddresses={treasuryInfo?.admins}
										/>
										{treasuryAdminAddress && (
											<div className="mt-1.5 flex items-center justify-between rounded border border-zinc-700 bg-zinc-800/50 px-3 py-1.5">
												<span className="font-mono text-xs text-zinc-300">
													{treasuryAdminAddress.slice(0, 16)}...{treasuryAdminAddress.slice(-8)}
												</span>
												<button
													type="button"
													onClick={() => setTreasuryAdminAddress("")}
													className="text-xs text-zinc-500 hover:text-zinc-300"
												>
													clear
												</button>
											</div>
										)}
									</FormField>
									<button
										type="button"
										onClick={handleAddTreasuryAdmin}
										disabled={!treasuryAdminAddress.trim()}
										className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
									>
										<UserPlus size={12} />
										Add Treasury Admin
									</button>
								</div>

								{treasuryInfo && (
									<div className="mt-3 border-t border-zinc-800 pt-3">
										<p className="mb-1.5 text-xs text-zinc-500">
											Treasury Admins ({treasuryInfo.admins.length + 1})
										</p>
										<div className="space-y-1">
											<div className="flex items-center gap-2">
												<span className="text-xs text-zinc-400">
													{charNameMap.get(treasuryInfo.owner) ?? `${treasuryInfo.owner.slice(0, 12)}...${treasuryInfo.owner.slice(-6)}`}
													{treasuryInfo.owner === suiAddress && <span className="ml-1 text-cyan-400">(you)</span>}
													<span className="ml-1 text-zinc-600">(owner)</span>
												</span>
											</div>
											{treasuryInfo.admins.map((addr) => (
												<div key={addr} className="flex items-center gap-2">
													<span className="text-xs text-zinc-400">
														{charNameMap.get(addr) ?? `${addr.slice(0, 12)}...${addr.slice(-6)}`}
														{addr === suiAddress && <span className="ml-1 text-cyan-400">(you)</span>}
													</span>
													<button
														type="button"
														onClick={() => handleRemoveTreasuryAdmin(addr)}
														className="text-zinc-600 transition-colors hover:text-red-400"
														title="Remove"
													>
														<UserMinus size={12} />
													</button>
												</div>
											))}
										</div>
									</div>
								)}
							</AdminPanel>
						)}
					</>
				)}
			</div>

			{/* Market Order Book */}
			{hasMarket && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<h3 className="mb-3 text-sm font-medium text-zinc-300">Market Order Book</h3>
					{loadingOrders ? (
						<div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-500">
							<Loader2 size={14} className="animate-spin" />
							Loading orders...
						</div>
					) : (
						<DataGrid
							columns={orderColumns}
							data={orderRows}
							keyFn={(r) => r.id}
							searchPlaceholder="Search orders..."
							emptyMessage="No market orders yet."
							actions={
								<button
									type="button"
									onClick={loadOrders}
									disabled={loadingOrders}
									className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
								>
									<RefreshCw size={12} />
									Refresh
								</button>
							}
						/>
					)}
				</div>
			)}

			{/* Exchange Pairs Section */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<h3 className="mb-3 text-sm font-medium text-zinc-300">Exchange Pairs</h3>
				{currencyPairs.length === 0 ? (
					<p className="text-xs text-zinc-600">No exchange pairs found for this currency.</p>
				) : (
					<div className="space-y-2">
						{currencyPairs.map((pair) => {
							const isExpanded = expandedPair === pair.id;
							const pairOrders = exchangeOrders.get(pair.id) ?? [];
							const otherCoinType =
								pair.coinTypeA === row.coinType ? pair.coinTypeB : pair.coinTypeA;
							const otherSymbol =
								otherCoinType
									.split("::")
									.pop()
									?.replace(/_TOKEN$/, "") ?? otherCoinType;

							const exchangeRows: ExchangeOrderRow[] = pairOrders.map((o) => ({
								id: `${pair.id}-${o.orderId}`,
								side: o.isBid ? "Bid" : "Ask",
								price: o.price,
								amount: o.amount,
								owner: o.owner,
								ownerName: charNameMap.get(o.owner),
							}));

							return (
								<div key={pair.id} className="rounded-lg border border-zinc-800 bg-zinc-900/80">
									<button
										type="button"
										onClick={() => {
											if (isExpanded) {
												setExpandedPair(null);
											} else {
												setExpandedPair(pair.id);
												if (!exchangeOrders.has(pair.id)) {
													loadExchangeOrders(pair.id);
												}
											}
										}}
										className="flex w-full items-center justify-between px-3 py-2 text-left"
									>
										<span className="text-xs text-zinc-300">
											{row.symbol} / {otherSymbol}
											<span className="ml-2 text-zinc-600">Fee: {pair.feeBps} bps</span>
										</span>
										{isExpanded ? (
											<ChevronUp size={14} className="text-zinc-500" />
										) : (
											<ChevronDown size={14} className="text-zinc-500" />
										)}
									</button>
									{isExpanded && (
										<div className="border-t border-zinc-800 p-3">
											{loadingExchange ? (
												<div className="flex items-center gap-2 py-4 text-xs text-zinc-500">
													<Loader2 size={12} className="animate-spin" />
													Loading orders...
												</div>
											) : (
												<DataGrid
													columns={exchangeColumns}
													data={exchangeRows}
													keyFn={(r) => r.id}
													searchPlaceholder="Search exchange orders..."
													emptyMessage="No orders in this book."
												/>
											)}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

// ── Create Currency Form ─────────────────────────────────────────────────────

function CreateCurrencyForm({
	symbol,
	tokenName,
	description,
	decimals,
	isProcessing,
	onSymbolChange,
	onNameChange,
	onDescChange,
	onDecimalsChange,
	onCreate,
	onCancel,
}: {
	symbol: string;
	tokenName: string;
	description: string;
	decimals: number;
	isProcessing: boolean;
	onSymbolChange: (v: string) => void;
	onNameChange: (v: string) => void;
	onDescChange: (v: string) => void;
	onDecimalsChange: (v: number) => void;
	onCreate: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<h2 className="mb-4 text-sm font-medium text-zinc-100">Create Currency</h2>
			<div className="space-y-3">
				<FormField label="Symbol">
					<input
						type="text"
						value={symbol}
						onChange={(e) => onSymbolChange(e.target.value)}
						placeholder="e.g., GOLD"
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
						maxLength={10}
					/>
				</FormField>
				<FormField label="Name">
					<input
						type="text"
						value={tokenName}
						onChange={(e) => onNameChange(e.target.value)}
						placeholder="e.g., Organization Gold"
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
						maxLength={100}
					/>
				</FormField>
				<FormField label="Description">
					<textarea
						value={description}
						onChange={(e) => onDescChange(e.target.value)}
						placeholder="e.g., Official currency of our organization"
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
						maxLength={500}
						rows={2}
					/>
				</FormField>
				<FormField label="Decimals">
					<input
						type="number"
						value={decimals}
						onChange={(e) => onDecimalsChange(Number(e.target.value))}
						min={0}
						max={18}
						className="w-32 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
					/>
				</FormField>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={onCreate}
						disabled={!symbol.trim() || !tokenName.trim() || isProcessing}
						className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isProcessing ? (
							<span className="flex items-center gap-2">
								<Loader2 size={14} className="animate-spin" /> Publishing...
							</span>
						) : (
							"Create Currency"
						)}
					</button>
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-300"
					>
						Cancel
					</button>
				</div>
				{isProcessing && (
					<p className="text-xs text-zinc-500">
						Your wallet will prompt you to sign. The token and Market will be published directly to
						Sui testnet.
					</p>
				)}
			</div>
		</div>
	);
}
