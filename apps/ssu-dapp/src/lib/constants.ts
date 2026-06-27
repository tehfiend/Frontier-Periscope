import { type TenantId, getContractAddresses } from "@tehfrontier/chain-shared";

/** World original package IDs per tenant -- for type strings in GraphQL queries */
export const WORLD_PACKAGE_IDS: Record<string, string> = {
	stillness: "0x8b8a46ed766fa1358ce7c5c51f6a164b13d627a63e45343f69ed0ba0446c1aa1",
	utopia: "0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75",
};

/** World published-at addresses per tenant -- for moveCall targets (only needed when upgraded) */
const WORLD_PUBLISHED_AT: Record<string, string> = {
	stillness: "0x8b8a46ed766fa1358ce7c5c51f6a164b13d627a63e45343f69ed0ba0446c1aa1",
	utopia: "0x07e6b810c2dff6df56ea7fbad9ff32f4d84cbee53e496267515887b712924bd1",
};

/** ObjectRegistry singleton addresses per tenant */
export const OBJECT_REGISTRY_ADDRESSES: Record<string, string> = {
	stillness: "0xf6aed9361acc0d7021672b653ebe9dae45d88e11fecef01cc5434c8f60ae764f",
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

/** Get the world original package ID for the current tenant (for type strings) */
export function getWorldPackageId(tenant?: string): string {
	const t = tenant ?? getTenant();
	return WORLD_PACKAGE_IDS[t] ?? WORLD_PACKAGE_IDS.stillness;
}

/** Get the world published-at address for the current tenant (for moveCall targets) */
export function getWorldPublishedAt(tenant?: string): string {
	const t = tenant ?? getTenant();
	return WORLD_PUBLISHED_AT[t] ?? getWorldPackageId(t);
}

/** Get the ObjectRegistry address for the current tenant */
export function getRegistryAddress(tenant?: string): string {
	const t = tenant ?? getTenant();
	return OBJECT_REGISTRY_ADDRESSES[t] ?? OBJECT_REGISTRY_ADDRESSES.stillness;
}

/** Get the ssu_unified package ID for the current tenant */
export function getSsuUnifiedPackageId(tenant?: string): string | null {
	const t = (tenant ?? getTenant()) as TenantId;
	return getContractAddresses(t).ssuUnified?.packageId ?? null;
}

/** Get the market package ID for the current tenant (for Market<T> queries) */
export function getMarketPackageId(tenant?: string): string | null {
	const t = (tenant ?? getTenant()) as TenantId;
	return getContractAddresses(t).market?.packageId ?? null;
}

/**
 * Get the SSU object ID. Priority:
 * 1. Derived from itemId + tenant (handled externally via deriveObjectId)
 * 2. VITE_OBJECT_ID env var fallback
 */
export function getFallbackObjectId(): string | null {
	return (import.meta.env.VITE_OBJECT_ID as string) ?? null;
}
