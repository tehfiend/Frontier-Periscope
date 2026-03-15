import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import type { BetrayalAlert, AlertStatus } from "@/db/types";

const KOS_GROUP_NAME = "KOS";
const KOS_GROUP_COLOR = "#ef4444";

/**
 * Hook for detecting and responding to betrayals.
 *
 * Provides:
 * - Pending betrayal alerts (from killmail cross-referencing or manual reports)
 * - `revokeAndBlacklist()`: one-click remove from friendlies + add to KOS + mark policies dirty
 * - `reportBetrayal()`: manually flag a character/tribe as hostile
 * - `dismissAlert()` / `dismissAll()`
 */
export function useBetrayalResponse() {
	const alerts =
		useLiveQuery(() =>
			db.betrayalAlerts.where("status").equals("pending").filter(notDeleted).sortBy("createdAt"),
		) ?? [];

	const allAlerts =
		useLiveQuery(() =>
			db.betrayalAlerts.orderBy("createdAt").reverse().filter(notDeleted).toArray(),
		) ?? [];

	/**
	 * Ensure a KOS group exists, creating one if needed.
	 * Returns the group ID.
	 */
	async function ensureKosGroup(): Promise<string> {
		const existing = await db.permissionGroups
			.where("name")
			.equals(KOS_GROUP_NAME)
			.first();
		if (existing) return existing.id;

		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		await db.permissionGroups.add({
			id,
			name: KOS_GROUP_NAME,
			color: KOS_GROUP_COLOR,
			isBuiltin: false,
			description: "Kill on sight — hostile players and traitors",
			createdAt: now,
			updatedAt: now,
		});
		return id;
	}

	/**
	 * Remove a character or tribe from ALL friendly groups.
	 * Returns the IDs of groups they were removed from.
	 */
	async function removeFromFriendlyGroups(params: {
		characterId?: number;
		suiAddress?: string;
		tribeId?: number;
	}): Promise<string[]> {
		const affectedGroupIds: string[] = [];
		const allMembers = await db.groupMembers.toArray();

		for (const member of allMembers) {
			let match = false;
			if (params.characterId && member.kind === "character" && member.characterId === params.characterId) {
				match = true;
			}
			if (params.suiAddress && member.kind === "character" && member.suiAddress === params.suiAddress) {
				match = true;
			}
			if (params.tribeId && member.kind === "tribe" && member.tribeId === params.tribeId) {
				match = true;
			}

			if (match) {
				affectedGroupIds.push(member.groupId);
				await db.groupMembers.update(member.id, { _deleted: true });
			}
		}

		// Mark policies referencing affected groups as dirty
		if (affectedGroupIds.length > 0) {
			const policies = await db.assemblyPolicies.toArray();
			for (const policy of policies) {
				const usesAffectedGroup = policy.groupIds.some((gid) => affectedGroupIds.includes(gid));
				if (usesAffectedGroup && policy.syncStatus === "synced") {
					await db.assemblyPolicies.update(policy.id, {
						syncStatus: "dirty",
						updatedAt: new Date().toISOString(),
					});
				}
			}
		}

		return [...new Set(affectedGroupIds)];
	}

	/**
	 * Add a character or tribe to the KOS group.
	 */
	async function addToKos(params: {
		characterId?: number;
		characterName?: string;
		suiAddress?: string;
		tribeId?: number;
		tribeName?: string;
	}): Promise<void> {
		const kosGroupId = await ensureKosGroup();

		// Check if already in KOS
		const existingMembers = await db.groupMembers
			.where("groupId")
			.equals(kosGroupId)
			.toArray();

		const alreadyExists = existingMembers.some((m) => {
			if (params.characterId && m.kind === "character" && m.characterId === params.characterId) return true;
			if (params.suiAddress && m.kind === "character" && m.suiAddress === params.suiAddress) return true;
			if (params.tribeId && m.kind === "tribe" && m.tribeId === params.tribeId) return true;
			return false;
		});

		if (alreadyExists) return;

		const isCharacter = !!(params.characterId || params.suiAddress || params.characterName);
		await db.groupMembers.add({
			id: crypto.randomUUID(),
			groupId: kosGroupId,
			kind: isCharacter ? "character" : "tribe",
			characterName: params.characterName,
			characterId: params.characterId,
			suiAddress: params.suiAddress,
			tribeId: params.tribeId,
			tribeName: params.tribeName,
			createdAt: new Date().toISOString(),
		});

		// Mark policies referencing KOS group as dirty
		const policies = await db.assemblyPolicies.toArray();
		for (const policy of policies) {
			if (policy.groupIds.includes(kosGroupId) && policy.syncStatus === "synced") {
				await db.assemblyPolicies.update(policy.id, {
					syncStatus: "dirty",
					updatedAt: new Date().toISOString(),
				});
			}
		}
	}

	/**
	 * One-click betrayal response:
	 * 1. Remove from all friendly groups
	 * 2. Add to KOS group
	 * 3. Mark all affected policies as dirty
	 */
	async function revokeAndBlacklist(params: {
		characterId?: number;
		characterName?: string;
		suiAddress?: string;
		tribeId?: number;
		tribeName?: string;
		alertId?: string;
	}): Promise<{ removedFromGroups: string[] }> {
		const removedFromGroups = await removeFromFriendlyGroups({
			characterId: params.characterId,
			suiAddress: params.suiAddress,
			tribeId: params.tribeId,
		});

		await addToKos({
			characterId: params.characterId,
			characterName: params.characterName,
			suiAddress: params.suiAddress,
			tribeId: params.tribeId,
			tribeName: params.tribeName,
		});

		// If acting on an alert, mark it
		if (params.alertId) {
			await db.betrayalAlerts.update(params.alertId, {
				status: "acted" as AlertStatus,
				actionTaken: `Revoked from ${removedFromGroups.length} group(s), added to KOS`,
				updatedAt: new Date().toISOString(),
			});
		}

		return { removedFromGroups };
	}

	/**
	 * Manually report a betrayal — creates an alert for review.
	 */
	async function reportBetrayal(params: {
		characterId?: number;
		characterName?: string;
		suiAddress?: string;
		tribeId?: number;
	}): Promise<string> {
		// Find which groups this character/tribe is in
		const allMembers = await db.groupMembers.toArray();
		const foundInGroups: string[] = [];
		for (const member of allMembers) {
			if (params.characterId && member.kind === "character" && member.characterId === params.characterId) {
				foundInGroups.push(member.groupId);
			}
			if (params.suiAddress && member.kind === "character" && member.suiAddress === params.suiAddress) {
				foundInGroups.push(member.groupId);
			}
			if (params.tribeId && member.kind === "tribe" && member.tribeId === params.tribeId) {
				foundInGroups.push(member.groupId);
			}
		}

		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		await db.betrayalAlerts.add({
			id,
			attackerCharacterId: params.characterId,
			attackerAddress: params.suiAddress,
			attackerName: params.characterName,
			attackerTribeId: params.tribeId,
			source: "manual",
			foundInGroups: [...new Set(foundInGroups)],
			status: "pending",
			createdAt: now,
			updatedAt: now,
		});

		return id;
	}

	async function dismissAlert(alertId: string): Promise<void> {
		await db.betrayalAlerts.update(alertId, {
			status: "dismissed" as AlertStatus,
			updatedAt: new Date().toISOString(),
		});
	}

	async function dismissAll(): Promise<void> {
		const pending = await db.betrayalAlerts.where("status").equals("pending").toArray();
		for (const alert of pending) {
			await db.betrayalAlerts.update(alert.id, {
				status: "dismissed" as AlertStatus,
				updatedAt: new Date().toISOString(),
			});
		}
	}

	return {
		/** Pending alerts requiring action */
		pendingAlerts: alerts,
		/** All alerts (history) */
		allAlerts,
		/** One-click: remove from friendlies + add to KOS + mark policies dirty */
		revokeAndBlacklist,
		/** Manually report a hostile character/tribe */
		reportBetrayal,
		/** Dismiss a single alert */
		dismissAlert,
		/** Dismiss all pending alerts */
		dismissAll,
		/** Ensure KOS group exists */
		ensureKosGroup,
	};
}
