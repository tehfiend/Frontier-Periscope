/**
 * Governance — Transaction builders and query helpers for the governance::org
 * and governance::claims Move modules.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import { Transaction } from "@mysten/sui/transactions";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import type { OrganizationInfo, OrgTier, OrgTierData, OnChainClaim } from "./types";
import { getObjectJson, queryEventsGql } from "./graphql-queries";

// ── Organization TX Builders ─────────────────────────────────────────────────

export function buildCreateOrg(
	packageId: string,
	name: string,
): Transaction {
	const tx = new Transaction();
	tx.moveCall({
		package: packageId,
		module: "org",
		function: "create_and_share",
		arguments: [tx.pure.vector("u8", Array.from(new TextEncoder().encode(name)))],
	});
	return tx;
}

export function buildAddToTier(
	packageId: string,
	orgObjectId: string,
	tier: OrgTier,
	entities: { tribeIds?: number[]; characterIds?: number[]; addresses?: string[] },
): Transaction {
	const tx = new Transaction();
	const orgArg = tx.object(orgObjectId);

	const tierPrefix = tier === "stakeholder" ? "stakeholder" : tier;

	for (const tribeId of entities.tribeIds ?? []) {
		tx.moveCall({
			package: packageId,
			module: "org",
			function: `add_${tierPrefix}_tribe`,
			arguments: [orgArg, tx.pure.u32(tribeId)],
		});
	}

	for (const charId of entities.characterIds ?? []) {
		tx.moveCall({
			package: packageId,
			module: "org",
			function: `add_${tierPrefix}_character`,
			arguments: [orgArg, tx.pure.u64(charId)],
		});
	}

	for (const addr of entities.addresses ?? []) {
		tx.moveCall({
			package: packageId,
			module: "org",
			function: `add_${tierPrefix}_address`,
			arguments: [orgArg, tx.pure.address(addr)],
		});
	}

	return tx;
}

export function buildRemoveFromTier(
	packageId: string,
	orgObjectId: string,
	tier: OrgTier,
	entities: { tribeIds?: number[]; characterIds?: number[]; addresses?: string[] },
): Transaction {
	const tx = new Transaction();
	const orgArg = tx.object(orgObjectId);

	const tierPrefix = tier === "stakeholder" ? "stakeholder" : tier;

	for (const tribeId of entities.tribeIds ?? []) {
		tx.moveCall({
			package: packageId,
			module: "org",
			function: `remove_${tierPrefix}_tribe`,
			arguments: [orgArg, tx.pure.u32(tribeId)],
		});
	}

	for (const charId of entities.characterIds ?? []) {
		tx.moveCall({
			package: packageId,
			module: "org",
			function: `remove_${tierPrefix}_character`,
			arguments: [orgArg, tx.pure.u64(charId)],
		});
	}

	for (const addr of entities.addresses ?? []) {
		tx.moveCall({
			package: packageId,
			module: "org",
			function: `remove_${tierPrefix}_address`,
			arguments: [orgArg, tx.pure.address(addr)],
		});
	}

	return tx;
}

// ── Claims TX Builders ───────────────────────────────────────────────────────

export function buildCreateClaim(
	packageId: string,
	registryId: string,
	orgObjectId: string,
	systemId: number,
	name: string,
	weight: number,
): Transaction {
	const tx = new Transaction();
	tx.moveCall({
		package: packageId,
		module: "claims",
		function: "create_claim",
		arguments: [
			tx.object(registryId),
			tx.object(orgObjectId),
			tx.pure.u64(systemId),
			tx.pure.vector("u8", Array.from(new TextEncoder().encode(name))),
			tx.pure.u64(weight),
			tx.object("0x6"), // Clock shared object
		],
	});
	return tx;
}

export function buildUpdateClaimName(
	packageId: string,
	registryId: string,
	orgObjectId: string,
	systemId: number,
	name: string,
): Transaction {
	const tx = new Transaction();
	tx.moveCall({
		package: packageId,
		module: "claims",
		function: "update_claim_name",
		arguments: [
			tx.object(registryId),
			tx.object(orgObjectId),
			tx.pure.u64(systemId),
			tx.pure.vector("u8", Array.from(new TextEncoder().encode(name))),
		],
	});
	return tx;
}

export function buildUpdateClaimWeight(
	packageId: string,
	registryId: string,
	orgObjectId: string,
	systemId: number,
	weight: number,
): Transaction {
	const tx = new Transaction();
	tx.moveCall({
		package: packageId,
		module: "claims",
		function: "update_claim_weight",
		arguments: [
			tx.object(registryId),
			tx.object(orgObjectId),
			tx.pure.u64(systemId),
			tx.pure.u64(weight),
		],
	});
	return tx;
}

export function buildRemoveClaim(
	packageId: string,
	registryId: string,
	orgObjectId: string,
	systemId: number,
): Transaction {
	const tx = new Transaction();
	tx.moveCall({
		package: packageId,
		module: "claims",
		function: "remove_claim",
		arguments: [
			tx.object(registryId),
			tx.object(orgObjectId),
			tx.pure.u64(systemId),
		],
	});
	return tx;
}

// ── Query Helpers ────────────────────────────────────────────────────────────

function parseTierData(fields: Record<string, unknown>): OrgTierData {
	return {
		tribes: ((fields.tribes as unknown[]) ?? []).map(Number),
		characters: ((fields.characters as unknown[]) ?? []).map(Number),
		addresses: ((fields.addresses as unknown[]) ?? []).map(String),
	};
}

/**
 * Fetch an Organization object from chain and parse its tier data.
 */
