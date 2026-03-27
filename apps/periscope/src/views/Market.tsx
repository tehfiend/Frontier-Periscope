import { useSuiClient } from "@/hooks/useSuiClient";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
	ChevronDown,
	Flame,
	Loader2,
	Package,
	Plus,
	RefreshCw,
	Send,
	Settings,
	ShoppingBag,
	Store,
	UserMinus,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { TenantId } from "@/chain/config";
import { discoverMarkets } from "@/chain/manifest";
import { CopyAddress } from "@/components/CopyAddress";
import { type ColumnDef, DataGrid, excelFilterFn } from "@/components/DataGrid";
import { db, notDeleted } from "@/db";
import type { CurrencyRecord } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import {
	buildAddAuthorized,
	buildBurn,
	buildCreateMarket,
	buildMint,
	buildPublishToken,
	buildRemoveAuthorized,
	buildSetMarketStandings,
	buildUpdateFee,
	discoverSsuConfigStandings,
	getCoinMetadata,
	getContractAddresses,
	parsePublishResult,
	queryMarketBuyOrders,
	queryMarketDetails,
	queryMarketListings,
	queryMarkets,
	queryOwnedCoins,
	queryTreasuryCap,
} from "@tehfrontier/chain-shared";
import type { MarketBuyOrder, MarketInfo, MarketSellListing } from "@tehfrontier/chain-shared";

type BuildStatus = "idle" | "building" | "minting" | "burning" | "done" | "error";

/** Assembly type names that are SSU-class structures */
const SSU_TYPE_NAMES = new Set([
	"Smart Storage Unit",
	"Heavy Storage",
	"Protocol Depot",
	"Portable Storage",
	"Gatekeeper",
]);

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

