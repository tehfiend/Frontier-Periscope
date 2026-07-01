// Chain SSU stock selector -- plan 39 Phase 7.
//
// Lets the Build Queue pick which on-chain storage units (SSUs) contribute their LIVE inventory to the
// queue's baseStock. The old flat localStorage `bom-manual-stock` manual-entry path was removed in plan
// 39 Phase 7: persistent manual containers now live in Assets (field storage) and queue-local what-if
// stock lives in the ScratchPadPanel (both use the EF inventory paste parser). This panel is purely
// chain-backed; BuildQueue only renders it when chain features are enabled.

import { type AssemblyInventory, fetchAssemblyInventory } from "@/chain/inventory";
import { db } from "@/db";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useOwnedAssemblies } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { Box, ChevronDown, ChevronRight, Loader2, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

// ── localStorage keys ───────────────────────────────────────────────────────

const LS_SELECTED_SSUS = "bom-selected-ssus";

function loadFromStorage<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function saveToStorage<T>(key: string, value: T): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// quota exceeded -- silently ignore
	}
}

/**
 * Display label for an SSU: its structure NAME, else the in-game structure ID (itemId / TenantItemId),
 * and only as a last resort a truncated objectId (the Sui ADDRESS) -- never the raw address when a
 * structure ID is known.
 */
function ssuLabel(name: string | undefined, itemId: string | undefined, objectId: string): string {
	return name?.trim() || itemId || `${objectId.slice(0, 8)}...${objectId.slice(-4)}`;
}

// ── SSU stock panel ──────────────────────────────────────────────────────────

/**
 * One selected on-chain storage unit's live inventory, surfaced as its own container (plan 41 B5).
 * Each SSU keeps its real objectId (-> `{ kind: "chain", id }` ContainerRef in the breakdown) and its
 * solar system (resolved from synced structure intel; undefined when unsynced) so the Build Queue can
 * deposit into / source from a specific SSU and distance-rank each individually instead of collapsing
 * all SSUs into one anonymous aggregate.
 */
export interface SsuInventory {
	objectId: string;
	name: string;
	systemId?: number;
	items: Map<number, number>;
}

interface BomStockPanelProps {
	onBreakdownChange: (ssus: SsuInventory[]) => void;
}

