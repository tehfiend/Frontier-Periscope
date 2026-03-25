import { TENANTS, type TenantId } from "@/chain/config";
import { discoverCharactersFromEvents, discoverTribes } from "@/chain/manifest";
import { db } from "@/db";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useEffect, useRef } from "react";

/**
 * Initial manifest sync -- runs once on mount in DataInitializer.
 *
 * - Catches up on all characters created while offline (both tenants)
 * - Fetches tribes from World API
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

					// Characters — full catch-up from last cursor
					try {
						const count = await discoverCharactersFromEvents(
							client,
							tenantId,
							worldPkg,
						);
						if (count > 0) {
							console.log(`[manifest-sync] ${tenantId}: ${count} new characters`);
						}
						// Hand cursor to Chain Sonar for ongoing monitoring
						await handoffCursorToSonar(tenantId, worldPkg);
					} catch (err) {
						console.warn(`[manifest-sync] ${tenantId} characters:`, err);
					}

					// Tribes — from World API
					try {
						const count = await discoverTribes(tenantId);
						if (count > 0) {
							console.log(`[manifest-sync] ${tenantId}: ${count} tribes`);
						}
					} catch (err) {
						console.warn(`[manifest-sync] ${tenantId} tribes:`, err);
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
