/**
 * Private Map Standings -- Transaction builders and query helpers for the
 * private_map_standings::private_map_standings Move module.
 *
 * Dual-mode maps: encrypted (mode=0, invite-based) and cleartext standings
 * (mode=1, registry-gated). Both modes share the PrivateMapV2 shared object.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import { fromBase64 } from "@mysten/bcs";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { bytesToHex } from "./crypto";
import { getObjectJson, listDynamicFieldsGql } from "./graphql-queries";
import type { MapLocationV2Info, PrivateMapV2Info } from "./types";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Decode a vector<u8> field from Sui GraphQL JSON content.
 * Returns hex-encoded string for consistent storage.
 */
function decodeVectorU8(raw: unknown): string {
	if (!raw) return "";

	if (Array.isArray(raw)) {
		return bytesToHex(new Uint8Array(raw));
	}

	const str = String(raw);

	if (str.startsWith("0x") && /^0x[0-9a-fA-F]*$/.test(str)) {
		return str.slice(2);
	}

	if (str.length > 0 && str.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(str)) {
		return str;
	}

	try {
		return bytesToHex(fromBase64(str));
	} catch {
		return str;
	}
}

/**
 * Parse an Option<ID> field from Sui GraphQL contents.json.
 */
function parseOptionId(raw: unknown): string | null {
	if (!raw) return null;
	if (typeof raw === "string") return raw || null;
	if (Array.isArray(raw)) return raw.length > 0 ? String(raw[0]) : null;
	if (typeof raw === "object" && raw !== null) {
		const obj = raw as Record<string, unknown>;
		const some = obj.Some ?? obj.some;
		if (some) return typeof some === "string" ? some : String(some);
		if ("vec" in obj) {
			const vec = obj.vec;
			if (Array.isArray(vec)) return vec.length > 0 ? String(vec[0]) : null;
		}
	}
	return String(raw) || null;
}

// ── TX Builders -- Map Creation ─────────────────────────────────────────────

export interface CreateEncryptedMapParams {
	packageId: string;
	name: string;
	publicKey: Uint8Array;
	selfInviteEncryptedKey: Uint8Array;
	senderAddress: string;
}

/**
 * Build a TX to create an encrypted (mode=0) PrivateMapV2 with a self-invite.
 * The map becomes a shared object; the self-invite is transferred to the sender.
 * Creator is auto-added to editors.
 */
export function buildCreateEncryptedMap(params: CreateEncryptedMapParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map_standings::create_encrypted_map`,
		arguments: [
			tx.pure.string(params.name),
			tx.pure("vector<u8>", Array.from(params.publicKey)),
			tx.pure("vector<u8>", Array.from(params.selfInviteEncryptedKey)),
		],
	});

	return tx;
}

export interface CreateStandingsMapParams {
	packageId: string;
	name: string;
	registryId: string;
	minReadStanding: number;
	minWriteStanding: number;
	senderAddress: string;
}

/**
 * Build a TX to create a cleartext standings-gated (mode=1) PrivateMapV2.
 * No encryption, no invite. Creator auto-added to editors.
 */
export function buildCreateStandingsMap(params: CreateStandingsMapParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map_standings::create_standings_map`,
		arguments: [
			tx.pure.string(params.name),
			tx.pure.id(params.registryId),
			tx.pure.u8(params.minReadStanding),
			tx.pure.u8(params.minWriteStanding),
		],
	});

	return tx;
}

// ── TX Builders -- Encrypted Mode Member Management ─────────────────────────

export interface InviteMemberV2Params {
	packageId: string;
	mapId: string;
	recipient: string;
	encryptedMapKey: Uint8Array;
	senderAddress: string;
}

/**
 * Build a TX to invite a member to an encrypted PrivateMapV2.
 * Creator only. Creates a MapInviteV2 owned by the recipient.
 */
export function buildInviteMemberV2(params: InviteMemberV2Params): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map_standings::invite_member`,
		arguments: [
			tx.object(params.mapId),
			tx.pure.address(params.recipient),
			tx.pure("vector<u8>", Array.from(params.encryptedMapKey)),
		],
	});

	return tx;
}

export interface RevokeMemberV2Params {
	packageId: string;
	mapId: string;
	memberAddress: string;
	senderAddress: string;
}

/**
 * Build a TX to revoke a member from an encrypted PrivateMapV2.
 * Creator only. Adds address to the revoked list.
 */
export function buildRevokeMemberV2(params: RevokeMemberV2Params): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map_standings::revoke_member`,
		arguments: [tx.object(params.mapId), tx.pure.address(params.memberAddress)],
	});

	return tx;
}

// ── TX Builders -- Editor Management (Both Modes) ───────────────────────────

export interface AddMapEditorParams {
	packageId: string;
	mapId: string;
	editorAddress: string;
	senderAddress: string;
}

