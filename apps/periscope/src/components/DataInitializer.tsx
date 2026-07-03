import { db } from "@/db";
import { useManifestAutoSync } from "@/hooks/useManifestAutoSync";
import { usePrivateMapAutoDecrypt } from "@/hooks/usePrivateMapAutoDecrypt";
import { checkCycleReset } from "@/lib/cycleReset";
import { loadLandscapeData } from "@/lib/landscapeData";
import { GAME_TYPES_VERSION, fetchAndStoreGameTypes } from "@/lib/worldApi";
import { useAppStore } from "@/stores/appStore";
import { Loader2, Telescope } from "lucide-react";
import { useEffect, useState } from "react";

// 3.3.0: solar-system names now read from the inline display-name string in systems.static (the real
// in-game name, e.g. "O3S-11J"). Earlier passes shipped numeric codes then wrong localization-label
// names under 3.2.0, so bump again to force a clean re-import of the corrected names for anyone who
// cached an intermediate build. Feeds the location search + recent-systems picker.
const STELLAR_DATA_VERSION = "3.3.0";

export function DataInitializer({ children }: { children: React.ReactNode }) {
	const [ready, setReady] = useState(false);
	const setStaticDataReady = useAppStore((s) => s.setStaticDataReady);
	const setProfileConfigured = useAppStore((s) => s.setProfileConfigured);

	// Auto-sync manifest characters for all tenants (background, non-blocking). Gated on `ready` so
	// it never writes cycle-bound tables before the cycle-reset check (which may clear them) resolves.
	useManifestAutoSync(ready);

	// Auto-decrypt private map locations when wallet connects. Gated on `ready` for the same reason --
	// the cycle-reset check must complete before any cycle-bound table is touched.
	usePrivateMapAutoDecrypt(ready);

	useEffect(() => {
		initialize();
	}, []);

	async function initialize() {
		// These checks are cheap and independent of the large star-map dataset, so resolve them
		// first and unblock the UI immediately. The star-map import then runs in the background
		// (see loadStellarData) -- every consumer reads it via reactive useLiveQuery and populates
		// as it arrives, so the app no longer waits on a 24k-system import to render.

		// Check if profile is configured (any character exists, or legacy suiAddress)
		const charCount = await db.characters.count();
		if (charCount > 0) {
			setProfileConfigured(true);
		} else {
			// Fallback: check legacy suiAddress setting (pre-migration)
			const profile = await db.settings.get("suiAddress");
			if (profile?.value) {
				setProfileConfigured(true);
			}
		}

		// Restore active character selection
		const activeCharSetting = await db.settings.get("activeCharacterId");
		if (activeCharSetting?.value) {
			useAppStore.getState().setActiveCharacterId(activeCharSetting.value as string);
		}

		// Detect a cycle boundary and (when chain-live) archive + clear stale cycle data before the
		// UI mounts, so it renders against post-reset data. Never blocks app load.
		try {
			await checkCycleReset();
		} catch (err) {
			console.warn("[DataInitializer] Cycle reset check failed:", err);
		}

		// Render the app now -- do NOT block on the star-map dataset.
		setReady(true);

		// Background: ensure the star-map dataset is present/current. Deferred off the startup
		// critical path; see docs/plans/deferred/34-starmap-data-refresh.md.
		void loadStellarData();
		void loadLandscapeData();

		// Background: import game types from local client data (non-blocking). No longer gated on
		// CHAIN_ENABLED -- names come from static /data files, not the World API, so they must load
		// even in chain-disabled builds.
		const typesMeta = await db.cacheMetadata.get("gameTypes");
		// Re-import when missing OR when the stored version differs (forces a refresh after a bump).
		if (!typesMeta || typesMeta.version !== GAME_TYPES_VERSION) {
			fetchAndStoreGameTypes().catch((err) =>
				console.warn("[DataInitializer] Failed to import game types:", err),
			);
		}
	}

	// Import the star-map dataset into IndexedDB in the background. Consumers (Jump Planner,
	// Command Palette, Manifest, Killmails, etc.) read these tables reactively, so they fill in
	// once this completes. A slow/failed load can never block or break the rest of the app.
	async function loadStellarData() {
		try {
			const meta = await db.cacheMetadata.get("stellarData");
			if (meta && meta.version === STELLAR_DATA_VERSION) {
				setStaticDataReady(true);
				return;
			}

			// Version mismatch or no data: clear stale rows before re-import
			if (meta) {
				await db.solarSystems.clear();
				await db.regions.clear();
				await db.constellations.clear();
				await db.jumps.clear();
				await db.cacheMetadata.delete("stellarData");
			}

			const load = async (
				file: string,
				// biome-ignore lint/suspicious/noExplicitAny: Dexie table type is complex
				table: { bulkPut: (items: any[]) => any },
			) => {
				const data = await fetch(`/data/${file}`).then((r) => {
					if (!r.ok) throw new Error(`Failed to load ${file}: ${r.status}`);
					return r.json();
				});
				await table.bulkPut(data);
				return data.length as number;
			};

			const solarSystems = await load("stellar_systems.json", db.solarSystems);
			const regions = await load("stellar_regions.json", db.regions);
			const constellations = await load("stellar_constellations.json", db.constellations);
			const jumps = await load("stellar_jumps.json", db.jumps);

			await db.cacheMetadata.put({
				key: "stellarData",
				version: STELLAR_DATA_VERSION,
				importedAt: new Date().toISOString(),
				counts: { solarSystems, regions, constellations, jumps },
			});

			setStaticDataReady(true);
		} catch (err) {
			// Star map is a deferred feature -- a failed/slow load must never break the rest of the app.
			console.warn("[DataInitializer] Star-map data load failed (deferred):", err);
		}
	}

	if (!ready) {
		return (
			<div className="flex h-screen items-center justify-center bg-zinc-950">
				<div className="flex flex-col items-center gap-4">
					<Telescope className="h-12 w-12 text-cyan-500" />
					<h1 className="text-2xl font-bold text-zinc-100">Frontier Periscope</h1>
					<div className="flex items-center gap-2 text-sm text-zinc-400">
						<Loader2 className="h-4 w-4 animate-spin text-cyan-500" />
						Starting up...
					</div>
				</div>
			</div>
		);
	}

	return <>{children}</>;
}
