import {
	getSsuMarketOriginalPackageId,
	getSsuMarketPackageId,
	getSsuMarketPreviousPackageIds,
} from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import {
	discoverSsuConfigStandings,
	queryMarketStandingsDetails,
	querySsuConfigStandings,
} from "@tehfrontier/chain-shared";
import { useSuiClient } from "./useSuiClient";

export interface SsuConfigResult {
	ssuConfigId: string;
	owner: string;
	delegates: string[];
	marketId: string | null;
	/** Coin type from the linked Market<T>, e.g. "0xabc::ISK_TOKEN::ISK_TOKEN" */
	coinType: string | null;
	/** StandingsRegistry object ID from the linked Market (needed for standings-gated trades). */
	registryId: string | null;
	/** SSU Market package ID (latest version for ssu_market calls). */
	packageId: string;
	isPublic: boolean;
}

/**
 * Discover and query the SsuConfig for an SSU.
 *
 * Uses the original package ID for GraphQL type filtering (type names use the
 * first-published package ID), and returns the latest package ID for moveCall targets.
 *
 * Only enabled when the SSU has a ssu_market extension.
 */
export function useSsuConfig(
	ssuObjectId: string | null | undefined,
	extensionType: string | null | undefined,
) {
	const client = useSuiClient();

	const hasMarketExtension = !!extensionType && extensionType.includes("::ssu_market::");
	const originalPkgId = getSsuMarketOriginalPackageId();
	const latestPkgId = getSsuMarketPackageId();

	return useQuery({
		queryKey: ["ssu-config", ssuObjectId, originalPkgId],
		queryFn: async (): Promise<SsuConfigResult | null> => {
			if (!ssuObjectId || !originalPkgId || !latestPkgId) return null;

			// Step 1: Discover the SsuConfig object for this SSU
			const ssuConfigId = await discoverSsuConfigStandings(
				client,
				originalPkgId,
				ssuObjectId,
				getSsuMarketPreviousPackageIds(),
			);
			if (!ssuConfigId) return null;

			// Step 2: Query the SsuConfig to get owner, delegates, marketId
			const config = await querySsuConfigStandings(client, ssuConfigId);
			if (!config) return null;

			// Step 3: If Market is linked, query it for the coin type and registry ID
			let coinType: string | null = null;
			let registryId: string | null = null;
			if (config.marketId) {
				const market = await queryMarketStandingsDetails(client, config.marketId);
				coinType = market?.coinType ?? null;
				registryId = market?.registryId ?? null;
			}

			return {
				ssuConfigId,
				owner: config.owner,
				delegates: config.delegates,
				marketId: config.marketId,
				coinType,
				registryId,
				packageId: latestPkgId,
				isPublic: config.isPublic,
			};
		},
		enabled: !!ssuObjectId && hasMarketExtension && !!originalPkgId && !!latestPkgId,
		staleTime: 60_000,
	});
}
