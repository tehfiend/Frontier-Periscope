/**
 * Shared coin/token utility functions used by WalletTab and CoinTransferDialog.
 */

export function formatBalance(raw: string | bigint, decimals: number): string {
	if (decimals < 0 || decimals > 18) return "0";
	const value = typeof raw === "bigint" ? raw : BigInt(raw);
	const divisor = 10n ** BigInt(decimals);
	const whole = value / divisor;
	const frac = value % divisor;
	if (frac === 0n) return whole.toLocaleString("en-US");
	const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

export function extractTokenName(coinType: string): string {
	const parts = coinType.split("::");
	if (parts.length >= 3) return parts[parts.length - 1];
	if (parts.length === 2) return parts[1];
	return coinType;
}

export function isSuiCoin(coinType: string): boolean {
	return /^0x0*2::sui::SUI$/.test(coinType);
}