export async function queryOrganization(
	client: SuiGraphQLClient,
	orgObjectId: string,
): Promise<OrganizationInfo> {
	const obj = await getObjectJson(client, orgObjectId);

	if (!obj.json) {
		throw new Error(`Organization ${orgObjectId} not found or not a Move object`);
	}

	const fields = obj.json;

	return {
		objectId: orgObjectId,
		name: new TextDecoder().decode(new Uint8Array(fields.name as number[])),
		creator: fields.creator as string,
		stakeholders: parseTierData(fields.stakeholders as Record<string, unknown>),
		members: parseTierData(fields.members as Record<string, unknown>),
		serfs: parseTierData(fields.serfs as Record<string, unknown>),
		opposition: parseTierData(fields.opposition as Record<string, unknown>),
	};
}

const DISCOVER_ORG_QUERY = `
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

interface DiscoverOrgResponse {
	objects: {
		nodes: Array<{
			address: string;
			asMoveObject?: { contents?: { json: Record<string, unknown> } };
		}>;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

/**
 * Discover an Organization created by a given address.
 * Queries all Organization objects on chain and finds one whose creator matches.
 */
export async function discoverOrgByCreator(
	client: SuiGraphQLClient,
	packageId: string,
	creatorAddress: string,
): Promise<OrganizationInfo | null> {
	const orgType = `${packageId}::org::Organization`;
	let cursor: string | null = null;
	let hasMore = true;

	while (hasMore) {
		const result: { data?: DiscoverOrgResponse } = await client.query({
			query: DISCOVER_ORG_QUERY,
			variables: { type: orgType, first: 50, after: cursor },
		});

		const objects: DiscoverOrgResponse["objects"] | undefined = result.data?.objects;
		if (!objects) return null;

		for (const node of objects.nodes) {
			const json = node.asMoveObject?.contents?.json;
			if (!json) continue;

			if (json.creator === creatorAddress) {
				try {
					return await queryOrganization(client, node.address);
				} catch {
					// Object may have been deleted, keep searching
				}
			}
		}

		hasMore = objects.pageInfo.hasNextPage;
		cursor = objects.pageInfo.endCursor;
	}

	return null;
}

/**
 * Query claim events from chain to build a local index.
 * Returns all claims that have been created (caller filters removed ones).
 */
export async function queryClaimEvents(
	client: SuiGraphQLClient,
	packageId: string,
): Promise<{
	created: Array<OnChainClaim & { registryId: string }>;
	removed: Array<{ orgId: string; systemId: number; registryId: string }>;
}> {
	const created: Array<OnChainClaim & { registryId: string }> = [];
	const removed: Array<{ orgId: string; systemId: number; registryId: string }> = [];

	// Query ClaimCreatedEvent
	let cursor: string | null = null;
	let hasMore = true;
	while (hasMore) {
		const page = await queryEventsGql(
			client,
			`${packageId}::claims::ClaimCreatedEvent`,
			{ cursor, limit: 50 },
		);

		for (const evt of page.data) {
			const parsed = evt.parsedJson as {
				registry_id: string;
				org_id: string;
				system_id: string;
				name: number[];
				weight: string;
			};
			created.push({
				registryId: parsed.registry_id,
				orgId: parsed.org_id,
				systemId: Number(parsed.system_id),
				name: new TextDecoder().decode(new Uint8Array(parsed.name)),
				claimedAt: Number(evt.timestampMs ?? 0),
				weight: Number(parsed.weight),
			});
		}

		hasMore = page.hasNextPage;
		cursor = page.nextCursor;
	}

	// Query ClaimRemovedEvent
	cursor = null;
	hasMore = true;
	while (hasMore) {
		const page = await queryEventsGql(
			client,
			`${packageId}::claims::ClaimRemovedEvent`,
			{ cursor, limit: 50 },
		);

		for (const evt of page.data) {
			const parsed = evt.parsedJson as {
				registry_id: string;
				org_id: string;
				system_id: string;
			};
			removed.push({
				registryId: parsed.registry_id,
				orgId: parsed.org_id,
				systemId: Number(parsed.system_id),
			});
		}

		hasMore = page.hasNextPage;
		cursor = page.nextCursor;
	}

	return { created, removed };
}
