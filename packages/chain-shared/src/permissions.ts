import { Transaction } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";
import type { AclConfig, AdminConfig } from "./types";
import { type TenantId, getContractAddresses } from "./config";

// ── Query Functions ─────────────────────────────────────────────────────────

function extractFields(content: unknown): Record<string, unknown> {
	const c = content as { fields?: Record<string, unknown> };
	return c?.fields ?? {};
}

/**
 * Read the admin config from the ExtensionConfig shared object.
 */
export async function queryAdminConfig(
	client: SuiClient,
	configObjectId: string,
): Promise<AdminConfig> {
	const obj = await client.getObject({
		id: configObjectId,
		options: { showContent: true },
	});
	const fields = extractFields(obj.data?.content);

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
	client: SuiClient,
	configObjectId: string,
	gateId: string,
): Promise<AclConfig | null> {
	try {
		const df = await client.getDynamicFieldObject({
			parentId: configObjectId,
			name: { type: "0x2::object::ID", value: gateId },
		});
		if (!df.data?.content) return null;

		const fields = extractFields(df.data.content);
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
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.id(params.gateId),
		],
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
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.address(params.adminAddress),
		],
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
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.address(params.adminAddress),
		],
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
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.u32(params.tribeId),
		],
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
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.u32(params.tribeId),
		],
	});

	return tx;
}
