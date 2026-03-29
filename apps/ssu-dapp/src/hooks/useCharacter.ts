import { getTenant, getWorldPackageId } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { getObjectJson } from "@tehfrontier/chain-shared";
import { useSuiClient } from "./useSuiClient";

/**
 * Find PlayerProfile object owned by wallet, then derive character object ID.
 * PlayerProfile has { character_id: ID } pointing to the shared Character object.
 *
 * Note: address.objects returns MoveObject nodes (not Object), so we use
 * `contents { json }` directly instead of `asMoveObject { contents { json } }`.
 */
const FIND_PLAYER_PROFILE = `
	query($owner: SuiAddress!, $profileType: String!, $first: Int) {
		address(address: $owner) {
			objects(filter: { type: $profileType }, first: $first) {
				nodes {
					address
					contents { json }
				}
			}
		}
	}
`;

interface GqlProfileResponse {
	address: {
		objects: {
			nodes: Array<{
				address: string;
				contents?: { json: Record<string, unknown> };
			}>;
		};
	} | null;
}

export interface CharacterInfo {
	characterObjectId: string;
	characterAddress: string;
	characterName: string | null;
	characterOwnerCapId: string | null;
	/** Numeric in-game character ID (key.item_id). */
	characterItemId: number | null;
	/** Numeric tribe ID (tribe_id). */
	tribeId: number | null;
}

/**
 * Resolve a wallet address to a Character object ID.
 * Uses PlayerProfile (owned by wallet) which points to the shared Character.
 */
export function useCharacter(walletAddress: string | undefined) {
	const client = useSuiClient();

	return useQuery({
		queryKey: ["character", walletAddress],
		queryFn: async (): Promise<CharacterInfo | null> => {
			if (!walletAddress) return null;

			const tenant = getTenant();
			const worldPkg = getWorldPackageId(tenant);
			const profileType = `${worldPkg}::character::PlayerProfile`;

			// Find PlayerProfile owned by wallet
			const profileResult = await client.query<
				GqlProfileResponse,
				{ owner: string; profileType: string; first: number }
			>({
				query: FIND_PLAYER_PROFILE,
				variables: { owner: walletAddress, profileType, first: 5 },
			});

			const profiles = profileResult.data?.address?.objects?.nodes ?? [];
			if (profiles.length === 0) return null;

			const profileJson = profiles[0].contents?.json;
			if (!profileJson) return null;

			const characterId = String(profileJson.character_id ?? "");
			if (!characterId) return null;

			// Fetch the Character object to get the name + owner_cap_id
			let characterName: string | null = null;
			let characterOwnerCapId: string | null = null;
			let characterItemId: number | null = null;
			let tribeId: number | null = null;
			try {
				const charResult = await getObjectJson(client, characterId);
				const meta = charResult.json?.metadata as Record<string, unknown> | undefined;
				characterName = meta?.name ? String(meta.name) : null;
				characterOwnerCapId = charResult.json?.owner_cap_id
					? String(charResult.json.owner_cap_id)
					: null;
				const keyFields = charResult.json?.key as Record<string, unknown> | undefined;
				characterItemId = keyFields?.item_id != null ? Number(keyFields.item_id) : null;
				tribeId = charResult.json?.tribe_id != null ? Number(charResult.json.tribe_id) : null;
			} catch {
				// Non-fatal -- name, cap ID, and numeric IDs are optional
			}

			return {
				characterObjectId: characterId,
				characterAddress: walletAddress,
				characterName,
				characterOwnerCapId,
				characterItemId,
				tribeId,
			};
		},
		enabled: !!walletAddress,
		staleTime: 5 * 60_000,
	});
}
