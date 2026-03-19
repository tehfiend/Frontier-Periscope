/** World package IDs for Stillness/Utopia (same Sui testnet) */
export const WORLD_PACKAGE_ID =
	"0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c";

/** SSU Market contract package ID */
export const SSU_MARKET_PACKAGE_ID =
	"0xeca760fe766302433fcc4c538d95f1f8960e863e5b789c63011dae18a20723d4";

/** Market contract package ID */
export const MARKET_PACKAGE_ID =
	"0x07d9632d6f4e3288d8ea2330caa40850bfdb63f19aff20dbd66fb16a5cf035a6";

/** World API base URLs per tenant */
export const WORLD_API: Record<string, string> = {
	stillness: "https://world-api-stillness.live.tech.evefrontier.com",
	utopia: "https://world-api-utopia.live.tech.evefrontier.com",
};

/** Read URL params or env vars */
export function getUrlParam(key: string): string | null {
	const params = new URLSearchParams(window.location.search);
	return params.get(key);
}

export function getConfigId(): string {
	return getUrlParam("configId") ?? import.meta.env.VITE_MARKET_CONFIG_ID ?? "";
}

export function getCoinType(): string {
	return getUrlParam("coinType") ?? import.meta.env.VITE_COIN_TYPE ?? "";
}

export function getTenant(): string {
	return getUrlParam("tenant") ?? "stillness";
}

export function getMarketId(): string {
	return getUrlParam("marketId") ?? "";
}

export function getMarketPackageId(): string {
	return getUrlParam("marketPackageId") ?? MARKET_PACKAGE_ID;
}
