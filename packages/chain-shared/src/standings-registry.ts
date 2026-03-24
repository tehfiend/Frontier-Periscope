/**
 * Standings Registry -- Transaction builders and query helpers for the
 * standings_registry::standings_registry Move module.
 *
 * StandingsRegistry is a standalone shared object for named standings registries.
 * Extension-agnostic -- any gate, SSU, or other extension can reference
 * a StandingsRegistry by its object ID.
 *
 * Standing values are stored as u8 (0-6) on-chain, displayed as -3 to +3.
 * Dynamic fields store per-tribe (TribeKey) and per-character (CharKey) standings.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { getObjectJson, listDynamicFieldsGql } from "./graphql-queries";
import type { RegistryStandingEntry, StandingsRegistryInfo } from "./types";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Human-readable labels for standing values (raw u8 0-6).
 * Use standingToDisplay() to convert to display values (-3 to +3).
 */
export const REGISTRY_STANDING_LABELS = new Map<number, string>([
	[0, "Opposition"],
	[1, "Hostile"],
	[2, "Unfriendly"],
	[3, "Neutral"],
	[4, "Friendly"],
	[5, "Ally"],
	[6, "Full Trust"],
]);

/** Convert raw on-chain u8 standing (0-6) to display value (-3 to +3). */
export function standingToDisplay(raw: number): number {
	return raw - 3;
}

/** Convert display standing (-3 to +3) to raw on-chain u8 value (0-6). */
export function displayToStanding(display: number): number {
	return display + 3;
}

// ── Create Registry ─────────────────────────────────────────────────────────

export interface CreateRegistryParams {
	packageId: string;
	name: string;
	ticker: string;
	defaultStanding: number;
	senderAddress: string;
}

/**
 * Build a transaction to create a new StandingsRegistry.
 * The sender becomes the owner and first implicit admin.
 * Ticker must be 3-6 chars, [A-Z0-9].
 */
export function buildCreateRegistry(params: CreateRegistryParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings_registry::create_registry`,
		arguments: [
			tx.pure.vector("u8", Array.from(new TextEncoder().encode(params.name))),
			tx.pure.vector("u8", Array.from(new TextEncoder().encode(params.ticker))),
			tx.pure.u8(params.defaultStanding),
		],
	});

	return tx;
}

// ── Standing Management (admin only) ────────────────────────────────────────

export interface SetTribeStandingParams {
	packageId: string;
	registryId: string;
	tribeId: number;
	standing: number;
	senderAddress: string;
}

/** Build a TX to set a tribe's standing in a registry. Admin only. */
export function buildSetTribeStanding(params: SetTribeStandingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings_registry::set_tribe_standing`,
		arguments: [
			tx.object(params.registryId),
			tx.pure.u32(params.tribeId),
			tx.pure.u8(params.standing),
		],
	});

	return tx;
}

export interface SetCharacterStandingParams {
	packageId: string;
	registryId: string;
	characterId: number;
	standing: number;
	senderAddress: string;
}

/** Build a TX to set a character's standing in a registry. Admin only. */
export function buildSetCharacterStanding(params: SetCharacterStandingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings_registry::set_character_standing`,
		arguments: [
			tx.object(params.registryId),
			tx.pure.u64(params.characterId),
			tx.pure.u8(params.standing),
		],
	});

	return tx;
}

export interface RemoveTribeStandingParams {
	packageId: string;
	registryId: string;
	tribeId: number;
	senderAddress: string;
}

/** Build a TX to remove a tribe's standing (reverts to default). Admin only. */
export function buildRemoveTribeStanding(params: RemoveTribeStandingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings_registry::remove_tribe_standing`,
		arguments: [tx.object(params.registryId), tx.pure.u32(params.tribeId)],
	});

	return tx;
}

export interface RemoveCharacterStandingParams {
	packageId: string;
	registryId: string;
	characterId: number;
	senderAddress: string;
}

/** Build a TX to remove a character's standing (reverts to default). Admin only. */
export function buildRemoveCharacterStanding(params: RemoveCharacterStandingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings_registry::remove_character_standing`,
		arguments: [tx.object(params.registryId), tx.pure.u64(params.characterId)],
	});

	return tx;
}

// ── Batch Operations (admin only) ───────────────────────────────────────────

export interface SetTribeStandingsBatchParams {
	packageId: string;
	registryId: string;
	tribeIds: number[];
	standings: number[];
	senderAddress: string;
}

/** Build a TX to set multiple tribe standings in one call. Admin only. */
export function buildSetTribeStandingsBatch(params: SetTribeStandingsBatchParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings_registry::set_tribe_standings_batch`,
		arguments: [
			tx.object(params.registryId),
			tx.pure.vector("u32", params.tribeIds),
			tx.pure.vector("u8", params.standings),
		],
	});

	return tx;
}

export interface SetCharacterStandingsBatchParams {
	packageId: string;
	registryId: string;
	characterIds: number[];
	standings: number[];
	senderAddress: string;
}

/** Build a TX to set multiple character standings in one call. Admin only. */
export function buildSetCharacterStandingsBatch(
	params: SetCharacterStandingsBatchParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings_registry::set_character_standings_batch`,
		arguments: [
			tx.object(params.registryId),
			tx.pure.vector("u64", params.characterIds),
			tx.pure.vector("u8", params.standings),
		],
	});

	return tx;
}

// ── Owner-Only Operations ───────────────────────────────────────────────────

export interface SetDefaultStandingParams {
	packageId: string;
	registryId: string;
	standing: number;
	senderAddress: string;
}

/** Build a TX to update the default standing for unregistered entities. Owner only. */
export function buildSetDefaultStanding(params: SetDefaultStandingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings_registry::set_default_standing`,
		arguments: [tx.object(params.registryId), tx.pure.u8(params.standing)],
	});

	return tx;
}

