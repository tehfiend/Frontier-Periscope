// Unified stock panel -- one collapsible "Stock" card with a SINGLE reorderable list of every source
// that can feed this queue's baseStock: field storage, the ship cargo hold, on-chain SSUs, and the
// queue-local scratch pad, all treated the same. List POSITION is sourcing priority (top = first drawn)
// and each row has an enable checkbox that gates whether its inventory counts at all. The arrangement is
// persisted per queue (queue.stockSources) so it survives reloads. SSUs are fetched from chain only while
// enabled (each toggle triggers/drops a live inventory read); everything else is local.

import { type AssemblyInventory, fetchAssemblyInventory } from "@/chain/inventory";
import { ItemIcon } from "@/components/ItemIcon";
import { ScratchPadPanel } from "@/components/buildqueue/ScratchPadPanel";
import { db } from "@/db";
import { CHAIN_ENABLED } from "@/featureFlags";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useOwnedAssemblies } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import { ensureShipCargoUnit } from "@/lib/fieldStorage";
import type { BuildQueue, ContainerRef, StockSourceEntry } from "@/lib/buildQueueTypes";
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
	FlaskConical,
	Loader2,
	Package,
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

export function StockPanel({ queue, typeList, volumeMap, onSsuStockChange }: StockPanelProps) {
	const [open, setOpen] = useState(false);
	const [scratchExpanded, setScratchExpanded] = useState(false);
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const client = useSuiClient();
	const { data: discovery } = useOwnedAssemblies();

	const stockSources = queue.stockSources;

	// The Ship Cargo Hold is a lazily-created singleton (Assets only makes it when you first paste into
	// it). Ensure it exists so it always appears in the stock list here, even before it holds anything.
	useEffect(() => {
		ensureShipCargoUnit();
	}, []);

	// Solar-system id -> name, for labelling each storage's location (SSUs resolve their system below).
	const systemNames = useLiveQuery(async () => {
		const systems = await db.solarSystems.toArray();
		return new Map(systems.map((s) => [s.id, s.name ?? `#${s.id}`]));
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
			});
		}
		return rows;
	}, []);

	// ── On-chain storage units (SSUs) ─────────────────────────────────────────────
	const storageAssemblies = useMemo(
		() => discovery?.assemblies.filter((a) => a.type === "storage_unit") ?? [],
		[discovery],
	);

	// Only fetch SSUs the user has explicitly enabled (chain default is off). Depends solely on the
	// discovered units + persisted arrangement, so inventory loads never re-trigger the fetch.
	const enabledChainIds = useMemo(() => {
		const enabledByKey = new Map((stockSources ?? []).map((s) => [containerRefKey(s.ref), s.enabled]));
		return storageAssemblies
			.filter((a) => enabledByKey.get(containerRefKey({ kind: "chain", id: a.objectId })) === true)
			.map((a) => a.objectId);
	}, [storageAssemblies, stockSources]);

	const { data: inventories, isLoading: loadingInventory } = useQuery({
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

	// Resolve each enabled SSU's solar system, inheriting a parent node's system when the unit has none
	// (parentId references a node by id or objectId). Structures are few, so load them all.
	const ssuSystemById = useLiveQuery(async () => {
		const map = new Map<string, number>();
		if (enabledChainIds.length === 0) return map;
		const [deps, asms] = await Promise.all([db.deployables.toArray(), db.assemblies.toArray()]);
		const byKey = new Map<string, { systemId?: number; parentId?: string }>();
		for (const rec of [...deps, ...asms]) {
			if (!byKey.has(rec.id)) byKey.set(rec.id, rec);
			if (!byKey.has(rec.objectId)) byKey.set(rec.objectId, rec);
		}
		const resolve = (k: string, depth = 0): number | undefined => {
			const rec = byKey.get(k);
			if (!rec || depth > 4) return undefined;
			if (rec.systemId != null) return rec.systemId;
			return rec.parentId ? resolve(rec.parentId, depth + 1) : undefined;
		};
		for (const objectId of enabledChainIds) {
			const sys = resolve(objectId);
			if (sys != null) map.set(objectId, sys);
		}
		return map;
	}, [enabledChainIds]);

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
			candidates.push({
				key: containerRefKey({ kind: "chain", id: objectId }),
				ref: { kind: "chain", id: objectId },
				kind: "chain",
				label: ssuLabel(a.name, a.itemId, objectId),
				systemId: inv?.systemId,
				systemName:
					inv?.systemId != null ? (systemNames?.get(inv.systemId) ?? `#${inv.systemId}`) : null,
				itemTypes: inv ? inv.items.size : 0,
				sampleTypeIds: inv ? [...inv.items.keys()].slice(0, 5) : [],
				loading: isEnabled && loadingInventory && !inv,
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

		return candidates
			.map((c) => ({ ...c, enabled: enabledByKey.get(c.key) ?? defaultEnabled(c.kind) }))
			.sort((a, b) => {
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
		enabledChainIds,
		loadingInventory,
		scratchCount,
		queue.scratch,
		stockSources,
		systemNames,
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
											{entry.kind === "scratch" && (
												<button
													type="button"
													onClick={() => setScratchExpanded((v) => !v)}
													className="ml-1 rounded px-1 py-0.5 text-[10px] text-zinc-500 hover:text-violet-300"
													title="Edit scratch pad contents"
												>
													{scratchExpanded ? "close" : "edit"}
												</button>
											)}
										</span>
									</div>

									{entry.kind === "scratch" && scratchExpanded && (
										<div className="border-t border-zinc-800/50 bg-zinc-900/40">
											<ScratchPadPanel
												queue={queue}
												typeList={typeList}
												volumeMap={volumeMap}
												embedded
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
