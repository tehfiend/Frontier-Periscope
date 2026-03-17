import { bcs } from "@mysten/sui/bcs";
import { deriveObjectID } from "@mysten/sui/utils";
import { getWorldPackageId, getRegistryAddress } from "./constants";

/**
 * Derive a Sui object ID from an in-game itemId + tenant.
 *
 * Uses the on-chain ObjectRegistry's deterministic derivation:
 * BCS-encode TenantItemId { id: u64, tenant: string }, then call
 * deriveObjectID(registryAddress, typeTag, bcsKey).
 *
 * This is a pure local computation — no chain query needed.
 */
export function deriveObjectId(itemId: string, tenant: string): string {
	const registryAddress = getRegistryAddress(tenant);
	const worldPackageId = getWorldPackageId(tenant);

	const bcsType = bcs.struct("TenantItemId", {
		id: bcs.u64(),
		tenant: bcs.string(),
	});

	const key = bcsType.serialize({ id: BigInt(itemId), tenant }).toBytes();

	return deriveObjectID(
		registryAddress,
		`${worldPackageId}::in_game_id::TenantItemId`,
		key,
	);
}
