/** World package IDs for Stillness/Utopia (same Sui testnet) */
export const WORLD_PACKAGE_ID =
	"0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c";

/** SSU Market contract package ID */
export const SSU_MARKET_PACKAGE_ID =
	"0xc61ced466cc75112c32d62630b2d2df2eea4353dd92bc99bfb48b8b4144bcc69";

/** Market contract package ID */
export const MARKET_PACKAGE_ID =
	"0x1755eaaebe4335fcf5f467dfaab73ba21047bdfbda1d97425e6a2cb961a055f4";

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
