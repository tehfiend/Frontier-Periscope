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
	const b = BigInt(baseUnits);
	const divisor = 10n ** BigInt(decimals);
	const whole = b / divisor;
	const frac = b % divisor;
	if (frac === 0n) return whole.toString();
	const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${whole}.${fracStr}`;
}
