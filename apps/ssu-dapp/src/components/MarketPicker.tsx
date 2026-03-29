import { useSuiClient } from "@/hooks/useSuiClient";
import { getTenant } from "@/lib/constants";
import {
	type TenantId,
	getContractAddresses,
	queryAllMarketsStandings,
	queryDecommissionedMarkets,
	queryMarkets,
} from "@tehfrontier/chain-shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { useState } from "react";

interface MarketPickerProps {
	value: string;
	onChange: (marketId: string) => void;
}

interface MarketOption {
	objectId: string;
	coinSymbol: string;
	coinType: string;
	source: "market" | "market_standings";
}

export function MarketPicker({ value, onChange }: MarketPickerProps) {
	const client = useSuiClient();
	const [open, setOpen] = useState(false);
	const [customMode, setCustomMode] = useState(false);
	const [customId, setCustomId] = useState(value);

	const { data: markets, isLoading } = useQuery({
		queryKey: ["all-markets-combined"],
		queryFn: async (): Promise<MarketOption[]> => {
			const tenant = getTenant() as TenantId;
			const addrs = getContractAddresses(tenant);
			const results: MarketOption[] = [];

			// Query decommissioned markets to filter them out
			let decommissioned = new Set<string>();
			const decomPkg = addrs.decommission?.packageId;
			if (decomPkg) {
				try {
					decommissioned = await queryDecommissionedMarkets(client, decomPkg);
				} catch {
					// non-fatal
				}
			}

			// Query regular market::Market<T>
			const marketPkg = addrs.market?.packageId;
			if (marketPkg) {
				try {
					const items = await queryMarkets(client, marketPkg);
					for (const m of items) {
						if (m.totalSupply == null) continue; // skip unqueryable markets
						if (decommissioned.has(m.objectId)) continue;
						results.push({
							objectId: m.objectId,
							coinSymbol: formatCoinType(m.coinType),
							coinType: m.coinType,
							source: "market",
						});
					}
				} catch {
					// non-fatal
				}
			}

			// Query market_standings::Market<T>
			const msPkg = addrs.marketStandings?.packageId;
			if (msPkg) {
				try {
					const items = await queryAllMarketsStandings(client, msPkg);
					for (const m of items) {
						if (m.totalSupply == null) continue; // skip unqueryable markets
						if (decommissioned.has(m.objectId)) continue;
						if (results.some((r) => r.objectId === m.objectId)) continue;
						results.push({
							objectId: m.objectId,
							coinSymbol: formatCoinType(m.coinType),
							coinType: m.coinType,
							source: "market_standings",
						});
					}
				} catch {
					// non-fatal
				}
			}

			results.sort((a, b) => a.coinSymbol.localeCompare(b.coinSymbol));
			return results;
		},
		staleTime: 120_000,
	});

	const selected = markets?.find((m) => m.objectId === value);

	if (customMode) {
		return (
			<div className="space-y-1.5">
				<input
					type="text"
					value={customId}
					onChange={(e) => setCustomId(e.target.value)}
					placeholder="0x... (paste Market object ID)"
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => {
							if (customId) onChange(customId);
							setCustomMode(false);
						}}
						className="rounded bg-cyan-600 px-2 py-1 text-xs text-white hover:bg-cyan-500"
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
				className="flex w-full items-center justify-between rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-left text-xs text-zinc-200 hover:border-zinc-600 focus:border-cyan-500 focus:outline-none"
			>
				{selected ? (
					<span>
						<span className="font-medium">{selected.coinSymbol}</span>
						<span className="ml-1.5 text-zinc-600">
							({selected.source === "market_standings" ? "standings" : "market"})
						</span>
					</span>
				) : value ? (
					<span className="font-mono text-zinc-400">{value.slice(0, 10)}...</span>
				) : (
					<span className="text-zinc-500">
						{isLoading ? "Loading..." : "None (optional)"}
					</span>
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
						>
							<X size={10} />
						</button>
					)}
					<ChevronDown size={12} className="text-zinc-500" />
				</div>
			</button>

			{open && (
				<div className="absolute left-0 top-full z-50 mt-1 w-full rounded border border-zinc-700 bg-zinc-900 shadow-xl">
					<div className="max-h-48 overflow-auto">
						{(markets ?? []).map((m) => (
							<button
								key={m.objectId}
								type="button"
								onClick={() => {
									onChange(m.objectId);
									setOpen(false);
								}}
								className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-zinc-800 ${
									m.objectId === value ? "text-cyan-400" : "text-zinc-300"
								}`}
							>
								<span>
									<span className="font-medium">{m.coinSymbol}</span>
									<span className="ml-1.5 text-zinc-600">
										({m.source === "market_standings" ? "standings" : "market"})
									</span>
								</span>
								<span className="font-mono text-zinc-600">
									{m.objectId.slice(0, 8)}...
								</span>
							</button>
						))}
						{!isLoading && (markets ?? []).length === 0 && (
							<p className="px-2 py-2 text-xs text-zinc-600">No markets found</p>
						)}
					</div>
					<div className="border-t border-zinc-800 p-1.5">
						<button
							type="button"
							onClick={() => {
								setCustomMode(true);
								setOpen(false);
							}}
							className="w-full rounded px-2 py-1 text-left text-xs text-cyan-400 hover:bg-cyan-900/20"
						>
							Paste custom ID
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

function formatCoinType(coinType: string): string {
	const parts = coinType.split("::");
	return parts.length >= 3 ? parts[parts.length - 1] : coinType.slice(0, 16);
}
