import { getSsuMarketOriginalPackageId, getSsuMarketPackageId } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { discoverMarketConfig, queryMarketConfig } from "@tehfrontier/chain-shared";
import { useSuiClient } from "./useSuiClient";

export interface MarketConfigResult {
	configObjectId: string;
	admin: string;
	packageId: string;
}

/**
 * Discover and query the MarketConfig for an SSU.
 *
 * Uses the original package ID for GraphQL type filtering (type names use the
 * first-published package ID), and returns the latest package ID for moveCall targets.
 *
 * Only enabled when the SSU has a MarketAuth extension.
 */
export function useMarketConfig(
	ssuObjectId: string | null | undefined,
	extensionType: string | null | undefined,
) {
	const client = useSuiClient();

	const hasMarketExtension = !!extensionType && extensionType.includes("ssu_market");
	const originalPkgId = getSsuMarketOriginalPackageId();
	const latestPkgId = getSsuMarketPackageId();

	return useQuery({
		queryKey: ["market-config", ssuObjectId, originalPkgId],
		queryFn: async (): Promise<MarketConfigResult | null> => {
			if (!ssuObjectId || !originalPkgId || !latestPkgId) return null;

			// Step 1: Discover the MarketConfig object for this SSU
			const configObjectId = await discoverMarketConfig(client, originalPkgId, ssuObjectId);
			if (!configObjectId) return null;

			// Step 2: Query the MarketConfig to get the admin address
			const config = await queryMarketConfig(client, configObjectId);
			if (!config) return null;

			return {
				configObjectId,
				admin: config.admin,
				packageId: latestPkgId,
			};
		},
		enabled: !!ssuObjectId && hasMarketExtension && !!originalPkgId && !!latestPkgId,
		staleTime: 60_000,
	});
}
