import { getTenant, getWorldPackageId } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { useSuiClient } from "./useSuiClient";

export interface CharacterSearchResult {
	characterObjectId: string;
	characterName: string;
	ownerCapId: string;
}

const SEARCH_CHARACTERS = `
	query($type: String!, $first: Int, $after: String) {
		objects(filter: { type: $type }, first: $first, after: $after) {
			nodes {
				address
				asMoveObject {
					contents { json }
				}
			}
			pageInfo { hasNextPage endCursor }
		}
	}
`;

interface CharSearchResponse {
	objects: {
		nodes: Array<{
			address: string;
			asMoveObject?: {
				contents?: {
					json: Record<string, unknown>;
				};
			};
		}>;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

/**
 * Search for Character objects by name.
 *
 * Queries all Character objects and filters client-side by case-insensitive
 * substring match on metadata.name. Results are cached for 5 minutes.
 *
 * The query is debounced by the caller -- only triggers when the search string
 * has 2+ characters.
 */
export function useCharacterSearch(query: string) {
	const client = useSuiClient();
	const trimmed = query.trim().toLowerCase();

	return useQuery({
		queryKey: ["character-search", trimmed],
		queryFn: async (): Promise<CharacterSearchResult[]> => {
			if (trimmed.length < 2) return [];

			const worldPkg = getWorldPackageId(getTenant());
			const charType = `${worldPkg}::character::Character`;
			const results: CharacterSearchResult[] = [];

			let cursor: string | null = null;
			for (let page = 0; page < 20; page++) {
				const r: { data?: CharSearchResponse | null } = await client.query({
					query: SEARCH_CHARACTERS,
					variables: { type: charType, first: 50, after: cursor },
				});

				for (const node of r.data?.objects?.nodes ?? []) {
					const json = node.asMoveObject?.contents?.json;
					if (!json) continue;

					const meta = json.metadata as Record<string, unknown> | undefined;
					const name = String(meta?.name ?? "");
					const ownerCapId = String(json.owner_cap_id ?? "");

					if (name?.toLowerCase().includes(trimmed)) {
						results.push({
							characterObjectId: node.address,
							characterName: name,
							ownerCapId,
						});
					}
				}

				// Stop early if we have enough results
				if (results.length >= 20) break;

				const pi = r.data?.objects?.pageInfo;
				if (!pi?.hasNextPage) break;
				cursor = pi.endCursor;
			}

			return results;
		},
		enabled: trimmed.length >= 2,
		staleTime: 5 * 60_000,
	});
}
