/**
 * Shared storage-numbering used by the Build Queue Stock panel and the Assets page, so both label
 * storages identically as "<Type> #<N> <System>". `#N` is unique per (system, type), ordered by
 * build age -- #1 is the oldest built of that type in that system.
 */

export interface StorageForNumbering {
	/** Stable identity (container ref key / SSU object id / field-unit id). */
	key: string;
	/** Resolved type name -- the numbering bucket key, alongside systemId. */
	typeName: string;
	systemId?: number;
	/** Build/creation age (epoch ms). Missing values sort last. */
	ageMs?: number;
	/** Secondary tiebreak when ageMs ties/absent (SSU in-game item id, else local seq). */
	buildTie?: number;
}

/**
 * Assign each storage its per-(system, type) sequence number. Returns a map keyed by `key`.
 * Ordering: oldest `ageMs` first, then `buildTie`, then `key` for determinism.
 */
export function assignStorageNumbers(rows: StorageForNumbering[]): Map<string, number> {
	const ordered = [...rows].sort((a, b) => {
		const aa = a.ageMs ?? Number.POSITIVE_INFINITY;
		const bb = b.ageMs ?? Number.POSITIVE_INFINITY;
		if (aa !== bb) return aa - bb;
		const ta = a.buildTie ?? 0;
		const tb = b.buildTie ?? 0;
		if (ta !== tb) return ta - tb;
		return a.key.localeCompare(b.key);
	});

	const counters = new Map<string, number>();
	const result = new Map<string, number>();
	for (const r of ordered) {
		const bucket = `${r.systemId ?? "?"}|${r.typeName}`;
		const n = (counters.get(bucket) ?? 0) + 1;
		counters.set(bucket, n);
		result.set(r.key, n);
	}
	return result;
}
