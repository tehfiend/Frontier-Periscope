/**
 * Coin formatting utilities for converting between display units and base units.
 *
 * On-chain prices are stored in base units (smallest denomination).
 * For a coin with 9 decimals, 1 display unit = 1_000_000_000 base units.
 */

/**
 * Parse a user-entered decimal price string into base units (bigint).
 * Uses string math to avoid floating-point precision issues.
 *
 * Examples (decimals=9):
 *   "100"   -> 100_000_000_000n
 *   "1.5"   -> 1_500_000_000n
 *   "0.001" -> 1_000_000n
 */
export function parseDisplayPrice(input: string, decimals: number): bigint {
	const trimmed = input.trim();
	if (!trimmed || trimmed === "." || trimmed === "-") return 0n;

	const parts = trimmed.replace(/,/g, "").split(".");
	// Reject anything BigInt() can't parse (exponent notation like "1e5", stray letters). Callers
	// treat 0n as "invalid, block submit", so this degrades to a validation error instead of a
	// render-time throw that white-screens the dialog.
	if (!/^-?\d*$/.test(parts[0]) || (parts[1] != null && !/^\d*$/.test(parts[1]))) return 0n;
	const whole = BigInt(parts[0] || "0");
	const fracStr = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
	const frac = BigInt(fracStr);
	return whole * 10n ** BigInt(decimals) + frac;
}

/**
 * Format base units into a human-readable display string.
 *
 * Examples (decimals=9):
 *   100_000_000_000n -> "100"
 *   1_500_000_000n   -> "1.5"
 *   1_000_000n       -> "0.001"
 */
export function formatBaseUnits(baseUnits: number | bigint, decimals: number): string {
	let b = BigInt(baseUnits);
	// Handle the sign once, up front: bigint / and % both truncate toward zero and keep the operand's
	// sign, so formatting the magnitude and re-attaching "-" avoids garbage like "-1.-5" or a dropped sign.
	const sign = b < 0n ? "-" : "";
	if (b < 0n) b = -b;
	const divisor = 10n ** BigInt(decimals);
	const whole = b / divisor;
	const frac = b % divisor;
	if (frac === 0n) return `${sign}${whole}`;
	const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${sign}${whole}.${fracStr}`;
}