export function BomStockPanel({ onBreakdownChange }: BomStockPanelProps) {
	const [open, setOpen] = useState(false);
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const client = useSuiClient();
	const { data: discovery, isLoading: loadingAssemblies } = useOwnedAssemblies();

	// SSU selection state (persisted so the chosen containers survive reloads).
	const [selectedSsuIds, setSelectedSsuIds] = useState<string[]>(() =>
		loadFromStorage<string[]>(LS_SELECTED_SSUS, []),
	);

	useEffect(() => {
		saveToStorage(LS_SELECTED_SSUS, selectedSsuIds);
	}, [selectedSsuIds]);

	// Find storage-type assemblies.
	const storageAssemblies = useMemo(
		() => discovery?.assemblies.filter((a) => a.type === "storage_unit") ?? [],
		[discovery],
	);

	// Fetch inventories for selected SSUs.
	const enabledSsus = storageAssemblies.filter((a) => selectedSsuIds.includes(a.objectId));

	const { data: inventories, isLoading: loadingInventory } = useQuery({
		queryKey: ["bomSsuInventories", enabledSsus.map((a) => a.objectId).join(",")],
		queryFn: async () => {
			const results: AssemblyInventory[] = [];
			for (const assembly of enabledSsus) {
				const inv = await fetchAssemblyInventory(client, assembly.objectId, assembly.type);
				results.push(...inv);
			}
			return results;
		},
		enabled: enabledSsus.length > 0,
		staleTime: 60_000,
		refetchInterval: 120_000,
	});

	// Resolve each selected SSU's solar system from synced structure intel (objectId -> systemId). SSUs
	// live in db.deployables or db.assemblies (V19 added the systemId index). Unsynced SSUs resolve to
	// undefined and sort last in the queue's distance ranking, exactly like the old aggregate did.
	const ssuSystemById = useLiveQuery(async () => {
		const map = new Map<string, number>();
		if (selectedSsuIds.length === 0) return map;
		const [deps, asms] = await Promise.all([
			db.deployables.where("objectId").anyOf(selectedSsuIds).toArray(),
			db.assemblies.where("objectId").anyOf(selectedSsuIds).toArray(),
		]);
		for (const d of deps) if (d.systemId != null) map.set(d.objectId, d.systemId);
		for (const a of asms) {
			if (a.systemId != null && !map.has(a.objectId)) map.set(a.objectId, a.systemId);
		}
		return map;
	}, [selectedSsuIds]);

	// Per-SSU breakdown -- one entry per selected unit (plan 41 B5). An SSU may expose several inventories
	// (owner + extension), so aggregate them per assembly; drop empties and carry the unit's name + system.
	const ssuBreakdown = useMemo<SsuInventory[]>(() => {
		if (!inventories) return [];
		const itemsByAssembly = new Map<string, Map<number, number>>();
		for (const inv of inventories) {
			let items = itemsByAssembly.get(inv.assemblyId);
			if (!items) {
				items = new Map<number, number>();
				itemsByAssembly.set(inv.assemblyId, items);
			}
			for (const item of inv.items) {
				items.set(item.typeId, (items.get(item.typeId) ?? 0) + item.quantity);
			}
		}
		const metaById = new Map(
			storageAssemblies.map((a) => [a.objectId, { name: a.name, itemId: a.itemId }] as const),
		);
		const result: SsuInventory[] = [];
		for (const [objectId, items] of itemsByAssembly) {
			if (items.size === 0) continue;
			const meta = metaById.get(objectId);
			const name = ssuLabel(meta?.name, meta?.itemId, objectId);
			result.push({ objectId, name, systemId: ssuSystemById?.get(objectId), items });
		}
		result.sort((a, b) => a.name.localeCompare(b.name));
		return result;
	}, [inventories, storageAssemblies, ssuSystemById]);

	useEffect(() => {
		onBreakdownChange(ssuBreakdown);
	}, [ssuBreakdown, onBreakdownChange]);

	// SSU toggle
	const toggleSsu = useCallback((objectId: string) => {
		setSelectedSsuIds((prev) =>
			prev.includes(objectId) ? prev.filter((id) => id !== objectId) : [...prev, objectId],
		);
	}, []);

	const hasWallet = !!activeCharacter?.suiAddress || !!account?.address;
	const totalStockItems = useMemo(() => {
		const seen = new Set<number>();
		for (const ssu of ssuBreakdown) for (const t of ssu.items.keys()) seen.add(t);
		return seen.size;
	}, [ssuBreakdown]);

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-300 hover:bg-zinc-800/30"
			>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				<Box size={14} className="text-cyan-400" />
				SSU Stock
				{totalStockItems > 0 && (
					<span className="text-xs text-zinc-500">({totalStockItems} items)</span>
				)}
			</button>

			{open && (
				<div className="space-y-2 px-4 pb-4">
					{!hasWallet ? (
						<div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/30 px-3 py-3 text-xs text-zinc-500">
							<Wallet size={14} className="text-cyan-500" />
							Connect your wallet to load SSU inventories.
						</div>
					) : loadingAssemblies ? (
						<div className="flex items-center gap-2 text-xs text-zinc-500">
							<Loader2 size={12} className="animate-spin" />
							Loading assemblies...
						</div>
					) : storageAssemblies.length === 0 ? (
						<div className="text-xs text-zinc-600">No storage units found.</div>
					) : (
						<div className="space-y-1">
							{storageAssemblies.map((a) => {
								const label = ssuLabel(a.name, a.itemId, a.objectId);
								const checked = selectedSsuIds.includes(a.objectId);
								return (
									<label
										key={a.objectId}
										className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-zinc-800/50"
									>
										<input
											type="checkbox"
											checked={checked}
											onChange={() => toggleSsu(a.objectId)}
											className="rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
										/>
										<span className={checked ? "text-zinc-200" : "text-zinc-400"}>{label}</span>
									</label>
								);
							})}
							{loadingInventory && (
								<div className="flex items-center gap-2 pt-1 text-xs text-zinc-500">
									<Loader2 size={12} className="animate-spin" />
									Loading inventory...
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
