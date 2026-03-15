import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type TurretPriorityConfig,
	generateTurretPrioritySource,
	generateTurretPriorityManifest,
	generateOrgTurretConfig,
	queryOrganization,
	SHIP_CLASSES,
	TURRET_TYPES,
} from "@tehfrontier/chain-shared";
import { getSuiClient } from "./sponsor";

// ── hp_ratio fix ────────────────────────────────────────────────────────────

/**
 * Patch generated Move source to comment out the hp_ratio check.
 * world-contracts v0.0.18 does not expose hp_ratio() on TargetCandidate.
 */
function applyHpRatioFix(source: string): string {
	return source.replace(
		/if \(candidate\.hp_ratio\(\) < LOW_HP_THRESHOLD && candidate\.hp_ratio\(\) > 0\) \{[\s\S]*?weight = weight \+ LOW_HP_BONUS;[\s\S]*?\};/,
		"// hp_ratio() not available in world-contracts v0.0.18\n        // if (candidate.hp_ratio() < LOW_HP_THRESHOLD && candidate.hp_ratio() > 0) {\n        //     weight = weight + LOW_HP_BONUS;\n        // };",
	);
}

/**
 * Patch character_id type: the generator uses u64 but the chain may return u32.
 * Cast character_id to u64 via (char_id as u64) in lookup comparisons.
 */
function applyCharacterIdFix(source: string): string {
	// The generated source already uses u64 for character ID constants and comparisons.
	// The candidate.character_id() returns u64 on current world-contracts, so no cast needed.
	return source;
}

// ── Build Pipeline ──────────────────────────────────────────────────────────

export interface BuildResult {
	packageId: string;
}

/**
 * Generate, build, and publish a custom turret priority Move package.
 *
 * 1. Generate Move source from config
 * 2. Apply patches (hp_ratio fix)
 * 3. Write to temp directory
 * 4. `sui move build`
 * 5. `sui client publish`
 * 6. Parse output for packageId
 * 7. Clean up temp directory
 */
/**
 * Build a governance-aware turret from an Organization's membership data.
 *
 * 1. Fetch Organization from chain
 * 2. Derive TurretPriorityConfig from org tiers + mode
 * 3. Build & publish via existing pipeline
 */
export async function buildGovernanceTurret(
	orgObjectId: string,
	mode: "public" | "private",
	turretType?: string,
	weightOverrides?: Partial<TurretPriorityConfig>,
): Promise<BuildResult> {
	const client = getSuiClient();
	const orgData = await queryOrganization(client, orgObjectId);

	const config = generateOrgTurretConfig(orgData, mode, weightOverrides);

	// Auto-fill effective classes from turret type if specified
	if (turretType) {
		const ttInfo = Object.values(TURRET_TYPES).find(
			(tt) => tt.typeId === Number(turretType) || tt.label.toLowerCase().includes(turretType.toLowerCase()),
		);
		if (ttInfo) {
			config.effectiveClasses = ttInfo.effective
				.map((key) => SHIP_CLASSES[key]?.groupId)
				.filter((id) => id != null);
		}
	}

	return buildAndPublishTurret(config);
}

export async function buildAndPublishTurret(config: TurretPriorityConfig): Promise<BuildResult> {
	const moduleName = config.moduleName ?? "turret_priority";
	const tmpDir = mkdtempSync(join(tmpdir(), "turret-build-"));

	try {
		// Generate source
		let source = generateTurretPrioritySource(config);
		source = applyHpRatioFix(source);
		source = applyCharacterIdFix(source);

		const manifest = generateTurretPriorityManifest(moduleName);

		// Write files
		const sourcesDir = join(tmpDir, "sources");
		mkdirSync(sourcesDir, { recursive: true });
		writeFileSync(join(tmpDir, "Move.toml"), manifest, "utf-8");
		writeFileSync(join(sourcesDir, `${moduleName}.move`), source, "utf-8");

		// Build
		execSync("sui move build", {
			cwd: tmpDir,
			stdio: "pipe",
			timeout: 60_000,
		});

		// Publish
		const publishOutput = execSync(
			"sui client publish --skip-dependency-verification --json",
			{
				cwd: tmpDir,
				stdio: "pipe",
				timeout: 120_000,
				encoding: "utf-8",
			},
		);

		// Parse packageId from publish output
		const parsed = JSON.parse(publishOutput);

		// The publish output contains objectChanges with a "published" entry
		let packageId: string | undefined;

		if (parsed.objectChanges) {
			for (const change of parsed.objectChanges) {
				if (change.type === "published") {
					packageId = change.packageId;
					break;
				}
			}
		}

		// Fallback: check effects.created for package type
		if (!packageId && parsed.effects?.created) {
			for (const created of parsed.effects.created) {
				if (created.owner === "Immutable") {
					packageId = created.reference?.objectId ?? created.objectId;
					break;
				}
			}
		}

		if (!packageId) {
			throw new Error("Could not extract packageId from publish output");
		}

		return { packageId };
	} finally {
		// Clean up temp directory
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup
		}
	}
}
