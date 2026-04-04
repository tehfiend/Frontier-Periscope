import { db } from "@/db";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useMemo } from "react";

/**
 * Resolves market IDs to tenants by joining through the creator's manifest character.
 * Market contracts are shared across tenants (no tenant field), so we resolve via:
 *   ManifestMarket.creator -> ManifestCharacter.suiAddress -> ManifestCharacter.tenant
 *
 * Unresolvable creators (no matching character) default to visible to avoid hiding data.
 */
export function useMarketTenantMap() {
	const markets = useLiveQuery(() => db.manifestMarkets.toArray(), []) ?? [];
	const characters = useLiveQuery(() => db.manifestCharacters.toArray(), []) ?? [];

	// Map suiAddress -> Set<tenant>
	const addressTenantMap = useMemo(() => {
		const map = new Map<string, Set<string>>();
		for (const c of characters) {
			if (!c.suiAddress || !c.tenant) continue;
			let set = map.get(c.suiAddress);
			if (!set) {
				set = new Set<string>();
				map.set(c.suiAddress, set);
			}
			set.add(c.tenant);
		}
		return map;
	}, [characters]);

	// Map marketId -> Set<tenant> (empty set if creator unresolvable)
	const marketTenantMap = useMemo(() => {
		const map = new Map<string, Set<string>>();
		for (const m of markets) {
			const tenants = addressTenantMap.get(m.creator);
			map.set(m.id, tenants ?? new Set<string>());
		}
		return map;
	}, [markets, addressTenantMap]);

	const isOnTenant = useCallback(
		(marketId: string | undefined, tenant: string): boolean => {
			if (!marketId) return true; // currencies without a market -- show unconditionally
			const tenants = marketTenantMap.get(marketId);
			if (!tenants) return true; // market not in manifest cache yet -- show it
			if (tenants.size === 0) return true; // unresolvable creator -- show it
			return tenants.has(tenant);
		},
		[marketTenantMap],
	);

	const isAddressOnTenant = useCallback(
		(address: string | undefined, tenant: string): boolean => {
			if (!address) return true; // no address to resolve -- show it
			const tenants = addressTenantMap.get(address);
			if (!tenants) return true; // unresolvable -- show it
			if (tenants.size === 0) return true; // unresolvable -- show it
			return tenants.has(tenant);
		},
		[addressTenantMap],
	);

	return { marketTenantMap, addressTenantMap, isOnTenant, isAddressOnTenant };
}
