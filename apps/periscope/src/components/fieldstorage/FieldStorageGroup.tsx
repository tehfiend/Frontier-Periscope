// Field storage on the Structures page -- plan: unified storage. Manually-added field storage units and
// the dedicated Ship Cargo Hold are not on-chain deployables, so they don't belong in the chain-oriented
// structures grid (its Extension/rename/dapp columns don't apply). Instead they get their OWN group band
// beneath that grid: each unit's name, solar system + closest warpable (editable, independent of the map,
// exactly like a node's location), and a summary of what it currently holds. Location edits write straight
// to db.fieldStorageUnits, so the same location feeds the Build Queue's distance ranking.

import { ItemIcon } from "@/components/ItemIcon";
import { SystemPicker } from "@/components/SystemPicker";
import { WarpableSelector } from "@/components/WarpableSelector";
import { db } from "@/db";
import type { SolarSystem } from "@/db/types";
import type { RecentSystem } from "@/hooks/useCharacterRecentSystems";
import { useLiveQuery } from "dexie-react-hooks";
import { Package, Ship, Warehouse } from "lucide-react";
import { useEffect, useState } from "react";

interface FieldStorageGroupRow {
	id: string;
	kind: "field" | "ship";
	label: string;
	systemId?: number;
	warpable?: string;
	systemName: string | null;
	itemTypes: number;
	sampleTypeIds: number[];
}

async function saveLocation(id: string, systemId: number | undefined, warpable: string | undefined) {
	await db.fieldStorageUnits.update(id, { systemId, warpable, updatedAt: Date.now() });
}

function FieldStorageRow({
	row,
	systems,
	recentSystems,
}: {
	row: FieldStorageGroupRow;
	systems: SolarSystem[];
	recentSystems: RecentSystem[];
}) {
	const [warpDraft, setWarpDraft] = useState(row.warpable ?? "");
	// Re-seed when the stored warpable changes underneath us (e.g. saved from Assets).
	useEffect(() => {
		setWarpDraft(row.warpable ?? "");
	}, [row.warpable]);

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm hover:bg-zinc-800/30">
			{row.kind === "ship" ? (
				<Ship size={14} className="shrink-0 text-cyan-400/80" />
			) : (
				<Package size={14} className="shrink-0 text-emerald-400/70" />
			)}
			<span className="min-w-0 truncate font-medium text-zinc-100">{row.label}</span>

			<span className="flex items-center gap-1 text-zinc-500">
				{row.sampleTypeIds.map((typeId) => (
					<ItemIcon key={typeId} typeId={typeId} />
				))}
				<span className="ml-1 text-[11px] tabular-nums">
					{row.itemTypes > 0 ? `${row.itemTypes} item${row.itemTypes === 1 ? "" : "s"}` : "empty"}
				</span>
			</span>

			{/* Location -- system + closest warpable, editable and independent of the map. */}
			<div className="ml-auto flex items-center gap-2">
				<span className="text-[10px] uppercase tracking-wide text-zinc-600">loc</span>
				<div className="w-44">
					<SystemPicker
						value={row.systemId ?? null}
						onChange={(id) => saveLocation(row.id, id ?? undefined, row.warpable)}
						systems={systems}
						recent={recentSystems}
						placeholder="System..."
						compact
					/>
				</div>
				<div className="w-48">
					<WarpableSelector
						value={warpDraft}
						onChange={setWarpDraft}
						onCommit={(w) => saveLocation(row.id, row.systemId, w.trim() || undefined)}
						systemId={row.systemId ?? null}
						compact
					/>
				</div>
			</div>
		</div>
	);
}

export function FieldStorageGroup({
	systems,
	recentSystems,
}: {
	systems: SolarSystem[];
	recentSystems: RecentSystem[];
}) {
	const rows = useLiveQuery<FieldStorageGroupRow[]>(async () => {
		const [units, solarSystems] = await Promise.all([
			db.fieldStorageUnits.toArray(),
			db.solarSystems.toArray(),
		]);
		const systemName = new Map(solarSystems.map((s) => [s.id, s.name ?? `#${s.id}`]));
		const out: FieldStorageGroupRow[] = [];
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
			out.push({
				id: unit.id,
				kind: unit.kind === "ship" ? "ship" : "field",
				label,
				systemId: unit.systemId,
				warpable: unit.warpable,
				systemName: unit.systemId != null ? (systemName.get(unit.systemId) ?? null) : null,
				itemTypes: items.length,
				sampleTypeIds: items.slice(0, 6).map((it) => it.typeId),
			});
		}
		// Ship cargo last; field units by seq.
		out.sort((a, b) => {
			if (a.kind !== b.kind) return a.kind === "ship" ? 1 : -1;
			return a.label.localeCompare(b.label, undefined, { numeric: true });
		});
		return out;
	}, []);

	if (!rows || rows.length === 0) return null;

	return (
		<div className="mt-4 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
				<Warehouse size={14} className="shrink-0 text-emerald-400" />
				<span className="text-sm font-semibold text-zinc-100">Field Storage</span>
				<span className="rounded bg-cyan-700/30 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">
					Manual
				</span>
				<span className="text-[10px] text-zinc-600">
					{rows.length} storage{rows.length === 1 ? "" : "s"}
				</span>
			</div>
			<div className="divide-y divide-zinc-800/50">
				{rows.map((row) => (
					<FieldStorageRow
						key={row.id}
						row={row}
						systems={systems}
						recentSystems={recentSystems}
					/>
				))}
			</div>
		</div>
	);
}
