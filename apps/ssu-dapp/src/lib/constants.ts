import { type TenantId, getContractAddresses } from "@tehfrontier/chain-shared";

/** World package IDs per tenant (Sui testnet) */
export const WORLD_PACKAGE_IDS: Record<string, string> = {
	stillness: "0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c",
	utopia: "0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75",
};

/** ObjectRegistry singleton addresses per tenant */
export const OBJECT_REGISTRY_ADDRESSES: Record<string, string> = {
	stillness: "0x454a9aa3d37e1d08d3c9181239c1b683781e4087fbbbd48c935d54b6736fd05c",
	utopia: "0xc2b969a72046c47e24991d69472afb2216af9e91caf802684514f39706d7dc57",
};

/** World API base URLs per tenant */
export const WORLD_API: Record<string, string> = {
	stillness: "https://world-api-stillness.live.tech.evefrontier.com",
	utopia: "https://world-api-utopia.uat.pub.evefrontier.com",
};

/** Read a URL query parameter */
export function getUrlParam(key: string): string | null {
	const params = new URLSearchParams(window.location.search);
	return params.get(key);
}

/** Get the tenant from URL params, defaulting to "stillness" */
export function getTenant(): string {
	return getUrlParam("tenant") ?? "stillness";
}

/** Get the in-game itemId from URL params */
export function getItemId(): string | null {
	return getUrlParam("itemId");
}

/** Get the world package ID for the current tenant */
export function getWorldPackageId(tenant?: string): string {
	const t = tenant ?? getTenant();
	return WORLD_PACKAGE_IDS[t] ?? WORLD_PACKAGE_IDS.stillness;
}

/** Get the ObjectRegistry address for the current tenant */
export function getRegistryAddress(tenant?: string): string {
	const t = tenant ?? getTenant();
	return OBJECT_REGISTRY_ADDRESSES[t] ?? OBJECT_REGISTRY_ADDRESSES.stillness;
}

/** Get the ssu_market package ID for the current tenant (latest version, for moveCall targets) */
export function getSsuMarketPackageId(tenant?: string): string | null {
	const t = (tenant ?? getTenant()) as TenantId;
	return getContractAddresses(t).ssuMarket?.packageId ?? null;
}

/** Get the ssu_market original package ID for the current tenant (for type filtering in GraphQL) */
export function getSsuMarketOriginalPackageId(tenant?: string): string | null {
	const t = (tenant ?? getTenant()) as TenantId;
	const m = getContractAddresses(t).ssuMarket;
	return m?.originalPackageId ?? m?.packageId ?? null;
}

/** Get previous ssu_market original package IDs (for discovering SsuConfigs created before republish) */
export function getSsuMarketPreviousPackageIds(tenant?: string): string[] {
	const t = (tenant ?? getTenant()) as TenantId;
	return getContractAddresses(t).ssuMarket?.previousOriginalPackageIds ?? [];
}

/** Get the market package ID for the current tenant (for Market<T> queries) */
export function getMarketPackageId(tenant?: string): string | null {
	const t = (tenant ?? getTenant()) as TenantId;
	return getContractAddresses(t).market?.packageId || null;
}

/**
 * Get the SSU object ID. Priority:
 * 1. Derived from itemId + tenant (handled externally via deriveObjectId)
 * 2. VITE_OBJECT_ID env var fallback
 */
export function getFallbackObjectId(): string | null {
	return (import.meta.env.VITE_OBJECT_ID as string) ?? null;
}
