import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import { useAppStore } from "@/stores/appStore";
import type { CharacterRecord } from "@/db/types";

export function useActiveCharacter() {
	const activeCharacterId = useAppStore((s) => s.activeCharacterId);
	const allCharacters = useLiveQuery(() => db.characters.filter(notDeleted).toArray()) ?? [];

	const activeCharacter: CharacterRecord | null =
		activeCharacterId === "all"
			? null
			: allCharacters.find((c) => c.id === activeCharacterId) ?? null;

	const isFiltered = activeCharacterId !== "all";

	// Get Sui addresses for the active selection (for chain queries)
	const activeSuiAddresses: string[] = isFiltered
		? activeCharacter?.suiAddress
			? [activeCharacter.suiAddress]
			: []
		: allCharacters.filter((c) => c.suiAddress).map((c) => c.suiAddress as string);

	return {
		activeCharacterId,
		activeCharacter,
		allCharacters,
		isFiltered,
		activeSuiAddresses,
	};
}
