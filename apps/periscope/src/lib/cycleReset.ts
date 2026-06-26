import { TENANTS, type TenantId } from "@/chain/config";
import { db } from "@/db";
import { CHAIN_ENABLED } from "@/featureFlags";
import { useAppStore } from "@/stores/appStore";
import { getBackupHandle, writeBackupFile } from "./autoBackup";
import { CYCLE_BOUND_TABLES } from "./constants";
import { downloadJson, serializeTables } from "./dataExport";

/**
 * Interim cycle sentinel. While chain is OFF there is no on-chain signal, so the stamp is
 * `interim:<CYCLE_VERSION>`. Bumping this only forces a reset when chain is live -- normally the
 * Settings "Reset for new cycle" button drives interim resets.
 */
export const CYCLE_VERSION = "cycle6-interim";

/** `cacheMetadata` key holding the cycle-reset stamp. */
export const CYCLE_DATA_KEY = "cycleData";

async function getActiveTenant(): Promise<TenantId> {
	const setting = await db.settings.get("tenant");
	return (setting?.value as TenantId) ?? "stillness";
}

/**
 * The cycle identity the local data belongs to: the active tenant's `worldPackageId` when chain is
 * live (changes once per cycle on a fresh world publish), else the interim sentinel.
 */
export async function getCurrentCycleStamp(): Promise<string> {
	if (CHAIN_ENABLED) {
		return TENANTS[await getActiveTenant()].worldPackageId;
	}
	return `interim:${CYCLE_VERSION}`;
}

/**
 * Archive the cycle-bound tables to a JSON file -- written to the configured backup directory if
 * one is set, otherwise downloaded. Recoverable via the existing Import Backup path. Returns
 * whether the archive was actually written.
 */
export async function archiveCycle(stamp: string): Promise<boolean> {
	const data = {
		version: 1 as const,
		exportedAt: new Date().toISOString(),
		kind: "cycle-archive" as const,
		cycleId: stamp,
		tables: await serializeTables(CYCLE_BOUND_TABLES),
	};

	// Slugify the stamp so sentinels (e.g. "interim:cycle6-interim") and 0x ids yield a legal
	// filename for both the download and the File System Access getFileHandle() path.
	const slug = stamp.replace(/[^a-z0-9]/gi, "-").slice(0, 16);
	const fileName = `periscope-cycle-${slug}-${new Date().toISOString().slice(0, 10)}.json`;

	const handle = await getBackupHandle();
	if (handle) {
		return writeBackupFile(data, fileName);
	}
	downloadJson(data, fileName);
	return true;
}

/**
 * Clear every cycle-bound table, then re-seed the sonar cursor rows and reset character/map
 * selection. The name list is filtered against the live schema so an absent/dropped name is a safe
 * no-op (never throws and partial-clears the DB).
 */
export async function clearCycleData(): Promise<void> {
	const live = new Set(db.tables.map((t) => t.name));
	await Promise.all(
		CYCLE_BOUND_TABLES.filter((t) => live.has(t)).map((t) => db.table(t).clear()),
	);

	// sonarState is NOT a cycle-bound table; overwrite its two cursor rows back to a clean state
	// (mirrors the db/index.ts on("ready") seed, which only fires on a fresh open).
	await db.sonarState.bulkPut([
		{ channel: "local", enabled: true, status: "off" },
		{ channel: "chain", enabled: true, status: "off" },
	]);

	// The active character / default map now point at deleted ids.
	await db.settings.bulkDelete(["activeCharacterId", "defaultMapId"]);
	useAppStore.getState().resetCycleState();
}

/**
 * Full operational reset: (optionally) archive -> clear -> stamp the new cycle. Aborts before
 * clearing if an archive was requested and failed, so we never clear without a recoverable copy.
 * The new stamp is written only after a successful clear.
 */
export async function resetForNewCycle(opts: { archive: boolean }): Promise<void> {
	const stamp = await getCurrentCycleStamp();
	const tenant = await getActiveTenant();

	if (opts.archive) {
		const ok = await archiveCycle(stamp);
		if (!ok) {
			throw new Error("Cycle archive failed; aborting reset to avoid data loss.");
		}
	}

	await clearCycleData();

	await db.cacheMetadata.put({
		key: CYCLE_DATA_KEY,
		version: stamp,
		tenant,
		importedAt: new Date().toISOString(),
	});
}

/**
 * Init-time hook: adopt the current stamp on first run (never clears), no-op when it matches, and
 * auto archive-then-clear only on a real cycle change -- i.e. CHAIN_ENABLED, the same tenant, and
 * both the stored and current stamps are real `0x` worlds. A tenant switch (which changes
 * `worldPackageId` without being a cycle boundary) and the interim->chain-live hop (owned by Plan
 * 28's V33) are adopted, not cleared.
 */
export async function checkCycleReset(): Promise<"adopted" | "reset" | "noop"> {
	const meta = await db.cacheMetadata.get(CYCLE_DATA_KEY);
	const current = await getCurrentCycleStamp();
	const tenant = await getActiveTenant();

	// First run: adopt the current stamp. The mechanism never clears data it has not stamped.
	if (!meta) {
		await db.cacheMetadata.put({
			key: CYCLE_DATA_KEY,
			version: current,
			tenant,
			importedAt: new Date().toISOString(),
		});
		return "adopted";
	}

	if (meta.version === current) return "noop";

	const sameTenant = meta.tenant === tenant;
	const bothReal = meta.version.startsWith("0x") && current.startsWith("0x");
	if (CHAIN_ENABLED && sameTenant && bothReal) {
		await resetForNewCycle({ archive: true });
		return "reset";
	}

	// Otherwise re-stamp (adopt) without clearing.
	await db.cacheMetadata.put({
		key: CYCLE_DATA_KEY,
		version: current,
		tenant,
		importedAt: new Date().toISOString(),
	});
	return "adopted";
}
