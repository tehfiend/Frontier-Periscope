import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { useQuery } from "@tanstack/react-query";
import { useSuiClient } from "./useSuiClient";

const GET_OBJECT_REF = `
	query($id: SuiAddress!) {
		object(address: $id) {
			address
			version
			digest
		}
	}
`;

/**
 * Fetch the latest OwnerCap version + digest directly from chain.
 * Use this right before building a transaction to avoid stale receivingRef errors.
 */
export async function fetchOwnerCapRef(
	client: SuiGraphQLClient,
	ownerCapId: string,
): Promise<OwnerCapInfo> {
	const r: { data?: GqlObjectRefResponse | null } = await client.query({
		query: GET_OBJECT_REF,
		variables: { id: ownerCapId },
	});
	const obj = r.data?.object;
	if (!obj) throw new Error("OwnerCap not found on chain");
	return { objectId: obj.address, version: obj.version, digest: obj.digest };
}

interface GqlObjectRefResponse {
	object: {
		address: string;
		version: number;
		digest: string;
	} | null;
}

export interface OwnerCapInfo {
	objectId: string;
	version: number;
	digest: string;
}

/**
 * Fetch the OwnerCap<StorageUnit> object reference for borrow_owner_cap.
 *
 * We already know the ownerCapId from the SSU's owner_cap_id field.
 * We just need the current version + digest to create a Receiving<OwnerCap<T>> arg.
 * We also verify the connected wallet's Character is the one that owns this cap.
 */
export function useOwnerCap(characterObjectId: string | undefined, ownerCapId: string | undefined) {
	const client = useSuiClient();

	return useQuery({
		queryKey: ["ownerCap", characterObjectId, ownerCapId],
		queryFn: async (): Promise<OwnerCapInfo | null> => {
			if (!characterObjectId || !ownerCapId) return null;

			// Fetch the OwnerCap object to get version + digest
			const r: { data?: GqlObjectRefResponse | null } = await client.query({
				query: GET_OBJECT_REF,
				variables: { id: ownerCapId },
			});

			const obj = r.data?.object;
			if (!obj) return null;

			// Verify this OwnerCap is owned by the connected wallet's Character
			// by checking the cap's owner address matches the characterObjectId
			const ownerQuery: {
				data?: { object: { owner: { address?: { address: string } } } | null } | null;
			} = await client.query({
				query: `query($id: SuiAddress!) {
						object(address: $id) {
							owner {
								... on ObjectOwner { address { address } }
								... on AddressOwner { address { address } }
							}
						}
					}`,
				variables: { id: ownerCapId },
			});

			const capOwner = ownerQuery.data?.object?.owner?.address?.address;
			if (capOwner !== characterObjectId) return null;

			return {
				objectId: obj.address,
				version: obj.version,
				digest: obj.digest,
			};
		},
		enabled: !!characterObjectId && !!ownerCapId,
		staleTime: 30_000,
	});
}
