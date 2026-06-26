import { db } from "@/db";
import { EXPORT_TABLES } from "./constants";

export interface ExportData {
	version: 1;
	exportedAt: string;
	tables: Record<string, unknown[]>;
	/** Cycle identity stamp (set for cycle-archive files). */
	cycleId?: string;
	/** Distinguishes a routine backup from a cycle-reset archive. */
	kind?: "backup" | "cycle-archive";
}

/**
 * Serialize the named tables to a plain object. Names absent from the live Dexie schema are
 * skipped (never thrown) so a since-dropped table name can never abort the operation.
 */
export async function serializeTables(
	names: readonly string[],
): Promise<Record<string, unknown[]>> {
	const live = new Set(db.tables.map((t) => t.name));
	const tables: Record<string, unknown[]> = {};
	for (const name of names) {
		if (!live.has(name)) continue;
		tables[name] = await db.table(name).toArray();
	}
	return tables;
}

/** Trigger a browser download of `data` serialized as JSON under `fileName`. */
export function downloadJson(data: unknown, fileName: string): void {
	const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = fileName;
	a.click();
	URL.revokeObjectURL(url);
}

/**
 * Restore every serialized table in `data` back into the DB (insert-or-replace). Iterates the
 * file's own table keys, so it restores any serialized set -- not just `EXPORT_TABLES`. Names
 * absent from the live schema are skipped (never thrown).
 */
export async function restoreTables(
	data: ExportData,
): Promise<{ tablesImported: number; recordsImported: number }> {
	const live = new Set(db.tables.map((t) => t.name));
	let tablesImported = 0;
	let recordsImported = 0;

	for (const name of Object.keys(data.tables)) {
		if (!live.has(name)) continue;
		const rows = data.tables[name];
		if (!rows || !Array.isArray(rows) || rows.length === 0) continue;

		await db.table(name).bulkPut(rows);
		tablesImported++;
		recordsImported += rows.length;
	}

	return { tablesImported, recordsImported };
}

export async function exportData(): Promise<void> {
	const data: ExportData = {
		version: 1,
		exportedAt: new Date().toISOString(),
		tables: await serializeTables(EXPORT_TABLES),
	};

	downloadJson(data, `periscope-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function importData(
	file: File,
): Promise<{ tablesImported: number; recordsImported: number }> {
	const text = await file.text();
	const data: ExportData = JSON.parse(text);

	if (!data.version || !data.tables) {
		throw new Error("Invalid backup file format");
	}

	return restoreTables(data);
}
