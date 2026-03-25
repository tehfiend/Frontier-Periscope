import { db } from "@/db";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";

/**
 * Returns session IDs belonging to the active character.
 * When no character filter is active ("All Characters"), returns null
 * to signal that callers should not filter by session.
 */
export function useCharacterSessionIds(): Set<string> | null {
	const { activeCharacter, isFiltered } = useActiveCharacter();

	const sessionIds = useLiveQuery(
		() =>
			isFiltered && activeCharacter
				? db.logSessions.where("characterName").equals(activeCharacter.characterName).primaryKeys()
				: [],
		[isFiltered, activeCharacter?.characterName],
	);

	return useMemo(() => {
		if (!isFiltered) return null;
		if (!sessionIds || sessionIds.length === 0) return new Set<string>();
		return new Set(sessionIds as string[]);
	}, [isFiltered, sessionIds]);
}
