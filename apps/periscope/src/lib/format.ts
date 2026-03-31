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

/**
 * Format a location string from system name and L-point.
 * Strips the hyphen from lPoint: "P2-L3" -> "P2L3".
 */
export function formatLocation(systemName?: string, lPoint?: string): string {
	const compactLPoint = lPoint?.replace("-", "");
	if (systemName && compactLPoint) return `${systemName} (${compactLPoint})`;
	if (systemName) return systemName;
	if (compactLPoint) return compactLPoint;
	return "";
}

/** Extract a user-friendly error message, enriching known wallet errors. */
export function walletErrorMessage(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	if (msg.includes("Max epoch")) {
		return "Eve Vault error: Max epoch is not set. Try logging out of the Eve Vault extension and logging back in, then reconnect your wallet.";
	}
	return msg;
}

/** Format a millisecond duration as "Xm Ys" or "Ys". */
export function formatDuration(ms: number): string {
	const totalSec = Math.round(ms / 1000);
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	if (min === 0) return `${sec}s`;
	return `${min}m ${sec}s`;
}
