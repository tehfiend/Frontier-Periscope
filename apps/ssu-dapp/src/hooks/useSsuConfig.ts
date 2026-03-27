import {
	getSsuUnifiedPackageId,
} from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import {
	discoverSsuUnifiedConfig,
	queryMarketStandingsDetails,
	querySsuUnifiedConfig,
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
	/** SSU Unified package ID (latest version for ssu_unified calls). */
	packageId: string;
	isPublic: boolean;
}

/**
 * Discover and query the SsuUnifiedConfig for an SSU.
 *
 * Only enabled when the SSU has a ssu_standings or ssu_market extension.
 */
export function useSsuConfig(
	ssuObjectId: string | null | undefined,
	extensionType: string | null | undefined,
) {
	const client = useSuiClient();

	const hasSsuExtension =
		!!extensionType &&
		(extensionType.includes("::ssu_market::") ||
			extensionType.includes("::ssu_standings::"));
	const ssuUnifiedPkg = getSsuUnifiedPackageId();

	return useQuery({
		queryKey: ["ssu-config", ssuObjectId, ssuUnifiedPkg],
		queryFn: async (): Promise<SsuConfigResult | null> => {
			if (!ssuObjectId || !ssuUnifiedPkg) return null;

			// Step 1: Discover the SsuUnifiedConfig object for this SSU
			const ssuConfigId = await discoverSsuUnifiedConfig(
				client,
				ssuUnifiedPkg,
				ssuObjectId,
			);
			if (!ssuConfigId) return null;

			// Step 2: Query the config to get owner, delegates, marketId, standings thresholds
			const config = await querySsuUnifiedConfig(client, ssuConfigId);
			if (!config) return null;

			// Step 3: If Market is linked, query it for the coin type and registry ID
			let coinType: string | null = null;
			let registryId: string | null = config.registryId || null;
			if (config.marketId) {
				const market = await queryMarketStandingsDetails(client, config.marketId);
				coinType = market?.coinType ?? null;
				if (market?.registryId) registryId = market.registryId;
			}

			return {
				ssuConfigId,
				owner: config.owner,
				delegates: config.delegates,
				marketId: config.marketId,
				coinType,
				registryId,
				packageId: ssuUnifiedPkg,
				isPublic: config.isPublic,
			};
		},
		enabled: !!ssuObjectId && hasSsuExtension && !!ssuUnifiedPkg,
		staleTime: 60_000,
	});
}
