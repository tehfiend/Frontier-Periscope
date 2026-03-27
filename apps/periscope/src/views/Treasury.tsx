import { useSuiClient } from "@/hooks/useSuiClient";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
	Archive,
	ArchiveRestore,
	ChevronDown,
	Flame,
	Loader2,
	Package,
	Plus,
	RefreshCw,
	Send,
	Settings,
	UserMinus,
	UserPlus,
	Vault,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { TenantId } from "@/chain/config";
import { discoverMarkets } from "@/chain/manifest";
import { CopyAddress } from "@/components/CopyAddress";
import { type ColumnDef, DataGrid, excelFilterFn } from "@/components/DataGrid";
import { db, notDeleted } from "@/db";
import type { CurrencyRecord, TreasuryRecord } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import {
	buildAddAuthorized,
	buildBurn,
	buildCreateMarket,
	buildMint,
	buildPublishToken,
	buildRemoveAuthorized,
	buildUpdateFee,
	getCoinMetadata,
	getContractAddresses,
	parsePublishResult,
	queryMarkets,
	queryOwnedCoins,
	queryTreasuryCap,
} from "@tehfrontier/chain-shared";
import type { MarketInfo } from "@tehfrontier/chain-shared";

type BuildStatus = "idle" | "building" | "minting" | "burning" | "done" | "error";

// ── Treasury View ─────────────────────────────────────────────────────

