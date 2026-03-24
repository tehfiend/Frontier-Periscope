// @deprecated -- Superseded by standings-registry.ts (plaintext standings model).
// This file supports the legacy encrypted standings contract.

/**
 * Standings -- Transaction builders and query helpers for the
 * standings Move module.
 *
 * StandingsList is a shared object containing encrypted standing records.
 * Members hold StandingsInvite objects (owned) that contain the list's
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
import type {
	StandingData,
	StandingEntryInfo,
	StandingsInviteInfo,
	StandingsListInfo,
} from "./types";

// ── Constants ────────────────────────────────────────────────────────────────

/** Human-readable labels for standing values (-3 to +3). */
export const STANDING_LABELS = new Map<number, string>([
	[3, "Full Trust"],
	[2, "Ally"],
	[1, "Friendly"],
	[0, "Neutral"],
	[-1, "Unfriendly"],
	[-2, "Hostile"],
	[-3, "Opposition"],
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Data Encoding ────────────────────────────────────────────────────────────

/**
 * Encode standing data to bytes for encryption.
 * JSON serialize + UTF-8 encode.
 */
export function encodeStandingData(data: StandingData): Uint8Array {
	const json = JSON.stringify(data);
	return new TextEncoder().encode(json);
}

/**
 * Decode standing data from decrypted bytes.
 * UTF-8 decode + JSON parse.
 */
export function decodeStandingData(plaintext: Uint8Array): StandingData {
	const json = new TextDecoder().decode(plaintext);
	return JSON.parse(json) as StandingData;
}

// ── TX Builders ──────────────────────────────────────────────────────────────

export interface CreateStandingsListParams {
	packageId: string;
	name: string;
	description: string;
	publicKey: string; // hex
	selfInviteEncryptedKey: string; // hex
	senderAddress: string;
}

/**
 * Build a TX to create a new StandingsList with a self-invite.
 * The list becomes a shared object; the self-invite is transferred to the sender.
 */
export function buildCreateStandingsList(params: CreateStandingsListParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const publicKeyBytes = hexToU8(params.publicKey);
	const selfInviteBytes = hexToU8(params.selfInviteEncryptedKey);

	tx.moveCall({
		target: `${params.packageId}::standings::create_list`,
		arguments: [
			tx.pure.string(params.name),
			tx.pure.string(params.description),
			tx.pure("vector<u8>", Array.from(publicKeyBytes)),
			tx.pure("vector<u8>", Array.from(selfInviteBytes)),
		],
	});

	return tx;
}

export interface InviteStandingsMemberParams {
	packageId: string;
	listId: string;
	recipient: string;
	encryptedListKey: string; // hex
	senderAddress: string;
}

/**
 * Build a TX to invite a member to a StandingsList.
 * Creator only. Creates a StandingsInvite owned by the recipient.
 */
export function buildInviteStandingsMember(params: InviteStandingsMemberParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const encryptedKeyBytes = hexToU8(params.encryptedListKey);

	tx.moveCall({
		target: `${params.packageId}::standings::invite_member`,
		arguments: [
			tx.object(params.listId),
			tx.pure.address(params.recipient),
			tx.pure("vector<u8>", Array.from(encryptedKeyBytes)),
		],
	});

	return tx;
}

export interface AddEditorParams {
	packageId: string;
	listId: string;
	editorAddress: string;
	senderAddress: string;
}

/**
 * Build a TX to add an editor to a StandingsList.
 * Creator only. Editors can modify standings.
 */
export function buildAddEditor(params: AddEditorParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings::add_editor`,
		arguments: [tx.object(params.listId), tx.pure.address(params.editorAddress)],
	});

	return tx;
}

export interface RemoveEditorParams {
	packageId: string;
	listId: string;
	editorAddress: string;
	senderAddress: string;
}

/**
 * Build a TX to remove an editor from a StandingsList.
 * Creator only.
 */
export function buildRemoveEditor(params: RemoveEditorParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings::remove_editor`,
		arguments: [tx.object(params.listId), tx.pure.address(params.editorAddress)],
	});

	return tx;
}

export interface RevokeStandingsMemberParams {
	packageId: string;
	listId: string;
	memberAddress: string;
	senderAddress: string;
}

/**
 * Build a TX to revoke a member from a StandingsList.
 * Creator only. Adds address to the revoked list (soft ban).
 */
