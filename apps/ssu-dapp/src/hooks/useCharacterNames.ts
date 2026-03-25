import { getTenant, getWorldPackageId } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { getObjectJson } from "@tehfrontier/chain-shared";
import { useSuiClient } from "./useSuiClient";

const FIND_PROFILES = `
	query($owner: SuiAddress!, $profileType: String!, $first: Int) {
		address(address: $owner) {
			objects(filter: { type: $profileType }, first: $first) {
				nodes {
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
				contents?: { json: Record<string, unknown> };
			}>;
		};
	} | null;
}

const nameCache = new Map<string, string>();
const NAME_CACHE_LIMIT = 500;

/**
 * Batch-resolve wallet addresses to character names.
 * Returns a Map<address, name>.
 */
export function useCharacterNames(addresses: string[]) {
	const client = useSuiClient();

	const unique = [...new Set(addresses.filter(Boolean))];

	return useQuery({
		queryKey: ["characterNames", unique.sort().join(",")],
		queryFn: async (): Promise<Map<string, string>> => {
			const result = new Map<string, string>();
			const toResolve: string[] = [];

			for (const addr of unique) {
				const cached = nameCache.get(addr);
				if (cached) {
					result.set(addr, cached);
				} else {
					toResolve.push(addr);
				}
			}

			const worldPkg = getWorldPackageId(getTenant());
			const profileType = `${worldPkg}::character::PlayerProfile`;

			await Promise.all(
				toResolve.map(async (addr) => {
					try {
						const r = await client.query<
							GqlProfileResponse,
							{ owner: string; profileType: string; first: number }
						>({
							query: FIND_PROFILES,
							variables: { owner: addr, profileType, first: 1 },
						});

						const json = r.data?.address?.objects?.nodes?.[0]?.contents?.json;
						if (!json) return;

						const charId = String(json.character_id ?? "");
						if (!charId) return;

						const charResult = await getObjectJson(client, charId);
						const meta = charResult.json?.metadata as Record<string, unknown> | undefined;
						const name = meta?.name ? String(meta.name) : null;
						if (name) {
							if (nameCache.size >= NAME_CACHE_LIMIT) nameCache.clear();
							nameCache.set(addr, name);
							result.set(addr, name);
						}
					} catch {
						// Non-fatal
					}
				}),
			);

			return result;
		},
		enabled: unique.length > 0,
		staleTime: 5 * 60_000,
	});
}
