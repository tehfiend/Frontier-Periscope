import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import type { PermissionGroup, GroupMember, MemberKind } from "@/db/types";

export function usePermissionGroups() {
	const groups = useLiveQuery(() => db.permissionGroups.filter(notDeleted).toArray()) ?? [];
	const members = useLiveQuery(() => db.groupMembers.filter(notDeleted).toArray()) ?? [];

	function getMembersForGroup(groupId: string): GroupMember[] {
		return members.filter((m) => m.groupId === groupId);
	}

	function getGroupsUsedByPolicies(): Map<string, string[]> {
		// Returns map of groupId → assemblyIds that use it
		// Will be enriched by useAssemblyPolicies
		return new Map();
	}

	async function createGroup(data: {
		name: string;
		color: string;
		description?: string;
	}): Promise<string> {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		await db.permissionGroups.add({
			id,
			name: data.name,
			color: data.color,
			isBuiltin: false,
			description: data.description,
			createdAt: now,
			updatedAt: now,
		});
		return id;
	}

	async function updateGroup(
		id: string,
		data: Partial<Pick<PermissionGroup, "name" | "color" | "description">>,
	): Promise<void> {
		await db.permissionGroups.update(id, {
			...data,
			updatedAt: new Date().toISOString(),
		});
	}

	async function deleteGroup(id: string): Promise<void> {
		// Remove members first
		await db.groupMembers.where("groupId").equals(id).modify({ _deleted: true });
		await db.permissionGroups.update(id, { _deleted: true, updatedAt: new Date().toISOString() });

		// Mark policies referencing this group as dirty
		const policies = await db.assemblyPolicies.toArray();
		for (const policy of policies) {
			if (policy.groupIds.includes(id)) {
				await db.assemblyPolicies.update(policy.id, {
					groupIds: policy.groupIds.filter((gid) => gid !== id),
					syncStatus: "dirty",
					updatedAt: new Date().toISOString(),
				});
			}
		}
	}

	async function addMember(data: {
		groupId: string;
		kind: MemberKind;
		characterName?: string;
		characterId?: number;
		suiAddress?: string;
		tribeId?: number;
		tribeName?: string;
	}): Promise<string> {
		const id = crypto.randomUUID();
		await db.groupMembers.add({
			id,
			groupId: data.groupId,
			kind: data.kind,
			characterName: data.characterName,
			characterId: data.characterId,
			suiAddress: data.suiAddress,
			tribeId: data.tribeId,
			tribeName: data.tribeName,
			createdAt: new Date().toISOString(),
		});

		// Mark policies referencing this group as dirty
		await markPoliciesDirtyForGroup(data.groupId);

		return id;
	}

	async function removeMember(memberId: string): Promise<void> {
		const member = await db.groupMembers.get(memberId);
		if (member) {
			await db.groupMembers.update(memberId, { _deleted: true });
			await markPoliciesDirtyForGroup(member.groupId);
		}
	}

	async function markPoliciesDirtyForGroup(groupId: string): Promise<void> {
		const policies = await db.assemblyPolicies.toArray();
		for (const policy of policies) {
			if (policy.groupIds.includes(groupId) && policy.syncStatus === "synced") {
				await db.assemblyPolicies.update(policy.id, {
					syncStatus: "dirty",
					updatedAt: new Date().toISOString(),
				});
			}
		}
	}

	return {
		groups,
		members,
		getMembersForGroup,
		getGroupsUsedByPolicies,
		createGroup,
		updateGroup,
		deleteGroup,
		addMember,
		removeMember,
	};
}