/** Build a TX to add an editor to a PrivateMapV2. Creator only. */
export function buildAddMapEditor(params: AddMapEditorParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map_standings::add_editor`,
		arguments: [tx.object(params.mapId), tx.pure.address(params.editorAddress)],
	});

	return tx;
}

export interface RemoveMapEditorParams {
	packageId: string;
	mapId: string;
	editorAddress: string;
	senderAddress: string;
}

/** Build a TX to remove an editor from a PrivateMapV2. Creator only. */
export function buildRemoveMapEditor(params: RemoveMapEditorParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map_standings::remove_editor`,
		arguments: [tx.object(params.mapId), tx.pure.address(params.editorAddress)],
	});

	return tx;
}

// ── TX Builders -- Standings Config (Mode=1 Only) ───────────────────────────

export interface UpdateMapStandingsConfigParams {
	packageId: string;
	mapId: string;
	registryId: string;
	minReadStanding: number;
	minWriteStanding: number;
	senderAddress: string;
}

/**
 * Build a TX to update standings configuration on a cleartext map.
 * Mode=1 only. Creator only.
 */
export function buildUpdateMapStandingsConfig(
	params: UpdateMapStandingsConfigParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map_standings::update_standings_config`,
		arguments: [
			tx.object(params.mapId),
			tx.pure.id(params.registryId),
			tx.pure.u8(params.minReadStanding),
			tx.pure.u8(params.minWriteStanding),
		],
	});

	return tx;
}

// ── TX Builders -- Location Management ──────────────────────────────────────

export interface AddLocationEncryptedParams {
	packageId: string;
	mapId: string;
	inviteId: string;
	structureId?: string;
	encryptedData: Uint8Array;
	senderAddress: string;
}

/**
 * Build a TX to add an encrypted location to a mode=0 PrivateMapV2.
 * Requires a MapInviteV2 reference for membership proof.
 * Sender must be an editor or creator.
 */
export function buildAddLocationEncrypted(
	params: AddLocationEncryptedParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Build Option<ID> for structure_id
	const structureIdArg = params.structureId
		? tx.moveCall({
				target: "0x1::option::some",
				typeArguments: ["0x2::object::ID"],
				arguments: [tx.pure.id(params.structureId)],
			})
		: tx.moveCall({
				target: "0x1::option::none",
				typeArguments: ["0x2::object::ID"],
				arguments: [],
			});

	tx.moveCall({
		target: `${params.packageId}::private_map_standings::add_location_encrypted`,
		arguments: [
			tx.object(params.mapId),
			tx.object(params.inviteId),
			structureIdArg,
			tx.pure("vector<u8>", Array.from(params.encryptedData)),
			tx.object("0x6"), // Clock shared object
		],
	});

	return tx;
}

export interface AddLocationStandingsParams {
	packageId: string;
	mapId: string;
	registryId: string;
	tribeId: number;
	charId: number;
	structureId?: string;
	data: Uint8Array;
	senderAddress: string;
}

/**
 * Build a TX to add a plaintext location to a mode=1 PrivateMapV2.
 * Requires standing >= min_write_standing OR sender is editor/creator.
 */
export function buildAddLocationStandings(
	params: AddLocationStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Build Option<ID> for structure_id
	const structureIdArg = params.structureId
		? tx.moveCall({
				target: "0x1::option::some",
				typeArguments: ["0x2::object::ID"],
				arguments: [tx.pure.id(params.structureId)],
			})
		: tx.moveCall({
				target: "0x1::option::none",
				typeArguments: ["0x2::object::ID"],
				arguments: [],
			});

	tx.moveCall({
		target: `${params.packageId}::private_map_standings::add_location_standings`,
		arguments: [
			tx.object(params.mapId),
			tx.object(params.registryId),
			tx.pure.u32(params.tribeId),
			tx.pure.u64(params.charId),
			structureIdArg,
			tx.pure("vector<u8>", Array.from(params.data)),
			tx.object("0x6"), // Clock shared object
		],
	});

	return tx;
}

export interface RemoveLocationV2Params {
	packageId: string;
	mapId: string;
	locationId: number;
	senderAddress: string;
}

/**
 * Build a TX to remove a location from a PrivateMapV2.
 * Creator or the address that added the location can remove it.
 */
export function buildRemoveLocationV2(params: RemoveLocationV2Params): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map_standings::remove_location`,
		arguments: [tx.object(params.mapId), tx.pure.u64(params.locationId)],
	});

	return tx;
}

// ── Query Functions ─────────────────────────────────────────────────────────

/**
 * Fetch a PrivateMapV2's details by object ID.
 */
