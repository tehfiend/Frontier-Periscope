import { useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { buildConfigureAcl } from "@tehfrontier/chain-shared";
import { getTemplate, type TenantId } from "@/chain/config";
import { resolvePolicy } from "@/chain/permissions";
import { db } from "@/db";

export type SyncState = "idle" | "resolving" | "building" | "signing" | "done" | "error";

export function usePermissionSync() {
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
	const [syncState, setSyncState] = useState<SyncState>("idle");
	const [syncError, setSyncError] = useState<string>();

	async function syncPolicy(policyId: string, tenant: TenantId): Promise<boolean> {
		if (!account) return false;

		setSyncState("resolving");
		setSyncError(undefined);

		try {
			// Load policy
			const policy = await db.assemblyPolicies.get(policyId);
			if (!policy) throw new Error("Policy not found");

			// Check extension template
			const templateId = policy.extensionTemplateId ?? "gate_acl";
			const template = getTemplate(templateId);
			if (!template) throw new Error(`Template "${templateId}" not found`);

			const packageId = template.packageIds[tenant];
			const configObjectId = template.configObjectIds[tenant];
			if (!packageId || !configObjectId) {
				throw new Error(`Template "${templateId}" not published on ${tenant}`);
			}

			// Resolve groups to concrete IDs
			const resolved = await resolvePolicy(policy);

			// Handle __everyone__ special case
			if (resolved.isEveryone) {
				if (policy.mode === "allowlist") {
					// Allowlist + everyone = no restriction (empty allowlist would block)
					// Use denylist with empty list instead
					resolved.isAllowlist = false;
					resolved.tribeIds = [];
					resolved.characterIds = [];
				} else {
					// Denylist + everyone = block all
					// Use allowlist with empty list
					resolved.isAllowlist = true;
					resolved.tribeIds = [];
					resolved.characterIds = [];
				}
			}

			// Mark as syncing
			await db.assemblyPolicies.update(policyId, {
				syncStatus: "syncing",
				updatedAt: new Date().toISOString(),
			});

			// Build transaction
			setSyncState("building");
			const tx = buildConfigureAcl({
				tenant,
				packageId,
				configObjectId,
				gateId: policy.assemblyId,
				isAllowlist: resolved.isAllowlist,
				tribeIds: resolved.tribeIds,
				characterIds: resolved.characterIds,
				permitDurationMs: policy.permitDurationMs ?? 600_000,
				senderAddress: account.address,
			});

			// Sign and execute
			setSyncState("signing");
			const result = await signAndExecute({ transaction: tx });

			// Update status
			await db.assemblyPolicies.update(policyId, {
				syncStatus: "synced",
				lastSyncedAt: new Date().toISOString(),
				syncTxDigest: result.digest,
				syncError: undefined,
				updatedAt: new Date().toISOString(),
			});

			setSyncState("done");
			return true;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setSyncError(message);
			setSyncState("error");

			await db.assemblyPolicies.update(policyId, {
				syncStatus: "error",
				syncError: message,
				updatedAt: new Date().toISOString(),
			});

			return false;
		}
	}

	function reset() {
		setSyncState("idle");
		setSyncError(undefined);
	}

	return {
		syncPolicy,
		syncState,
		syncError,
		reset,
		isSyncing: syncState === "resolving" || syncState === "building" || syncState === "signing",
	};
}
