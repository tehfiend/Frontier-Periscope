import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { discoverCharacterAndAssemblies } from "@/chain/queries";
import type { TenantId } from "@/chain/config";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { useActiveCharacter } from "./useActiveCharacter";

export function useActiveTenant(): TenantId {
	const tenantSetting = useLiveQuery(() => db.settings.get("tenant"));
	return (tenantSetting?.value as TenantId) ?? "stillness";
}

/**
 * Discover assemblies using the active character's Sui address.
 * Falls back to the connected wallet address if no character address is linked.
 * When a wallet is connected and the active character lacks an address, auto-links it.
 */
export function useOwnedAssemblies() {
	const account = useCurrentAccount();
	const client = useCurrentClient();
	const globalTenant = useActiveTenant();
	const { activeCharacter, activeSuiAddresses } = useActiveCharacter();

	// Use the character's tenant if set, otherwise fall back to global
	const tenant = (activeCharacter?.tenant as TenantId) ?? globalTenant;

	// Prefer character address, fall back to wallet
	const characterAddress = activeCharacter?.suiAddress ?? activeSuiAddresses[0] ?? null;
	const address = characterAddress ?? account?.address ?? null;

	// Auto-link wallet address to active character if it doesn't have one
	useEffect(() => {
		if (account?.address && activeCharacter && !activeCharacter.suiAddress) {
			db.characters.update(activeCharacter.id, {
				suiAddress: account.address,
				tenant,
				updatedAt: new Date().toISOString(),
			});
		}
	}, [account?.address, activeCharacter?.id, activeCharacter?.suiAddress, tenant]);

	return useQuery({
		queryKey: ["ownedAssemblies", address, tenant],
		queryFn: () => {
			if (!address) throw new Error("No Sui address available");
			return discoverCharacterAndAssemblies(client, address, tenant);
		},
		enabled: !!address,
		staleTime: 60_000,
		refetchInterval: 120_000,
	});
}
