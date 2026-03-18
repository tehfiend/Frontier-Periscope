/**
 * ACL Registry -- Transaction builders and query helpers for the
 * acl_registry::acl_registry Move module.
 *
 * SharedAcl is a standalone shared object for named access control lists.
 * Extension-agnostic -- any gate, turret, or other extension can reference
 * a SharedAcl by its object ID.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { getObjectJson, queryEventsGql } from "./graphql-queries";
import type { SharedAclInfo } from "./types";

// ── Create ACL ──────────────────────────────────────────────────────────────

export interface CreateAclParams {
	packageId: string;
	name: string;
	isAllowlist: boolean;
	tribes: number[];
	characters: number[];
	senderAddress: string;
}

/**
 * Build a transaction to create a new SharedAcl.
 * The sender becomes the creator and first implicit admin.
 */
export function buildCreateAcl(params: CreateAclParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::acl_registry::create_acl`,
		arguments: [
			tx.pure.vector("u8", Array.from(new TextEncoder().encode(params.name))),
			tx.pure.bool(params.isAllowlist),
			tx.pure.vector("u32", params.tribes),
			tx.pure.vector("u64", params.characters),
		],
	});

	return tx;
}

// ── Update ACL (bulk) ───────────────────────────────────────────────────────

export interface UpdateAclParams {
	packageId: string;
	aclId: string;
	isAllowlist: boolean;
	tribes: number[];
	characters: number[];
	senderAddress: string;
}

/**
 * Build a transaction to bulk-update an ACL's mode and lists. Admin only.
 */
export function buildUpdateAcl(params: UpdateAclParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::acl_registry::update_acl`,
		arguments: [
			tx.object(params.aclId),
			tx.pure.bool(params.isAllowlist),
			tx.pure.vector("u32", params.tribes),
			tx.pure.vector("u64", params.characters),
		],
	});

	return tx;
}

// ── Admin Management (creator only) ─────────────────────────────────────────

export function buildAddAclAdmin(params: {
	packageId: string;
	aclId: string;
	adminAddress: string;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::acl_registry::add_admin`,
		arguments: [tx.object(params.aclId), tx.pure.address(params.adminAddress)],
	});

	return tx;
}

export function buildRemoveAclAdmin(params: {
	packageId: string;
	aclId: string;
	adminAddress: string;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::acl_registry::remove_admin`,
		arguments: [tx.object(params.aclId), tx.pure.address(params.adminAddress)],
	});

	return tx;
}

// ── Tribe Management (admin only) ───────────────────────────────────────────

export function buildAddAclTribe(params: {
	packageId: string;
	aclId: string;
	tribeId: number;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::acl_registry::add_tribe`,
		arguments: [tx.object(params.aclId), tx.pure.u32(params.tribeId)],
	});

	return tx;
}

export function buildRemoveAclTribe(params: {
	packageId: string;
	aclId: string;
	tribeId: number;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::acl_registry::remove_tribe`,
		arguments: [tx.object(params.aclId), tx.pure.u32(params.tribeId)],
	});

	return tx;
}

// ── Character Management (admin only) ───────────────────────────────────────

export function buildAddAclCharacter(params: {
	packageId: string;
	aclId: string;
	characterId: number;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::acl_registry::add_character`,
		arguments: [tx.object(params.aclId), tx.pure.u64(params.characterId)],
	});

	return tx;
}

export function buildRemoveAclCharacter(params: {
	packageId: string;
	aclId: string;
	characterId: number;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::acl_registry::remove_character`,
		arguments: [tx.object(params.aclId), tx.pure.u64(params.characterId)],
	});

	return tx;
}

// ── Query Functions ─────────────────────────────────────────────────────────

/**
 * Fetch full details of a SharedAcl by its object ID.
 */
export async function queryAclDetails(
	client: SuiGraphQLClient,
	aclId: string,
): Promise<SharedAclInfo | null> {
	try {
		const obj = await getObjectJson(client, aclId);
		if (!obj.json) return null;

		const fields = obj.json;
		return {
			objectId: aclId,
			name: decodeAclName(fields.name),
			creator: String(fields.creator ?? ""),
			admins: ((fields.admins as unknown[]) ?? []).map(String),
			isAllowlist: (fields.is_allowlist as boolean) ?? true,
			allowedTribes: ((fields.allowed_tribes as unknown[]) ?? []).map(Number),
			allowedCharacters: ((fields.allowed_characters as unknown[]) ?? []).map(Number),
		};
	} catch {
		return null;
	}
}

/**
 * Discover SharedAcl objects created by a specific address.
 * Uses AclCreatedEvent to find ACL IDs, then fetches each one.
 */
export async function querySharedAcls(
	client: SuiGraphQLClient,
	packageId: string,
	ownerAddress: string,
): Promise<SharedAclInfo[]> {
	const acls: SharedAclInfo[] = [];

	try {
		const eventType = `${packageId}::acl_registry::AclCreatedEvent`;
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await queryEventsGql(client, eventType, { cursor, limit: 50 });

			for (const event of page.data) {
				if (event.sender !== ownerAddress) continue;
				const aclId = String(event.parsedJson.acl_id ?? "");
				if (!aclId) continue;

				const details = await queryAclDetails(client, aclId);
				if (details) {
					acls.push(details);
				}
			}

			hasMore = page.hasNextPage;
			cursor = page.nextCursor;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return acls;
}

/**
 * Discover all SharedAcl objects on-chain by querying by type.
 */
export async function queryAllSharedAcls(
	client: SuiGraphQLClient,
	packageId: string,
): Promise<SharedAclInfo[]> {
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

	const acls: SharedAclInfo[] = [];
	const aclType = `${packageId}::acl_registry::SharedAcl`;
	let cursor: string | null = null;
	let hasMore = true;

	while (hasMore) {
		const result: { data?: Response } = await client.query({
			query: QUERY,
			variables: { type: aclType, first: 50, after: cursor },
		});

		const objects = result.data?.objects;
		if (!objects) break;

		for (const node of objects.nodes) {
			const json = node.asMoveObject?.contents?.json;
			if (!json) continue;

			acls.push({
				objectId: node.address,
				name: decodeAclName(json.name),
				creator: String(json.creator ?? ""),
				admins: ((json.admins as unknown[]) ?? []).map(String),
				isAllowlist: (json.is_allowlist as boolean) ?? true,
				allowedTribes: ((json.allowed_tribes as unknown[]) ?? []).map(Number),
				allowedCharacters: ((json.allowed_characters as unknown[]) ?? []).map(Number),
			});
		}

		hasMore = objects.pageInfo.hasNextPage;
		cursor = objects.pageInfo.endCursor;
	}

	return acls;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Decode a Move vector<u8> name field. GraphQL returns it as a JSON number
 * array; we convert to UTF-8 string.
 */
function decodeAclName(nameField: unknown): string {
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
