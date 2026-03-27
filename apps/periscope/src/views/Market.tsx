import { useSuiClient } from "@/hooks/useSuiClient";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, Loader2, Package, RefreshCw, ShoppingBag, Store } from "lucide-react";
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
	buildSetSsuMarketLink,
	discoverSsuUnifiedConfig,
	getCoinMetadata,
	getContractAddresses,
	queryMarketBuyOrders,
	queryMarketDetails,
	queryMarketListings,
} from "@tehfrontier/chain-shared";
import type { MarketBuyOrder, MarketInfo, MarketSellListing } from "@tehfrontier/chain-shared";

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
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const tenant = useActiveTenant();
	const currencies = useLiveQuery(() => db.currencies.filter(notDeleted).toArray());
	const filteredCurrencies = useMemo(
		() => (currencies ?? []).filter((c) => !c._archived),
		[currencies],
	);

	const [selectedId, setSelectedId] = useState<string | null>(null);

	// Auto-select first market when list loads and nothing is selected.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedId intentionally omitted to prevent infinite loop
	useEffect(() => {
		if (!selectedId && filteredCurrencies.length > 0) {
			setSelectedId(filteredCurrencies[0].id);
		}
	}, [filteredCurrencies]);

	const suiClient = useSuiClient();

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

	const selectedCurrency = filteredCurrencies.find((c) => c.id === selectedId);

	return (
		<div className="flex h-full flex-col gap-4 p-4">
			{/* Header bar: title + market selector */}
			<div className="flex items-center gap-3">
				<span className="shrink-0 text-sm text-zinc-400">Market:</span>
				<div className="relative max-w-sm min-w-0 flex-1">
					<select
						value={selectedId ?? ""}
						onChange={(e) => setSelectedId(e.target.value || null)}
						className="w-full appearance-none rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-3 pr-8 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
					>
						<option value="">Select a market...</option>
						{filteredCurrencies.map((c) => (
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
			</div>

			{/* Market detail (fills remaining space) */}
			<div className="min-h-0 flex-1">
				{selectedCurrency ? (
					<MarketDetail currency={selectedCurrency} tenant={tenant} suiAddress={suiAddress} />
				) : (
					<div className="flex h-full items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/30">
						<div className="text-center">
							<ShoppingBag size={32} className="mx-auto mb-2 text-zinc-700" />
							<p className="text-sm text-zinc-500">
								{(currencies ?? []).length > 0
									? "Select a market to view orders"
									: "No markets yet -- create one in Treasury to get started"}
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
}: {
	currency: CurrencyRecord;
	tenant: TenantId;
	suiAddress: string;
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
	const [linkSsuId, setLinkSsuId] = useState("");
	const [linkStatus, setLinkStatus] = useState<"idle" | "linking" | "done" | "error">("idle");
	const [linkError, setLinkError] = useState("");

	const hasMarket = !!currency.marketId;
	const addresses = getContractAddresses(tenant);
	const marketPkg = addresses.market?.packageId;

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

		// Private map cache
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

	async function loadAll() {
		await Promise.all([loadMarketInfo(), loadOrders()]);
	}

	async function handleLinkToSsu(ssuObjectId: string) {
		if (!currency.marketId || !currency.coinType) return;

		const ssuUnifiedAddresses = getContractAddresses(tenant).ssuUnified;
		const ssuUnifiedPkg = ssuUnifiedAddresses?.packageId;
		if (!ssuUnifiedPkg) return;

		setLinkStatus("linking");
		setLinkError("");
		try {
			const currentConfigId = await discoverSsuUnifiedConfig(suiClient, ssuUnifiedPkg, ssuObjectId);
			if (!currentConfigId) {
				setLinkStatus("error");
				setLinkError(
					"No SsuUnifiedConfig found on-chain for this SSU. Deploy the SSU extension first.",
				);
				return;
			}

			const tx = buildSetSsuMarketLink({
				packageId: ssuUnifiedPkg,
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

			setLinkStatus("done");
		} catch (err) {
			setLinkStatus("error");
			setLinkError(err instanceof Error ? err.message : String(err));
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
									{marketInfo.creator === suiAddress && (
										<span className="text-cyan-400">(you)</span>
									)}
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

				{/* Link Market to SSU -- visible whenever a market is linked */}
				{hasMarket && (
					<div className="mt-3 border-t border-zinc-800 pt-3">
						<div className="flex items-center gap-2">
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
									disabled={!linkSsuId || linkStatus === "linking"}
									className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
								>
									{linkStatus === "linking" ? "Linking..." : "Link"}
								</button>
							) : (
								<span className="text-xs text-zinc-500">Connect wallet to link</span>
							)}
						</div>
						{linkStatus === "error" && linkError && (
							<p className="mt-1 text-xs text-red-400">{linkError}</p>
						)}
						{linkStatus === "done" && (
							<p className="mt-1 text-xs text-green-400">SSU linked successfully.</p>
						)}
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
		</div>
	);
}

// ── Shared UI Components ─────────────────────────────────────────────

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
