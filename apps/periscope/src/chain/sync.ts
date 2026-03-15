// ── Chain Data Sync ─────────────────────────────────────────────────────────
// Pulls data from Sui chain into local IndexedDB tables.

import { db } from "@/db";
import {
	getOwnedAssemblies,
	getCharacters,
	queryEvents,
	extractFields,
	extractType,
	extractObjectId,
	extractOwner,
	getObjectDetails,
} from "./client";
import { EVENT_TYPES, ASSEMBLY_TYPE_IDS, TENANTS, type TenantId } from "./config";
import type {
	DeployableIntel,
	AssemblyIntel,
	PlayerIntel,
	KillmailIntel,
	AssemblyStatus,
} from "@/db/types";

// ── Assembly Sync ───────────────────────────────────────────────────────────

/** Classify assembly type from Move type string. */
function classifyAssemblyType(moveType: string): string {
	if (moveType.includes("::storage_unit::")) return "Smart Storage Unit";
	if (moveType.includes("::gate::")) return "Gate";
	if (moveType.includes("::turret::")) return "Turret";
	if (moveType.includes("::network_node::")) return "Network Node";
	if (moveType.includes("::manufacturing::")) return "Manufacturing";
	if (moveType.includes("::refinery::")) return "Refinery";
	return "Assembly";
}

/** Parse assembly status from on-chain data. */
function parseAssemblyStatus(fields: Record<string, unknown>): AssemblyStatus {
	const status = fields.status as Record<string, unknown> | undefined;
	if (!status) return "unknown";
	const state = status.state as string | number | undefined;
	if (state === 1 || state === "online") return "online";
	if (state === 0 || state === "offline") return "offline";
	if (state === 2 || state === "anchoring") return "anchoring";
	if (state === 3 || state === "unanchoring") return "unanchoring";
	if (state === 4 || state === "destroyed") return "destroyed";
	return "unknown";
}

/** Parse fuel data from assembly fields. */
function parseFuelData(fields: Record<string, unknown>): { fuelLevel?: number; fuelExpiresAt?: string } {
	const fuel = fields.fuel as Record<string, unknown> | undefined;
	if (!fuel) return {};

	const amount = Number(fuel.amount ?? fuel.balance ?? 0);
	const burnRate = Number(fuel.burn_rate ?? fuel.burnRate ?? 0);

	if (amount > 0 && burnRate > 0) {
		const secondsRemaining = amount / burnRate;
		const expiresAt = new Date(Date.now() + secondsRemaining * 1000).toISOString();
		return { fuelLevel: amount, fuelExpiresAt: expiresAt };
	}

	return { fuelLevel: amount };
}

/** Sync owned assemblies for the user's address. */
export async function syncOwnedAssemblies(address: string): Promise<number> {
	const objects = await getOwnedAssemblies(address);
	const now = new Date().toISOString();
	let count = 0;

	for (const obj of objects) {
		const objectId = extractObjectId(obj);
		const fields = extractFields(obj);
		const moveType = extractType(obj);
		if (!objectId || !fields) continue;

		const assemblyType = moveType ? classifyAssemblyType(moveType) : "Assembly";
		const status = parseAssemblyStatus(fields);
		const fuelData = parseFuelData(fields);

		// Extract in-game type ID if available
		const itemId = fields.item_id as number | undefined;
		const label = itemId ? (ASSEMBLY_TYPE_IDS[itemId] ?? assemblyType) : assemblyType;

		const existing = await db.deployables.where("objectId").equals(objectId).first();

		const deployable: DeployableIntel = {
			id: existing?.id ?? crypto.randomUUID(),
			objectId,
			assemblyType,
			owner: address,
			status,
			label: existing?.label ?? label,
			systemId: existing?.systemId ?? 0,
			fuelLevel: fuelData.fuelLevel,
			fuelExpiresAt: fuelData.fuelExpiresAt,
			notes: existing?.notes,
			tags: existing?.tags ?? [],
			source: "chain",
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};

		await db.deployables.put(deployable);
		count++;
	}

	return count;
}

// ── Target Assembly Discovery ───────────────────────────────────────────────

/** Discover and sync assemblies for a target address. */
export async function syncTargetAssemblies(targetAddress: string): Promise<number> {
	const objects = await getOwnedAssemblies(targetAddress);
	const now = new Date().toISOString();
	let count = 0;

	for (const obj of objects) {
		const objectId = extractObjectId(obj);
		const fields = extractFields(obj);
		const moveType = extractType(obj);
		if (!objectId || !fields) continue;

		const assemblyType = moveType ? classifyAssemblyType(moveType) : "Assembly";
		const status = parseAssemblyStatus(fields);

		const existing = await db.assemblies.where("objectId").equals(objectId).first();

		const assembly: AssemblyIntel = {
			id: existing?.id ?? crypto.randomUUID(),
			objectId,
			assemblyType,
			owner: targetAddress,
			status,
			label: existing?.label,
			notes: existing?.notes,
			tags: existing?.tags ?? [],
			source: "chain",
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};

		await db.assemblies.put(assembly);
		count++;
	}

	// Update target record (avoid clearing lastActivity when count is 0)
	const targetUpdate: Record<string, string> = { lastPolled: now };
	if (count > 0) targetUpdate.lastActivity = now;
	await db.targets.where("address").equals(targetAddress).modify(targetUpdate);

	return count;
}

// ── Character Sync ──────────────────────────────────────────────────────────

