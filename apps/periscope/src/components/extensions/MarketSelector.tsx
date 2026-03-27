import { db } from "@/db";
import { useSuiClient } from "@/hooks/useSuiClient";
import { queryMarketDetails } from "@tehfrontier/chain-shared";
import type { MarketInfo } from "@tehfrontier/chain-shared";
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
 * Dropdown selector for Market objects linked to currencies in the local DB.
 * Queries db.currencies for records with non-null marketId, resolves admin
 * names and tribe names from manifest tables, and fetches MarketInfo from
 * chain to get the creator address.
 */
export function MarketSelector({ value, onChange }: MarketSelectorProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [customMode, setCustomMode] = useState(false);
	const [customId, setCustomId] = useState(value);

	const client = useSuiClient();

	// Query currencies with marketId
	const currencies = useLiveQuery(() => db.currencies.toArray(), []);
	const currenciesWithMarket = useMemo(
		() => (currencies ?? []).filter((c) => c.marketId),
		[currencies],
	);

	// Resolve admin/tribe names from manifest
	const manifestChars = useLiveQuery(() => db.manifestCharacters.toArray(), []) ?? [];
	const manifestTribes = useLiveQuery(() => db.manifestTribes.toArray(), []) ?? [];

	// Fetch MarketInfo for each currency's marketId to get creator address
	const [marketInfoMap, setMarketInfoMap] = useState<Map<string, MarketInfo>>(new Map());

	useEffect(() => {
		if (currenciesWithMarket.length === 0) return;
		let cancelled = false;

		async function fetchAll() {
			const newMap = new Map<string, MarketInfo>();
			for (const c of currenciesWithMarket) {
				if (!c.marketId) continue;
				try {
					const info = await queryMarketDetails(client, c.marketId);
					if (info && !cancelled) {
						newMap.set(c.marketId, info);
					}
				} catch {
					// non-fatal
				}
			}
			if (!cancelled) setMarketInfoMap(newMap);
		}

		fetchAll();
		return () => {
			cancelled = true;
		};
	}, [currenciesWithMarket, client]);

	// Build options
	const options: MarketOption[] = useMemo(() => {
		return currenciesWithMarket.map((c) => {
			const info = c.marketId ? marketInfoMap.get(c.marketId) : undefined;
			const creatorAddr = info?.creator ?? "";

			// Resolve admin name from manifest characters (by suiAddress)
			const adminChar = creatorAddr
				? manifestChars.find((mc) => mc.suiAddress === creatorAddr)
				: undefined;
			const adminName = adminChar?.name ?? "";

			// Resolve tribe name
			const tribeName = adminChar?.tribeId
				? (manifestTribes.find((t) => t.id === adminChar.tribeId)?.name ?? "")
				: "";

			return {
				marketId: c.marketId ?? "",
				symbol: c.symbol,
				adminName,
				tribeName,
				creator: creatorAddr,
			};
		});
	}, [currenciesWithMarket, marketInfoMap, manifestChars, manifestTribes]);

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
