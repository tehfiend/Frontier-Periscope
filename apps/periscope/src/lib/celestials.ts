import { db } from "@/db";
import type { Celestial } from "@/db/types";

// ── Planet Type Constants ───────────────────────────────────────────────────

/** Planet typeID -> human-readable name. All 7 planet types in EVE Frontier. */
export const PLANET_TYPE_NAMES: Record<number, string> = {
	11: "Temperate",
	12: "Ice",
	13: "Gas",
	2014: "Oceanic",
	2015: "Lava",
	2016: "Barren",
	2063: "Plasma",
};

/** All 24,026 inhabited-system suns are this type. */
export const SUN_TYPE_NAME = "Sun K7 (Orange)";
export const SUN_TYPE_ID = 45031;

// ── Celestials Lazy Loader ──────────────────────────────────────────────────

/**
 * Compact JSON format: systemId (string key) -> array of planet tuples.
 * Each tuple: [celestialID, celestialIndex, typeID, x, y, z]
 */
type CelestialsData = Record<string, [number, number, number, number, number, number][]>;

const CELESTIALS_DATA_VERSION = "1.0.0";

/**
 * Ensures celestial data is loaded into the Dexie `celestials` table.
 * On first call, fetches celestials.json and imports ~83K planet records.
 * Subsequent calls return immediately (cached in IndexedDB).
 */
export async function ensureCelestialsLoaded(): Promise<void> {
	const meta = await db.cacheMetadata.get("celestialsData");
	if (meta && meta.version === CELESTIALS_DATA_VERSION) return;

	// Version mismatch or no data: clear + re-import
	if (meta) {
		await db.celestials.clear();
		await db.cacheMetadata.delete("celestialsData");
	}

	const resp = await fetch("/data/celestials.json");
	if (!resp.ok) {
		console.warn("[celestials] Failed to fetch celestials.json:", resp.status);
		return;
	}

	const data: CelestialsData = await resp.json();
	const records: Celestial[] = [];

	for (const [systemIdStr, planets] of Object.entries(data)) {
		const systemId = Number(systemIdStr);
		for (const [celestialId, index, typeId, x, y, z] of planets) {
			records.push({ id: celestialId, systemId, index, typeId, x, y, z });
		}
	}

	await db.celestials.bulkPut(records);
	await db.cacheMetadata.put({
		key: "celestialsData",
		version: CELESTIALS_DATA_VERSION,
		importedAt: new Date().toISOString(),
		counts: { celestials: records.length },
	});
}
