import { db } from "@/db";
import { fetchAndStoreGameTypes } from "@/lib/worldApi";
import { useAppStore } from "@/stores/appStore";
import { Loader2, Telescope } from "lucide-react";
import { useEffect, useState } from "react";

interface LoadingStep {
	label: string;
	status: "pending" | "loading" | "done";
	count?: number;
}

export function DataInitializer({ children }: { children: React.ReactNode }) {
	const [ready, setReady] = useState(false);
	const [steps, setSteps] = useState<LoadingStep[]>([]);
	const setStaticDataReady = useAppStore((s) => s.setStaticDataReady);
	const setProfileConfigured = useAppStore((s) => s.setProfileConfigured);

	useEffect(() => {
		initialize();
	}, []);

	async function initialize() {
		const STELLAR_DATA_VERSION = "2.0.0";

		// Check if static data is already loaded and up-to-date
		const meta = await db.cacheMetadata.get("stellarData");
		if (meta && meta.version === STELLAR_DATA_VERSION) {
			setStaticDataReady(true);

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

			setReady(true);
			return;
		}

		// Version mismatch or no data: clear stale data before re-import
		if (meta) {
			await db.solarSystems.clear();
			await db.regions.clear();
			await db.constellations.clear();
			await db.jumps.clear();
			await db.cacheMetadata.delete("stellarData");
		}

		// Load static data with progress tracking
		const loadSteps: LoadingStep[] = [
			{ label: "Solar systems", status: "pending" },
			{ label: "Regions", status: "pending" },
			{ label: "Constellations", status: "pending" },
			{ label: "Jump connections", status: "pending" },
		];
		setSteps([...loadSteps]);

		async function loadStep(
			index: number,
			file: string,
			// biome-ignore lint/suspicious/noExplicitAny: Dexie table type is complex
			table: { bulkPut: (items: any[]) => any },
		) {
			loadSteps[index].status = "loading";
			setSteps([...loadSteps]);

			const data = await fetch(`/data/${file}`).then((r) => r.json());
			await table.bulkPut(data);

			loadSteps[index].status = "done";
			loadSteps[index].count = data.length;
			setSteps([...loadSteps]);
		}

		await loadStep(0, "stellar_systems.json", db.solarSystems);
		await loadStep(1, "stellar_regions.json", db.regions);
		await loadStep(2, "stellar_constellations.json", db.constellations);
		await loadStep(3, "stellar_jumps.json", db.jumps);

		// Save cache metadata
		await db.cacheMetadata.put({
			key: "stellarData",
			version: STELLAR_DATA_VERSION,
			importedAt: new Date().toISOString(),
			counts: {
				solarSystems: loadSteps[0].count ?? 0,
				regions: loadSteps[1].count ?? 0,
				constellations: loadSteps[2].count ?? 0,
				jumps: loadSteps[3].count ?? 0,
			},
		});

		setStaticDataReady(true);
		setReady(true);

		// Fetch game types from World API in background (non-blocking)
		const typesMeta = await db.cacheMetadata.get("gameTypes");
		if (!typesMeta) {
			fetchAndStoreGameTypes().catch((err) =>
				console.warn("[DataInitializer] Failed to fetch game types:", err),
			);
		}
	}

	if (!ready) {
		return (
			<div className="flex h-screen items-center justify-center bg-zinc-950">
				<div className="w-full max-w-md space-y-8 px-6">
					<div className="flex flex-col items-center gap-4">
						<Telescope className="h-12 w-12 text-cyan-500" />
						<h1 className="text-2xl font-bold text-zinc-100">EF Periscope</h1>
						<p className="text-sm text-zinc-400">Loading star map data...</p>
					</div>

					{steps.length > 0 && (
						<div className="space-y-3">
							{steps.map((step) => (
								<div key={step.label} className="flex items-center justify-between text-sm">
									<div className="flex items-center gap-2">
										{step.status === "loading" && (
											<Loader2 className="h-4 w-4 animate-spin text-cyan-500" />
										)}
										{step.status === "done" && (
											<div className="h-4 w-4 rounded-full bg-cyan-500/20 text-center text-xs leading-4 text-cyan-400">
												✓
											</div>
										)}
										{step.status === "pending" && (
											<div className="h-4 w-4 rounded-full bg-zinc-800" />
										)}
										<span className={step.status === "done" ? "text-zinc-300" : "text-zinc-500"}>
											{step.label}
										</span>
									</div>
									{step.count != null && (
										<span className="text-xs text-zinc-600">{step.count.toLocaleString()}</span>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		);
	}

	return <>{children}</>;
}
