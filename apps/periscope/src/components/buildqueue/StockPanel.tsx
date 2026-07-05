// Unified stock panel -- one collapsible "Stock" card with a SINGLE reorderable list of every source
// that can feed this queue's baseStock: field storage, the ship cargo hold, on-chain SSUs, and the
// queue-local scratch pad, all treated the same. List POSITION is sourcing priority (top = first drawn)
// and each row has an enable checkbox that gates whether its inventory counts at all. The arrangement is
// persisted per queue (queue.stockSources) so it survives reloads. SSUs are fetched from chain only while
// enabled (each toggle triggers/drops a live inventory read); everything else is local.

import { getStorageUnitBuildTimes } from "@/chain/client";
import { type AssemblyInventory, fetchAssemblyInventory } from "@/chain/inventory";
import { ItemIcon } from "@/components/ItemIcon";
import { ScratchPadPanel } from "@/components/buildqueue/ScratchPadPanel";
import { PasteUpdatePanel } from "@/components/fieldstorage/PasteUpdatePanel";
import { db } from "@/db";
import { CHAIN_ENABLED } from "@/featureFlags";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant, useOwnedAssemblies } from "@/hooks/useOwnedAssemblies";
import { useSsuSystemMap } from "@/hooks/useSsuSystemMap";
import { useSuiClient } from "@/hooks/useSuiClient";
import { assignStorageNumbers } from "@/lib/storageLabels";
import type { RecentSystem } from "@/hooks/useCharacterRecentSystems";
import { ensureShipCargoUnit } from "@/lib/fieldStorage";
import type { BuildQueue, ContainerRef, StockSourceEntry } from "@/lib/buildQueueTypes";
import type { InventoryTypeInfo } from "@/lib/inventoryParser";
import { containerRefKey } from "@/lib/queueResolver";
import { setStockSources } from "@/stores/buildQueueStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import {
	Boxes,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	ClipboardPaste,
	FlaskConical,
	Loader2,
	Package,
	RefreshCw,
	Ship,
	Warehouse,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * One selected on-chain storage unit's live inventory surfaced as its own container (plan 41 B5). Kept
 * exported here (the resolver's baseStock is seeded from it); the view lifts these via onSsuStockChange.
 */
export interface SsuInventory {
	objectId: string;
	name: string;
	systemId?: number;
	items: Map<number, number>;
}

interface StockPanelProps {
	queue: BuildQueue;
	/** All game types (id + name) for the scratch pad's add-item search. */
	typeList: Array<{ id: number; name: string }>;
	/** typeID -> unit volume (m3) for the scratch pad paste parser. */
	volumeMap: Map<number, number>;
	/** Solar-system id -> name, for labelling each storage's location. */
	systemNames?: Map<number, string>;
	/** Recently visited systems (newest first) -- the ship cargo hold's location is the current one. */
	recentSystems?: RecentSystem[];
	/** Live SSU inventories from the enabled on-chain rows, lifted to the view for the resolver. */
	onSsuStockChange: (ssus: SsuInventory[]) => void;
}

type StockKind = "field" | "ship" | "chain" | "scratch";

interface StockCandidate {
	key: string;
	ref: ContainerRef;
	kind: StockKind;
	label: string;
	systemId?: number;
	systemName?: string | null;
	warpable?: string;
	itemTypes: number;
	sampleTypeIds: number[];
	/** Chain rows only: fetching live inventory right now. */
	loading?: boolean;
	/** Chain rows: the storage's game type id (resolves the "Mini Storage"/"Field Storage" name). */
	typeId?: number;
	/** Build/creation age (epoch ms) -- drives the per-(system, type) "#N" numbering. */
	ageMs?: number;
	/** Secondary age tiebreak when ageMs is equal/absent (SSU in-game item id, else local seq). */
	buildTie?: number;
}

/**
 * Rewrite the label of every real-storage row (on-chain SSU + local field unit) to
 * "<Type> #<N> <System>", where N is unique per (system, type) ordered by build age -- #1 is the
 * oldest. Ship cargo hold and scratch pad are left untouched. Mutates the passed rows in place.
 */
function applyStorageNumbering(
	rows: Array<StockCandidate & { enabled: boolean }>,
	typeNameById: Map<number, string>,
): void {
	const typeOf = (r: StockCandidate): string =>
		r.kind === "chain" ? (typeNameById.get(r.typeId ?? -1) ?? "Storage") : "Field Storage";

	const storages = rows.filter((r) => r.kind === "chain" || r.kind === "field");
	const numbers = assignStorageNumbers(
		storages.map((r) => ({
			key: r.key,
			typeName: typeOf(r),
			systemId: r.systemId,
			ageMs: r.ageMs,
			buildTie: r.buildTie,
		})),
	);
	for (const r of storages) {
		const typeName = typeOf(r);
		const n = numbers.get(r.key) ?? 0;
		const sys = r.systemName ? ` ${r.systemName}` : "";
		const warp = r.warpable ? ` · ${r.warpable}` : "";
		r.label = `${typeName} #${n}${sys}${warp}`;
		// The system (and warpable) are now folded into the label -- suppress the separate span.
		r.systemName = null;
		r.warpable = undefined;
	}
}

/** SSU display label: structure name, else its in-game id, else a truncated address (never raw). */
function ssuLabel(name: string | undefined, itemId: string | undefined, objectId: string): string {
	return name?.trim() || itemId || `${objectId.slice(0, 8)}...${objectId.slice(-4)}`;
}

/** Default enabled state for a not-yet-arranged row: local storage on, chain SSUs off (they fetch). */
function defaultEnabled(kind: StockKind): boolean {
	return kind !== "chain";
}

/** Default ordering among unarranged rows: field, ship, chain, then the scratch pad last. */
function defaultKindRank(kind: StockKind): number {
	switch (kind) {
		case "field":
			return 0;
		case "ship":
			return 1;
		case "chain":
			return 2;
		default:
			return 3;
	}
}

export function StockPanel({
	queue,
	typeList,
	volumeMap,
	systemNames,
	recentSystems,
	onSsuStockChange,
}: StockPanelProps) {
	const [open, setOpen] = useState(false);
	// Which row's inline update panel is expanded (paste box / scratch editor). Single-open at a time.
	const [expandedKey, setExpandedKey] = useState<string | null>(null);

	// Candidate types (id + name + per-unit volume) for the paste parser's name -> typeId resolution.
	const inventoryTypes = useMemo<InventoryTypeInfo[]>(
		() => typeList.map((t) => ({ id: t.id, name: t.name, volume: volumeMap.get(t.id) ?? 0 })),
		[typeList, volumeMap],
	);
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const client = useSuiClient();
	const { data: discovery } = useOwnedAssemblies();
	const tenant = useActiveTenant();
	const buildAddress = activeCharacter?.suiAddress ?? account?.address ?? null;

	// typeID -> game type name, for labelling SSUs as "Mini Storage", "Field Storage", etc.
	const typeNameById = useMemo(
		() => new Map(typeList.map((t) => [t.id, t.name])),
		[typeList],
	);

	const stockSources = queue.stockSources;

	// The Ship Cargo Hold is a lazily-created singleton (Assets only makes it when you first paste into
	// it). Ensure it exists so it always appears in the stock list here, even before it holds anything.
	useEffect(() => {
		ensureShipCargoUnit();
	}, []);

	// ── Local storages (field units + ship cargo) and their contents ──────────────
	const fieldRows = useLiveQuery(async () => {
		const [units, systems] = await Promise.all([
			db.fieldStorageUnits.toArray(),
			db.solarSystems.toArray(),
		]);
		const systemName = new Map(systems.map((s) => [s.id, s.name ?? `#${s.id}`]));
		const rows: StockCandidate[] = [];
		for (const unit of units) {
			const snaps = await db.fieldStorageSnapshots
				.where("containerId")
				.equals(unit.id)
				.sortBy("timestamp");
			const items = snaps[snaps.length - 1]?.items ?? [];
			const label =
				unit.kind === "ship"
					? unit.name?.trim() || "Ship Cargo Hold"
					: unit.name?.trim()
						? `#${unit.seq} ${unit.name.trim()}`
						: `#${unit.seq}`;
			rows.push({
				key: containerRefKey({ kind: "field", id: unit.id }),
				ref: { kind: "field", id: unit.id },
				kind: unit.kind === "ship" ? "ship" : "field",
				label,
				systemId: unit.systemId,
				systemName: unit.systemId != null ? (systemName.get(unit.systemId) ?? null) : null,
				warpable: unit.warpable,
				itemTypes: items.length,
				sampleTypeIds: items.slice(0, 5).map((it) => it.typeId),
				ageMs: unit.createdAt,
				buildTie: unit.seq,
			});
		}
		return rows;
	}, []);

	// ── On-chain storage units (SSUs) ─────────────────────────────────────────────
	const storageAssemblies = useMemo(
		() => discovery?.assemblies.filter((a) => a.type === "storage_unit") ?? [],
		[discovery],
	);

	// On-chain build time per SSU (from StorageUnitCreatedEvent), for the per-system "#N" numbering.
	// Stable per owner, so keyed on address+tenant only; independent of which units are enabled.
	const { data: ssuBuildTimes } = useQuery({
		queryKey: ["ssuBuildTimes", buildAddress, tenant],
		queryFn: () => getStorageUnitBuildTimes(buildAddress as string, tenant),
		enabled: CHAIN_ENABLED && !!buildAddress,
		staleTime: 10 * 60_000,
	});

	// Only fetch SSUs the user has explicitly enabled (chain default is off). Depends solely on the
	// discovered units + persisted arrangement, so inventory loads never re-trigger the fetch.
	const enabledChainIds = useMemo(() => {
		const enabledByKey = new Map((stockSources ?? []).map((s) => [containerRefKey(s.ref), s.enabled]));
		return storageAssemblies
			.filter((a) => enabledByKey.get(containerRefKey({ kind: "chain", id: a.objectId })) === true)
			.map((a) => a.objectId);
	}, [storageAssemblies, stockSources]);

	const {
		data: inventories,
		isLoading: loadingInventory,
		isFetching: fetchingInventory,
		refetch: refetchInventories,
	} = useQuery({
		queryKey: ["stockSsuInventories", enabledChainIds.join(",")],
		queryFn: async () => {
			const results: AssemblyInventory[] = [];
			for (const objectId of enabledChainIds) {
				const inv = await fetchAssemblyInventory(client, objectId, "storage_unit");
				results.push(...inv);
			}
			return results;
		},
		enabled: enabledChainIds.length > 0,
		staleTime: 60_000,
		refetchInterval: 120_000,
	});

	// Resolve EVERY discovered SSU's solar system from synced structure intel (independent of whether it
	// is enabled/fetched), so a row can show its location before it's ticked.
	const ssuObjectIds = useMemo(() => storageAssemblies.map((a) => a.objectId), [storageAssemblies]);
	const ssuSystemById = useSsuSystemMap(ssuObjectIds);

	// One SsuInventory per enabled unit (aggregating its owner + extension inventories), carrying its
	// name + resolved system. Lifted to the view (baseStock) via the effect below.
	const ssuInventories = useMemo<SsuInventory[]>(() => {
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
		for (const objectId of enabledChainIds) {
			const items = itemsByAssembly.get(objectId) ?? new Map<number, number>();
			const meta = metaById.get(objectId);
			result.push({
				objectId,
				name: ssuLabel(meta?.name, meta?.itemId, objectId),
				systemId: ssuSystemById?.get(objectId),
				items,
			});
		}
		return result;
	}, [inventories, storageAssemblies, enabledChainIds, ssuSystemById]);

	useEffect(() => {
		onSsuStockChange(ssuInventories);
	}, [ssuInventories, onSsuStockChange]);

	const ssuInvByObjectId = useMemo(
		() => new Map(ssuInventories.map((s) => [s.objectId, s])),
		[ssuInventories],
	);

	// ── Merge every candidate into ONE ordered list (persisted order + enabled) ───
	const scratchCount = queue.scratch?.filter((s) => s.qty > 0).length ?? 0;

	const entries = useMemo<Array<StockCandidate & { enabled: boolean }>>(() => {
		const candidates: StockCandidate[] = [];
		for (const row of fieldRows ?? []) candidates.push(row);
		// SSUs -- always listed (so they can be enabled); contents shown once fetched.
		for (const a of storageAssemblies) {
			const objectId = a.objectId;
			const inv = ssuInvByObjectId.get(objectId);
			const isEnabled = enabledChainIds.includes(objectId);
			const sysId = ssuSystemById?.get(objectId);
			candidates.push({
				key: containerRefKey({ kind: "chain", id: objectId }),
				ref: { kind: "chain", id: objectId },
				kind: "chain",
				label: ssuLabel(a.name, a.itemId, objectId),
				systemId: sysId,
				systemName: sysId != null ? (systemNames?.get(sysId) ?? `#${sysId}`) : null,
				itemTypes: inv ? inv.items.size : 0,
				sampleTypeIds: inv ? [...inv.items.keys()].slice(0, 5) : [],
				loading: isEnabled && loadingInventory && !inv,
				typeId: a.typeId,
				ageMs: ssuBuildTimes?.get(objectId),
				buildTie: Number(a.itemId ?? 0),
			});
		}
		// Scratch pad -- always listed as a single storage row.
		candidates.push({
			key: containerRefKey({ kind: "scratch" }),
			ref: { kind: "scratch" },
			kind: "scratch",
			label: "Scratch pad",
			itemTypes: scratchCount,
			sampleTypeIds: (queue.scratch ?? []).slice(0, 5).map((s) => s.typeId),
		});

		const orderIndex = new Map((stockSources ?? []).map((s, i) => [containerRefKey(s.ref), i]));
		const enabledByKey = new Map((stockSources ?? []).map((s) => [containerRefKey(s.ref), s.enabled]));

		// The Ship Cargo Hold follows the character -- its location is the current (most recent) system.
		const currentSystem = recentSystems?.[0]?.name ?? null;

		const mapped = candidates.map((c) => ({
			...c,
			systemName: c.kind === "ship" && !c.systemName ? currentSystem : c.systemName,
			enabled: enabledByKey.get(c.key) ?? defaultEnabled(c.kind),
		}));

		// Relabel real storages to "<Type> #<N> <System>" (SSUs + local field units) before sorting.
		applyStorageNumbering(mapped, typeNameById);

		return mapped.sort((a, b) => {
			const ia = orderIndex.get(a.key) ?? Number.POSITIVE_INFINITY;
			const ib = orderIndex.get(b.key) ?? Number.POSITIVE_INFINITY;
			if (ia !== ib) return ia - ib;
			const rk = defaultKindRank(a.kind) - defaultKindRank(b.kind);
			if (rk !== 0) return rk;
			return a.label.localeCompare(b.label, undefined, { numeric: true });
		});
	}, [
		fieldRows,
		storageAssemblies,
		ssuInvByObjectId,
		ssuSystemById,
		ssuBuildTimes,
		typeNameById,
		enabledChainIds,
		loadingInventory,
		scratchCount,
		queue.scratch,
		stockSources,
		systemNames,
		recentSystems,
	]);

	const persist = useCallback(
		(next: Array<StockCandidate & { enabled: boolean }>) => {
			const list: StockSourceEntry[] = next.map((e) => ({ ref: e.ref, enabled: e.enabled }));
			setStockSources(queue.id, list);
		},
		[queue.id],
	);

	const toggle = useCallback(
		(key: string) => {
			persist(entries.map((e) => (e.key === key ? { ...e, enabled: !e.enabled } : e)));
		},
		[entries, persist],
	);

	const move = useCallback(
		(index: number, delta: number) => {
			const target = index + delta;
			if (target < 0 || target >= entries.length) return;
			const next = [...entries];
			const [moved] = next.splice(index, 1);
			next.splice(target, 0, moved);
			persist(next);
		},
		[entries, persist],
	);

	const enabledCount = entries.filter((e) => e.enabled).length;

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-300 hover:bg-zinc-800/30"
			>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				<Boxes size={14} className="text-cyan-400" />
				Stock
				{entries.length > 0 && (
					<span className="text-xs text-zinc-500">
						({enabledCount}/{entries.length} active)
					</span>
				)}
				{!open && (
					<span className="ml-2 text-xs font-normal text-zinc-500">
						every storage in priority order -- reorder and toggle what feeds this queue
					</span>
				)}
			</button>

			{open && (
				<div className="space-y-2 px-4 pb-4">
					<p className="text-[11px] text-zinc-500">
						All your storage in one list. Drag priority with the arrows (top is drawn from first),
						and untick anything this queue should ignore. On-chain SSUs load their live inventory only
						while ticked.
					</p>

					{entries.length === 0 ? (
						<p className="text-xs text-zinc-600">
							No storage yet. Add field storage in Assets or Structures, or connect your wallet to
							load on-chain SSUs.
						</p>
					) : (
						<div className="divide-y divide-zinc-800/50 overflow-hidden rounded border border-zinc-800">
							{entries.map((entry, index) => (
								<div key={entry.key}>
									<div
										className={`flex items-center gap-2 px-2 py-1.5 text-xs ${
											entry.enabled ? "" : "opacity-45"
										}`}
									>
										{/* Priority reorder */}
										<div className="flex shrink-0 flex-col">
											<button
												type="button"
												onClick={() => move(index, -1)}
												disabled={index === 0}
												className="rounded text-zinc-600 enabled:hover:text-cyan-300 disabled:opacity-30"
												title="Higher priority"
												aria-label={`Raise ${entry.label} priority`}
											>
												<ChevronUp size={12} />
											</button>
											<button
												type="button"
												onClick={() => move(index, 1)}
												disabled={index === entries.length - 1}
												className="rounded text-zinc-600 enabled:hover:text-cyan-300 disabled:opacity-30"
												title="Lower priority"
												aria-label={`Lower ${entry.label} priority`}
											>
												<ChevronDown size={12} />
											</button>
										</div>

										<span className="w-4 shrink-0 text-right font-mono text-[10px] text-zinc-600">
											{index + 1}
										</span>

										<input
											type="checkbox"
											checked={entry.enabled}
											onChange={() => toggle(entry.key)}
											className="shrink-0 rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
											aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.label}`}
										/>

										{entry.kind === "ship" ? (
											<Ship size={13} className="shrink-0 text-cyan-400/80" />
										) : entry.kind === "scratch" ? (
											<FlaskConical size={13} className="shrink-0 text-violet-400" />
										) : entry.kind === "chain" ? (
											<Warehouse size={13} className="shrink-0 text-amber-400/80" />
										) : (
											<Package size={13} className="shrink-0 text-emerald-400/70" />
										)}

										<span className="min-w-0 truncate font-medium text-zinc-200">{entry.label}</span>
										{entry.systemName && (
											<span className="shrink-0 text-zinc-500">
												· {entry.systemName}
												{entry.warpable ? ` · ${entry.warpable}` : ""}
											</span>
										)}

										<span className="ml-auto flex shrink-0 items-center gap-1 text-zinc-500">
											{entry.loading ? (
												<span className="flex items-center gap-1">
													<Loader2 size={11} className="animate-spin" />
													loading
												</span>
											) : (
												<>
													{entry.sampleTypeIds.map((typeId) => (
														<ItemIcon key={typeId} typeId={typeId} />
													))}
													<span className="ml-1 tabular-nums">
														{entry.itemTypes > 0
															? `${entry.itemTypes} item${entry.itemTypes === 1 ? "" : "s"}`
															: entry.kind === "chain" && !entry.enabled
																? "tick to load"
																: "empty"}
													</span>
												</>
											)}
											{entry.kind === "chain"
												? entry.enabled && (
														<button
															type="button"
															onClick={() => refetchInventories()}
															className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-cyan-300"
															title="Refresh this SSU's inventory from chain"
														>
															<RefreshCw
																size={11}
																className={fetchingInventory ? "animate-spin" : ""}
															/>
															refresh
														</button>
													)
												: (
														<button
															type="button"
															onClick={() =>
																setExpandedKey((k) => (k === entry.key ? null : entry.key))
															}
															className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-cyan-300"
															title="Paste inventory from the game client to update this storage"
														>
															<ClipboardPaste size={11} />
															{expandedKey === entry.key ? "close" : "update"}
														</button>
													)}
										</span>
									</div>

									{expandedKey === entry.key && entry.kind === "scratch" && (
										<div className="border-t border-zinc-800/50 bg-zinc-900/40">
											<ScratchPadPanel
												queue={queue}
												typeList={typeList}
												volumeMap={volumeMap}
												embedded
												defaultOpen
												defaultShowPaste
											/>
										</div>
									)}
									{expandedKey === entry.key &&
										(entry.kind === "field" || entry.kind === "ship") && (
											<div className="border-t border-zinc-800/50 bg-zinc-900/40 p-2">
												<PasteUpdatePanel
													containerId={entry.ref.kind === "field" ? entry.ref.id : undefined}
													ensureContainerId={
														entry.kind === "ship"
															? async () => (await ensureShipCargoUnit()).id
															: undefined
													}
													types={inventoryTypes}
													onSnapshot={() => setExpandedKey(null)}
												/>
											</div>
										)}
								</div>
							))}
						</div>
					)}

					{!CHAIN_ENABLED ? null : !account && !activeCharacter?.suiAddress ? (
						<p className="text-[11px] text-zinc-600">
							Connect your wallet to load on-chain SSU inventories into this list.
						</p>
					) : null}
				</div>
			)}
		</div>
	);
}
