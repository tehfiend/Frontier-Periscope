import { getStorageUnitBuildTimes } from "@/chain/client";
import { type AssemblyInventory, fetchAssemblyInventory } from "@/chain/inventory";
import { ContainerHistory, type TimelineEntry } from "@/components/fieldstorage/ContainerHistory";
import { FieldStorageEditor } from "@/components/fieldstorage/FieldStorageEditor";
import {
	InventoryGrid,
	type InventoryGroup,
	type InventoryLine,
} from "@/components/fieldstorage/InventoryGrid";
import { PasteUpdatePanel } from "@/components/fieldstorage/PasteUpdatePanel";
import { db } from "@/db";
import type { FieldStorageSnapshot, FieldStorageUnit } from "@/db/types";
import { CHAIN_ENABLED } from "@/featureFlags";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useBlueprintData } from "@/hooks/useBlueprintData";
import { useCharacterRecentSystems } from "@/hooks/useCharacterRecentSystems";
import { useActiveTenant, useOwnedAssemblies } from "@/hooks/useOwnedAssemblies";
import { useSsuSystemMap } from "@/hooks/useSsuSystemMap";
import { useSuiClient } from "@/hooks/useSuiClient";
import { diffSnapshots, ensureShipCargoUnit } from "@/lib/fieldStorage";
import { type StorageForNumbering, assignStorageNumbers } from "@/lib/storageLabels";
import type { InventoryTypeInfo } from "@/lib/inventoryParser";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import {
	Boxes,
	Check,
	ClipboardPaste,
	Copy,
	History,
	Loader2,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

interface ItemQty {
	typeId: number;
	quantity: number;
}

interface ChainContainer {
	id: string;
	label: string;
	items: ItemQty[];
	/** Game type id (resolves "Mini Storage" etc.) and in-game item id (age tiebreak). */
	typeId: number;
	itemId?: string;
}

/** Base (undecorated) group data before header actions / inline panels are attached. */
type BaseGroup = Omit<InventoryGroup, "actions" | "panel">;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Compact icon button for a group header action. */
function HeaderBtn({
	title,
	onClick,
	active,
	danger,
	children,
}: {
	title: string;
	onClick: () => void;
	active?: boolean;
	danger?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			title={title}
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
			className={`rounded border p-1 transition-colors ${
				active
					? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
					: danger
						? "border-zinc-700 text-zinc-400 hover:border-red-800 hover:text-red-400"
						: "border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
			}`}
		>
			{children}
		</button>
	);
}

// ── Component ───────────────────────────────────────────────────────────────

export function Assets() {
	const { activeCharacter } = useActiveCharacter();
	const client = useSuiClient();
	const { data: discovery, isLoading: loadingAssemblies } = useOwnedAssemblies();
	const tenant = useActiveTenant();
	const buildAddress = activeCharacter?.suiAddress ?? null;

	const gameTypes = useLiveQuery(() => db.gameTypes.toArray()) ?? [];
	// Local client-extracted type names / volumes (types.json). Offline-safe and comprehensive; the
	// World API gameTypes cache is empty in Cycle 6 (host down at cutover), so this is the reliable
	// source with gameTypes only as a supplementary fallback.
	const { typeList, volumeMap } = useBlueprintData();
	const systems = useLiveQuery(() => db.solarSystems.toArray()) ?? [];
	const recentSystems = useCharacterRecentSystems(systems);
	const allFieldUnits = useLiveQuery(() => db.fieldStorageUnits.orderBy("seq").toArray()) ?? [];
	const allSnapshots = useLiveQuery(() => db.fieldStorageSnapshots.toArray()) ?? [];

	// Split the dedicated Ship Cargo Hold (kind "ship") out of the numbered field-storage list.
	const shipUnit = useMemo(
		() => allFieldUnits.find((u) => u.kind === "ship") ?? null,
		[allFieldUnits],
	);
	const fieldUnits = useMemo(
		() => allFieldUnits.filter((u) => u.kind !== "ship"),
		[allFieldUnits],
	);

	const [showEditor, setShowEditor] = useState(false);
	const [editingUnit, setEditingUnit] = useState<FieldStorageUnit | null>(null);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	// Inline panel expanded under a group header: paste-to-update or snapshot/event history.
	const [activePanel, setActivePanel] = useState<{
		containerId: string;
		mode: "paste" | "history";
	} | null>(null);

	// Lookups
	const typeNameMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const gt of gameTypes) map[gt.id] = gt.name; // World API cache (may be empty)
		for (const t of typeList) map[t.id] = t.name; // local types.json overrides / fills gaps
		return map;
	}, [gameTypes, typeList]);

	// Candidate types for resolving pasted inventories -- local data, so resolution never silently
	// fails while the async db.gameTypes import has not populated yet.
	const resolverTypes = useMemo<InventoryTypeInfo[]>(
		() => typeList.map((t) => ({ id: t.id, name: t.name, volume: volumeMap.get(t.id) ?? 0 })),
		[typeList, volumeMap],
	);

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

	// Each SSU's solar system + on-chain build time, for the "<Type> #<N> <System>" labelling.
	const ssuObjectIds = useMemo(() => storageAssemblies.map((a) => a.objectId), [storageAssemblies]);
	const ssuSystemById = useSsuSystemMap(ssuObjectIds);
	const { data: ssuBuildTimes } = useQuery({
		queryKey: ["ssuBuildTimes", buildAddress, tenant],
		queryFn: () => getStorageUnitBuildTimes(buildAddress as string, tenant),
		enabled: CHAIN_ENABLED && !!buildAddress,
		staleTime: 10 * 60_000,
	});

	const {
		data: inventories,
		isLoading: loadingInventory,
		refetch,
		isFetching,
		dataUpdatedAt: chainUpdatedAt,
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
				id: a.objectId,
				// Prefer the assembly name; when unnamed, label by the in-game item ID rather than the
				// opaque Sui object address so the SSU is identifiable. (Overridden below by the numbered
				// "<Type> #<N> <System>" label when a game type resolves.)
				label: a.name?.trim() || (a.itemId ? `SSU #${a.itemId}` : `${a.objectId.slice(0, 10)}...`),
				items,
				typeId: a.typeId,
				itemId: a.itemId,
			};
		});
	}, [storageAssemblies, inventories]);

	// Per-(system, type) build-age numbering across local field units + on-chain SSUs.
	const storageNumbers = useMemo(() => {
		const rows: StorageForNumbering[] = [];
		for (const unit of fieldUnits) {
			rows.push({
				key: unit.id,
				typeName: "Field Storage",
				systemId: unit.systemId,
				ageMs: unit.createdAt,
				buildTie: unit.seq,
			});
		}
		for (const a of storageAssemblies) {
			rows.push({
				key: a.objectId,
				typeName: typeNameMap[a.typeId] ?? "Storage",
				systemId: ssuSystemById?.get(a.objectId),
				ageMs: ssuBuildTimes?.get(a.objectId),
				buildTie: Number(a.itemId ?? 0),
			});
		}
		return assignStorageNumbers(rows);
	}, [fieldUnits, storageAssemblies, ssuSystemById, ssuBuildTimes, typeNameMap]);

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

	// Chain SSU history -- reuse Sonar deposit/withdraw events -- only for the open history panel.
	const chainEvents = useLiveQuery(async () => {
		if (activePanel?.mode !== "history") return [];
		if (!chainContainers.some((c) => c.id === activePanel.containerId)) return [];
		const evs = await db.sonarEvents.where("assemblyId").equals(activePanel.containerId).toArray();
		return evs
			.filter((e) => e.eventType === "item_deposited" || e.eventType === "item_withdrawn")
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	}, [activePanel, chainContainers]);

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

	// ── Build grouped rows (field storage -> ship -> chain) ────────────────────
	const baseGroups = useMemo<BaseGroup[]>(() => {
		const volOf = (typeId: number, qty: number) => (volumeMap.get(typeId) ?? 0) * qty;
		const nameOf = (typeId: number) => typeNameMap[typeId] ?? `Type ${typeId}`;
		const linesFromQty = (items: ItemQty[]): InventoryLine[] =>
			items.map((it) => ({
				typeId: it.typeId,
				name: nameOf(it.typeId),
				quantity: it.quantity,
				volume: volOf(it.typeId, it.quantity),
			}));

		const out: BaseGroup[] = [];

		for (const unit of fieldUnits) {
			const latest = snapshotsByContainer.get(unit.id)?.[0];
			const items = linesFromQty(
				(latest?.items ?? []).map((i) => ({ typeId: i.typeId, quantity: i.qty })),
			);
			out.push({
				id: unit.id,
				name: `Field Storage #${storageNumbers.get(unit.id) ?? 0}`,
				kind: "field",
				system: unit.systemId
					? (systemNameMap[unit.systemId] ?? `System #${unit.systemId}`)
					: "",
				warpable: unit.warpable?.trim() ?? "",
				updatedAt: latest?.timestamp,
				items,
			});
		}

		// Ship Cargo Hold is always present so it can be pasted into even before it exists. Its
		// location follows the character: the most recently visited system (recentSystems is sorted
		// newest-first) is where the ship currently is.
		const shipLatest = shipUnit ? snapshotsByContainer.get(shipUnit.id)?.[0] : undefined;
		out.push({
			id: shipUnit?.id ?? "ship",
			name: "Ship Cargo Hold",
			kind: "ship",
			system: recentSystems[0]?.name ?? "",
			warpable: "",
			updatedAt: shipLatest?.timestamp,
			items: linesFromQty(
				(shipLatest?.items ?? []).map((i) => ({ typeId: i.typeId, quantity: i.qty })),
			),
		});

		for (const c of chainContainers) {
			const typeName = typeNameMap[c.typeId];
			const num = storageNumbers.get(c.id) ?? 0;
			const sysId = ssuSystemById?.get(c.id);
			out.push({
				id: c.id,
				// Numbered "<Type> #<N>" when the game type resolves, else keep the identifiable name.
				name: typeName ? `${typeName} #${num}` : c.label,
				kind: "chain",
				system: sysId != null ? (systemNameMap[sysId] ?? `System #${sysId}`) : "",
				warpable: "",
				// SSU inventories all refresh together, so the query's last-updated time applies to each.
				updatedAt: chainUpdatedAt || undefined,
				items: linesFromQty(c.items),
			});
		}

		return out;
	}, [
		fieldUnits,
		shipUnit,
		chainContainers,
		chainUpdatedAt,
		recentSystems,
		snapshotsByContainer,
		storageNumbers,
		ssuSystemById,
		systemNameMap,
		typeNameMap,
		volumeMap,
	]);

	// ── Actions ──────────────────────────────────────────────────────────────
	// "Field Storage #<N> <System>" -- matches the group header so Copy/Delete never show a stale #seq.
	function fieldLabel(unit: FieldStorageUnit): string {
		const sys = unit.systemId ? ` ${systemNameMap[unit.systemId] ?? `System #${unit.systemId}`}` : "";
		return `Field Storage #${storageNumbers.get(unit.id) ?? 0}${sys}`;
	}

	function handleCopy(unit: FieldStorageUnit) {
		navigator.clipboard.writeText(fieldLabel(unit));
		setCopiedId(unit.id);
		setTimeout(() => setCopiedId((c) => (c === unit.id ? null : c)), 1500);
	}

	async function handleDelete(unit: FieldStorageUnit) {
		if (!window.confirm(`Delete field storage container ${fieldLabel(unit)} and its history?`)) return;
		await db.fieldStorageSnapshots.where("containerId").equals(unit.id).delete();
		await db.fieldStorageUnits.delete(unit.id);
		setActivePanel((p) => (p?.containerId === unit.id ? null : p));
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

	function togglePanel(containerId: string, mode: "paste" | "history") {
		setActivePanel((cur) =>
			cur && cur.containerId === containerId && cur.mode === mode ? null : { containerId, mode },
		);
	}

	const isPanel = (id: string, mode: "paste" | "history") =>
		activePanel?.containerId === id && activePanel.mode === mode;

	// Decorate the base groups with header actions and the inline paste / history panel.
	function renderActions(g: BaseGroup): ReactNode {
		if (g.kind === "field") {
			const unit = fieldUnits.find((u) => u.id === g.id);
			if (!unit) return null;
			return (
				<>
					<HeaderBtn title="Paste / update inventory" onClick={() => togglePanel(g.id, "paste")} active={isPanel(g.id, "paste")}>
						<ClipboardPaste size={13} />
					</HeaderBtn>
					<HeaderBtn title="History" onClick={() => togglePanel(g.id, "history")} active={isPanel(g.id, "history")}>
						<History size={13} />
					</HeaderBtn>
					<HeaderBtn title={copiedId === unit.id ? "Copied" : "Copy label"} onClick={() => handleCopy(unit)}>
						{copiedId === unit.id ? <Check size={13} className="text-teal-400" /> : <Copy size={13} />}
					</HeaderBtn>
					<HeaderBtn
						title="Edit container"
						onClick={() => {
							setEditingUnit(unit);
							setShowEditor(true);
						}}
					>
						<Pencil size={13} />
					</HeaderBtn>
					<HeaderBtn title="Delete container" danger onClick={() => handleDelete(unit)}>
						<Trash2 size={13} />
					</HeaderBtn>
				</>
			);
		}
		if (g.kind === "ship") {
			return (
				<>
					<HeaderBtn title="Paste / update cargo" onClick={() => togglePanel(g.id, "paste")} active={isPanel(g.id, "paste")}>
						<ClipboardPaste size={13} />
					</HeaderBtn>
					<HeaderBtn title="History" onClick={() => togglePanel(g.id, "history")} active={isPanel(g.id, "history")}>
						<History size={13} />
					</HeaderBtn>
					{shipUnit && (
						<HeaderBtn title="Clear cargo hold" danger onClick={handleClearShip}>
							<Trash2 size={13} />
						</HeaderBtn>
					)}
				</>
			);
		}
		// chain SSU -- read-only, history only
		return (
			<HeaderBtn title="History" onClick={() => togglePanel(g.id, "history")} active={isPanel(g.id, "history")}>
				<History size={13} />
			</HeaderBtn>
		);
	}

	function renderPanel(g: BaseGroup): ReactNode {
		if (activePanel?.containerId !== g.id) return undefined;
		if (activePanel.mode === "paste") {
			if (g.kind === "ship") {
				return (
					<PasteUpdatePanel
						ensureContainerId={async () => (await ensureShipCargoUnit()).id}
						types={resolverTypes}
						onSnapshot={() => setActivePanel(null)}
					/>
				);
			}
			return (
				<PasteUpdatePanel
					containerId={g.id}
					types={resolverTypes}
					onSnapshot={() => setActivePanel(null)}
				/>
			);
		}
		// history
		if (g.kind === "chain") {
			return (
				<ContainerHistory
					entries={chainTimeline}
					emptyMessage="No deposit / withdraw events recorded yet. Enable Chain Sonar to capture them."
				/>
			);
		}
		return (
			<ContainerHistory
				entries={buildSnapshotTimeline(snapshotsByContainer.get(g.id) ?? [], typeNameMap)}
				emptyMessage="No snapshots yet. Paste an inventory to start the history."
			/>
		);
	}

	const groups: InventoryGroup[] = baseGroups.map((g) => ({
		...g,
		actions: renderActions(g),
		panel: renderPanel(g),
	}));

	const isLoading = loadingAssemblies || (storageAssemblies.length > 0 && loadingInventory);
	const showChainPrompt = CHAIN_ENABLED && !activeCharacter;

	const addButton = (
		<button
			type="button"
			onClick={() => {
				setEditingUnit(null);
				setShowEditor(true);
			}}
			className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
		>
			<Plus size={14} />
			Add field storage
		</button>
	);

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

			{showChainPrompt && (
				<div className="mb-4 rounded-lg border border-dashed border-zinc-800 p-3 text-center text-xs text-zinc-500">
					Select a character on the{" "}
					<a href="/manifest" className="text-cyan-400 hover:text-cyan-300">
						Manifest
					</a>{" "}
					to load on-chain storage.
				</div>
			)}

			{/* Content: editor form, or the unified inventory grid */}
			<div className="min-h-0 flex-1">
				{showEditor ? (
					<div className="max-w-2xl">
						<FieldStorageEditor
							unit={editingUnit ?? undefined}
							systems={systems}
							recentSystems={recentSystems}
							types={resolverTypes}
							onSaved={() => {
								setShowEditor(false);
								setEditingUnit(null);
							}}
							onCancel={() => {
								setShowEditor(false);
								setEditingUnit(null);
							}}
						/>
					</div>
				) : (
					<InventoryGrid
						groups={groups}
						toolbarActions={addButton}
						emptyMessage="No items yet. Add a field storage container or paste your ship cargo."
					/>
				)}
			</div>
		</div>
	);
}
