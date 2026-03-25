/**
 * Turret Standings -- Generates turret priority Move source from a
 * StandingsRegistry, mapping standing levels to friend/foe lists.
 *
 * Extends turret-priority.ts by deriving the friendlyTribes/Characters and
 * kosTribes/Characters arrays from registry entries + threshold config.
 * Config is baked into module constants at compile time (same as turret-priority).
 * No shared config object needed on-chain -- turret config is baked at publish time.
 */

import type { RegistryStandingEntry, StandingsRegistryInfo, TurretStandingsConfig } from "./types";
import {
	DEFAULT_TURRET_PRIORITY_CONFIG,
	generateTurretPriorityManifest,
	generateTurretPrioritySource,
	type TurretPriorityConfig,
} from "./turret-priority";

// ── Default Config ──────────────────────────────────────────────────────────

export const DEFAULT_TURRET_STANDINGS_CONFIG: Omit<
	TurretStandingsConfig,
	"registryId"
> = {
	...DEFAULT_TURRET_PRIORITY_CONFIG,
	standingThresholds: {
		/** Friendly (ally) or above -> never shoot (raw standing >= 5, display >= +2) */
		friendlyThreshold: 5,
		/** Hostile or below -> KOS (raw standing <= 1, display <= -2) */
		kosThreshold: 1,
	},
};

// ── Generator ───────────────────────────────────────────────────────────────

/**
 * Generate turret priority Move source from a StandingsRegistry and its entries.
 *
 * Maps standing levels to friend/foe lists based on thresholds:
 *   - standing >= friendlyThreshold -> added to friendly list
 *   - standing <= kosThreshold -> added to KOS list
 *   - between thresholds -> neutral (default weight)
 *
 * Reuses generateTurretPrioritySource() internally after building the
 * friend/foe arrays from registry data.
 */
export function generateTurretFromRegistry(
	config: TurretStandingsConfig,
	_registry: StandingsRegistryInfo,
	entries: RegistryStandingEntry[],
): { source: string; manifest: string; priorityConfig: TurretPriorityConfig } {
	const friendlyTribes: number[] = [];
	const friendlyCharacters: number[] = [];
	const kosTribes: number[] = [];
	const kosCharacters: number[] = [];

	const { friendlyThreshold, kosThreshold } = config.standingThresholds;

	for (const entry of entries) {
		if (entry.standing >= friendlyThreshold) {
			if (entry.kind === "tribe" && entry.tribeId) {
				friendlyTribes.push(entry.tribeId);
			} else if (entry.kind === "character" && entry.characterId) {
				friendlyCharacters.push(entry.characterId);
			}
		} else if (entry.standing <= kosThreshold) {
			if (entry.kind === "tribe" && entry.tribeId) {
				kosTribes.push(entry.tribeId);
			} else if (entry.kind === "character" && entry.characterId) {
				kosCharacters.push(entry.characterId);
			}
		}
		// Entries between thresholds are neutral -- handled by defaultWeight
	}

	const priorityConfig: TurretPriorityConfig = {
		moduleName: config.moduleName,
		defaultWeight: config.defaultWeight,
		kosWeight: config.kosWeight,
		aggressorBonus: config.aggressorBonus,
		betrayalBonus: config.betrayalBonus,
		lowHpBonus: config.lowHpBonus,
		lowHpThreshold: config.lowHpThreshold,
		classBonus: config.classBonus,
		effectiveClasses: config.effectiveClasses,
		friendlyTribes,
		friendlyCharacters,
		kosTribes,
		kosCharacters,
	};

	const source = generateTurretPrioritySource(priorityConfig);
	const manifest = generateTurretPriorityManifest(config.moduleName);

	return { source, manifest, priorityConfig };
}
