import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import { useAppStore } from "@/stores/appStore";
import type { CharacterRecord } from "@/db/types";
import type { TenantId } from "@/chain/config";

export function useActiveCharacter() {
	const activeCharacterId = useAppStore((s) => s.activeCharacterId);
	const allCharacters = useLiveQuery(() => db.characters.filter(notDeleted).toArray()) ?? [];
	const tenantSetting = useLiveQuery(() => db.settings.get("tenant"));
	const activeTenant = (tenantSetting?.value as TenantId) ?? "stillness";

	// Backfill legacy characters that have no tenant — assign them to stillness (default)
	useEffect(() => {
		const orphans = allCharacters.filter((c) => !c.tenant);
		if (orphans.length > 0) {
			const now = new Date().toISOString();
			Promise.all(
				orphans.map((c) =>
					db.characters.update(c.id, { tenant: "stillness", updatedAt: now }),
				),
			);
		}
	}, [allCharacters]);

	const activeCharacter: CharacterRecord | null =
		activeCharacterId === "all"
			? null
			: allCharacters.find((c) => c.id === activeCharacterId) ?? null;

	const isFiltered = activeCharacterId !== "all";

	// Get Sui addresses for the active selection (scoped to active server)
	const activeSuiAddresses: string[] = isFiltered
		? activeCharacter?.suiAddress
			? [activeCharacter.suiAddress]
			: []
		: allCharacters
				.filter((c) => c.suiAddress && c.tenant === activeTenant)
				.map((c) => c.suiAddress as string);

	return {
		activeCharacterId,
		activeCharacter,
		allCharacters,
		isFiltered,
		activeSuiAddresses,
	};
}
