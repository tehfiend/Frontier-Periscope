import { db } from "@/db";
import { EXPORT_TABLES } from "./constants";

interface ExportData {
	version: 1;
	exportedAt: string;
	tables: Record<string, unknown[]>;
}

export async function exportData(): Promise<void> {
	const tables: Record<string, unknown[]> = {};

	for (const name of EXPORT_TABLES) {
		const table = db.table(name);
		tables[name] = await table.toArray();
	}

	const data: ExportData = {
		version: 1,
		exportedAt: new Date().toISOString(),
		tables,
	};

	const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `periscope-backup-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

export async function importData(file: File): Promise<{ tablesImported: number; recordsImported: number }> {
	const text = await file.text();
	const data: ExportData = JSON.parse(text);

	if (!data.version || !data.tables) {
		throw new Error("Invalid backup file format");
	}

	let tablesImported = 0;
	let recordsImported = 0;

	for (const name of EXPORT_TABLES) {
		const rows = data.tables[name];
		if (!rows || !Array.isArray(rows) || rows.length === 0) continue;

		const table = db.table(name);
		await table.bulkPut(rows);
		tablesImported++;
		recordsImported += rows.length;
	}

	return { tablesImported, recordsImported };
}
