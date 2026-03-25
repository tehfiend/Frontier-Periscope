/**
 * Claims -- Transaction builders for the governance::claims Move module.
 *
 * Extracted from governance.ts. Only the claim creation/removal builders are
 * needed (by GovernanceClaims view). Organization builders were removed with
 * the governance architecture simplification.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import { Transaction } from "@mysten/sui/transactions";

// ── Claims TX Builders ─────────────────────────────────────────────────────

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
		arguments: [tx.object(registryId), tx.object(orgObjectId), tx.pure.u64(systemId)],
	});
	return tx;
}