export function buildRevokeStandingsMember(params: RevokeStandingsMemberParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings::revoke_member`,
		arguments: [tx.object(params.listId), tx.pure.address(params.memberAddress)],
	});

	return tx;
}

export interface SetStandingParams {
	packageId: string;
	listId: string;
	inviteId: string;
	entryId: number | null;
	encryptedData: string; // hex
	senderAddress: string;
}

/**
 * Build a TX to add or update an encrypted standing entry.
 * Requires a StandingsInvite reference for membership proof.
 * Pass entryId = null for new entries, or the existing entry_id for updates.
 */
export function buildSetStanding(params: SetStandingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const encryptedDataBytes = hexToU8(params.encryptedData);

	tx.moveCall({
		target: `${params.packageId}::standings::set_standing`,
		arguments: [
			tx.object(params.listId),
			tx.object(params.inviteId),
			tx.pure.option("u64", params.entryId),
			tx.pure("vector<u8>", Array.from(encryptedDataBytes)),
			tx.object("0x6"), // Sui shared Clock object
		],
	});

	return tx;
}

export interface RemoveStandingParams {
	packageId: string;
	listId: string;
	entryId: number;
	senderAddress: string;
}

/**
 * Build a TX to remove a standing entry from a StandingsList.
 * Creator or the address that added the entry can remove it.
 */
export function buildRemoveStanding(params: RemoveStandingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings::remove_standing`,
		arguments: [tx.object(params.listId), tx.pure.u64(params.entryId)],
	});

	return tx;
}

export interface UpdateListInfoParams {
	packageId: string;
	listId: string;
	name: string;
	description: string;
	senderAddress: string;
}

/**
 * Build a TX to update a StandingsList's name and description.
 * Creator only.
 */
export function buildUpdateListInfo(params: UpdateListInfoParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::standings::update_list_info`,
		arguments: [
			tx.object(params.listId),
			tx.pure.string(params.name),
			tx.pure.string(params.description),
		],
	});

	return tx;
}

// ── Query Functions ──────────────────────────────────────────────────────────

/**
 * Fetch a StandingsList's details by object ID.
 */
export async function queryStandingsList(
	client: SuiGraphQLClient,
	listId: string,
): Promise<StandingsListInfo | null> {
	try {
		const obj = await getObjectJson(client, listId);
		if (!obj.json) return null;

		const fields = obj.json;
		return {
			objectId: listId,
			name: String(fields.name ?? ""),
			description: String(fields.description ?? ""),
			creator: String(fields.creator ?? ""),
			publicKey: decodeVectorU8(fields.public_key),
			editors: Array.isArray(fields.editors) ? fields.editors.map((e: unknown) => String(e)) : [],
			nextEntryId: Number(fields.next_entry_id ?? 0),
		};
	} catch {
		return null;
	}
}

/**
 * Discover all StandingsInvite objects owned by a user.
 * Uses GraphQL objects query filtered by type and owner.
 */
export async function queryStandingsInvitesForUser(
	client: SuiGraphQLClient,
	ownerAddress: string,
	packageId: string,
): Promise<StandingsInviteInfo[]> {
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

	const inviteType = `${packageId}::standings::StandingsInvite`;
	const invites: StandingsInviteInfo[] = [];
	let cursor: string | null = null;
	let hasMore = true;

	try {
		while (hasMore) {
			const result: { data?: Response } = await client.query({
				query: QUERY,
				variables: { type: inviteType, owner: ownerAddress, first: 50, after: cursor },
			});

			const objects = result.data?.objects;
			if (!objects) break;

			for (const node of objects.nodes) {
				const json = node.asMoveObject?.contents?.json;
				if (!json) continue;

				invites.push({
					objectId: node.address,
					listId: String(json.list_id ?? ""),
					sender: String(json.sender ?? ""),
					encryptedListKey: decodeVectorU8(json.encrypted_list_key),
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
 * Fetch all standing entries from a StandingsList via dynamic field enumeration.
 * Entries are stored as dynamic fields keyed by EntryKey { entry_id }.
 */
export async function queryStandingEntries(
	client: SuiGraphQLClient,
	listId: string,
): Promise<StandingEntryInfo[]> {
	const entries: StandingEntryInfo[] = [];

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, listId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				if (!df.nameType.includes("EntryKey")) continue;

				const fields = df.valueJson as Record<string, unknown> | undefined;
				if (!fields) continue;

				const nameObj = df.nameJson as Record<string, unknown> | null;
				const entryId = nameObj ? Number(nameObj.entry_id ?? 0) : 0;

				entries.push({
					entryId: Number(fields.entry_id ?? entryId),
					encryptedData: decodeVectorU8(fields.encrypted_data),
					addedBy: String(fields.added_by ?? ""),
					updatedAtMs: Number(fields.updated_at_ms ?? 0),
				});
			}

			hasMore = page.hasNextPage;
			cursor = page.cursor;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return entries;
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/** Convert a hex string to a Uint8Array. */
function hexToU8(hex: string): Uint8Array {
	const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}
