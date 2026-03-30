import { db, notDeleted } from "@/db";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import {
	type TenantId,
	getContractAddresses,
	queryAllMarketsStandings,
	queryDecommissionedMarkets,
} from "@tehfrontier/chain-shared";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface MarketSelectorProps {
	value: string;
	onChange: (marketId: string) => void;
}

interface MarketOption {
	marketId: string;
	symbol: string;
	adminName: string;
	tribeName: string;
	creator: string;
}

/**
 * Dropdown selector for Market objects. Combines:
 * 1. Local db.currencies records with marketId (user-created currencies)
 * 2. Cached db.manifestMarkets records (chain-discovered markets)
 * 3. Live chain query for market_standings::Market objects
 */
export function MarketSelector({ value, onChange }: MarketSelectorProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [customMode, setCustomMode] = useState(false);
	const [customId, setCustomId] = useState(value);

	const client = useSuiClient();
	const tenant = useActiveTenant() as TenantId;
	const addrs = getContractAddresses(tenant);

	// Local currency records (same source the Currencies page uses)
	const currencies = useLiveQuery(() => db.currencies.filter(notDeleted).toArray(), []) ?? [];

	// Cached manifest markets (chain-discovered market::Market<T> objects)
	const manifestMarkets = useLiveQuery(() => db.manifestMarkets.toArray(), []) ?? [];

	// Resolve admin/tribe names from manifest
	const manifestChars = useLiveQuery(() => db.manifestCharacters.toArray(), []) ?? [];
	const manifestTribes = useLiveQuery(() => db.manifestTribes.toArray(), []) ?? [];

	// Decommissioned market IDs (filtered out of all sources)
	const [decommissioned, setDecommissioned] = useState<Set<string>>(new Set());

	// Standings markets from chain (market_standings::Market<T>)
	const [standingsOptions, setStandingsOptions] = useState<MarketOption[]>([]);

	function symbolFromCoinType(ct: string): string {
		const parts = ct.split("::");
		return parts.length >= 3 ? parts[2].replace(/_TOKEN$/, "") : (parts[1] ?? ct);
	}

	function resolveNames(creatorAddr: string) {
		const adminChar = creatorAddr
			? manifestChars.find((mc) => mc.suiAddress === creatorAddr)
			: undefined;
		const adminName = adminChar?.name ?? "";
		const tribeName = adminChar?.tribeId
			? (manifestTribes.find((t) => t.id === adminChar.tribeId)?.name ?? "")
			: "";
		return { adminName, tribeName };
	}

	// Build options from local currencies that have a marketId
	const currencyOptions = useMemo<MarketOption[]>(() => {
		return currencies
			.filter((c) => c.marketId)
			.map((c) => ({
				marketId: c.marketId!,
				symbol: c.symbol,
				adminName: "",
				tribeName: "",
				creator: "",
			}));
	}, [currencies]);

	// Build options from cached manifest markets
	const manifestOptions = useMemo<MarketOption[]>(() => {
		return manifestMarkets.map((m) => {
			const { adminName, tribeName } = resolveNames(m.creator);
			return {
				marketId: m.id,
				symbol: symbolFromCoinType(m.coinType),
				adminName,
				tribeName,
				creator: m.creator,
			};
		});
	}, [manifestMarkets, manifestChars, manifestTribes]);

	// Discover decommissioned markets
	useEffect(() => {
		const decomPkg = addrs.decommission?.packageId;
		if (!decomPkg) return;
		let cancelled = false;
		queryDecommissionedMarkets(client, decomPkg)
			.then((set) => { if (!cancelled) setDecommissioned(set); })
			.catch(() => {});
		return () => { cancelled = true; };
	}, [client, addrs.decommission?.packageId]);

	// Discover standings markets from chain
	useEffect(() => {
		const standingsPkg = addrs.marketStandings?.packageId;
		if (!standingsPkg) return;
		let cancelled = false;

		async function discover() {
			try {
				const markets = await queryAllMarketsStandings(client, standingsPkg!);
				if (cancelled) return;
				const results: MarketOption[] = [];
				for (const m of markets) {
					const { adminName, tribeName } = resolveNames(m.creator);
					results.push({
						marketId: m.objectId,
						symbol: symbolFromCoinType(m.coinType),
						adminName,
						tribeName,
						creator: m.creator,
					});
				}
				setStandingsOptions(results);
			} catch {
				/* non-fatal */
			}
		}

		discover();
		return () => {
			cancelled = true;
		};
	}, [client, addrs.marketStandings?.packageId, manifestChars, manifestTribes]);

	// Merge all sources, dedup by marketId, exclude decommissioned
	const options = useMemo<MarketOption[]>(() => {
		const seen = new Set<string>();
		const merged: MarketOption[] = [];

		// Manifest markets first (they have creator/admin info)
		for (const opt of manifestOptions) {
			if (!seen.has(opt.marketId) && !decommissioned.has(opt.marketId)) {
				seen.add(opt.marketId);
				merged.push(opt);
			}
		}
		// Local currency records (user-created currencies)
		for (const opt of currencyOptions) {
			if (!seen.has(opt.marketId) && !decommissioned.has(opt.marketId)) {
				seen.add(opt.marketId);
				merged.push(opt);
			}
		}
		// Standings markets from chain
		for (const opt of standingsOptions) {
			if (!seen.has(opt.marketId) && !decommissioned.has(opt.marketId)) {
				seen.add(opt.marketId);
				merged.push(opt);
			}
		}
		return merged;
	}, [manifestOptions, currencyOptions, standingsOptions, decommissioned]);

	const filtered = useMemo(() => {
		if (!search) return options;
		const q = search.toLowerCase();
		return options.filter(
			(o) =>
				o.symbol.toLowerCase().includes(q) ||
				o.adminName.toLowerCase().includes(q) ||
				o.tribeName.toLowerCase().includes(q) ||
				o.marketId.toLowerCase().includes(q),
		);
	}, [options, search]);

	const selected = options.find((o) => o.marketId === value) ?? null;

	function formatCreator(addr: string): string {
		if (!addr) return "";
		return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
	}

	if (customMode) {
		return (
			<div className="space-y-2">
				<input
					type="text"
					value={customId}
					onChange={(e) => setCustomId(e.target.value)}
					placeholder="0x... (paste Market object ID)"
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => {
							if (customId) onChange(customId);
							setCustomMode(false);
						}}
						className="rounded bg-cyan-600 px-2 py-1 text-xs font-medium text-white hover:bg-cyan-500"
					>
						Apply
					</button>
					<button
						type="button"
						onClick={() => {
							setCustomMode(false);
							setCustomId(value);
						}}
						className="text-xs text-zinc-500 hover:text-zinc-300"
					>
						Cancel
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:border-zinc-600 focus:border-cyan-500 focus:outline-none"
			>
				{selected ? (
					<span>
						<span className="font-medium">{selected.symbol}</span>
						{selected.adminName && (
							<span className="ml-2 text-xs text-zinc-500">
								{selected.adminName}
								{selected.tribeName && ` [${selected.tribeName}]`}
							</span>
						)}
					</span>
				) : value ? (
					<span className="font-mono text-xs text-zinc-400">{formatCreator(value)}</span>
				) : (
					<span className="text-zinc-500">Select a market...</span>
				)}
				<div className="flex items-center gap-1">
					{value && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onChange("");
							}}
							className="rounded p-0.5 text-zinc-500 hover:text-zinc-300"
							title="Clear selection"
						>
							<X size={12} />
						</button>
					)}
					<ChevronDown size={14} className="text-zinc-500" />
				</div>
			</button>

			{open && (
				<div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
					{/* Search */}
					<div className="border-b border-zinc-800 p-2">
						<div className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-2 py-1">
							<Search size={12} className="text-zinc-500" />
							<input
								type="text"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Escape") setOpen(false);
								}}
								placeholder="Search markets..."
								className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
							/>
						</div>
					</div>

					{/* Options */}
					<div className="max-h-48 overflow-auto">
						{filtered.map((opt) => (
							<button
								key={opt.marketId}
								type="button"
								onClick={() => {
									onChange(opt.marketId);
									setOpen(false);
									setSearch("");
								}}
								className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-zinc-800 ${
									opt.marketId === value ? "text-cyan-400" : "text-zinc-300"
								}`}
							>
								<div>
									<span className="font-medium">{opt.symbol}</span>
									{opt.adminName && (
										<span className="ml-2 text-zinc-500">
											{opt.adminName}
											{opt.tribeName && <span className="text-zinc-600"> [{opt.tribeName}]</span>}
										</span>
									)}
								</div>
								{opt.creator && (
									<span className="font-mono text-zinc-600">{formatCreator(opt.creator)}</span>
								)}
							</button>
						))}
						{filtered.length === 0 && (
							<div className="px-3 py-3 text-xs text-zinc-600">
								{options.length === 0 ? "No currencies with markets found." : "No matches"}
							</div>
						)}
					</div>

					{/* Footer: custom paste option */}
					<div className="border-t border-zinc-800 p-2">
						<button
							type="button"
							onClick={() => {
								setCustomMode(true);
								setOpen(false);
							}}
							className="w-full rounded px-2 py-1.5 text-left text-xs text-cyan-400 hover:bg-cyan-900/20"
						>
							Paste custom ID
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
