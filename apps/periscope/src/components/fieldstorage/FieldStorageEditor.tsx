import { SystemPicker } from "@/components/SystemPicker";
import { db } from "@/db";
import type { FieldStorageUnit, SolarSystem } from "@/db/types";
import type { RecentSystem } from "@/hooks/useCharacterRecentSystems";
import { allocateNextSeq, createSnapshot } from "@/lib/fieldStorage";
import { type InventoryTypeInfo, parseInventoryPaste } from "@/lib/inventoryParser";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

interface FieldStorageEditorProps {
	/** When set, edits an existing unit; otherwise creates a new one. */
	unit?: FieldStorageUnit;
	systems: SolarSystem[];
	/** Recently visited systems for the location picker's quick-select list. */
	recentSystems: RecentSystem[];
	/** Candidate types for resolving a pasted starting inventory (id + name + per-unit volume). */
	types: InventoryTypeInfo[];
	/** Called with the created/updated unit id after a successful save. */
	onSaved: (id: string) => void;
	onCancel: () => void;
}

/**
 * Create / edit form for a field storage container. On create it allocates the next
 * monotonic `seq` (the displayed `#`), then persists to `db.fieldStorageUnits`. A new
 * container can optionally capture a starting inventory snapshot from a pasted in-game
 * inventory in the same step.
 */
export function FieldStorageEditor({
	unit,
	systems,
	recentSystems,
	types,
	onSaved,
	onCancel,
}: FieldStorageEditorProps) {
	const [name, setName] = useState(unit?.name ?? "");
	const [systemId, setSystemId] = useState<number | null>(unit?.systemId ?? null);
	const [warpable, setWarpable] = useState(unit?.warpable ?? "");
	const [note, setNote] = useState(unit?.note ?? "");
	const [inventoryText, setInventoryText] = useState("");
	const [saving, setSaving] = useState(false);

	// Live preview of a pasted starting inventory (create only). Cheap: a small paste against a
	// few thousand candidate types.
	const inventoryPreview = useMemo(() => {
		if (unit || !inventoryText.trim()) return null;
		return parseInventoryPaste(inventoryText, types);
	}, [unit, inventoryText, types]);
	const matchedCount = inventoryPreview?.items.length ?? 0;
	const unresolvedCount = inventoryPreview?.unresolved.length ?? 0;

	async function handleSave() {
		if (saving) return;
		setSaving(true);
		try {
			const now = Date.now();
			const trimmedName = name.trim();
			const trimmedWarpable = warpable.trim();
			const trimmedNote = note.trim();
			if (unit) {
				await db.fieldStorageUnits.update(unit.id, {
					name: trimmedName || undefined,
					systemId: systemId ?? undefined,
					warpable: trimmedWarpable || undefined,
					note: trimmedNote || undefined,
					updatedAt: now,
				});
				onSaved(unit.id);
			} else {
				const seq = await allocateNextSeq();
				const record: FieldStorageUnit = {
					id: crypto.randomUUID(),
					seq,
					name: trimmedName || undefined,
					source: "manual",
					systemId: systemId ?? undefined,
					warpable: trimmedWarpable || undefined,
					note: trimmedNote || undefined,
					createdAt: now,
					updatedAt: now,
				};
				await db.fieldStorageUnits.add(record);
				// Optionally seed the initial inventory snapshot from the pasted inventory.
				if (inventoryPreview && matchedCount + unresolvedCount > 0) {
					const snapshot = createSnapshot(record.id, inventoryPreview);
					await db.fieldStorageSnapshots.add(snapshot);
					await db.fieldStorageUnits.update(record.id, { updatedAt: snapshot.timestamp });
				}
				onSaved(record.id);
			}
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<h3 className="text-sm font-semibold text-zinc-200">
				{unit ? `Edit container #${unit.seq}` : "New field storage container"}
			</h3>

			<div>
				<label className="mb-1 block text-xs font-medium text-zinc-500">Name (optional)</label>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g. Junk, Ammo cache"
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>

			<div>
				<label className="mb-1 block text-xs font-medium text-zinc-500">Solar system</label>
				<SystemPicker
					value={systemId}
					onChange={setSystemId}
					systems={systems}
					recent={recentSystems}
					placeholder="Search or pick a recent system..."
				/>
			</div>

			<div>
				<label className="mb-1 block text-xs font-medium text-zinc-500">
					Closest warpable (optional)
				</label>
				<input
					type="text"
					value={warpable}
					onChange={(e) => setWarpable(e.target.value)}
					placeholder="e.g. P3-L2, station name"
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>

			<div>
				<label className="mb-1 block text-xs font-medium text-zinc-500">Note (optional)</label>
				<textarea
					value={note}
					onChange={(e) => setNote(e.target.value)}
					rows={2}
					placeholder="Free-text note"
					className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>

			{!unit && (
				<div>
					<label className="mb-1 block text-xs font-medium text-zinc-500">
						Starting inventory (optional)
					</label>
					<textarea
						value={inventoryText}
						onChange={(e) => setInventoryText(e.target.value)}
						rows={4}
						placeholder="Select all items in the in-game inventory, copy, and paste here to capture the first snapshot..."
						className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
					{inventoryPreview && (
						<div className="mt-1 text-xs text-zinc-500">
							<span className="font-medium text-teal-400">{matchedCount}</span> matched
							{unresolvedCount > 0 && (
								<>
									{" · "}
									<span className="font-medium text-amber-400">{unresolvedCount}</span> unresolved
								</>
							)}
						</div>
					)}
				</div>
			)}

			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={handleSave}
					disabled={saving}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{saving && <Loader2 size={14} className="animate-spin" />}
					{unit ? "Save changes" : "Create container"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					disabled={saving}
					className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
