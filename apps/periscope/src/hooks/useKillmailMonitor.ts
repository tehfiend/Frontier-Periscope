import { useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import type { GroupMember } from "@/db/types";

/**
 * Monitors killmails and cross-references attackers against friendly permission groups.
 * When a whitelisted character/tribe is found as the killer of one of your structures,
 * creates a BetrayalAlert for the user to act on.
 *
 * Runs as a background effect — checks new killmails against group membership.
 */
export function useKillmailMonitor() {
	const killmails = useLiveQuery(() => db.killmails.filter(notDeleted).toArray()) ?? [];
	const members = useLiveQuery(() => db.groupMembers.filter(notDeleted).toArray()) ?? [];
	const processedRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		if (killmails.length === 0 || members.length === 0) return;

		checkForBetrayals(killmails, members);
	}, [killmails, members]);

	async function checkForBetrayals(
		killmails: Array<{ id: string; killmailId: string; finalBlow: string; involved: string[]; victim: string }>,
		allMembers: GroupMember[],
	) {
		// Build lookup of friendly Sui addresses from groups
		const friendlyAddresses = new Map<string, { groupIds: string[]; name?: string }>();
		for (const member of allMembers) {
			if (member.kind === "character" && member.suiAddress) {
				const existing = friendlyAddresses.get(member.suiAddress);
				if (existing) {
					existing.groupIds.push(member.groupId);
				} else {
					friendlyAddresses.set(member.suiAddress, {
						groupIds: [member.groupId],
						name: member.characterName,
					});
				}
			}
		}

		if (friendlyAddresses.size === 0) return;

		// Check if our own assemblies were victims
		const ownedDeployables = await db.deployables.toArray();
		const ownAddresses = new Set<string>();
		for (const d of ownedDeployables) {
			if (d.owner) ownAddresses.add(d.owner);
		}
		// Also include character addresses
		const characters = await db.characters.toArray();
		for (const c of characters) {
			if (c.suiAddress) ownAddresses.add(c.suiAddress);
		}

		for (const km of killmails) {
			// Skip already processed
			if (processedRef.current.has(km.id)) continue;
			processedRef.current.add(km.id);

			// Check if victim is one of ours
			const isOurVictim = ownAddresses.has(km.victim);
			if (!isOurVictim) continue;

			// Check if killer is in our friendly lists
			const allAttackers = [km.finalBlow, ...km.involved];
			for (const attacker of allAttackers) {
				const friendlyInfo = friendlyAddresses.get(attacker);
				if (!friendlyInfo) continue;

				// This is a betrayal — a friendly killed our structure
				const existingAlert = await db.betrayalAlerts
					.where("attackerAddress")
					.equals(attacker)
					.first();

				// Don't duplicate alerts for the same attacker
				if (existingAlert && existingAlert.status === "pending") continue;

				const now = new Date().toISOString();
				await db.betrayalAlerts.add({
					id: crypto.randomUUID(),
					attackerAddress: attacker,
					attackerName: friendlyInfo.name,
					source: "killmail",
					killmailId: km.killmailId,
					foundInGroups: [...new Set(friendlyInfo.groupIds)],
					status: "pending",
					createdAt: now,
					updatedAt: now,
				});
			}
		}
	}
}