export interface UpdateRegistryInfoParams {
	packageId: string;
	registryId: string;
	name: string;
	ticker: string;
	senderAddress: string;
}

/** Build a TX to update a registry's name and ticker. Owner only. */
export function buildUpdateRegistryInfo(params: UpdateRegistryInfoParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings_registry::update_info`,
		arguments: [
			tx.object(params.registryId),
			tx.pure.vector("u8", Array.from(new TextEncoder().encode(params.name))),
			tx.pure.vector("u8", Array.from(new TextEncoder().encode(params.ticker))),
		],
	});

	return tx;
}

// ── Admin Management (owner only) ───────────────────────────────────────────

export function buildAddRegistryAdmin(params: {
	packageId: string;
	registryId: string;
	adminAddress: string;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings_registry::add_admin`,
		arguments: [tx.object(params.registryId), tx.pure.address(params.adminAddress)],
	});

	return tx;
}

export function buildRemoveRegistryAdmin(params: {
	packageId: string;
	registryId: string;
	adminAddress: string;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings_registry::remove_admin`,
		arguments: [tx.object(params.registryId), tx.pure.address(params.adminAddress)],
	});

	return tx;
}

// ── Query Functions ─────────────────────────────────────────────────────────

/**
 * Fetch full details of a StandingsRegistry by its object ID.
 */
export async function queryRegistryDetails(
	client: SuiGraphQLClient,
	registryId: string,
): Promise<StandingsRegistryInfo | null> {
	try {
		const obj = await getObjectJson(client, registryId);
		if (!obj.json) return null;

		const fields = obj.json;
		return {
			objectId: registryId,
			owner: String(fields.owner ?? ""),
			admins: ((fields.admins as unknown[]) ?? []).map(String),
			name: decodeRegistryName(fields.name),
			ticker: decodeRegistryName(fields.ticker),
			defaultStanding: Number(fields.default_standing ?? 3),
		};
	} catch {
		return null;
	}
}

/**
 * Discover all StandingsRegistry objects on-chain by querying by type.
 * Same pattern as queryAllSharedAcls() in acl-registry.ts.
 */
export async function queryAllRegistries(
	client: SuiGraphQLClient,
	packageId: string,
): Promise<StandingsRegistryInfo[]> {
	const QUERY = `
		query($type: String!, $first: Int, $after: String) {
			objects(filter: { type: $type }, first: $first, after: $after) {
				nodes {
					address
					asMoveObject { contents { json } }
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	`;

	interface Response {
		objects: {
			nodes: Array<{
				address: string;
				asMoveObject?: { contents?: { json: Record<string, unknown> } };
			}>;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	}

	const registries: StandingsRegistryInfo[] = [];
	const registryType = `${packageId}::standings_registry::StandingsRegistry`;
	let cursor: string | null = null;
	let hasMore = true;

	while (hasMore) {
		const result: { data?: Response } = await client.query({
			query: QUERY,
			variables: { type: registryType, first: 50, after: cursor },
		});

		const objects = result.data?.objects;
		if (!objects) break;

		for (const node of objects.nodes) {
			const json = node.asMoveObject?.contents?.json;
			if (!json) continue;

			registries.push({
				objectId: node.address,
				owner: String(json.owner ?? ""),
				admins: ((json.admins as unknown[]) ?? []).map(String),
				name: decodeRegistryName(json.name),
				ticker: decodeRegistryName(json.ticker),
				defaultStanding: Number(json.default_standing ?? 3),
			});
		}

		hasMore = objects.pageInfo.hasNextPage;
		cursor = objects.pageInfo.endCursor;
	}

	return registries;
}

/**
 * Enumerate tribe and character standings from a StandingsRegistry's dynamic fields.
 * Returns an array of RegistryStandingEntry.
 */
export async function queryRegistryStandings(
	client: SuiGraphQLClient,
	registryId: string,
): Promise<RegistryStandingEntry[]> {
	const entries: RegistryStandingEntry[] = [];

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, registryId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				const nameObj = df.nameJson as Record<string, unknown> | null;
				if (!nameObj) continue;

				// Standing value is stored as a raw u8 dynamic field value
				const standing = Number(df.valueJson ?? 3);

				if (df.nameType.includes("TribeKey")) {
					entries.push({
						kind: "tribe",
						tribeId: Number(nameObj.tribe_id ?? 0),
						standing,
					});
				} else if (df.nameType.includes("CharKey")) {
					entries.push({
						kind: "character",
						characterId: Number(nameObj.char_id ?? 0),
						standing,
					});
				}
			}

			hasMore = page.hasNextPage;
			cursor = page.cursor;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return entries;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Decode a Move vector<u8> name/ticker field. GraphQL returns it as a JSON
 * number array; we convert to UTF-8 string.
 */
function decodeRegistryName(nameField: unknown): string {
	if (typeof nameField === "string") return nameField;
	if (Array.isArray(nameField)) {
		try {
			return new TextDecoder().decode(new Uint8Array(nameField.map(Number)));
		} catch {
			return "";
		}
	}
	return "";
}