export function Treasury() {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const tenant = useActiveTenant();
	const suiClient = useSuiClient();

	// Treasury state
	const treasuries = useLiveQuery(() => db.treasuries.toArray()) ?? [];
	const [selectedTreasuryId, setSelectedTreasuryId] = useState<string | null>(null);
	const [newTreasuryName, setNewTreasuryName] = useState("");

	// Currency state (migrated from Market)
	const currencies = useLiveQuery(() => db.currencies.filter(notDeleted).toArray());
	const [showArchived, setShowArchived] = useState(false);
	const filteredCurrencies = useMemo(
		() => (currencies ?? []).filter((c) => !c._archived || showArchived),
		[currencies, showArchived],
	);

	const [creating, setCreating] = useState(false);
	const [symbol, setSymbol] = useState("");
	const [tokenName, setTokenName] = useState("");
	const [description, setDescription] = useState("");
	const [decimals, setDecimals] = useState(9);
	const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
	const [buildError, setBuildError] = useState("");
	const [selectedCurrencyId, setSelectedCurrencyId] = useState<string | null>(null);

	// Auto-select first non-archived currency when list loads
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedCurrencyId intentionally omitted to prevent infinite loop
	useEffect(() => {
		if (!selectedCurrencyId && filteredCurrencies.length > 0) {
			setSelectedCurrencyId(filteredCurrencies[0].id);
		}
	}, [filteredCurrencies]);

	const isProcessing =
		buildStatus === "building" || buildStatus === "minting" || buildStatus === "burning";

	// Sync currencies from manifest cache
	const syncMarkets = useCallback(async () => {
		if (!suiAddress) return;

		try {
			await discoverMarkets(suiClient);

			const markets = await db.manifestMarkets.toArray();
			const validMarketIds = new Set<string>();

			for (const market of markets) {
				const walletAddr = account?.address;
				if (
					market.creator !== suiAddress &&
					!market.authorized.includes(suiAddress) &&
					(!walletAddr ||
						(market.creator !== walletAddr && !market.authorized.includes(walletAddr)))
				) {
					continue;
				}

				validMarketIds.add(market.id);

				const existing = await db.currencies.where("coinType").equals(market.coinType).first();
				if (existing) {
					if (!existing.marketId) {
						await db.currencies.update(existing.id, {
							marketId: market.id,
						});
					}
					continue;
				}

				const parts = market.coinType.split("::");
				const packageId = parts[0] ?? "";
				const moduleName = parts.length >= 2 ? parts[1] : "";
				const structName = parts.length >= 3 ? parts[2] : moduleName;
				const sym = structName.replace(/_TOKEN$/, "");

				let coinDecimals = 9;
				try {
					const meta = await getCoinMetadata(suiClient, market.coinType);
					if (meta) coinDecimals = meta.decimals;
				} catch {
					// Fall back to 9 if metadata unavailable
				}

				const now = new Date().toISOString();
				await db.currencies.add({
					id: crypto.randomUUID(),
					symbol: sym,
					name: `${sym} Token`,
					description: "",
					moduleName,
					coinType: market.coinType,
					packageId,
					marketId: market.id,
					decimals: coinDecimals,
					createdAt: now,
					updatedAt: now,
				});
			}

			// Remove currencies whose Market is on an old/incompatible package
			const allCurrencies = await db.currencies.filter(notDeleted).toArray();
			for (const c of allCurrencies) {
				if (c.marketId && !validMarketIds.has(c.marketId)) {
					await db.currencies.delete(c.id);
				}
			}
		} catch {
			// Silent -- sync is best-effort
		}
	}, [suiAddress, suiClient, account?.address]);

	useEffect(() => {
		syncMarkets();
	}, [syncMarkets]);

	// Filter treasuries for current user
	const userTreasuries = useMemo(
		() =>
			suiAddress
				? treasuries.filter((t) => t.owner === suiAddress || t.admins.includes(suiAddress))
				: [],
		[treasuries, suiAddress],
	);

	const selectedTreasury = userTreasuries.find((t) => t.id === selectedTreasuryId);

	if (!activeCharacter || !suiAddress) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<Vault size={48} className="mx-auto mb-4 text-zinc-700" />
					<p className="text-sm text-zinc-500">Select a character to manage treasuries</p>
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

	async function handleCreateCurrency() {
		if (!symbol.trim() || !tokenName.trim()) return;

		setBuildStatus("building");
		setBuildError("");

		try {
			const tx = await buildPublishToken({
				symbol: symbol.trim().toUpperCase(),
				name: tokenName.trim(),
				description: description.trim() || `${tokenName.trim()} token`,
				decimals,
			});

			const result = await signAndExecute({
				transaction: tx,
			});

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
					return {
						type: "published",
						packageId: change.objectId,
					};
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

			const now = new Date().toISOString();
			await db.currencies.add({
				id: crypto.randomUUID(),
				symbol: symbol.trim().toUpperCase(),
				name: tokenName.trim(),
				description: description.trim(),
				moduleName: parsed.moduleName,
				coinType: parsed.coinType,
				packageId: parsed.packageId,
				marketId: parsed.marketId,
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
			setBuildError(err instanceof Error ? err.message : String(err));
		}
	}

	const handleArchiveCurrency = async (id: string, archived: boolean) => {
		await db.currencies.update(id, { _archived: archived });
		if (archived && selectedCurrencyId === id) setSelectedCurrencyId(null);
	};

	async function handleCreateTreasury() {
		if (!newTreasuryName.trim() || !suiAddress) return;

		setBuildStatus("building");
		setBuildError("");

		try {
			// TODO: Wire to chain-shared buildCreateTreasury once available
			// const addresses = getContractAddresses(tenant);
			// const tx = buildCreateTreasury({
			// 	packageId: addresses.treasury?.packageId ?? "",
			// 	name: newTreasuryName.trim(),
			// 	senderAddress: suiAddress,
			// });
			// const result = await signAndExecute({ transaction: tx });

			// For now, create a local placeholder record
			const record = {
				id: crypto.randomUUID(),
				name: newTreasuryName.trim(),
				owner: suiAddress,
				admins: [],
				balances: [],
			};
			await db.treasuries.put(record);

			setNewTreasuryName("");
			setBuildStatus("done");
		} catch (err) {
			setBuildStatus("error");
			setBuildError(err instanceof Error ? err.message : String(err));
		}
	}

	const selectedCurrency = filteredCurrencies.find((c) => c.id === selectedCurrencyId);

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

			{/* ── Treasury Management Section ──────────────────────────────── */}
			<section>
				<div className="mb-3 flex items-center gap-3">
					<div className="flex items-center gap-2">
						<Vault size={18} className="text-cyan-500" />
						<h2 className="text-sm font-medium text-zinc-100">Treasuries</h2>
					</div>

					{/* Treasury selector */}
					{userTreasuries.length > 0 && (
						<div className="relative max-w-xs min-w-0 flex-1">
							<select
								value={selectedTreasuryId ?? ""}
								onChange={(e) => setSelectedTreasuryId(e.target.value || null)}
								className="w-full appearance-none rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-3 pr-8 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
							>
								<option value="">Select a treasury...</option>
								{userTreasuries.map((t) => (
									<option key={t.id} value={t.id}>
										{t.name} {t.owner === suiAddress ? "(owner)" : "(admin)"}
									</option>
								))}
							</select>
							<ChevronDown
								size={14}
								className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
							/>
						</div>
					)}
				</div>

				{/* Create Treasury */}
				<div className="mb-3 flex items-center gap-2">
					<input
						type="text"
						value={newTreasuryName}
						onChange={(e) => setNewTreasuryName(e.target.value)}
						placeholder="New treasury name..."
						className="max-w-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
					{account ? (
						<button
							type="button"
							onClick={handleCreateTreasury}
							disabled={!newTreasuryName.trim() || isProcessing}
							className="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-4 py-2 text-sm text-zinc-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-400 disabled:opacity-50"
						>
							<Plus size={14} />
							Create Treasury
						</button>
					) : (
						<span className="text-xs text-zinc-500">Connect wallet</span>
					)}
				</div>

				{/* Treasury Detail */}
				{selectedTreasury && (
					<TreasuryDetail
						treasury={selectedTreasury}
						suiAddress={suiAddress}
						tenant={tenant}
						onStatusChange={(s, e) => {
							setBuildStatus(s);
							setBuildError(e ?? "");
						}}
					/>
				)}
			</section>

			{/* ── Coin Creation Section ────────────────────────────────────── */}
			<section className="border-t border-zinc-800 pt-4">
				<div className="mb-3 flex items-center gap-3">
					<div className="flex items-center gap-2">
						<Package size={18} className="text-cyan-500" />
						<h2 className="text-sm font-medium text-zinc-100">Currencies</h2>
					</div>

					{/* Currency selector */}
					<div className="relative max-w-sm min-w-0 flex-1">
						<select
							value={selectedCurrencyId ?? ""}
							onChange={(e) => setSelectedCurrencyId(e.target.value || null)}
							className="w-full appearance-none rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-3 pr-8 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
						>
							<option value="">Select a currency...</option>
							{filteredCurrencies.map((c) => (
								<option key={c.id} value={c.id}>
									{c.symbol} -- {c.name}
									{c.marketId ? "" : " (no market)"}
									{c._archived ? " (archived)" : ""}
								</option>
							))}
						</select>
						<ChevronDown
							size={14}
							className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
						/>
					</div>

					{/* Archive toggle */}
					<button
						type="button"
						onClick={() => setShowArchived(!showArchived)}
						title={showArchived ? "Hide archived" : "Show archived"}
						className={`shrink-0 rounded-lg p-2 text-xs transition-colors ${
							showArchived
								? "bg-amber-900/30 text-amber-400"
								: "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
						}`}
					>
						<Archive size={14} />
					</button>

					{/* Archive / Unarchive selected currency */}
					{selectedCurrency && (
						<button
							type="button"
							onClick={() =>
								handleArchiveCurrency(selectedCurrency.id, !selectedCurrency._archived)
							}
							title={selectedCurrency._archived ? "Unarchive" : "Archive"}
							className="shrink-0 rounded-lg p-2 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
						>
							{selectedCurrency._archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
						</button>
					)}

					{/* Create button / form toggle */}
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
							Create
						</button>
					)}
				</div>

				{/* Create Currency Form */}
				{creating && (
					<CreateCurrencyForm
						symbol={symbol}
						tokenName={tokenName}
						description={description}
						decimals={decimals}
						isProcessing={isProcessing}
						hasAccount={!!account}
						onSymbolChange={setSymbol}
						onNameChange={setTokenName}
						onDescChange={setDescription}
						onDecimalsChange={setDecimals}
						onCreate={handleCreateCurrency}
						onCancel={() => setCreating(false)}
					/>
				)}

				{/* Currency Detail / Management */}
				{selectedCurrency && (
					<CurrencyManagement
						currency={selectedCurrency}
						tenant={tenant}
						suiAddress={suiAddress}
						onStatusChange={(s, e) => {
							setBuildStatus(s);
							setBuildError(e ?? "");
						}}
						onMarketCreated={syncMarkets}
					/>
				)}
			</section>
		</div>
	);
}

