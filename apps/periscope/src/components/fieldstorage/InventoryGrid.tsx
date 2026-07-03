import { ItemIcon } from "@/components/ItemIcon";
import {
	ChevronDown,
	ChevronRight,
	ChevronUp,
	ChevronsDownUp,
	ChevronsUpDown,
	Search,
	X,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface InventoryLine {
	typeId: number;
	name: string;
	quantity: number;
	/** Total stack volume in m3 (per-unit volume x quantity). */
	volume: number;
}

export interface InventoryGroup {
	id: string;
	/** Storage display name (e.g. "#3 Ammo cache", "Ship Cargo Hold", "SSU #123"). */
	name: string;
	kind: "chain" | "field" | "ship";
	/** Container system name, or "" when it has no location (chain SSU / ship). */
	system: string;
	/** Closest warpable, or "" when unset. */
	warpable: string;
	/**
	 * When this container's data was last captured (epoch ms): the latest snapshot time for field
	 * storage / ship cargo, or the last on-chain refresh time for an SSU. Undefined when never set.
	 */
	updatedAt?: number;
	items: InventoryLine[];
	/** Action buttons rendered on the right of the group header. */
	actions?: ReactNode;
	/** Inline panel (paste / history) rendered under the header when present. */
	panel?: ReactNode;
}

type SortKey = "storage" | "system" | "warpable" | "updated" | "item" | "quantity" | "volume";
type SortDir = "asc" | "desc";

interface InventoryGridProps {
	groups: InventoryGroup[];
	/** Extra toolbar content on the left (e.g. an "Add field storage" button). */
	toolbarActions?: ReactNode;
	emptyMessage?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a volume in m3 the way the in-game inventory does. */
export function formatVolume(m3: number): string {
	return `${m3.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`;
}

/** Compact "when captured" label for the Updated column. */
function formatUpdated(ms: number | undefined): string {
	if (!ms) return "";
	return new Date(ms).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

const GROUP_KEYS: SortKey[] = ["storage", "system", "warpable", "updated"];

// ── Component ───────────────────────────────────────────────────────────────

/**
 * Unified inventory grid: every item across every storage container in one table, grouped by
 * container. Each collapsible group header carries the container-level system / closest warpable
 * plus its rolled-up item count and total volume, and item rows list name / quantity / volume.
 * Storage/System/Warpable sorting reorders the groups; Item/Qty/Volume sorting reorders items
 * within each group. The search box matches item names as well as storage/system names.
 */
export function InventoryGrid({ groups, toolbarActions, emptyMessage }: InventoryGridProps) {
	const [query, setQuery] = useState("");
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	// null sort = input order (field -> ship -> chain), items alphabetized. Clicking a header sorts.
	const [sortKey, setSortKey] = useState<SortKey | null>(null);
	const [sortDir, setSortDir] = useState<SortDir>("asc");

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortKey(key);
			setSortDir("asc");
		}
	}

	function toggleGroup(id: string) {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	// Filter by search, then sort groups and their items.
	const visibleGroups = useMemo(() => {
		const q = query.trim().toLowerCase();
		const dir = sortDir === "asc" ? 1 : -1;

		// Items default to alphabetical; quantity/volume sorts follow the header; the "item" header
		// sorts by name with the chosen direction.
		const sortItems = (items: InventoryLine[]) => {
			if (sortKey === "quantity") return [...items].sort((a, b) => (a.quantity - b.quantity) * dir);
			if (sortKey === "volume") return [...items].sort((a, b) => (a.volume - b.volume) * dir);
			const nameDir = sortKey === "item" ? dir : 1;
			return [...items].sort((a, b) => a.name.localeCompare(b.name) * nameDir);
		};

		const filtered = groups
			.map((g) => {
				if (!q) return { ...g, items: sortItems(g.items) };
				const groupMatch =
					g.name.toLowerCase().includes(q) ||
					g.system.toLowerCase().includes(q) ||
					g.warpable.toLowerCase().includes(q);
				// A group matched by name/system shows all its items; otherwise only matching items.
				const items = groupMatch ? g.items : g.items.filter((i) => i.name.toLowerCase().includes(q));
				if (!groupMatch && items.length === 0) return null;
				return { ...g, items: sortItems(items) };
			})
			.filter((g): g is InventoryGroup => g != null);

		// Group-level sorting only reorders the groups; otherwise input order (field -> ship -> chain).
		if (sortKey && GROUP_KEYS.includes(sortKey)) {
			filtered.sort((a, b) => {
				if (sortKey === "updated") return ((a.updatedAt ?? 0) - (b.updatedAt ?? 0)) * dir;
				const av = sortKey === "storage" ? a.name : sortKey === "system" ? a.system : a.warpable;
				const bv = sortKey === "storage" ? b.name : sortKey === "system" ? b.system : b.warpable;
				return av.localeCompare(bv) * dir;
			});
		}
		return filtered;
	}, [groups, query, sortKey, sortDir]);

	const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.id));
	const toggleAll = () =>
		setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.id)));

	const totalVolume = useMemo(
		() => visibleGroups.reduce((sum, g) => sum + g.items.reduce((s, i) => s + i.volume, 0), 0),
		[visibleGroups],
	);
	const totalItems = useMemo(
		() => visibleGroups.reduce((sum, g) => sum + g.items.length, 0),
		[visibleGroups],
	);

	return (
		<div className="flex h-full flex-col gap-3">
			{/* Toolbar */}
			<div className="flex items-center gap-3">
				{toolbarActions}
				<div className="relative max-w-sm flex-1">
					<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search items, storage, or system..."
						className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-8 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							aria-label="Clear search"
							className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
						>
							<X size={14} />
						</button>
					)}
				</div>
				<button
					type="button"
					onClick={toggleAll}
					className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
				>
					{allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
					{allCollapsed ? "Expand all" : "Collapse all"}
				</button>
				<span className="ml-auto shrink-0 text-xs text-zinc-600">
					{totalItems} item{totalItems === 1 ? "" : "s"} · {formatVolume(totalVolume)}
				</span>
			</div>

			{/* Table */}
			<div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-800">
				<table className="w-full table-fixed text-sm">
					<colgroup>
						<col style={{ width: "220px" }} />
						<col style={{ width: "110px" }} />
						<col style={{ width: "130px" }} />
						<col style={{ width: "130px" }} />
						<col />
						<col style={{ width: "90px" }} />
						<col style={{ width: "110px" }} />
					</colgroup>
					<thead className="sticky top-0 z-10">
						<tr className="border-b border-zinc-800 bg-zinc-900/90 text-left text-zinc-400">
							<HeaderCell label="Storage" k="storage" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
							<HeaderCell label="System" k="system" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
							<HeaderCell label="Warpable" k="warpable" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
							<HeaderCell label="Updated" k="updated" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
							<HeaderCell label="Item" k="item" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
							<HeaderCell label="Qty" k="quantity" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
							<HeaderCell label="Volume" k="volume" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
						</tr>
					</thead>
					<tbody>
						{visibleGroups.length === 0 ? (
							<tr>
								<td colSpan={7} className="px-3 py-12 text-center text-sm text-zinc-600">
									{emptyMessage ?? "No items."}
								</td>
							</tr>
						) : (
							visibleGroups.map((g) => {
								const isCollapsed = collapsed.has(g.id);
								const groupVolume = g.items.reduce((s, i) => s + i.volume, 0);
								return (
									<GroupRows
										key={g.id}
										group={g}
										collapsed={isCollapsed}
										groupVolume={groupVolume}
										onToggle={() => toggleGroup(g.id)}
									/>
								);
							})
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

// ── Sub-components ───────────────────────────────────────────────────────────

function HeaderCell({
	label,
	k,
	sortKey,
	sortDir,
	onSort,
	align = "left",
}: {
	label: string;
	k: SortKey;
	sortKey: SortKey | null;
	sortDir: SortDir;
	onSort: (k: SortKey) => void;
	align?: "left" | "right";
}) {
	const active = sortKey === k;
	return (
		<th className={`px-2 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
			<button
				type="button"
				onClick={() => onSort(k)}
				className={`inline-flex items-center gap-1 hover:text-zinc-200 ${active ? "text-cyan-300" : ""}`}
			>
				{label}
				{active ? (
					sortDir === "asc" ? (
						<ChevronUp size={12} />
					) : (
						<ChevronDown size={12} />
					)
				) : (
					<ChevronsUpDown size={11} className="text-zinc-700" />
				)}
			</button>
		</th>
	);
}

function GroupRows({
	group,
	collapsed,
	groupVolume,
	onToggle,
}: {
	group: InventoryGroup;
	collapsed: boolean;
	groupVolume: number;
	onToggle: () => void;
}) {
	return (
		<>
			<tr className="border-b border-zinc-800 bg-zinc-900/40">
				<td className="px-2 py-2">
					<button
						type="button"
						onClick={onToggle}
						className="flex w-full min-w-0 items-center gap-1.5 text-left font-medium text-zinc-100 hover:text-cyan-300"
					>
						{collapsed ? (
							<ChevronRight size={14} className="shrink-0 text-zinc-500" />
						) : (
							<ChevronDown size={14} className="shrink-0 text-zinc-500" />
						)}
						<span className="truncate">{group.name}</span>
						<span className="shrink-0 text-[10px] text-zinc-600">({group.items.length})</span>
					</button>
				</td>
				<td className="truncate px-2 py-2 text-zinc-400">
					{group.system || <span className="text-zinc-700">--</span>}
				</td>
				<td className="truncate px-2 py-2 text-zinc-400">
					{group.warpable || <span className="text-zinc-700">--</span>}
				</td>
				<td
					className="truncate px-2 py-2 text-[11px] text-zinc-500"
					title={group.updatedAt ? new Date(group.updatedAt).toLocaleString() : undefined}
				>
					{formatUpdated(group.updatedAt) || <span className="text-zinc-700">--</span>}
				</td>
				<td className="px-2 py-2">
					{group.actions && <div className="flex items-center gap-1">{group.actions}</div>}
				</td>
				<td className="px-2 py-2" />
				<td className="px-2 py-2 text-right font-mono text-xs text-zinc-400">
					{formatVolume(groupVolume)}
				</td>
			</tr>
			{group.panel && (
				<tr className="border-b border-zinc-800 bg-zinc-950/40">
					<td colSpan={7} className="px-3 py-3">
						{group.panel}
					</td>
				</tr>
			)}
			{!collapsed &&
				group.items.map((item) => (
					<tr
						key={`${group.id}:${item.typeId}`}
						className="border-b border-zinc-800/30 hover:bg-zinc-800/30"
					>
						<td className="px-2 py-1.5" />
						<td className="px-2 py-1.5" />
						<td className="px-2 py-1.5" />
						<td className="px-2 py-1.5" />
						<td className="px-2 py-1.5">
							<div className="flex min-w-0 items-center gap-2">
								<ItemIcon typeId={item.typeId} size={18} />
								<span className="truncate text-zinc-200">{item.name}</span>
								<span className="shrink-0 font-mono text-[10px] text-zinc-600">#{item.typeId}</span>
							</div>
						</td>
						<td className="px-2 py-1.5 text-right font-mono text-zinc-200">
							{item.quantity.toLocaleString()}
						</td>
						<td className="px-2 py-1.5 text-right font-mono text-xs text-zinc-400">
							{formatVolume(item.volume)}
						</td>
					</tr>
				))}
			{!collapsed && group.items.length === 0 && (
				<tr className="border-b border-zinc-800/30">
					<td className="px-2 py-1.5" />
					<td className="px-2 py-1.5" />
					<td className="px-2 py-1.5" />
					<td className="px-2 py-1.5" />
					<td colSpan={3} className="px-2 py-1.5 text-xs italic text-zinc-600">
						No items.
					</td>
				</tr>
			)}
		</>
	);
}
