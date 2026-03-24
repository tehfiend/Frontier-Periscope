/**
 * Contacts hooks -- CRUD operations for the local-only contacts table.
 * Contacts store private per-character/tribe standings and notes (NOT on-chain).
 */

import { db } from "@/db";
import type { Contact } from "@/db/types";
import { REGISTRY_STANDING_LABELS, displayToStanding } from "@tehfrontier/chain-shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";

/** Human-readable label for a display standing value (-3 to +3). */
export function standingLabel(display: number): string {
	const raw = displayToStanding(display);
	return REGISTRY_STANDING_LABELS.get(raw) ?? "Unknown";
}

/** Returns all contacts from IndexedDB, reactively updated. */
export function useContacts() {
	const contacts = useLiveQuery(() => db.contacts.toArray()) ?? [];
	return contacts;
}

/** Returns a hook to add a new contact. */
export function useAddContact() {
	return useCallback(
		async (params: {
			kind: "character" | "tribe";
			characterId?: number;
			characterName?: string;
			tribeId?: number;
			tribeName?: string;
			standing: number;
			notes?: string;
		}) => {
			const now = new Date().toISOString();
			const contact: Contact = {
				id: crypto.randomUUID(),
				kind: params.kind,
				characterId: params.characterId,
				characterName: params.characterName,
				tribeId: params.tribeId,
				tribeName: params.tribeName,
				standing: params.standing,
				label: standingLabel(params.standing),
				notes: params.notes ?? "",
				createdAt: now,
				updatedAt: now,
			};
			await db.contacts.add(contact);
			return contact;
		},
		[],
	);
}

/** Returns a hook to update an existing contact. */
export function useUpdateContact() {
	return useCallback(
		async (
			id: string,
			updates: Partial<Pick<Contact, "standing" | "notes" | "characterName" | "tribeName">>,
		) => {
			const patch: Record<string, unknown> = {
				...updates,
				updatedAt: new Date().toISOString(),
			};
			if (updates.standing !== undefined) {
				patch.label = standingLabel(updates.standing);
			}
			await db.contacts.update(id, patch);
		},
		[],
	);
}

/** Returns a hook to delete a contact by ID. */
export function useDeleteContact() {
	return useCallback(async (id: string) => {
		await db.contacts.delete(id);
	}, []);
}