// ── Treasury Detail ───────────────────────────────────────────────────

function TreasuryDetail({
	treasury,
	suiAddress,
	tenant: _tenant,
	onStatusChange,
}: {
	treasury: TreasuryRecord;
	suiAddress: string;
	tenant: TenantId;
	onStatusChange: (status: BuildStatus, error?: string) => void;
}) {
	const _account = useCurrentAccount();
	const { signAndExecuteTransaction: _signAndExecute } = useDAppKit();
	const [addAdminAddress, setAddAdminAddress] = useState("");

	const isOwner = treasury.owner === suiAddress;
	// isAdmin will be used for deposit/withdraw once chain-shared treasury module lands
	const _isAdmin = isOwner || treasury.admins.includes(suiAddress);

	const balanceColumns = useMemo<ColumnDef<(typeof treasury.balances)[0], unknown>[]>(
		() => [
			{
				accessorKey: "symbol",
				header: "Currency",
				size: 100,
				filterFn: excelFilterFn,
			},
			{
				accessorKey: "amount",
				header: "Balance",
				size: 120,
				enableColumnFilter: false,
			},
			{
				accessorKey: "coinType",
				header: "Coin Type",
				size: 200,
				filterFn: excelFilterFn,
				cell: ({ row }) => (
					<span className="truncate font-mono text-xs text-zinc-500">{row.original.coinType}</span>
				),
			},
		],
		[],
	);

	async function handleAddAdmin() {
		if (!addAdminAddress.trim() || !isOwner) return;

		onStatusChange("building");
		try {
			// TODO: Wire to chain-shared buildAddTreasuryAdmin once available
			// const addresses = getContractAddresses(tenant);
			// const tx = buildAddTreasuryAdmin({
			// 	packageId: addresses.treasury?.packageId ?? "",
			// 	treasuryId: treasury.id,
			// 	adminAddress: addAdminAddress.trim(),
			// 	senderAddress: suiAddress,
			// });
			// await signAndExecute({ transaction: tx });

			// Local update
			const updated = [...treasury.admins, addAdminAddress.trim()];
			await db.treasuries.update(treasury.id, { admins: updated });
			setAddAdminAddress("");
			onStatusChange("done");
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleRemoveAdmin(addr: string) {
		if (!isOwner) return;

		onStatusChange("building");
		try {
			// TODO: Wire to chain-shared buildRemoveTreasuryAdmin once available
			const updated = treasury.admins.filter((a) => a !== addr);
			await db.treasuries.update(treasury.id, { admins: updated });
			onStatusChange("done");
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="mb-3 flex items-center justify-between">
				<div>
					<h3 className="text-sm font-bold text-zinc-100">{treasury.name}</h3>
					<div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
						<span>Owner:</span>
						<CopyAddress
							address={treasury.owner}
							sliceStart={10}
							sliceEnd={6}
							className="font-mono text-zinc-400"
						/>
						{isOwner && <span className="text-cyan-400">(you)</span>}
					</div>
				</div>
			</div>

			{/* Admins */}
			<div className="mb-3 border-t border-zinc-800 pt-3">
				<p className="mb-1.5 text-xs font-medium text-zinc-400">
					Admins ({treasury.admins.length})
				</p>
				{treasury.admins.length > 0 ? (
					<div className="mb-2 space-y-1">
						{treasury.admins.map((addr) => (
							<div key={addr} className="flex items-center justify-between">
								<CopyAddress
									address={addr}
									sliceStart={12}
									sliceEnd={6}
									className="font-mono text-xs text-zinc-400"
								/>
								{isOwner && (
									<button
										type="button"
										onClick={() => handleRemoveAdmin(addr)}
										className="text-zinc-600 transition-colors hover:text-red-400"
										title="Remove admin"
									>
										<UserMinus size={12} />
									</button>
								)}
							</div>
						))}
					</div>
				) : (
					<p className="mb-2 text-xs text-zinc-600">No admins added yet.</p>
				)}

				{isOwner && (
					<div className="flex items-center gap-2">
						<input
							type="text"
							value={addAdminAddress}
							onChange={(e) => setAddAdminAddress(e.target.value)}
							placeholder="Admin Sui address (0x...)"
							className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
						/>
						<button
							type="button"
							onClick={handleAddAdmin}
							disabled={!addAdminAddress.trim()}
							className="flex items-center gap-1 rounded bg-cyan-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
						>
							<UserPlus size={12} />
							Add
						</button>
					</div>
				)}
			</div>

			{/* Balances */}
			<div className="border-t border-zinc-800 pt-3">
				<p className="mb-2 text-xs font-medium text-zinc-400">Balances</p>
				{treasury.balances.length > 0 ? (
					<DataGrid
						columns={balanceColumns}
						data={treasury.balances}
						keyFn={(r) => r.coinType}
						searchPlaceholder="Search balances..."
						emptyMessage="No balances."
					/>
				) : (
					<p className="text-xs text-zinc-600">
						No balances yet. Deposit funds or set as toll recipient.
					</p>
				)}
			</div>
		</div>
	);
}

// ── Currency Management (migrated from Market.tsx) ────────────────────

function CurrencyManagement({
	currency,
	tenant,
	suiAddress,
	onStatusChange,
	onMarketCreated,
}: {
	currency: CurrencyRecord;
	tenant: TenantId;
	suiAddress: string;
	onStatusChange: (status: BuildStatus, error?: string) => void;
	onMarketCreated: () => void;
}) {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const suiClient = useSuiClient();

	const [marketInfo, setMarketInfo] = useState<MarketInfo | null>(null);
	const [loadingMarket, setLoadingMarket] = useState(false);
	const [totalSupply, setTotalSupply] = useState<bigint | null>(null);

	// Admin panel state
	const [showMint, setShowMint] = useState(false);
	const [mintAmount, setMintAmount] = useState("");
	const [mintRecipient, setMintRecipient] = useState("");
	const [showBurn, setShowBurn] = useState(false);
	const [burnCoinId, setBurnCoinId] = useState("");
	const [ownedCoins, setOwnedCoins] = useState<Array<{ objectId: string; balance: bigint }>>([]);
	const [loadingCoins, setLoadingCoins] = useState(false);
	const [showAuth, setShowAuth] = useState(false);
	const [authAddress, setAuthAddress] = useState("");
	const [showFees, setShowFees] = useState(false);
	const [feeBps, setFeeBps] = useState("");
	const [feeRecipient, setFeeRecipient] = useState("");

	const isPublished = !!currency.packageId;
	const hasMarket = !!currency.marketId;
	const addresses = getContractAddresses(tenant);
	const marketPkg = addresses.market?.packageId;
	const isCreator = marketInfo?.creator === suiAddress;
	const isAuthorized = isCreator || (marketInfo?.authorized ?? []).includes(suiAddress);

	// Address -> character name lookup from manifest
	const manifestChars = useLiveQuery(() => db.manifestCharacters.toArray()) ?? [];
	const charNameMap = useMemo(() => {
		const m = new Map<string, string>();
		for (const c of manifestChars) {
			if (c.suiAddress && c.name) m.set(c.suiAddress, c.name);
		}
		return m;
	}, [manifestChars]);

	useEffect(() => {
		if (hasMarket && currency.marketId) {
			loadMarketInfo();
		}
	}, [currency.marketId, hasMarket]);

	async function loadMarketInfo() {
		const marketId = currency.marketId;
		if (!marketId) return;
		setLoadingMarket(true);
		try {
			const info = await import("@tehfrontier/chain-shared").then((m) =>
				m.queryMarketDetails(suiClient, marketId),
			);
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

	async function loadOwnedCoins() {
		if (!currency.coinType) return;
		setLoadingCoins(true);
		try {
			const coins = await queryOwnedCoins(suiClient, suiAddress, currency.coinType);
			setOwnedCoins(coins);
		} catch {
			setOwnedCoins([]);
		} finally {
			setLoadingCoins(false);
		}
	}

	async function handleMint() {
		if (!mintAmount || !currency.marketId || !currency.coinType || !marketPkg) return;

		onStatusChange("minting");
		try {
			const amount = BigInt(Math.floor(Number(mintAmount) * 10 ** currency.decimals));
			const recipient = mintRecipient.trim() || suiAddress;
			const tx = buildMint({
				packageId: marketPkg,
				marketId: currency.marketId,
				coinType: currency.coinType,
				amount: Number(amount),
				recipient,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowMint(false);
			setMintAmount("");
			setMintRecipient("");
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleBurn() {
		if (!burnCoinId || !currency.marketId || !currency.coinType || !marketPkg) return;

		onStatusChange("burning");
		try {
			const tx = buildBurn({
				packageId: marketPkg,
				marketId: currency.marketId,
				coinType: currency.coinType,
				coinObjectId: burnCoinId,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowBurn(false);
			setBurnCoinId("");
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleAddAuthorized() {
		if (!authAddress.trim() || !currency.marketId || !currency.coinType || !marketPkg) return;

		onStatusChange("building");
		try {
			const tx = buildAddAuthorized({
				packageId: marketPkg,
				marketId: currency.marketId,
				coinType: currency.coinType,
				addr: authAddress.trim(),
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setAuthAddress("");
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleRemoveAuthorized(addr: string) {
		if (!currency.marketId || !currency.coinType || !marketPkg) return;

		onStatusChange("building");
		try {
			const tx = buildRemoveAuthorized({
				packageId: marketPkg,
				marketId: currency.marketId,
				coinType: currency.coinType,
				addr,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleUpdateFee() {
		if (!currency.marketId || !currency.coinType || !marketPkg) return;

		onStatusChange("building");
		try {
			const tx = buildUpdateFee({
				packageId: marketPkg,
				marketId: currency.marketId,
				coinType: currency.coinType,
				feeBps: Number(feeBps) || 0,
				feeRecipient: feeRecipient.trim() || suiAddress,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowFees(false);
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleDiscoverMarket() {
		if (!currency.coinType || !marketPkg) return;

		onStatusChange("building");
		try {
			const markets = await queryMarkets(suiClient, marketPkg, currency.coinType);

			if (markets.length === 0) {
				const treasuryCapId = await queryTreasuryCap(suiClient, currency.coinType, suiAddress);
				if (!treasuryCapId) {
					onStatusChange(
						"error",
						"No Market found on-chain and no TreasuryCap" +
							" in your wallet. The Market may have been" +
							" created with a different market package" +
							" version.",
					);
					return;
				}

				const tx = buildCreateMarket({
					packageId: marketPkg,
					coinType: currency.coinType,
					treasuryCapId,
					senderAddress: suiAddress,
				});

				const result = await signAndExecute({
					transaction: tx,
				});

				const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";
				const fullResult = await suiClient.waitForTransaction({
					digest,
					include: {
						effects: true,
						objectTypes: true,
					},
				});
				const fullTx = fullResult.Transaction ?? fullResult.FailedTransaction;
				const changedObjects = fullTx?.effects?.changedObjects ?? [];
				const objectTypesMap = fullTx?.objectTypes ?? {};

				let marketId: string | undefined;
				for (const change of changedObjects) {
					const objType = objectTypesMap[change.objectId] ?? "";
					if (objType.includes("::market::Market<")) {
						marketId = change.objectId;
						break;
					}
				}

				if (marketId) {
					await db.currencies.update(currency.id, {
						marketId,
						updatedAt: new Date().toISOString(),
					});
				}

				onStatusChange("done");
				onMarketCreated();
				return;
			}

			const market = markets[0];
			await db.currencies.update(currency.id, {
				marketId: market.objectId,
				updatedAt: new Date().toISOString(),
			});

			onStatusChange("done");
			onMarketCreated();
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div className="space-y-3">
			{/* Market Identity Card */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<div className="mb-3 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="rounded-lg bg-zinc-800 p-2">
							<Package size={16} className="text-cyan-500" />
						</div>
						<div>
							<h3 className="text-sm font-bold text-zinc-100">
								{currency.symbol}
								<span className="ml-2 text-xs font-normal text-zinc-400">{currency.name}</span>
							</h3>
							{hasMarket ? (
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
					{hasMarket && (
						<button
							type="button"
							onClick={loadMarketInfo}
							className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
							title="Refresh market data"
						>
							<RefreshCw size={12} />
							Refresh
						</button>
					)}
				</div>

				{loadingMarket ? (
					<div className="flex items-center gap-2 py-4 text-xs text-zinc-500">
						<Loader2 size={14} className="animate-spin" />
						Loading market data...
					</div>
				) : hasMarket && marketInfo ? (
					<>
						<div className="mb-3 grid grid-cols-3 gap-3">
							<StatBox
								label="Total Supply"
								value={
									totalSupply != null
										? `${formatTokenAmount(totalSupply, currency.decimals)} ${currency.symbol}`
										: "--"
								}
							/>
							<StatBox label="Fee" value={`${marketInfo.feeBps} bps`} />
							<StatBox label="Authorized" value={String(marketInfo.authorized.length)} />
						</div>

						<div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-zinc-800 pt-3 text-xs">
							<div>
								<span className="text-zinc-500">Market ID</span>
								<CopyAddress
									address={currency.marketId ?? ""}
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
								<span className="text-zinc-500">Coin Type</span>
								<p className="mt-0.5 truncate font-mono text-zinc-400">{currency.coinType}</p>
							</div>
						</div>
					</>
				) : null}

				{/* No market -- discover/create prompt */}
				{isPublished && !hasMarket && (
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
							<span className="text-xs text-zinc-500">Connect wallet</span>
						)}
					</div>
				)}
			</div>

			{/* Admin Actions */}
			{hasMarket && isAuthorized && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
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
									label="Authorize"
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

					{/* Expanded Admin Panels */}
					{(showMint || showBurn || showAuth || showFees) && (
						<div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
							{/* Mint Form */}
							{showMint && (
								<AdminPanel title={`Mint ${currency.symbol}`}>
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
										<FormField label="Recipient (blank = your wallet)">
											<input
												type="text"
												value={mintRecipient}
												onChange={(e) => setMintRecipient(e.target.value)}
												placeholder={suiAddress.slice(0, 16)}
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</FormField>
										{account ? (
											<button
												type="button"
												onClick={handleMint}
												disabled={!mintAmount}
												className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
											>
												Mint {currency.symbol}
											</button>
										) : (
											<span className="text-xs text-zinc-500">EVE Vault not connected</span>
										)}
									</div>
								</AdminPanel>
							)}

							{/* Burn Form */}
							{showBurn && (
								<AdminPanel title={`Burn ${currency.symbol}`}>
									{loadingCoins ? (
										<div className="flex items-center gap-2 text-xs text-zinc-500">
											<Loader2 size={12} className="animate-spin" />
											Loading your coins...
										</div>
									) : ownedCoins.length === 0 ? (
										<p className="text-xs text-zinc-600">
											No {currency.symbol} coins in your wallet.
										</p>
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
															{formatTokenAmount(c.balance, currency.decimals)} {currency.symbol} (
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
												<span className="text-xs text-zinc-500">EVE Vault not connected</span>
											)}
										</div>
									)}
								</AdminPanel>
							)}

							{/* Authorization Form (creator only) */}
							{showAuth && isCreator && (
								<AdminPanel title="Add Authorized Minter">
									<div className="space-y-3">
										<FormField label="Sui Address">
											<input
												type="text"
												value={authAddress}
												onChange={(e) => setAuthAddress(e.target.value)}
												placeholder="0x..."
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</FormField>
										<button
											type="button"
											onClick={handleAddAuthorized}
											disabled={!authAddress.trim()}
											className="flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
										>
											<UserPlus size={12} />
											Add Authorized
										</button>
									</div>

									{/* Current authorized list */}
									{marketInfo && marketInfo.authorized.length > 0 && (
										<div className="mt-3 border-t border-zinc-800 pt-3">
											<p className="mb-1.5 text-xs text-zinc-500">
												Currently authorized ({marketInfo.authorized.length})
											</p>
											<div className="space-y-1">
												{marketInfo.authorized.map((addr) => (
													<div key={addr} className="flex items-center justify-between">
														<span className="font-mono text-xs text-zinc-400">
															{addr.slice(0, 12)}
															...
															{addr.slice(-6)}
															{addr === suiAddress && (
																<span className="ml-1 text-cyan-400">(you)</span>
															)}
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

							{/* Fee Management (creator only) */}
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
				</div>
			)}
		</div>
	);
}

// ── Shared UI Components ─────────────────────────────────────────────

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
			className={`mb-6 rounded-lg border p-4 ${
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
			{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
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

function StatBox({
	label,
	value,
}: {
	label: string;
	value: string;
}) {
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

function AdminPanel({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
			<h4 className="mb-3 text-xs font-medium text-zinc-400">{title}</h4>
			{children}
		</div>
	);
}

function FormField({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="block">
			<span className="mb-1 block text-xs text-zinc-500">{label}</span>
			{children}
		</div>
	);
}

function CreateCurrencyForm({
	symbol,
	tokenName,
	description,
	decimals,
	isProcessing,
	hasAccount,
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
	hasAccount: boolean;
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
					{hasAccount ? (
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
					) : (
						<span className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-500">
							EVE Vault not connected
						</span>
					)}
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

// ── Utilities ────────────────────────────────────────────────────────

function formatTokenAmount(raw: bigint, decimals: number): string {
	if (decimals === 0) return raw.toString();
	const divisor = 10n ** BigInt(decimals);
	const whole = raw / divisor;
	const frac = raw % divisor;
	if (frac === 0n) return whole.toString();
	const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${whole}.${fracStr}`;
}
