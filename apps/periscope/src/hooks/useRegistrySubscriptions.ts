/**
 * Registry subscription hooks -- subscribe/unsubscribe to on-chain
 * StandingsRegistry objects and sync their standings to local cache.
 */

import { db } from "@/db";
import type { RegistryStanding, SubscribedRegistry } from "@/db/types";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	type StandingsRegistryInfo,
	queryRegistryDetails,
	queryRegistryStandings,
	standingToDisplay,
} from "@tehfrontier/chain-shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";

/** Returns all subscribed registries, reactively updated. */
export function useSubscribedRegistries(tenant?: string) {
	return (
		useLiveQuery(
			() =>
				tenant
					? db.subscribedRegistries.where("tenant").equals(tenant).toArray()
					: db.subscribedRegistries.toArray(),
			[tenant],
		) ?? []
	);
}

/** Returns a hook to subscribe to a registry. */
export function useSubscribeRegistry() {
	return useCallback(
		async (registry: StandingsRegistryInfo, tenant: string, creatorName?: string) => {
			const sub: SubscribedRegistry = {
				id: registry.objectId,
				name: registry.name,
				ticker: registry.ticker,
				creator: registry.owner,
				creatorName,
				defaultStanding: registry.defaultStanding,
				subscribedAt: new Date().toISOString(),
				tenant,
			};
			await db.subscribedRegistries.put(sub);
			return sub;
		},
		[],
	);
}

/** Returns a hook to unsubscribe from a registry. */
export function useUnsubscribeRegistry() {
	return useCallback(async (registryId: string) => {
		// Delete subscription and all cached standings
		await db.registryStandings.where("registryId").equals(registryId).delete();
		await db.subscribedRegistries.delete(registryId);
	}, []);
}

/** Returns a hook to archive/unarchive a subscribed registry. */
export function useArchiveRegistry() {
	return useCallback(async (registryId: string, archived = true) => {
		await db.subscribedRegistries.update(registryId, { _archived: archived });
	}, []);
}

/**
 * Returns a hook to sync standings from chain for a subscribed registry.
 * Fetches all dynamic fields and caches them locally.
 */
export function useSyncRegistryStandings() {
	return useCallback(async (client: SuiGraphQLClient, registryId: string) => {
		// Refresh registry info
		const details = await queryRegistryDetails(client, registryId);
		if (details) {
			await db.subscribedRegistries.update(registryId, {
				name: details.name,
				ticker: details.ticker,
				defaultStanding: details.defaultStanding,
				lastSyncedAt: new Date().toISOString(),
			});
		}

		// Fetch all standings from chain
		const entries = await queryRegistryStandings(client, registryId);
		const now = new Date().toISOString();

		// Build cached standings
		const cached: RegistryStanding[] = entries.map((entry) => {
			const entityId = entry.kind === "tribe" ? entry.tribeId : entry.characterId;
			return {
				id: `${registryId}:${entry.kind}:${entityId}`,
				registryId,
				kind: entry.kind,
				characterId: entry.characterId,
				tribeId: entry.tribeId,
				standing: entry.standing,
				cachedAt: now,
			};
		});

		// Clear old standings for this registry and replace
		await db.registryStandings.where("registryId").equals(registryId).delete();
		if (cached.length > 0) {
			await db.registryStandings.bulkAdd(cached);
		}
	}, []);
}

/** Returns cached standings for a specific registry, reactively updated. */
export function useRegistryStandings(registryId: string | null) {
	return (
		useLiveQuery(
			() =>
				registryId
					? db.registryStandings.where("registryId").equals(registryId).toArray()
					: ([] as RegistryStanding[]),
			[registryId],
		) ?? []
	);
}

/**
 * Compute a display standing value for a given registry + entity.
 * Checks character standing first, then tribe, then default.
 * Returns display value (-3 to +3).
 */
export function resolveStanding(
	standings: RegistryStanding[],
	defaultStanding: number,
	characterId?: number,
	tribeId?: number,
): number {
	// Character standing has priority
	if (characterId != null) {
		const charStanding = standings.find(
			(s) => s.kind === "character" && s.characterId === characterId,
		);
		if (charStanding) return standingToDisplay(charStanding.standing);
	}

	// Then tribe standing
	if (tribeId != null) {
		const tribeStanding = standings.find((s) => s.kind === "tribe" && s.tribeId === tribeId);
		if (tribeStanding) return standingToDisplay(tribeStanding.standing);
	}

	// Fall back to default
	return standingToDisplay(defaultStanding);
}
