import { type AssemblyInventory, fetchAssemblyInventory } from "@/chain/inventory";
import { CopyAddress } from "@/components/CopyAddress";
import { type ColumnDef, DataGrid, excelFilterFn } from "@/components/DataGrid";
import { ContainerHistory, type TimelineEntry } from "@/components/fieldstorage/ContainerHistory";
import { FieldStorageEditor } from "@/components/fieldstorage/FieldStorageEditor";
import { PasteUpdatePanel } from "@/components/fieldstorage/PasteUpdatePanel";
import { db } from "@/db";
import type { FieldStorageSnapshot, FieldStorageUnit, GameType } from "@/db/types";
import { CHAIN_ENABLED } from "@/featureFlags";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useOwnedAssemblies } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import { diffSnapshots, ensureShipCargoUnit } from "@/lib/fieldStorage";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import {
	Boxes,
	Check,
	Copy,
	HardDrive,
	Loader2,
	MapPin,
	Pencil,
	Plus,
	RefreshCw,
	Ship,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

interface InventoryRow {
	id: string;
	typeId: number;
	typeName: string;
	quantity: number;
}

interface ItemQty {
	typeId: number;
	quantity: number;
}

interface ChainContainer {
	kind: "chain";
	id: string;
	label: string;
	items: ItemQty[];
}

type Selection =
	| { kind: "chain"; id: string }
	| { kind: "field"; id: string }
	| { kind: "ship" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function toInventoryRows(
	containerId: string,
	items: ItemQty[],
	typeNameMap: Record<number, string>,
): InventoryRow[] {
	return items.map((it) => ({
		id: `${containerId}-${it.typeId}`,
		typeId: it.typeId,
		typeName: typeNameMap[it.typeId] ?? `Type ${it.typeId}`,
		quantity: it.quantity,
	}));
}

const inventoryColumns: ColumnDef<InventoryRow, unknown>[] = [
	{
		id: "typeName",
		accessorKey: "typeName",
		header: "Item",
		filterFn: excelFilterFn,
		cell: ({ row }) => (
			<div>
				<span className="font-medium text-zinc-100">{row.original.typeName}</span>
				<span className="ml-2 font-mono text-xs text-zinc-600">#{row.original.typeId}</span>
			</div>
		),
	},
	{
		id: "quantity",
		accessorKey: "quantity",
		header: "Qty",
		size: 120,
		enableColumnFilter: false,
		cell: ({ row }) => (
			<span className="font-mono text-zinc-200">{row.original.quantity.toLocaleString()}</span>
		),
	},
];

/**
 * Build a history timeline (newest-first) from a container's snapshots (also newest-first), diffing
 * each against its predecessor. Shared by numbered field units and the Ship Cargo Hold.
 */
function buildSnapshotTimeline(
	snaps: FieldStorageSnapshot[],
	typeNameMap: Record<number, string>,
): TimelineEntry[] {
	const nameOf = (typeId: number) => `${typeNameMap[typeId] ?? `Type ${typeId}`} #${typeId}`;
	return snaps.map((snap, i) => {
		const prev = snaps[i + 1] ?? null; // older snapshot (list is descending)
		const diff = diffSnapshots(prev, snap);
		return {
			id: snap.id,
			timestamp: snap.timestamp,
			title: i === snaps.length - 1 ? "Initial snapshot" : "Snapshot",
			changes: [
				...diff.added.map((r) => ({
					key: `a-${r.typeId}`,
					label: nameOf(r.typeId),
					delta: r.qty,
					tone: "add" as const,
				})),
				...diff.changed.map((c) => ({
					key: `c-${c.typeId}`,
					label: nameOf(c.typeId),
					delta: c.delta,
					tone: "change" as const,
				})),
				...diff.removed.map((r) => ({
					key: `r-${r.typeId}`,
					label: nameOf(r.typeId),
					delta: -r.qty,
					tone: "remove" as const,
				})),
			],
		};
	});
}

// ── Component ───────────────────────────────────────────────────────────────

export function Assets() {
	const { activeCharacter } = useActiveCharacter();
	const client = useSuiClient();
	const { data: discovery, isLoading: loadingAssemblies } = useOwnedAssemblies();

	const gameTypes = useLiveQuery(() => db.gameTypes.toArray()) ?? [];
	const systems = useLiveQuery(() => db.solarSystems.toArray()) ?? [];
	const allFieldUnits = useLiveQuery(() => db.fieldStorageUnits.orderBy("seq").toArray()) ?? [];
	const allSnapshots = useLiveQuery(() => db.fieldStorageSnapshots.toArray()) ?? [];

	// Split the dedicated Ship Cargo Hold (kind "ship") out of the numbered field-storage list so it
	// renders in its own always-visible card and never appears twice.
	const shipUnit = useMemo(
		() => allFieldUnits.find((u) => u.kind === "ship") ?? null,
		[allFieldUnits],
	);
	const fieldUnits = useMemo(
		() => allFieldUnits.filter((u) => u.kind !== "ship"),
		[allFieldUnits],
	);

	const [selection, setSelection] = useState<Selection | null>(null);
	const [showEditor, setShowEditor] = useState(false);
	const [editingUnit, setEditingUnit] = useState<FieldStorageUnit | null>(null);
	const [copiedId, setCopiedId] = useState<string | null>(null);

	// Lookups
	const typeNameMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const gt of gameTypes) map[gt.id] = gt.name;
		return map;
	}, [gameTypes]);

	const systemNameMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const s of systems) if (s.name) map[s.id] = s.name;
		return map;
	}, [systems]);

	// Field storage snapshots grouped by container (descending by timestamp).
	const snapshotsByContainer = useMemo(() => {
		const map = new Map<string, FieldStorageSnapshot[]>();
		for (const snap of allSnapshots) {
			const arr = map.get(snap.containerId);
			if (arr) arr.push(snap);
			else map.set(snap.containerId, [snap]);
		}
		for (const arr of map.values()) arr.sort((a, b) => b.timestamp - a.timestamp);
		return map;
	}, [allSnapshots]);

	// ── Chain SSUs ───────────────────────────────────────────────────────────
	const storageAssemblies = useMemo(
		() => discovery?.assemblies.filter((a) => a.type === "storage_unit") ?? [],
		[discovery],
	);

	const {
		data: inventories,
		isLoading: loadingInventory,
		refetch,
		isFetching,
	} = useQuery({
		queryKey: ["assetInventories", storageAssemblies.map((a) => a.objectId).join(",")],
		queryFn: async () => {
			const results: AssemblyInventory[] = [];
			for (const assembly of storageAssemblies) {
				const inv = await fetchAssemblyInventory(client, assembly.objectId, assembly.type);
				results.push(...inv);
			}
			return results;
		},
		enabled: storageAssemblies.length > 0,
		staleTime: 60_000,
		refetchInterval: 120_000,
	});

	const chainContainers = useMemo<ChainContainer[]>(() => {
		return storageAssemblies.map((a) => {
			const itemMap = new Map<number, number>();
			for (const inv of inventories ?? []) {
				if (inv.assemblyId !== a.objectId) continue;
				for (const it of inv.items) {
					itemMap.set(it.typeId, (itemMap.get(it.typeId) ?? 0) + it.quantity);
				}
			}
			const items = [...itemMap.entries()].map(([typeId, quantity]) => ({ typeId, quantity }));
			return {
				kind: "chain",
				id: a.objectId,
				label: a.name?.trim() || `${a.objectId.slice(0, 10)}...`,
				items,
			};
		});
	}, [storageAssemblies, inventories]);

	// ── Summary stats (chain + field) ──────────────────────────────────────────
	const summary = useMemo(() => {
		const typeSet = new Set<number>();
		let totalItems = 0;
		for (const c of chainContainers) {
			for (const it of c.items) {
				typeSet.add(it.typeId);
				totalItems += it.quantity;
			}
		}
		for (const unit of allFieldUnits) {
			const latest = snapshotsByContainer.get(unit.id)?.[0];
			for (const it of latest?.items ?? []) {
				typeSet.add(it.typeId);
				totalItems += it.qty;
			}
		}
		return {
			totalItems,
			uniqueTypes: typeSet.size,
			containers: chainContainers.length + allFieldUnits.length,
		};
	}, [chainContainers, allFieldUnits, snapshotsByContainer]);

	// Auto-select the first container once data is available, falling back to the always-present
	// Ship Cargo Hold card when there is nothing else to show.
	useEffect(() => {
		if (selection) return;
		if (chainContainers.length > 0) {
			setSelection({ kind: "chain", id: chainContainers[0].id });
		} else if (fieldUnits.length > 0) {
			setSelection({ kind: "field", id: fieldUnits[0].id });
		} else {
			setSelection({ kind: "ship" });
		}
	}, [selection, chainContainers, fieldUnits]);

	// ── Selected container resolution ──────────────────────────────────────────
	const selectedChain =
		selection?.kind === "chain"
			? (chainContainers.find((c) => c.id === selection.id) ?? null)
			: null;
	const selectedUnit =
		selection?.kind === "field" ? (fieldUnits.find((u) => u.id === selection.id) ?? null) : null;
	const selectedShip = selection?.kind === "ship";

	// Chain SSU history -- reuse Sonar deposit/withdraw events (decision 15).
	const chainEvents = useLiveQuery(async () => {
		if (selection?.kind !== "chain") return [];
		const evs = await db.sonarEvents.where("assemblyId").equals(selection.id).toArray();
		return evs
			.filter((e) => e.eventType === "item_deposited" || e.eventType === "item_withdrawn")
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	}, [selection]);

	// ── Timeline entries ────────────────────────────────────────────────────────
	const fieldTimeline = useMemo<TimelineEntry[]>(() => {
		if (!selectedUnit) return [];
		return buildSnapshotTimeline(snapshotsByContainer.get(selectedUnit.id) ?? [], typeNameMap);
	}, [selectedUnit, snapshotsByContainer, typeNameMap]);

	const shipTimeline = useMemo<TimelineEntry[]>(() => {
		if (!shipUnit) return [];
		return buildSnapshotTimeline(snapshotsByContainer.get(shipUnit.id) ?? [], typeNameMap);
	}, [shipUnit, snapshotsByContainer, typeNameMap]);

	const chainTimeline = useMemo<TimelineEntry[]>(() => {
		return (chainEvents ?? []).map((e) => {
			const deposited = e.eventType === "item_deposited";
			const label = e.typeName ?? (e.typeId != null ? `#${e.typeId}` : "Item");
			return {
				id: String(e.id ?? `${e.timestamp}-${e.typeId}`),
				timestamp: new Date(e.timestamp).getTime(),
				title: deposited ? "Deposit" : "Withdraw",
				subtitle: e.characterName,
				changes: [
					{
						key: String(e.id ?? e.timestamp),
						label,
						delta: (deposited ? 1 : -1) * (e.quantity ?? 0),
						tone: deposited ? ("add" as const) : ("remove" as const),
					},
				],
			};
		});
	}, [chainEvents]);

	// ── Actions ──────────────────────────────────────────────────────────────
	function handleCopy(unit: FieldStorageUnit) {
		const text = unit.name?.trim() ? `#${unit.seq} ${unit.name.trim()}` : `#${unit.seq}`;
		navigator.clipboard.writeText(text);
		setCopiedId(unit.id);
		setTimeout(() => setCopiedId((c) => (c === unit.id ? null : c)), 1500);
	}

	async function handleDelete(unit: FieldStorageUnit) {
		const label = unit.name?.trim() ? `#${unit.seq} ${unit.name.trim()}` : `#${unit.seq}`;
		if (!window.confirm(`Delete field storage container ${label} and its history?`)) return;
		await db.fieldStorageSnapshots.where("containerId").equals(unit.id).delete();
		await db.fieldStorageUnits.delete(unit.id);
		setSelection((s) => (s?.kind === "field" && s.id === unit.id ? null : s));
		if (editingUnit?.id === unit.id) {
			setEditingUnit(null);
			setShowEditor(false);
		}
	}

	// Clear the Ship Cargo Hold: drop its snapshots + unit (the next paste recreates it lazily).
	async function handleClearShip() {
		if (!shipUnit) return;
		if (!window.confirm("Clear the Ship Cargo Hold and its snapshot history?")) return;
		await db.fieldStorageSnapshots.where("containerId").equals(shipUnit.id).delete();
		await db.fieldStorageUnits.delete(shipUnit.id);
	}

	const isLoading = loadingAssemblies || (storageAssemblies.length > 0 && loadingInventory);
	const showChainPrompt = CHAIN_ENABLED && !activeCharacter;

	return (
		<div className="flex h-full flex-col p-6">
			{/* Header */}
			<div className="mb-4 flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<Boxes size={24} className="text-amber-500" />
						Assets
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						{isLoading
							? "Loading inventories..."
							: `${summary.totalItems.toLocaleString()} items across ${summary.uniqueTypes} types in ${summary.containers} container${summary.containers !== 1 ? "s" : ""}`}
					</p>
				</div>
				{CHAIN_ENABLED && storageAssemblies.length > 0 && (
					<button
						type="button"
						onClick={() => refetch()}
						disabled={isFetching}
						className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
					>
						{isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
						Refresh
					</button>
				)}
			</div>

			{/* Summary Cards */}
			<div className="mb-4 grid grid-cols-3 gap-4">
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<p className="text-xs text-zinc-500">Total Items</p>
					<p className="mt-1 text-2xl font-bold text-zinc-100">
						{summary.totalItems.toLocaleString()}
					</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<p className="text-xs text-zinc-500">Unique Types</p>
					<p className="mt-1 text-2xl font-bold text-amber-400">{summary.uniqueTypes}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<p className="text-xs text-zinc-500">Containers</p>
					<p className="mt-1 text-2xl font-bold text-cyan-400">{summary.containers}</p>
				</div>
			</div>

			{/* Master / detail */}
			<div className="flex min-h-0 flex-1 gap-4">
				{/* Container list */}
				<div className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto pr-1">
					{/* Ship cargo hold -- always present; copy ship cargo in-game and paste to update */}
					<div>
						<div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
							<Ship size={12} />
							Ship
						</div>
						<button
							type="button"
							onClick={() => {
								setSelection({ kind: "ship" });
								setShowEditor(false);
							}}
							className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
								selectedShip
									? "border-cyan-600/60 bg-cyan-950/30"
									: "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
							}`}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="truncate text-sm font-medium text-zinc-100">Ship Cargo Hold</span>
								<span className="shrink-0 text-[10px] text-zinc-600">
									{(shipUnit ? snapshotsByContainer.get(shipUnit.id)?.[0]?.items.length : 0) ?? 0}{" "}
									types
								</span>
							</div>
							<div className="mt-0.5 truncate text-[11px] text-zinc-600">Paste cargo to update</div>
						</button>
					</div>

					{/* Field storage */}
					<div>
						<div className="mb-2 flex items-center justify-between">
							<div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
								<HardDrive size={12} />
								Field Storage
							</div>
							<button
								type="button"
								onClick={() => {
									setEditingUnit(null);
									setShowEditor(true);
								}}
								className="flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
							>
								<Plus size={11} />
								Add
							</button>
						</div>
						<div className="space-y-1.5">
							{fieldUnits.length === 0 && !showEditor && (
								<p className="rounded-lg border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-600">
									No field storage yet. Add a container to track manual inventory.
								</p>
							)}
							{fieldUnits.map((unit) => {
								const latest = snapshotsByContainer.get(unit.id)?.[0];
								const itemCount = latest?.items.length ?? 0;
								const isActive = selection?.kind === "field" && selection.id === unit.id;
								return (
									<button
										key={unit.id}
										type="button"
										onClick={() => {
											setSelection({ kind: "field", id: unit.id });
											setShowEditor(false);
										}}
										className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
											isActive
												? "border-cyan-600/60 bg-cyan-950/30"
												: "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
										}`}
									>
										<div className="flex items-center justify-between gap-2">
											<span className="truncate text-sm font-medium text-zinc-100">
												<span className="font-mono text-zinc-500">#{unit.seq}</span>{" "}
												{unit.name?.trim() || "(unnamed)"}
											</span>
											<span className="shrink-0 text-[10px] text-zinc-600">{itemCount} types</span>
										</div>
										<div className="mt-0.5 truncate text-[11px] text-zinc-600">
											{unit.systemId
												? (systemNameMap[unit.systemId] ?? `System #${unit.systemId}`)
												: "No location"}
										</div>
									</button>
								);
							})}
						</div>
					</div>

					{/* On-chain SSUs */}
					<div>
						<div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
							<Boxes size={12} />
							On-Chain SSUs
						</div>
						<div className="space-y-1.5">
							{showChainPrompt && (
								<p className="rounded-lg border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-600">
									Select a character on the{" "}
									<a href="/manifest" className="text-cyan-400 hover:text-cyan-300">
										Manifest
									</a>{" "}
									to load on-chain storage.
								</p>
							)}
							{!showChainPrompt && isLoading && (
								<div className="flex items-center gap-2 px-3 py-2 text-[11px] text-zinc-500">
									<Loader2 size={12} className="animate-spin" />
									{loadingAssemblies ? "Discovering assemblies..." : "Fetching inventories..."}
								</div>
							)}
							{!showChainPrompt && !isLoading && chainContainers.length === 0 && (
								<p className="rounded-lg border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-600">
									No storage units found.
								</p>
							)}
							{chainContainers.map((c) => {
								const itemCount = c.items.length;
								const isActive = selection?.kind === "chain" && selection.id === c.id;
								return (
									<button
										key={c.id}
										type="button"
										onClick={() => {
											setSelection({ kind: "chain", id: c.id });
											setShowEditor(false);
										}}
										className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
											isActive
												? "border-cyan-600/60 bg-cyan-950/30"
												: "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
										}`}
									>
										<div className="flex items-center justify-between gap-2">
											<span className="truncate font-mono text-sm font-medium text-zinc-100">
												{c.label}
											</span>
											<span className="shrink-0 text-[10px] text-zinc-600">{itemCount} types</span>
										</div>
										<div className="mt-0.5 text-[11px] text-zinc-600">Smart Storage Unit</div>
									</button>
								);
							})}
						</div>
					</div>
				</div>

				{/* Detail */}
				<div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
					{showEditor ? (
						<FieldStorageEditor
							unit={editingUnit ?? undefined}
							systems={systems}
							onSaved={(id) => {
								setShowEditor(false);
								setEditingUnit(null);
								setSelection({ kind: "field", id });
							}}
							onCancel={() => {
								setShowEditor(false);
								setEditingUnit(null);
							}}
						/>
					) : selectedShip ? (
						<ShipDetail
							unit={shipUnit}
							snapshot={shipUnit ? (snapshotsByContainer.get(shipUnit.id)?.[0] ?? null) : null}
							timeline={shipTimeline}
							typeNameMap={typeNameMap}
							gameTypes={gameTypes}
							onClear={handleClearShip}
						/>
					) : selectedUnit ? (
						<FieldDetail
							unit={selectedUnit}
							snapshot={snapshotsByContainer.get(selectedUnit.id)?.[0] ?? null}
							timeline={fieldTimeline}
							typeNameMap={typeNameMap}
							systemNameMap={systemNameMap}
							gameTypes={gameTypes}
							copied={copiedId === selectedUnit.id}
							onCopy={() => handleCopy(selectedUnit)}
							onEdit={() => {
								setEditingUnit(selectedUnit);
								setShowEditor(true);
							}}
							onDelete={() => handleDelete(selectedUnit)}
						/>
					) : selectedChain ? (
						<ChainDetail
							container={selectedChain}
							timeline={chainTimeline}
							typeNameMap={typeNameMap}
						/>
					) : (
						<div className="flex h-full items-center justify-center text-center">
							<div>
								<Boxes size={40} className="mx-auto mb-3 text-zinc-700" />
								<p className="text-sm text-zinc-500">
									Select a container, or add a field storage unit.
								</p>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

// ── Chain SSU detail ──────────────────────────────────────────────────────────

function ChainDetail({
	container,
	timeline,
	typeNameMap,
}: {
	container: ChainContainer;
	timeline: TimelineEntry[];
	typeNameMap: Record<number, string>;
}) {
	const rows = useMemo(
		() => toInventoryRows(container.id, container.items, typeNameMap),
		[container, typeNameMap],
	);

	return (
		<div className="space-y-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<h2 className="truncate font-mono text-lg font-semibold text-zinc-100">
							{container.label}
						</h2>
						<span className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
							On-Chain SSU
						</span>
					</div>
					<CopyAddress
						address={container.id}
						sliceStart={12}
						sliceEnd={6}
						className="mt-1 text-xs text-zinc-500"
					/>
				</div>
			</div>

			<div>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
					Inventory
				</h3>
				<DataGrid
					columns={inventoryColumns}
					data={rows}
					keyFn={(r) => r.id}
					searchPlaceholder="Search items..."
					emptyMessage="No items in this storage unit."
				/>
			</div>

			<div>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
					History
				</h3>
				<ContainerHistory
					entries={timeline}
					emptyMessage="No deposit / withdraw events recorded yet. Enable Chain Sonar to capture them."
				/>
			</div>
		</div>
	);
}

// ── Field storage detail ────────────────────────────────────────────────────────

function FieldDetail({
	unit,
	snapshot,
	timeline,
	typeNameMap,
	systemNameMap,
	gameTypes,
	copied,
	onCopy,
	onEdit,
	onDelete,
}: {
	unit: FieldStorageUnit;
	snapshot: FieldStorageSnapshot | null;
	timeline: TimelineEntry[];
	typeNameMap: Record<number, string>;
	systemNameMap: Record<number, string>;
	gameTypes: GameType[];
	copied: boolean;
	onCopy: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const rows = useMemo(() => {
		const items = (snapshot?.items ?? []).map((i) => ({ typeId: i.typeId, quantity: i.qty }));
		return toInventoryRows(unit.id, items, typeNameMap);
	}, [snapshot, unit.id, typeNameMap]);

	const systemName = unit.systemId
		? (systemNameMap[unit.systemId] ?? `System #${unit.systemId}`)
		: null;

	return (
		<div className="space-y-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<h2 className="truncate text-lg font-semibold text-zinc-100">
							<span className="font-mono text-zinc-500">#{unit.seq}</span>{" "}
							{unit.name?.trim() || "(unnamed)"}
						</h2>
						<span className="rounded bg-cyan-700/30 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">
							Field Storage
						</span>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
						{systemName && (
							<span className="flex items-center gap-1">
								<MapPin size={12} className="text-cyan-500" />
								{systemName}
							</span>
						)}
						{unit.warpable?.trim() && <span>warp: {unit.warpable.trim()}</span>}
					</div>
					{unit.note?.trim() && <p className="mt-1 text-xs text-zinc-600">{unit.note.trim()}</p>}
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						onClick={onCopy}
						title="Copy #id + name to clipboard"
						className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
					>
						{copied ? <Check size={13} className="text-teal-400" /> : <Copy size={13} />}
						{copied ? "Copied" : "Copy ID"}
					</button>
					<button
						type="button"
						onClick={onEdit}
						title="Edit container"
						className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
					>
						<Pencil size={13} />
					</button>
					<button
						type="button"
						onClick={onDelete}
						title="Delete container"
						className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 transition-colors hover:border-red-800 hover:text-red-400"
					>
						<Trash2 size={13} />
					</button>
				</div>
			</div>

			<PasteUpdatePanel containerId={unit.id} types={gameTypes} />

			<div>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
					Inventory{" "}
					<span className="font-normal normal-case text-zinc-600">
						{snapshot
							? `(latest snapshot ${new Date(snapshot.timestamp).toLocaleString()})`
							: "(no snapshot yet)"}
					</span>
				</h3>
				<DataGrid
					columns={inventoryColumns}
					data={rows}
					keyFn={(r) => r.id}
					searchPlaceholder="Search items..."
					emptyMessage="No snapshot yet. Paste an inventory above to capture one."
				/>
				{snapshot && snapshot.unresolved.length > 0 && (
					<div className="mt-2 rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300/80">
						<span className="font-medium">{snapshot.unresolved.length} unresolved:</span>{" "}
						{snapshot.unresolved.map((u) => `${u.name} x${u.qty}`).join(", ")}
					</div>
				)}
			</div>

			<div>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
					History
				</h3>
				<ContainerHistory
					entries={timeline}
					emptyMessage="No snapshots yet. Paste an inventory above to start the history."
				/>
			</div>
		</div>
	);
}

// ── Ship cargo hold detail ──────────────────────────────────────────────────────

/**
 * Dedicated Ship Cargo Hold detail. Reuses the same paste -> snapshot flow + history timeline as
 * field storage, but has no location picker and no "#seq" (a ship moves). The unit is created
 * lazily on first paste via `ensureShipCargoUnit`, so `unit` may be null until then.
 */
function ShipDetail({
	unit,
	snapshot,
	timeline,
	typeNameMap,
	gameTypes,
	onClear,
}: {
	unit: FieldStorageUnit | null;
	snapshot: FieldStorageSnapshot | null;
	timeline: TimelineEntry[];
	typeNameMap: Record<number, string>;
	gameTypes: GameType[];
	onClear: () => void;
}) {
	const rows = useMemo(() => {
		const items = (snapshot?.items ?? []).map((i) => ({ typeId: i.typeId, quantity: i.qty }));
		return toInventoryRows("ship", items, typeNameMap);
	}, [snapshot, typeNameMap]);

	return (
		<div className="space-y-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<h2 className="flex items-center gap-2 truncate text-lg font-semibold text-zinc-100">
							<Ship size={18} className="shrink-0 text-violet-400" />
							Ship Cargo Hold
						</h2>
						<span className="rounded bg-violet-700/30 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
							Ship
						</span>
					</div>
					<p className="mt-1 text-xs text-zinc-500">
						Copy your ship cargo in-game, then paste below to update what is in your hold.
					</p>
				</div>
				{unit && (
					<div className="flex shrink-0 items-center gap-1.5">
						<button
							type="button"
							onClick={onClear}
							title="Clear cargo hold and history"
							className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 transition-colors hover:border-red-800 hover:text-red-400"
						>
							<Trash2 size={13} />
						</button>
					</div>
				)}
			</div>

			<PasteUpdatePanel
				ensureContainerId={async () => (await ensureShipCargoUnit()).id}
				types={gameTypes}
			/>

			<div>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
					Inventory{" "}
					<span className="font-normal normal-case text-zinc-600">
						{snapshot
							? `(latest snapshot ${new Date(snapshot.timestamp).toLocaleString()})`
							: "(no snapshot yet)"}
					</span>
				</h3>
				<DataGrid
					columns={inventoryColumns}
					data={rows}
					keyFn={(r) => r.id}
					searchPlaceholder="Search items..."
					emptyMessage="No snapshot yet. Paste your ship cargo above to capture one."
				/>
				{snapshot && snapshot.unresolved.length > 0 && (
					<div className="mt-2 rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300/80">
						<span className="font-medium">{snapshot.unresolved.length} unresolved:</span>{" "}
						{snapshot.unresolved.map((u) => `${u.name} x${u.qty}`).join(", ")}
					</div>
				)}
			</div>

			<div>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
					History
				</h3>
				<ContainerHistory
					entries={timeline}
					emptyMessage="No snapshots yet. Paste your ship cargo above to start the history."
				/>
			</div>
		</div>
	);
}
