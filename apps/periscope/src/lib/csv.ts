/**
 * Zero-dependency CSV export utility.
 * Builds a CSV string with proper escaping and triggers a browser download.
 */

export interface CsvColumn<T> {
	header: string;
	accessor: (row: T) => string | number | null | undefined;
}

/** Escape a CSV field value -- wraps in quotes if it contains commas, quotes, or newlines. */
function escapeCsvField(value: string): string {
	if (value.includes(",") || value.includes('"') || value.includes("\n")) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

/** Build a CSV string from rows and column definitions. */
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
	const header = columns.map((c) => escapeCsvField(c.header)).join(",");
	const lines = rows.map((row) =>
		columns.map((c) => escapeCsvField(String(c.accessor(row) ?? ""))).join(","),
	);
	return [header, ...lines].join("\n");
}

/** Trigger a browser download for a CSV string. */
export function downloadCsv(csv: string, filename: string): void {
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/** Build and download a CSV file from rows and column definitions. */
export function exportToCsv<T>(
	rows: T[],
	columns: CsvColumn<T>[],
	filenamePrefix = "export",
): void {
	const csv = buildCsv(rows, columns);
	const date = new Date().toISOString().slice(0, 10);
	downloadCsv(csv, `${filenamePrefix}-${date}.csv`);
}
