/**
 * Private Map -- Transaction builders and query helpers for the
 * private_map Move module.
 *
 * PrivateMap is a shared object containing encrypted locations.
 * Members hold MapInvite objects (owned) that contain the map's
 * secret key encrypted with the member's wallet-derived X25519 key.
 *
 * All TX builders return a Transaction ready for signing. The caller
 * is responsible for adding gas config and executing.
 */

import { fromBase64 } from "@mysten/bcs";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { bytesToHex } from "./crypto";
import { getObjectJson, listDynamicFieldsGql } from "./graphql-queries";
import type { MapInviteInfo, MapLocationInfo, PrivateMapInfo } from "./types";

/**
 * Decode a vector<u8> field from Sui GraphQL JSON content.
 * Handles all known serialization formats:
 * - Base64 string (standard Sui GraphQL JSON)
 * - JSON array of numbers (some API versions)
 * - Hex string with 0x prefix
 * Returns hex-encoded string for consistent storage.
 */
function decodeVectorU8(raw: unknown): string {
	if (!raw) return "";

	// Array of numbers: [1, 2, 3, ...]
	if (Array.isArray(raw)) {
		return bytesToHex(new Uint8Array(raw));
	}

	const str = String(raw);

	// Hex string with 0x prefix
	if (str.startsWith("0x") && /^0x[0-9a-fA-F]*$/.test(str)) {
		return str.slice(2);
	}

	// Hex string without prefix (even-length, all hex chars)
	if (str.length > 0 && str.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(str)) {
		return str;
	}

	// Base64 string (default Sui GraphQL format)
	try {
		return bytesToHex(fromBase64(str));
	} catch {
		return str;
	}
}

// ── TX Builders ─────────────────────────────────────────────────────────────

export interface CreateMapParams {
	packageId: string;
	name: string;
	publicKey: Uint8Array;
	selfInviteEncryptedKey: Uint8Array;
	senderAddress: string;
}

/**
 * Build a TX to create a new PrivateMap with a self-invite.
 * The map becomes a shared object; the self-invite is transferred to the sender.
 */
export function buildCreateMap(params: CreateMapParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map::create_map`,
		arguments: [
			tx.pure.string(params.name),
			tx.pure("vector<u8>", Array.from(params.publicKey)),
			tx.pure("vector<u8>", Array.from(params.selfInviteEncryptedKey)),
		],
	});

	return tx;
}

export interface InviteMemberParams {
	packageId: string;
	mapId: string;
	recipient: string;
	encryptedMapKey: Uint8Array;
	senderAddress: string;
}

/**
 * Build a TX to invite a member to a PrivateMap.
 * Creator only. Creates a MapInvite owned by the recipient.
 */
export function buildInviteMember(params: InviteMemberParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map::invite_member`,
		arguments: [
			tx.object(params.mapId),
			tx.pure.address(params.recipient),
			tx.pure("vector<u8>", Array.from(params.encryptedMapKey)),
		],
	});

	return tx;
}

export interface AddLocationParams {
	packageId: string;
	mapId: string;
	inviteId: string;
	structureId?: string;
	encryptedData: Uint8Array;
	senderAddress: string;
}

/**
 * Build a TX to add an encrypted location to a PrivateMap.
 * Requires a MapInvite reference for membership proof.
 */
export function buildAddLocation(params: AddLocationParams): Transaction {
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
		target: `${params.packageId}::private_map::add_location`,
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

export interface RemoveLocationParams {
	packageId: string;
	mapId: string;
	locationId: number;
	senderAddress: string;
}

/**
 * Build a TX to remove a location from a PrivateMap.
 * Creator or the address that added the location can remove it.
 */
export function buildRemoveLocation(params: RemoveLocationParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map::remove_location`,
		arguments: [tx.object(params.mapId), tx.pure.u64(params.locationId)],
	});

	return tx;
}

export interface RevokeMemberParams {
	packageId: string;
	mapId: string;
	memberAddress: string;
	senderAddress: string;
}

/**
 * Build a TX to revoke a member from a PrivateMap.
 * Creator only. Adds address to the revoked list (soft ban).
 */
export function buildRevokeMember(params: RevokeMemberParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::private_map::revoke_member`,
		arguments: [tx.object(params.mapId), tx.pure.address(params.memberAddress)],
	});

	return tx;
}

// ── Query Functions ─────────────────────────────────────────────────────────

/**
 * Fetch a PrivateMap's details by object ID.
 */
export async function queryPrivateMap(
	client: SuiGraphQLClient,
	mapId: string,
): Promise<PrivateMapInfo | null> {
	try {
		const obj = await getObjectJson(client, mapId);
		if (!obj.json) return null;

		const fields = obj.json;
		return {
			objectId: mapId,
			name: String(fields.name ?? ""),
			creator: String(fields.creator ?? ""),
			publicKey: decodeVectorU8(fields.public_key),
			nextLocationId: Number(fields.next_location_id ?? 0),
		};
	} catch {
		return null;
	}
}

/**
 * Discover all MapInvite objects owned by a user.
 * Uses GraphQL objects query filtered by type and owner.
 */
export async function queryMapInvitesForUser(
	client: SuiGraphQLClient,
	packageId: string,
	userAddress: string,
): Promise<MapInviteInfo[]> {
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

	const inviteType = `${packageId}::private_map::MapInvite`;
	console.log("[queryMapInvites] type:", inviteType, "owner:", userAddress);
	const invites: MapInviteInfo[] = [];
	let cursor: string | null = null;
	let hasMore = true;

	try {
		while (hasMore) {
			const result: { data?: Response } = await client.query({
				query: QUERY,
				variables: { type: inviteType, owner: userAddress, first: 50, after: cursor },
			});

			const objects = result.data?.objects;
			console.log("[queryMapInvites] response:", JSON.stringify(result.data, null, 2)?.slice(0, 500));
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
 * Fetch all locations from a PrivateMap via dynamic field enumeration.
 * Locations are stored as dynamic fields keyed by LocationKey { location_id }.
 */
export async function queryMapLocations(
	client: SuiGraphQLClient,
	mapId: string,
): Promise<MapLocationInfo[]> {
	const locations: MapLocationInfo[] = [];

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

				locations.push({
					locationId: Number(fields.location_id ?? locationId),
					structureId: fields.structure_id ? String(fields.structure_id) : null,
					encryptedData: decodeVectorU8(fields.encrypted_data),
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