/** Look up a character by wallet address and store as player intel. */
export async function syncCharacter(address: string): Promise<PlayerIntel | null> {
	const chars = await getCharacters(address);
	if (chars.length === 0) return null;

	const fields = extractFields(chars[0]);
	if (!fields) return null;

	const now = new Date().toISOString();
	const name = (fields.name as string) ?? "Unknown";

	const existing = await db.players.where("address").equals(address).first();

	const player: PlayerIntel = {
		id: existing?.id ?? crypto.randomUUID(),
		address,
		name,
		threat: existing?.threat ?? "unknown",
		tribe: (fields.tribe as string) ?? existing?.tribe,
		notes: existing?.notes,
		tags: existing?.tags ?? [],
		source: "chain",
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};

	await db.players.put(player);
	return player;
}

// ── Killmail Sync ───────────────────────────────────────────────────────────

/** Fetch and store recent killmails. */
export async function syncKillmails(limit = 50, tenant?: TenantId): Promise<number> {
	// Use tenant-specific event type if provided, otherwise fall back to Stillness
	const eventType = tenant
		? `${TENANTS[tenant].worldPackageId}::killmail::KillmailCreatedEvent`
		: EVENT_TYPES.KillmailCreated;

	const result = await queryEvents({
		eventType,
		limit,
		order: "descending",
	});

	const now = new Date().toISOString();
	let count = 0;

	for (const event of result.events) {
		const parsed = event.parsedJson as Record<string, unknown> | undefined;
		if (!parsed) continue;

		// Extract killmail ID from key.item_id or fallback to tx digest
		const keyObj = parsed.key as { item_id?: string } | undefined;
		const killmailId = keyObj?.item_id ?? event.id.txDigest;

		// Skip if we already have this killmail
		const exists = await db.killmails.where("killmailId").equals(killmailId).count();
		if (exists > 0) continue;

		// Parse TenantItemId fields
		const victimObj = parsed.victim_id as { item_id?: string } | undefined;
		const killerObj = parsed.killer_id as { item_id?: string } | undefined;
		const reporterObj = parsed.reported_by_character_id as { item_id?: string } | undefined;
		const systemObj = parsed.solar_system_id as { item_id?: string } | undefined;
		const lossType = parsed.loss_type as { variant?: string } | undefined;

		const victimId = victimObj?.item_id ?? (parsed.victim as string) ?? "";
		const killerId = killerObj?.item_id ?? (parsed.final_blow as string) ?? (parsed.killer as string) ?? "";
		const systemId = systemObj?.item_id ? Number(systemObj.item_id) : (parsed.system_id ? Number(parsed.system_id) : undefined);

		// Build involved list (killer + reporter if different)
		const involved: string[] = [killerId];
		if (reporterObj?.item_id && reporterObj.item_id !== killerId) {
			involved.push(reporterObj.item_id);
		}

		const killmail: KillmailIntel = {
			id: crypto.randomUUID(),
			killmailId,
			victim: victimId,
			finalBlow: killerId,
			involved,
			timestamp: parsed.kill_timestamp
				? new Date(Number(parsed.kill_timestamp) * 1000).toISOString()
				: new Date(Number(event.timestampMs)).toISOString(),
			systemId,
			source: "chain",
			tags: lossType?.variant ? [lossType.variant.toLowerCase()] : [],
			createdAt: now,
			updatedAt: now,
		};

		await db.killmails.put(killmail);
		count++;
	}

	// Store cursor for next sync
	if (result.nextCursor) {
		await db.settings.put({
			key: "killmailCursor",
			value: result.nextCursor,
		});
	}

	return count;
}

// ── Full Sync ───────────────────────────────────────────────────────────────

export interface SyncResult {
	deployables: number;
	killmails: number;
	targets: number;
	errors: string[];
}

/** Run a full sync cycle. Accepts a single address or syncs all linked characters. */
export async function fullSync(address?: string): Promise<SyncResult> {
	const result: SyncResult = { deployables: 0, killmails: 0, targets: 0, errors: [] };

	// Determine addresses to sync
	let addresses: string[];
	if (address) {
		addresses = [address];
	} else {
		const characters = await db.characters.toArray();
		addresses = characters
			.filter((c) => c.suiAddress)
			.map((c) => c.suiAddress as string);
	}

	// Sync owned assemblies for each address
	for (const addr of addresses) {
		try {
			result.deployables += await syncOwnedAssemblies(addr);
		} catch (e) {
			result.errors.push(`Deployables (${addr.slice(0, 10)}): ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	// Sync killmails
	try {
		result.killmails = await syncKillmails();
	} catch (e) {
		result.errors.push(`Killmails: ${e instanceof Error ? e.message : String(e)}`);
	}

	// Sync active targets (parallel with concurrency limit)
	try {
		const activeTargets = await db.targets.where("watchStatus").equals("active").toArray();
		const dueTargets = activeTargets.filter((t) => {
			const lastPolled = t.lastPolled ? new Date(t.lastPolled).getTime() : 0;
			const pollInterval = (t.pollInterval ?? 60) * 1000;
			return Date.now() - lastPolled >= pollInterval;
		});

		const CONCURRENCY = 4;
		for (let i = 0; i < dueTargets.length; i += CONCURRENCY) {
			const batch = dueTargets.slice(i, i + CONCURRENCY);
			const results = await Promise.allSettled(batch.map((t) => syncTargetAssemblies(t.address)));
			for (let j = 0; j < results.length; j++) {
				const r = results[j];
				if (r.status === "fulfilled") {
					result.targets += r.value;
				} else {
					result.errors.push(`Target ${batch[j].address.slice(0, 10)}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
				}
			}
		}
	} catch (e) {
		result.errors.push(`Targets: ${e instanceof Error ? e.message : String(e)}`);
	}

	// Update last sync timestamp
	await db.settings.put({ key: "lastChainSync", value: new Date().toISOString() });

	return result;
}
