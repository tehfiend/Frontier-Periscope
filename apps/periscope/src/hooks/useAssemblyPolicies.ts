import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import type { AssemblyPolicy, PolicyMode, SyncStatus } from "@/db/types";

export function useAssemblyPolicies() {
	const policies = useLiveQuery(() => db.assemblyPolicies.filter(notDeleted).toArray()) ?? [];

	function getPoliciesByType(assemblyType: string): AssemblyPolicy[] {
		return policies.filter((p) => p.assemblyType === assemblyType);
	}

	function getPolicy(assemblyId: string): AssemblyPolicy | undefined {
		return policies.find((p) => p.assemblyId === assemblyId);
	}

	async function createPolicy(data: {
		assemblyId: string;
		assemblyType: "turret" | "gate" | "storage_unit" | "network_node";
		extensionTemplateId?: string;
	}): Promise<string> {
		const now = new Date().toISOString();
		const policy: AssemblyPolicy = {
			id: data.assemblyId,
			assemblyId: data.assemblyId,
			assemblyType: data.assemblyType,
			mode: "allowlist",
			groupIds: ["__self__"],
			permitDurationMs: data.assemblyType === "gate" ? 600_000 : undefined,
			syncStatus: "draft",
			extensionTemplateId: data.extensionTemplateId,
			createdAt: now,
			updatedAt: now,
		};
		await db.assemblyPolicies.put(policy);
		return data.assemblyId;
	}

	async function updatePolicy(
		assemblyId: string,
		data: Partial<Pick<AssemblyPolicy, "mode" | "groupIds" | "permitDurationMs" | "defaultPriority" | "friendlyPriority" | "hostilePriority">>,
	): Promise<void> {
		const existing = await db.assemblyPolicies.get(assemblyId);
		if (!existing) return;

		const needsSync = data.mode !== undefined || data.groupIds !== undefined;

		await db.assemblyPolicies.update(assemblyId, {
			...data,
			syncStatus: needsSync && existing.syncStatus !== "draft" ? "dirty" : existing.syncStatus,
			updatedAt: new Date().toISOString(),
		});
	}

	async function deletePolicy(assemblyId: string): Promise<void> {
		await db.assemblyPolicies.update(assemblyId, { _deleted: true, updatedAt: new Date().toISOString() });
	}

	async function setSyncStatus(
		assemblyId: string,
		status: SyncStatus,
		extra?: { syncError?: string; syncTxDigest?: string },
	): Promise<void> {
		await db.assemblyPolicies.update(assemblyId, {
			syncStatus: status,
			lastSyncedAt: status === "synced" ? new Date().toISOString() : undefined,
			syncError: extra?.syncError,
			syncTxDigest: extra?.syncTxDigest,
			updatedAt: new Date().toISOString(),
		});
	}

	return {
		policies,
		getPoliciesByType,
		getPolicy,
		createPolicy,
		updatePolicy,
		deletePolicy,
		setSyncStatus,
	};
}
