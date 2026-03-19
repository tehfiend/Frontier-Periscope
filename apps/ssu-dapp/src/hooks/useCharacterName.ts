import { useQuery } from "@tanstack/react-query";
import { getObjectJson } from "@tehfrontier/chain-shared";
import { useSuiClient } from "./useSuiClient";

/**
 * Fetch a Character object by ID and return its metadata name.
 */
export function useCharacterName(characterObjectId: string | undefined) {
	const client = useSuiClient();

	return useQuery({
		queryKey: ["character-name", characterObjectId],
		queryFn: async (): Promise<string | null> => {
			if (!characterObjectId) return null;
			const result = await getObjectJson(client, characterObjectId);
			if (!result.json) return null;
			const meta = result.json.metadata as Record<string, unknown> | undefined;
			return meta?.name ? String(meta.name) : null;
		},
		enabled: !!characterObjectId,
		staleTime: 5 * 60_000,
	});
}
