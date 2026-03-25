/** Format an ISO timestamp as "MM/DD/YYYY HH:MM:SS" (locale-dependent). */
export function fmtDateTime(iso: string): string {
	const d = new Date(iso);
	return `${d.toLocaleDateString([], { year: "numeric", month: "2-digit", day: "2-digit" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

/** Format an ISO timestamp as "HH:MM:SS" (locale-dependent). */
export function fmtTime(iso: string): string {
	return new Date(iso).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

/** Format a millisecond duration as "Xm Ys" or "Ys". */
export function formatDuration(ms: number): string {
	const totalSec = Math.round(ms / 1000);
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	if (min === 0) return `${sec}s`;
	return `${min}m ${sec}s`;
}