export async function queryPrivateMapV2(
	client: SuiGraphQLClient,
	mapId: string,
): Promise<PrivateMapV2Info | null> {
	try {
		const obj = await getObjectJson(client, mapId);
		if (!obj.json) return null;

		const fields = obj.json;
		return {
			objectId: mapId,
			name: String(fields.name ?? ""),
			creator: String(fields.creator ?? ""),
			editors: ((fields.editors as unknown[]) ?? []).map(String),
			mode: Number(fields.mode ?? 0),
			publicKey: decodeVectorU8(fields.public_key) || undefined,
			registryId: parseOptionId(fields.registry_id) ?? undefined,
			minReadStanding:
				fields.min_read_standing != null
					? Number(fields.min_read_standing)
					: undefined,
			minWriteStanding:
				fields.min_write_standing != null
					? Number(fields.min_write_standing)
					: undefined,
			nextLocationId: Number(fields.next_location_id ?? 0),
		};
	} catch {
		return null;
	}
}

/**
 * Discover all MapInviteV2 objects owned by a user.
 * Uses GraphQL objects query filtered by type and owner.
 */
export async function queryMapInvitesV2ForUser(
	client: SuiGraphQLClient,
	packageId: string,
	userAddress: string,
): Promise<
	Array<{
		objectId: string;
		mapId: string;
		sender: string;
		encryptedMapKey: string;
	}>
> {
	const QUERY = `
		query($type: String!, $owner: SuiAddress!, $first: Int, $after: String) {
			objects(filter: { type: $type, owner: $owner }, first: $first, after: $after) {
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
				asMoveObject?: {
					contents?: { json: Record<string, unknown> };
				};
			}>;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	}

	const inviteType = `${packageId}::private_map_standings::MapInviteV2`;
	const invites: Array<{
		objectId: string;
		mapId: string;
		sender: string;
		encryptedMapKey: string;
	}> = [];
	let cursor: string | null = null;
	let hasMore = true;

	try {
		while (hasMore) {
			const result: { data?: Response } = await client.query({
				query: QUERY,
				variables: {
					type: inviteType,
					owner: userAddress,
					first: 50,
					after: cursor,
				},
			});

			const objects = result.data?.objects;
			if (!objects) break;

			for (const node of objects.nodes) {
				const json = node.asMoveObject?.contents?.json;
				if (!json) continue;

				invites.push({
					objectId: node.address,
					mapId: String(json.map_id ?? ""),
					sender: String(json.sender ?? ""),
					encryptedMapKey: decodeVectorU8(json.encrypted_map_key),
				});
			}

			hasMore = objects.pageInfo.hasNextPage;
			cursor = objects.pageInfo.endCursor;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return invites;
}

/**
 * Fetch all locations from a PrivateMapV2 via dynamic field enumeration.
 * Locations are stored as dynamic fields keyed by LocationKey { location_id }.
 * Returns raw data bytes -- caller decrypts (mode=0) or JSON-parses (mode=1).
 */
export async function queryMapLocationsV2(
	client: SuiGraphQLClient,
	mapId: string,
): Promise<MapLocationV2Info[]> {
	const locations: MapLocationV2Info[] = [];

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, mapId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				if (!df.nameType.includes("LocationKey")) continue;

				const fields = df.valueJson as Record<string, unknown> | undefined;
				if (!fields) continue;

				const nameObj = df.nameJson as Record<string, unknown> | null;
				const locationId = nameObj ? Number(nameObj.location_id ?? 0) : 0;

				// Parse Option<ID> for structure_id
				const structureId = parseOptionId(fields.structure_id);

				locations.push({
					locationId: Number(fields.location_id ?? locationId),
					structureId,
					data: decodeVectorU8(fields.data),
					addedBy: String(fields.added_by ?? ""),
					addedAtMs: Number(fields.added_at_ms ?? 0),
				});
			}

			hasMore = page.hasNextPage;
			cursor = page.cursor;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return locations;
}

/**
 * Discover standings-gated maps (mode=1) via MapCreatedEvent events.
 * Filters by mode=1 and returns map IDs for the caller to fetch details.
 */
export async function queryStandingsMaps(
	client: SuiGraphQLClient,
	packageId: string,
): Promise<string[]> {
	const { queryEventsGql } = await import("./graphql-queries");
	const eventType = `${packageId}::private_map_standings::MapCreatedEvent`;
	const mapIds: string[] = [];

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const result = await queryEventsGql(client, eventType, {
				cursor,
				limit: 50,
			});

			for (const event of result.data) {
				const parsed = event.parsedJson;
				if (!parsed) continue;
				// Only include mode=1 (cleartext standings) maps
				if (Number(parsed.mode ?? 0) !== 1) continue;
				const mapId = parsed.map_id as string;
				if (mapId) mapIds.push(mapId);
			}

			hasMore = result.hasNextPage;
			cursor = result.nextCursor;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return mapIds;
}
