import { useQuery } from "@tanstack/react-query";
import { useSuiClient } from "./useSuiClient";
import { getWorldPackageId, getTenant } from "@/lib/constants";

const FIND_OWNER_CAP = `
	query($parentId: SuiAddress!, $ownerCapType: String!, $first: Int) {
		object(address: $parentId) {
			dynamicObjectField: receivingConnection(filter: { type: $ownerCapType }, first: $first) {
				nodes {
					address
					version
					digest
				}
			}
		}
	}
`;

/** Fallback: list objects received by the character object */
const LIST_RECEIVED_OBJECTS = `
	query($parentId: SuiAddress!, $first: Int) {
		object(address: $parentId) {
			receivingConnection(first: $first) {
				nodes {
					address
					version
					digest
					asMoveObject {
						contents { type { repr } json }
					}
				}
			}
		}
	}
`;

interface GqlReceivedResponse {
	object: {
		receivingConnection: {
			nodes: Array<{
				address: string;
				version: number;
				digest: string;
				asMoveObject?: {
					contents?: {
						type: { repr: string };
						json: Record<string, unknown>;
					};
				};
			}>;
		};
	} | null;
}

export interface OwnerCapInfo {
	objectId: string;
	version: number;
	digest: string;
}

/**
 * Find the OwnerCap<StorageUnit> receiving ticket for borrow_owner_cap.
 *
 * The OwnerCap is "owned" by the Character object. To borrow it in a PTB,
 * we need its object ID + version + digest to create a Receiving<OwnerCap<T>> arg.
 */
export function useOwnerCap(characterObjectId: string | undefined, ownerCapId: string | undefined) {
	const client = useSuiClient();

	return useQuery({
		queryKey: ["ownerCap", characterObjectId, ownerCapId],
		queryFn: async (): Promise<OwnerCapInfo | null> => {
			if (!characterObjectId || !ownerCapId) return null;

			const tenant = getTenant();
			const worldPkg = getWorldPackageId(tenant);
			const ownerCapType = `${worldPkg}::access::OwnerCap<${worldPkg}::storage_unit::StorageUnit>`;

			// Try listing received objects on the character
			const result = await client.query<
				GqlReceivedResponse,
				{ parentId: string; first: number }
			>({
				query: LIST_RECEIVED_OBJECTS,
				variables: { parentId: characterObjectId, first: 50 },
			});

			const nodes = result.data?.object?.receivingConnection?.nodes ?? [];

			// Find the OwnerCap matching the expected ownerCapId
			for (const node of nodes) {
				const typeRepr = node.asMoveObject?.contents?.type?.repr ?? "";
				if (
					node.address === ownerCapId ||
					typeRepr.includes("OwnerCap") && typeRepr.includes("StorageUnit")
				) {
					return {
						objectId: node.address,
						version: node.version,
						digest: node.digest,
					};
				}
			}

			return null;
		},
		enabled: !!characterObjectId && !!ownerCapId,
		staleTime: 30_000,
	});
}
