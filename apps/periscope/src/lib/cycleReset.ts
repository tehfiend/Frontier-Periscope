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
 * Per-tenant `cacheMetadata` key for the cycle-reset stamp. Scoping the stamp by tenant means a
 * stillness cycle boundary is never missed because the single stored stamp happened to be utopia's
 * (and vice versa) -- each tenant tracks its own last-seen cycle independently.
 */
export function cycleDataKey(tenant: TenantId): string {
	return `${CYCLE_DATA_KEY}:${tenant}`;
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

/** Outcome of an {@link archiveCycle} attempt. */
export interface ArchiveResult {
	/** The attempt did not error -- a backup-dir write succeeded, or a download was triggered. */
	ok: boolean;
	/**
	 * The archive was VERIFIABLY persisted to disk (a backup-dir write whose completion we awaited).
	 * A browser download cannot be confirmed (it may be silently blocked outside a user gesture), so
	 * the download fallback is `ok` but never `verified`.
	 */
	verified: boolean;
}

/**
 * Archive the cycle-bound tables to a JSON file -- written to the configured backup directory if
 * one is set, otherwise downloaded. Recoverable via the existing Import Backup path. Returns both
 * whether the attempt succeeded (`ok`) and whether the copy was VERIFIABLY persisted (`verified`);
 * only the backup-dir write is verifiable, the download fallback is best-effort.
 */
export async function archiveCycle(stamp: string): Promise<ArchiveResult> {
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
		const ok = await writeBackupFile(data, fileName);
		return { ok, verified: ok };
	}
	downloadJson(data, fileName);
	return { ok: true, verified: false };
}

/**
 * Clear every cycle-bound table, then re-seed the sonar cursor rows and reset character/map
 * selection. The name list is filtered against the live schema so an absent/dropped name is a safe
 * no-op (never throws and partial-clears the DB).
 */
export async function clearCycleData(): Promise<void> {
	const live = new Set(db.tables.map((t) => t.name));
	const clearable = CYCLE_BOUND_TABLES.filter((t) => live.has(t));

	// Atomic: the table clears + sonar cursor reseed + settings cleanup run in ONE rw transaction so
	// a mid-sequence failure rolls the whole set back rather than leaving a partially-cleared DB.
	// sonarState and settings join the scope (cursor reseed + stale pointer deletes). The zustand
	// resetCycleState() below is in-memory only and stays outside the DB transaction.
	await db.transaction("rw", [...clearable, "sonarState", "settings"], async () => {
		await Promise.all(clearable.map((t) => db.table(t).clear()));

		// sonarState is NOT a cycle-bound table; reset only the transient `status` back to "off" while
		// PRESERVING the user's per-channel `enabled` preference -- channel on/off is a user setting,
		// not cycle data, and should survive a reset. Fall back to enabled:true if a row is absent.
		const priorSonar = await db.sonarState.toArray();
		const wasEnabled = (channel: string) =>
			priorSonar.find((s) => s.channel === channel)?.enabled ?? true;
		await db.sonarState.bulkPut([
			{ channel: "local", enabled: wasEnabled("local"), status: "off" },
			{ channel: "chain", enabled: wasEnabled("chain"), status: "off" },
		]);

		// The active character / default map now point at deleted ids.
		await db.settings.bulkDelete(["activeCharacterId", "defaultMapId"]);
	});

	useAppStore.getState().resetCycleState();
}

/**
 * Full operational reset: (optionally) archive -> clear -> stamp the new cycle. Aborts before
 * clearing if an archive was requested and failed, so we never clear without a recoverable copy.
 * The new (per-tenant) stamp is written only after a successful clear.
 *
 * `unattended` distinguishes the auto path (checkCycleReset, fires on a real cycle change) from the
 * attended manual dialog. On the unattended path a browser download cannot be confirmed and is
 * often blocked outside a user gesture, so without a configured backup-dir handle there is NO
 * verifiable archive -- we refuse to clear and return "skipped", leaving the data and the old stamp
 * intact so the boundary is retried (or the user runs the manual reset). The attended path keeps the
 * gesture-driven download as a best-effort archive and is allowed to clear.
 */
export async function resetForNewCycle(opts: {
	archive: boolean;
	unattended: boolean;
}): Promise<"reset" | "skipped"> {
	const stamp = await getCurrentCycleStamp();
	const tenant = await getActiveTenant();

	if (opts.archive) {
		// Unattended + no backup-dir handle => only an unverifiable download is possible. Do not fire
		// it and do not clear: abort so the cycle boundary is retried with a verifiable target later.
		const handle = await getBackupHandle();
		if (opts.unattended && !handle) {
			return "skipped";
		}

		const result = await archiveCycle(stamp);
		if (!result.ok) {
			throw new Error("Cycle archive failed; aborting reset to avoid data loss.");
		}
		// Defensive: the unattended path must never clear behind an unverifiable (download) archive.
		if (opts.unattended && !result.verified) {
			return "skipped";
		}
	}

	await clearCycleData();

	await db.cacheMetadata.put({
		key: cycleDataKey(tenant),
		version: stamp,
		tenant,
		importedAt: new Date().toISOString(),
	});

	return "reset";
}

/**
 * Init-time hook: adopt the current stamp on first run (never clears), no-op when it matches, and
 * auto archive-then-clear only on a real cycle change -- i.e. CHAIN_ENABLED, the same tenant, and
 * both the stored and current stamps are real `0x` worlds. A tenant switch (which changes
 * `worldPackageId` without being a cycle boundary) and the interim->chain-live hop (owned by Plan
 * 28's V33) are adopted, not cleared.
 */
export async function checkCycleReset(): Promise<"adopted" | "reset" | "noop" | "skipped"> {
	const tenant = await getActiveTenant();
	const meta = await db.cacheMetadata.get(cycleDataKey(tenant));
	const current = await getCurrentCycleStamp();

	// First run: adopt the current stamp. The mechanism never clears data it has not stamped.
	if (!meta) {
		await db.cacheMetadata.put({
			key: cycleDataKey(tenant),
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
		// Auto path: unattended. If the reset is skipped (no verifiable archive), do NOT stamp the
		// new cycle -- leave the old stamp so the boundary is detected again on the next load (or the
		// user can run the manual reset, which allows a best-effort download archive).
		const outcome = await resetForNewCycle({ archive: true, unattended: true });
		return outcome === "reset" ? "reset" : "skipped";
	}

	// Otherwise re-stamp (adopt) without clearing.
	await db.cacheMetadata.put({
		key: cycleDataKey(tenant),
		version: current,
		tenant,
		importedAt: new Date().toISOString(),
	});
	return "adopted";
}
