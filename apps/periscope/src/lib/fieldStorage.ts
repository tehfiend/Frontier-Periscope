/**
 * Field Storage helpers (plan 39 -- Phase 1).
 *
 * Field storage units are manual, peer-to-SSU containers that track inventory via
 * clipboard snapshots instead of chain sync. Current inventory = the latest snapshot;
 * history = the snapshot sequence; "what changed" = an on-demand diff between two snapshots.
 *
 * - `allocateNextSeq` hands out the per-user monotonic `#` id (never reused).
 * - `createSnapshot` builds (does not persist) a `FieldStorageSnapshot` from a parsed paste.
 * - `diffSnapshots` derives added / removed / changed rows for the history timeline.
 */
import { db } from "@/db";
import type { FieldStorageSnapshot, FieldStorageUnit } from "@/db/types";
import type { ParsedInventory } from "./inventoryParser";

/** Settings key for the monotonic field-storage sequence counter (next value to hand out). */
export const FIELD_STORAGE_SEQ_KEY = "fieldStorageNextSeq";

/** Stable display name for the single dedicated Ship Cargo Hold unit. */
export const SHIP_CARGO_NAME = "Ship Cargo Hold";

/**
 * Find the existing Ship Cargo Hold unit and return it, else create the single one and persist it.
 * Idempotent -- never creates a second (the find + add run in one read-write transaction). `seq` is
 * 0 (reserved -- the ship hold has no "#number", so `allocateNextSeq` is intentionally NOT used).
 */
export async function ensureShipCargoUnit(): Promise<FieldStorageUnit> {
	return db.transaction("rw", db.fieldStorageUnits, async () => {
		const existing = await db.fieldStorageUnits.filter((u) => u.kind === "ship").first();
		if (existing) return existing;
		const now = Date.now();
		const record: FieldStorageUnit = {
			id: crypto.randomUUID(),
			seq: 0,
			name: SHIP_CARGO_NAME,
			source: "manual",
			kind: "ship",
			createdAt: now,
			updatedAt: now,
		};
		await db.fieldStorageUnits.add(record);
		return record;
	});
}

/**
 * Allocate the next monotonic field-storage `seq` and advance the counter.
 *
 * The next value is stored in the existing `settings` table (never derived from
 * `max(seq)`, so deleting the highest unit never causes reuse). First value is 1.
 * Read + increment run in a single read-write transaction to avoid races.
 */
export async function allocateNextSeq(): Promise<number> {
	return db.transaction("rw", db.settings, async () => {
		const entry = await db.settings.get(FIELD_STORAGE_SEQ_KEY);
		const current = typeof entry?.value === "number" && entry.value >= 1 ? entry.value : 1;
		await db.settings.put({ key: FIELD_STORAGE_SEQ_KEY, value: current + 1 });
		return current;
	});
}

/**
 * Build a snapshot record from a parsed inventory paste. Pure -- the caller persists it
 * (e.g. `db.fieldStorageSnapshots.add(...)`).
 */
export function createSnapshot(containerId: string, parsed: ParsedInventory): FieldStorageSnapshot {
	return {
		id: crypto.randomUUID(),
		containerId,
		timestamp: Date.now(),
		items: parsed.items.map((i) => ({ typeId: i.typeId, qty: i.qty })),
		unresolved: parsed.unresolved.map((u) => ({ name: u.name, qty: u.qty, vol: u.vol })),
	};
}

export interface SnapshotDiffRow {
	typeId: number;
	qty: number;
}

export interface SnapshotDiffChange {
	typeId: number;
	prevQty: number;
	nextQty: number;
	/** nextQty - prevQty (always non-zero for a `changed` row). */
	delta: number;
}

export interface SnapshotDiff {
	added: SnapshotDiffRow[];
	removed: SnapshotDiffRow[];
	changed: SnapshotDiffChange[];
}

/**
 * Diff two snapshots' resolved items for the history timeline. A missing/null `prev`
 * (the first snapshot) makes every item an addition. Unresolved rows are not diffed.
 */
export function diffSnapshots(
	prev: FieldStorageSnapshot | null | undefined,
	next: FieldStorageSnapshot,
): SnapshotDiff {
	const prevMap = new Map<number, number>();
	for (const i of prev?.items ?? []) prevMap.set(i.typeId, i.qty);
	const nextMap = new Map<number, number>();
	for (const i of next.items) nextMap.set(i.typeId, i.qty);

	const added: SnapshotDiffRow[] = [];
	const removed: SnapshotDiffRow[] = [];
	const changed: SnapshotDiffChange[] = [];

	for (const [typeId, nextQty] of nextMap) {
		const prevQty = prevMap.get(typeId);
		if (prevQty == null) {
			added.push({ typeId, qty: nextQty });
		} else if (prevQty !== nextQty) {
			changed.push({ typeId, prevQty, nextQty, delta: nextQty - prevQty });
		}
	}
	for (const [typeId, prevQty] of prevMap) {
		if (!nextMap.has(typeId)) removed.push({ typeId, qty: prevQty });
	}

	return { added, removed, changed };
}