export function Market() {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const tenant = useActiveTenant();
	const currencies = useLiveQuery(() => db.currencies.filter(notDeleted).toArray());

	const [creating, setCreating] = useState(false);
	const [symbol, setSymbol] = useState("");
	const [tokenName, setTokenName] = useState("");
	const [description, setDescription] = useState("");
	const [decimals, setDecimals] = useState(9);
	const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
	const [buildError, setBuildError] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);

	// Auto-select first market when list loads and nothing is selected.
	// Only re-run when currencies changes -- omit selectedId to avoid a set/dep loop.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedId intentionally omitted to prevent infinite loop
	useEffect(() => {
		if (!selectedId && currencies && currencies.length > 0) {
			setSelectedId(currencies[0].id);
		}
	}, [currencies]);

	const suiClient = useSuiClient();

	const isProcessing =
		buildStatus === "building" || buildStatus === "minting" || buildStatus === "burning";

	// Sync currencies from manifest cache -- reads cached Market<T> objects
	const syncMarkets = useCallback(async () => {
		if (!suiAddress) return;

		try {
			// Refresh manifest cache first
			await discoverMarkets(suiClient);

			// Read from cached manifest
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

	if (!activeCharacter || !suiAddress) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<Store size={48} className="mx-auto mb-4 text-zinc-700" />
					<p className="text-sm text-zinc-500">Select a character to manage markets</p>
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

	const selectedCurrency = currencies?.find((c) => c.id === selectedId);

	return (
		<div className="flex h-full flex-col gap-4 p-4">
			{/* Header bar: title + market selector + create */}
			<div className="flex items-center gap-3">
				<span className="shrink-0 text-sm text-zinc-400">Market:</span>
				<div className="relative max-w-sm min-w-0 flex-1">
					<select
						value={selectedId ?? ""}
						onChange={(e) => setSelectedId(e.target.value || null)}
						className="w-full appearance-none rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-3 pr-8 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
					>
						<option value="">Select a market...</option>
						{(currencies ?? []).map((c) => (
							<option key={c.id} value={c.id}>
								{c.symbol} -- {c.name}
								{c.marketId ? "" : " (no market)"}
							</option>
						))}
					</select>
					<ChevronDown
						size={14}
						className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
					/>
				</div>

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

			{/* Create Currency Form (inline, shown when creating) */}
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

			{/* Market detail (fills remaining space) */}
			<div className="min-h-0 flex-1">
				{selectedCurrency ? (
					<MarketDetail
						currency={selectedCurrency}
						tenant={tenant}
						suiAddress={suiAddress}
						onStatusChange={(s, e) => {
							setBuildStatus(s);
							setBuildError(e ?? "");
						}}
						onMarketCreated={syncMarkets}
					/>
				) : (
					<div className="flex h-full items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/30">
						<div className="text-center">
							<ShoppingBag size={32} className="mx-auto mb-2 text-zinc-700" />
							<p className="text-sm text-zinc-500">
								{(currencies ?? []).length > 0
									? "Select a market to view orders"
									: "No markets yet -- create one to get started"}
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

// ── Market Detail (expanded view) ────────────────────────────────────

function MarketDetail({
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
	const [sellListings, setSellListings] = useState<MarketSellListing[]>([]);
	const [buyOrders, setBuyOrders] = useState<MarketBuyOrder[]>([]);
	const [loadingOrders, setLoadingOrders] = useState(false);
	const [itemNameMap, setItemNameMap] = useState<Map<number, string>>(new Map());

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
	const [linkSsuId, setLinkSsuId] = useState("");

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

	// SSU location lookup: ssuObjectId -> system name
	// Sources: public manifest, private map cache, local deployables
	const manifestLocs = useLiveQuery(() => db.manifestLocations.toArray()) ?? [];
	const mapLocs = useLiveQuery(() => db.manifestMapLocations.toArray()) ?? [];
	const systems = useLiveQuery(() => db.solarSystems.toArray()) ?? [];
	const allDeployables = useLiveQuery(() => db.deployables.toArray()) ?? [];
	const allSsus = useMemo(
		() => allDeployables.filter((d) => SSU_TYPE_NAMES.has(d.assemblyType)),
		[allDeployables],
	);

	const ssuLocationMap = useMemo(() => {
		const sysNames = new Map<number, string>();
		for (const s of systems) {
			if (s.name) sysNames.set(s.id, s.name);
		}

		const loc = new Map<string, string>();

		// Public manifest locations (LocationRevealedEvent)
		for (const m of manifestLocs) {
			const name = sysNames.get(m.solarsystem);
			if (name) loc.set(m.id, m.lPoint ? `${name} ${m.lPoint}` : name);
		}

		// Private map cache (already decrypted, no re-decrypt needed)
		for (const m of mapLocs) {
			if (m.structureId && m.solarSystemId && !loc.has(m.structureId)) {
				const name = sysNames.get(m.solarSystemId);
				if (name) {
					const lp = m.planet && m.lPoint ? ` P${m.planet}L${m.lPoint}` : "";
					loc.set(m.structureId, `${name}${lp}`);
				}
			}
		}

		// Local deployables (user's own structures)
		for (const d of allSsus) {
			if (d.objectId && d.systemId && !loc.has(d.objectId)) {
				const name = sysNames.get(d.systemId);
				if (name) loc.set(d.objectId, d.lPoint ? `${name} ${d.lPoint}` : name);
			}
		}

		return loc;
	}, [manifestLocs, mapLocs, systems, allSsus]);

	// Trade nodes for "Link to SSU" action
	const tradeNodes = useLiveQuery(() => db.tradeNodes.toArray()) ?? [];

	// Unified order rows for the DataGrid
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

	const coinDecimals = currency.decimals;
	const coinSymbol = currency.symbol;

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
							{d.toLocaleDateString([], {
								month: "numeric",
								day: "numeric",
							})}{" "}
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

	// Load market info + orders when market is selected
	useEffect(() => {
		if (hasMarket && currency.marketId) {
			loadAll();
		}
	}, [currency.marketId, hasMarket]);

	async function loadMarketInfo() {
		if (!currency.marketId) return;
		setLoadingMarket(true);
		try {
			const info = await queryMarketDetails(suiClient, currency.marketId);
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
		if (!currency.marketId || !marketPkg) return;
		setLoadingOrders(true);
		try {
			const [sells, buys] = await Promise.all([
				queryMarketListings(suiClient, currency.marketId, marketPkg),
				queryMarketBuyOrders(suiClient, currency.marketId, marketPkg),
			]);
			setSellListings(sells);
			setBuyOrders(buys);

			// Resolve item names for all typeIds in the orders
			const typeIds = new Set<number>();
			for (const l of sells) typeIds.add(l.typeId);
			for (const o of buys) typeIds.add(o.typeId);
			if (typeIds.size > 0) {
				const names = new Map<number, string>();
				// First pass: check local gameTypes DB
				const dbTypes = await db.gameTypes.bulkGet([...typeIds]);
				for (const t of dbTypes) {
					if (t) names.set(t.id, t.name);
				}
				// Second pass: fetch missing from World API
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

	async function loadAll() {
		await Promise.all([loadMarketInfo(), loadOrders()]);
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

	async function handleLinkToSsu(ssuObjectId: string) {
		if (!currency.marketId || !currency.coinType) return;

		const ssuMarketAddresses = getContractAddresses(tenant).ssuMarket;
		const ssuMarketPkg = ssuMarketAddresses?.packageId;
		const originalPkg = ssuMarketAddresses?.originalPackageId ?? ssuMarketPkg;
		const previousPkgs = ssuMarketAddresses?.previousOriginalPackageIds;
		if (!ssuMarketPkg || !originalPkg) return;

		onStatusChange("building");
		try {
			const currentConfigId = await discoverSsuConfigStandings(
				suiClient,
				originalPkg,
				ssuObjectId,
				previousPkgs,
			);
			if (!currentConfigId) {
				onStatusChange(
					"error",
					"No SsuConfig found on-chain for this SSU." + " Deploy the extension first.",
				);
				return;
			}

			const tx = buildSetMarketStandings({
				packageId: ssuMarketPkg,
				ssuConfigId: currentConfigId,
				marketId: currency.marketId,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });

			const tn = tradeNodes.find((t) => t.id === ssuObjectId);
			if (tn) {
				await db.tradeNodes.update(tn.id, {
					marketConfigId: currentConfigId,
				});
			}

			onStatusChange("done");
			onMarketCreated();
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto">
			{/* Market Identity */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<div className="mb-4 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="rounded-lg bg-zinc-800 p-2.5">
							<Package size={20} className="text-cyan-500" />
						</div>
						<div>
							<h2 className="text-lg font-bold text-zinc-100">
								{currency.symbol}
								<span className="ml-2 text-sm font-normal text-zinc-400">{currency.name}</span>
							</h2>
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
							onClick={loadAll}
							className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
							title="Refresh all data"
						>
							<RefreshCw size={12} />
							Refresh
						</button>
					)}
				</div>

				{/* Metadata fields */}
				{loadingMarket ? (
					<div className="flex items-center gap-2 py-4 text-xs text-zinc-500">
						<Loader2 size={14} className="animate-spin" />
						Loading market data...
					</div>
				) : hasMarket && marketInfo ? (
					<>
						{/* Stat boxes */}
						<div className="mb-4 grid grid-cols-3 gap-3">
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

						{/* Metadata rows */}
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
				) : hasMarket ? (
					<p className="text-xs text-zinc-600">Loading market data...</p>
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

				{/* Admin Actions -- always visible for authorized users */}
				{hasMarket && isAuthorized && (
					<div className="border-t border-zinc-800 pt-3 mt-3">
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

							{/* Link Market to SSU -- inline */}
							<div className="ml-auto flex items-center gap-2">
								<select
									value={linkSsuId}
									onChange={(e) => setLinkSsuId(e.target.value)}
									className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none"
								>
									<option value="">Link to SSU...</option>
									{allSsus.map((ssu) => (
										<option key={ssu.objectId} value={ssu.objectId}>
											{ssu.label || `${ssu.objectId.slice(0, 14)}...`}
											{ssu.systemId ? ` (System ${ssu.systemId})` : ""}
										</option>
									))}
								</select>
								{account ? (
									<button
										type="button"
										onClick={() => {
											if (linkSsuId) handleLinkToSsu(linkSsuId);
										}}
										disabled={!linkSsuId}
										className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
									>
										Link
									</button>
								) : (
									<span className="text-xs text-zinc-500">Connect wallet to link</span>
								)}
							</div>
						</div>
					</div>
				)}
			</div>

			{/* Order Book */}
			{hasMarket && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
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

			{/* Expanded Admin Panels */}
			{hasMarket && isAuthorized && (showMint || showBurn || showAuth || showFees) && (
				<div className="space-y-3">
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
								<p className="text-xs text-zinc-600">No {currency.symbol} coins in your wallet.</p>
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

/** Format a bigint price with commas in the whole part. */
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
