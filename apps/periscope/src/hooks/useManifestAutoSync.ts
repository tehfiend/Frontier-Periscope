import { TENANTS, type TenantId } from "@/chain/config";
import {
	discoverCharactersFromEvents,
	discoverMarkets,
	discoverRegistries,
	discoverTribes,
	mergePrivateMapLocationsIntoManifest,
	syncMapLocations,
	syncMapLocationsV2,
	syncPrivateMapIndex,
} from "@/chain/manifest";
import { db } from "@/db";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useEffect, useRef } from "react";

/**
 * Initial manifest sync -- runs once on mount in DataInitializer.
 *
 * - Catches up on all characters created while offline (both tenants)
 * - Fetches tribes from World API
 * - Discovers all Market<T> and StandingsRegistry objects (global, once)
 * - Builds private map index and merges locations (per-tenant)
 * - Hands off cursors to sonarState so Chain Sonar picks up ongoing monitoring
 *
 * Ongoing real-time monitoring is handled by Chain Sonar (useChainSonar),
 * which polls CharacterCreatedEvent every 15s for the active tenant.
 */
export function useManifestAutoSync() {
	const client = useSuiClient();
	const ran = useRef(false);

	useEffect(() => {
		if (ran.current) return;
		ran.current = true;

		(async () => {
			try {
				for (const tenantId of Object.keys(TENANTS) as TenantId[]) {
					const worldPkg = TENANTS[tenantId].worldPackageId;

					// Characters -- full catch-up from last cursor
					try {
						const count = await discoverCharactersFromEvents(client, tenantId, worldPkg);
						if (count > 0) {
							console.log(`[manifest-sync] ${tenantId}: ${count} new characters`);
						}
						// Hand cursor to Chain Sonar for ongoing monitoring
						await handoffCursorToSonar(tenantId, worldPkg);
					} catch (err) {
						console.warn(`[manifest-sync] ${tenantId} characters:`, err);
					}

					// Tribes -- from World API
					try {
						const count = await discoverTribes(tenantId);
						if (count > 0) {
							console.log(`[manifest-sync] ${tenantId}: ${count} tribes`);
						}
					} catch (err) {
						console.warn(`[manifest-sync] ${tenantId} tribes:`, err);
					}
				}

				// Markets -- global (shared packageId across tenants), run once
				try {
					const count = await discoverMarkets(client);
					if (count > 0) {
						console.log(`[manifest-sync] ${count} markets cached`);
					}
				} catch (err) {
					console.warn("[manifest-sync] markets:", err);
				}

				// Registries -- global (shared packageId across tenants), run once
				try {
					const count = await discoverRegistries(client);
					if (count > 0) {
						console.log(`[manifest-sync] ${count} registries cached`);
					}
				} catch (err) {
					console.warn("[manifest-sync] registries:", err);
				}

				// Private map index + location sync + merge -- per-tenant
				for (const tenantId of Object.keys(TENANTS) as TenantId[]) {
					try {
						const count = await syncPrivateMapIndex(client, tenantId);
						if (count > 0) {
							console.log(`[manifest-sync] ${tenantId}: ${count} maps indexed`);
						}
					} catch (err) {
						console.warn(`[manifest-sync] ${tenantId} map index:`, err);
					}

					// Sync location records for all indexed maps
					// Records are stored even without decryption keys (encrypted data preserved)
					try {
						const indexedMaps = await db.manifestPrivateMapIndex
							.where("tenant")
							.equals(tenantId)
							.toArray();
						for (const map of indexedMaps) {
							if (map.version === 2) {
								const cached = await db.manifestPrivateMapsV2.get(map.id);
								const locCount = await syncMapLocationsV2(
									client, map.id, map.mode,
									cached?.decryptedMapKey, cached?.publicKey, tenantId,
								);
								if (locCount > 0) {
									console.log(`[manifest-sync] ${tenantId}: ${locCount} locs from ${map.name}`);
								}
							} else if (map.version === 1) {
								const cached = await db.manifestPrivateMaps.get(map.id);
								const locCount = await syncMapLocations(
									client, map.id, cached?.decryptedMapKey, tenantId,
								);
								if (locCount > 0) {
									console.log(`[manifest-sync] ${tenantId}: ${locCount} locs from ${map.name}`);
								}
							}
						}
					} catch (err) {
						console.warn(`[manifest-sync] ${tenantId} map locations:`, err);
					}

					try {
						const count = await mergePrivateMapLocationsIntoManifest(tenantId);
						if (count > 0) {
							console.log(
								`[manifest-sync] ${tenantId}: ${count} locations merged from private maps`,
							);
						}
					} catch (err) {
						console.warn(`[manifest-sync] ${tenantId} location merge:`, err);
					}
				}
			} catch (err) {
				console.warn("[manifest-sync] Failed:", err);
			}
		})();
	}, [client]);
}

/**
 * Copy the manifest character cursor to sonarState so Chain Sonar
 * continues polling from where the initial sync left off.
 */
async function handoffCursorToSonar(tenantId: TenantId, worldPkg: string) {
	const saved = await db.settings.get(`manifestCharCursor:${worldPkg}`);
	if (!saved?.value || typeof saved.value !== "string") return;

	const state = await db.sonarState.get("chain");
	if (!state) return;

	const cursors = { ...(state.cursors ?? {}) } as Record<string, string>;
	cursors[`CharacterCreated:${tenantId}`] = saved.value;
	await db.sonarState.update("chain", { cursors });
}
