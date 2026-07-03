/**
 * Per-system warpable extras that aren't in the planet-only `celestials` table: moon counts (by
 * planet index) and stargate type names. Labels only, no coordinates -- enough to populate the
 * closest-warpable selector without bloating the celestial position data. Extracted from the game
 * client's mapObjects.db (groups 8 = moons, 10 = stargates).
 */
export interface SystemWarpables {
	/** Moon count keyed by planet index (a planet may have several moons). */
	m?: Record<string, number>;
	/** Stargate type names present in the system (e.g. "O-Type", "R-Type"). */
	g?: string[];
}

type WarpablesData = Record<string, SystemWarpables>;

let cache: WarpablesData | null = null;
let loadPromise: Promise<WarpablesData> | null = null;

/** Fetch + cache the whole dataset (small, ~700KB). Returns {} on failure. */
export async function loadSystemWarpables(): Promise<WarpablesData> {
	if (cache) return cache;
	if (loadPromise) return loadPromise;
	loadPromise = fetch("/data/system_warpables.json")
		.then((r) => (r.ok ? (r.json() as Promise<WarpablesData>) : {}))
		.then((d) => {
			cache = d;
			return d;
		})
		.catch(() => {
			loadPromise = null;
			return {};
		});
	return loadPromise;
}
