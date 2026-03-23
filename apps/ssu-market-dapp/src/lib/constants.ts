import { type TenantId, getContractAddresses } from "@tehfrontier/chain-shared";

/** SSU Market contract package ID (Stillness fallback) */
export const SSU_MARKET_PACKAGE_ID =
	"0x3339a266b12a7829dc873813608151caff50c46466e13fab020acd6dfe2397a2";

/** Market contract package ID (Stillness fallback) */
export const MARKET_PACKAGE_ID =
	"0xf9c4151434bc6158c21b7ba7d2860c8ce168dcd8ed39815a4c4c71108a5a311a";

/** World API base URLs per tenant */
export const WORLD_API: Record<string, string> = {
	stillness: "https://world-api-stillness.live.tech.evefrontier.com",
	utopia: "https://world-api-utopia.uat.pub.evefrontier.com",
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

/** Get the market package ID for the current tenant. URL param overrides chain-shared config. */
export function getMarketPackageId(tenant?: string): string {
	const urlOverride = getUrlParam("marketPackageId");
	if (urlOverride) return urlOverride;
	const t = (tenant ?? getTenant()) as TenantId;
	return getContractAddresses(t).market?.packageId ?? MARKET_PACKAGE_ID;
}

/** Get the ssu_market package ID for the current tenant (latest version, for moveCall targets) */
export function getSsuMarketPackageId(tenant?: string): string {
	const t = (tenant ?? getTenant()) as TenantId;
	return getContractAddresses(t).ssuMarket?.packageId ?? SSU_MARKET_PACKAGE_ID;
}
