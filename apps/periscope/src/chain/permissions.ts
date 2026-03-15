import { db } from "@/db";
import type { AssemblyPolicy } from "@/db/types";
import type { AclConfig } from "@tehfrontier/chain-shared";

export interface ResolvedAcl {
	isAllowlist: boolean;
	tribeIds: number[];
	characterIds: number[];
	isEveryone: boolean;
}

/**
 * Resolve an AssemblyPolicy's groups into concrete on-chain identifiers.
 * Groups are a Periscope-local concept — the chain only sees flat vectors.
 */
export async function resolvePolicy(policy: AssemblyPolicy): Promise<ResolvedAcl> {
	const tribeIds = new Set<number>();
	const characterIds = new Set<number>();
	let isEveryone = false;

	for (const groupId of policy.groupIds) {
		if (groupId === "__everyone__") {
			isEveryone = true;
			continue;
		}

		if (groupId === "__self__") {
			// Auto-resolve from all characters in the database
			const characters = await db.characters.toArray();
			for (const char of characters) {
				if (char.characterId) {
					characterIds.add(Number(char.characterId));
				}
				if (char.tribe) {
					tribeIds.add(Number(char.tribe));
				}
			}
			continue;
		}

		// Regular group — query members
		const members = await db.groupMembers.where("groupId").equals(groupId).toArray();
		for (const member of members) {
			if (member.kind === "tribe" && member.tribeId !== undefined) {
				tribeIds.add(member.tribeId);
			}
			if (member.kind === "character" && member.characterId !== undefined) {
				characterIds.add(member.characterId);
			}
		}
	}

	return {
		isAllowlist: policy.mode === "allowlist",
		tribeIds: Array.from(tribeIds),
		characterIds: Array.from(characterIds),
		isEveryone,
	};
}

/**
 * Convert a ResolvedAcl to the format expected by chain-shared's buildConfigureAcl.
 */
export function toChainAclConfig(resolved: ResolvedAcl, permitDurationMs: number): AclConfig {
	return {
		isAllowlist: resolved.isAllowlist,
		tribeIds: resolved.tribeIds,
		characterIds: resolved.characterIds,
		permitDurationMs,
	};
}
