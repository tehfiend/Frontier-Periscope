import { useQuery } from "@tanstack/react-query";
import { getObjectJson } from "@tehfrontier/chain-shared";
import { useSuiClient } from "./useSuiClient";

/**
 * Query to find the owner (Character) of an OwnerCap object.
 * The OwnerCap<StorageUnit> is sent to the Character via transfer,
 * so its Sui-level owner is the Character object (ObjectOwner variant).
 */
const GET_OWNER_ADDRESS = `
	query($id: SuiAddress!) {
		object(address: $id) {
			owner {
				... on ObjectOwner {
					address { address }
				}
				... on AddressOwner {
					address { address }
				}
			}
		}
	}
`;

interface OwnerResponse {
	object: {
		owner: {
			address?: { address: string };
		};
	} | null;
}

/**
 * Resolve the SSU owner's character name from the ownerCapId.
 *
 * 1. Look up the OwnerCap<StorageUnit> object -> its owner is the Character.
 * 2. Fetch the Character object -> read metadata.name.
 */
export function useOwnerCharacter(ownerCapId: string | undefined) {
	const client = useSuiClient();

	return useQuery({
		queryKey: ["owner-character", ownerCapId],
		queryFn: async (): Promise<string | null> => {
			if (!ownerCapId) return null;

			// Step 1: Find the Character that owns this OwnerCap
			const r: { data?: OwnerResponse | null } = await client.query({
				query: GET_OWNER_ADDRESS,
				variables: { id: ownerCapId },
			});

			const characterId = r.data?.object?.owner?.address?.address;
			if (!characterId) return null;

			// Step 2: Fetch Character object to get metadata.name
			const charResult = await getObjectJson(client, characterId);
			if (!charResult.json) return null;

			const meta = charResult.json.metadata as Record<string, unknown> | undefined;
			return meta?.name ? String(meta.name) : null;
		},
		enabled: !!ownerCapId,
		staleTime: 5 * 60_000,
	});
}
