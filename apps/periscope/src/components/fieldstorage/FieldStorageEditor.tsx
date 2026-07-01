import { SystemSearch } from "@/components/SystemSearch";
import { db } from "@/db";
import type { FieldStorageUnit, SolarSystem } from "@/db/types";
import { allocateNextSeq } from "@/lib/fieldStorage";
import { Loader2 } from "lucide-react";
import { useState } from "react";

interface FieldStorageEditorProps {
	/** When set, edits an existing unit; otherwise creates a new one. */
	unit?: FieldStorageUnit;
	systems: SolarSystem[];
	/** Called with the created/updated unit id after a successful save. */
	onSaved: (id: string) => void;
	onCancel: () => void;
}

/**
 * Create / edit form for a field storage container. On create it allocates the next
 * monotonic `seq` (the displayed `#`), then persists to `db.fieldStorageUnits`.
 */
export function FieldStorageEditor({ unit, systems, onSaved, onCancel }: FieldStorageEditorProps) {
	const [name, setName] = useState(unit?.name ?? "");
	const [systemId, setSystemId] = useState<number | null>(unit?.systemId ?? null);
	const [warpable, setWarpable] = useState(unit?.warpable ?? "");
	const [note, setNote] = useState(unit?.note ?? "");
	const [saving, setSaving] = useState(false);

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
				<SystemSearch
					value={systemId}
					onChange={setSystemId}
					systems={systems}
					placeholder="Search solar system..."
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
