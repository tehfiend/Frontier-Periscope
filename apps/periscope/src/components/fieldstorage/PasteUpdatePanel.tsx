import { db } from "@/db";
import { createSnapshot } from "@/lib/fieldStorage";
import { type InventoryTypeInfo, parseInventoryPaste } from "@/lib/inventoryParser";
import { ClipboardPaste, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

interface PasteUpdatePanelProps {
	/** Existing container id (field units). Omit when using `ensureContainerId`. */
	containerId?: string;
	/**
	 * Lazily resolve (creating if needed) the container id at apply time. Takes precedence over
	 * `containerId`; used by the Ship Cargo Hold so its unit is only created on first paste.
	 */
	ensureContainerId?: () => Promise<string>;
	/** Candidate types for name resolution (id + name + per-unit volume). */
	types: InventoryTypeInfo[];
	/** Called with the persisted snapshot's container id after a snapshot is saved. */
	onSnapshot?: (containerId: string) => void;
}

/**
 * Paste-to-update flow for a field storage container: an EVE Frontier inventory paste is
 * parsed into a full snapshot and appended to `db.fieldStorageSnapshots`. A live preview
 * shows how many lines resolved vs. landed in the unresolved bucket before applying.
 */
export function PasteUpdatePanel({
	containerId,
	ensureContainerId,
	types,
	onSnapshot,
}: PasteUpdatePanelProps) {
	const [text, setText] = useState("");
	const [saving, setSaving] = useState(false);
	const [lastApplied, setLastApplied] = useState<{ matched: number; unresolved: number } | null>(
		null,
	);

	// Live preview -- parse on every keystroke (cheap: a few thousand candidates, small paste).
	const preview = useMemo(() => {
		if (!text.trim()) return null;
		return parseInventoryPaste(text, types);
	}, [text, types]);

	const matchedCount = preview?.items.length ?? 0;
	const unresolvedCount = preview?.unresolved.length ?? 0;

	async function handleApply() {
		if (saving || !preview || matchedCount + unresolvedCount === 0) return;
		setSaving(true);
		try {
			const id = ensureContainerId ? await ensureContainerId() : containerId;
			if (!id) return;
			const snapshot = createSnapshot(id, preview);
			await db.fieldStorageSnapshots.add(snapshot);
			await db.fieldStorageUnits.update(id, { updatedAt: snapshot.timestamp });
			setLastApplied({ matched: matchedCount, unresolved: unresolvedCount });
			setText("");
			onSnapshot?.(id);
		} finally {
			setSaving(false);
		}
	}

	// Record an EMPTY snapshot -- the storage now holds nothing. A paste never produces this (an empty
	// paste has nothing to apply), so it is the only way to zero out a container without deleting it.
	async function handleEmpty() {
		if (saving) return;
		if (!window.confirm("Empty this storage? This records a snapshot showing it now holds nothing."))
			return;
		setSaving(true);
		try {
			const id = ensureContainerId ? await ensureContainerId() : containerId;
			if (!id) return;
			const snapshot = createSnapshot(id, { items: [], unresolved: [] });
			await db.fieldStorageSnapshots.add(snapshot);
			await db.fieldStorageUnits.update(id, { updatedAt: snapshot.timestamp });
			setText("");
			setLastApplied({ matched: 0, unresolved: 0 });
			onSnapshot?.(id);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
			<div className="flex items-center gap-2">
				<ClipboardPaste size={14} className="text-cyan-400" />
				<span className="text-xs font-medium text-zinc-400">
					Paste inventory to capture a new snapshot
				</span>
			</div>
			<textarea
				value={text}
				onChange={(e) => {
					setText(e.target.value);
					setLastApplied(null);
				}}
				rows={4}
				placeholder="Select all items in the in-game inventory, copy, and paste here..."
				className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
			/>
			<div className="flex items-center justify-between gap-3">
				<div className="text-xs text-zinc-500">
					{preview ? (
						<>
							<span className="font-medium text-teal-400">{matchedCount}</span> matched
							{unresolvedCount > 0 && (
								<>
									{" · "}
									<span className="font-medium text-amber-400">{unresolvedCount}</span> unresolved
								</>
							)}
						</>
					) : lastApplied ? (
						<span className="text-zinc-500">
							Snapshot saved ({lastApplied.matched} matched
							{lastApplied.unresolved > 0 ? `, ${lastApplied.unresolved} unresolved` : ""})
						</span>
					) : (
						"Awaiting paste"
					)}
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={handleEmpty}
						disabled={saving}
						className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-red-500/60 hover:text-red-300 disabled:opacity-50"
						title="Record that this storage is now empty"
					>
						Empty
					</button>
					<button
						type="button"
						onClick={handleApply}
						disabled={saving || matchedCount + unresolvedCount === 0}
						className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
					>
						{saving && <Loader2 size={12} className="animate-spin" />}
						Apply snapshot
					</button>
				</div>
			</div>
			{preview && unresolvedCount > 0 && (
				<div className="rounded border border-amber-900/40 bg-amber-950/20 px-2 py-1.5 text-[11px] text-amber-300/80">
					Unresolved: {preview.unresolved.map((u) => `${u.name} x${u.qty}`).join(", ")}
				</div>
			)}
		</div>
	);
}
