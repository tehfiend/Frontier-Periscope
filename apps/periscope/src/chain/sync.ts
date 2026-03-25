// ── Chain Data Sync ─────────────────────────────────────────────────────────
// Pulls data from Sui chain into local IndexedDB tables.

import { db } from "@/db";
import type {
	AssemblyIntel,
	AssemblyStatus,
	DeployableIntel,
	KillmailIntel,
} from "@/db/types";
import {
	extractFields,
	extractObjectId,
	extractType,
	getOwnedAssemblies,
	queryEvents,
} from "./client";
import { ASSEMBLY_TYPE_IDS, type TenantId, getEventTypes } from "./config";

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
function parseFuelData(fields: Record<string, unknown>): {
	fuelLevel?: number;
	fuelExpiresAt?: string;
} {
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
export async function syncOwnedAssemblies(
	address: string,
	tenant: TenantId = "stillness",
): Promise<number> {
	const objects = await getOwnedAssemblies(address, tenant);
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
			systemId: existing?.systemId,
			lPoint: existing?.lPoint,
			fuelLevel: fuelData.fuelLevel,
			fuelExpiresAt: fuelData.fuelExpiresAt,
			notes: existing?.notes,
			parentId: existing?.parentId,
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

// ── Killmail Sync ───────────────────────────────────────────────────────────

/** Fetch and store recent killmails. */
export async function syncKillmails(limit = 50, tenant: TenantId = "stillness"): Promise<number> {
	const eventType = getEventTypes(tenant).KillmailCreated;

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

		// Extract killmail ID from key.item_id or fallback to timestamp
		const keyObj = parsed.key as { item_id?: string } | undefined;
		const killmailId = keyObj?.item_id ?? `kill-${event.timestampMs}`;

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
		const killerId =
			killerObj?.item_id ?? (parsed.final_blow as string) ?? (parsed.killer as string) ?? "";
		const systemId = systemObj?.item_id
			? Number(systemObj.item_id)
			: parsed.system_id
				? Number(parsed.system_id)
				: undefined;

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
	errors: string[];
}

/** Run a full sync cycle. Accepts a single address or syncs all linked characters. */
export async function fullSync(address?: string): Promise<SyncResult> {
	const result: SyncResult = { deployables: 0, killmails: 0, errors: [] };

	// Determine addresses to sync
	let addresses: string[];
	if (address) {
		addresses = [address];
	} else {
		const characters = await db.characters.toArray();
		addresses = characters.filter((c) => c.suiAddress).map((c) => c.suiAddress as string);
	}

	// Sync owned assemblies for each address
	for (const addr of addresses) {
		try {
			result.deployables += await syncOwnedAssemblies(addr);
		} catch (e) {
			result.errors.push(
				`Deployables (${addr.slice(0, 10)}): ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}

	// Sync killmails
	try {
		result.killmails = await syncKillmails();
	} catch (e) {
		result.errors.push(`Killmails: ${e instanceof Error ? e.message : String(e)}`);
	}

	// Update last sync timestamp
	await db.settings.put({ key: "lastChainSync", value: new Date().toISOString() });

	return result;
}
