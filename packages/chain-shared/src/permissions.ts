import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import type { TenantId } from "./config";
import { getDynamicFieldJson, getObjectJson } from "./graphql-queries";
import type { AclConfig, AdminConfig } from "./types";

// ── Query Functions ─────────────────────────────────────────────────────────

/**
 * Read the admin config from the ExtensionConfig shared object.
 */
export async function queryAdminConfig(
	client: SuiGraphQLClient,
	configObjectId: string,
): Promise<AdminConfig> {
	const obj = await getObjectJson(client, configObjectId);
	const fields = obj.json ?? {};

	return {
		owner: (fields.owner as string) ?? "",
		admins: (fields.admins as string[]) ?? [],
		adminTribes: (fields.admin_tribes as number[]) ?? [],
	};
}

/**
 * Read the ACL config for a specific gate from dynamic fields.
 */
export async function queryAclConfig(
	client: SuiGraphQLClient,
	configObjectId: string,
	gateId: string,
): Promise<AclConfig | null> {
	try {
		const fields = await getDynamicFieldJson(client, configObjectId, {
			type: "0x2::object::ID",
			value: gateId,
		});
		if (!fields) return null;

		return {
			isAllowlist: (fields.is_allowlist as boolean) ?? true,
			tribeIds: (fields.allowed_tribes as number[]) ?? [],
			characterIds: (fields.allowed_characters as number[]) ?? [],
			permitDurationMs: Number(fields.permit_duration_ms ?? 600000),
		};
	} catch {
		return null;
	}
}

// ── Transaction Builders ────────────────────────────────────────────────────

export interface ConfigureAclParams {
	tenant: TenantId;
	packageId: string;
	configObjectId: string;
	gateId: string;
	isAllowlist: boolean;
	tribeIds: number[];
	characterIds: number[];
	permitDurationMs: number;
	senderAddress: string;
}

/**
 * Build a transaction to configure the ACL for a gate.
 */
export function buildConfigureAcl(params: ConfigureAclParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::set_config`,
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.id(params.gateId),
			tx.pure.bool(params.isAllowlist),
			tx.pure.vector("u32", params.tribeIds),
			tx.pure.vector("u64", params.characterIds),
			tx.pure.u64(params.permitDurationMs),
		],
	});

	return tx;
}

/**
 * Build a transaction to remove ACL config for a gate.
 */
export function buildRemoveAclConfig(params: {
	packageId: string;
	configObjectId: string;
	gateId: string;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::remove_config`,
		arguments: [tx.object(params.configObjectId), tx.pure.id(params.gateId)],
	});

	return tx;
}

// ── Admin Management ────────────────────────────────────────────────────────

export function buildAddAdmin(params: {
	packageId: string;
	configObjectId: string;
	adminAddress: string;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::add_admin`,
		arguments: [tx.object(params.configObjectId), tx.pure.address(params.adminAddress)],
	});

	return tx;
}

export function buildRemoveAdmin(params: {
	packageId: string;
	configObjectId: string;
	adminAddress: string;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::remove_admin`,
		arguments: [tx.object(params.configObjectId), tx.pure.address(params.adminAddress)],
	});

	return tx;
}

export function buildAddAdminTribe(params: {
	packageId: string;
	configObjectId: string;
	tribeId: number;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::add_admin_tribe`,
		arguments: [tx.object(params.configObjectId), tx.pure.u32(params.tribeId)],
	});

	return tx;
}

export function buildRemoveAdminTribe(params: {
	packageId: string;
	configObjectId: string;
	tribeId: number;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::remove_admin_tribe`,
		arguments: [tx.object(params.configObjectId), tx.pure.u32(params.tribeId)],
	});

	return tx;
}

// ── Shared ACL Config ──────────────────────────────────────────────────────

export interface SetSharedAclConfigParams {
	packageId: string;
	configObjectId: string;
	gateId: string;
	sharedAclId: string;
	permitDurationMs: number;
	senderAddress: string;
}

/**
 * Build a transaction to bind a gate to a SharedAcl object.
 * The gate will use the SharedAcl's tribes/characters instead of inline config.
 */
export function buildSetSharedAclConfig(params: SetSharedAclConfigParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::set_shared_config`,
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.id(params.gateId),
			tx.pure.id(params.sharedAclId),
			tx.pure.u64(params.permitDurationMs),
		],
	});

	return tx;
}

export interface RemoveSharedAclConfigParams {
	packageId: string;
	configObjectId: string;
	gateId: string;
	senderAddress: string;
}

/**
 * Build a transaction to remove the shared ACL binding for a gate.
 */
export function buildRemoveSharedAclConfig(params: RemoveSharedAclConfigParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::remove_shared_config`,
		arguments: [tx.object(params.configObjectId), tx.pure.id(params.gateId)],
	});

	return tx;
}
