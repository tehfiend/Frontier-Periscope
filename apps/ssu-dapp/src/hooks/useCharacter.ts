import { useQuery } from "@tanstack/react-query";
import { useSuiClient } from "./useSuiClient";
import { getWorldPackageId, getTenant } from "@/lib/constants";

const FIND_CHARACTER_BY_OWNER = `
	query($owner: SuiAddress!, $characterType: String!, $first: Int) {
		address(address: $owner) {
			objects(filter: { type: $characterType }, first: $first) {
				nodes {
					address
					asMoveObject {
						contents { json }
					}
				}
			}
		}
	}
`;

interface GqlCharacterResponse {
	address: {
		objects: {
			nodes: Array<{
				address: string;
				asMoveObject?: {
					contents?: { json: Record<string, unknown> };
				};
			}>;
		};
	} | null;
}

/**
 * Find PlayerProfile object owned by wallet, then derive character object ID.
 * PlayerProfile has { character_id: ID } pointing to the shared Character object.
 */
const FIND_PLAYER_PROFILE = `
	query($owner: SuiAddress!, $profileType: String!, $first: Int) {
		address(address: $owner) {
			objects(filter: { type: $profileType }, first: $first) {
				nodes {
					address
					asMoveObject {
						contents { json }
					}
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
				asMoveObject?: {
					contents?: { json: Record<string, unknown> };
				};
			}>;
		};
	} | null;
}

export interface CharacterInfo {
	characterObjectId: string;
	characterAddress: string;
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

			const profileJson = profiles[0].asMoveObject?.contents?.json;
			if (!profileJson) return null;

			const characterId = String(profileJson.character_id ?? "");
			if (!characterId) return null;

			return {
				characterObjectId: characterId,
				characterAddress: walletAddress,
			};
		},
		enabled: !!walletAddress,
		staleTime: 5 * 60_000,
	});
}
