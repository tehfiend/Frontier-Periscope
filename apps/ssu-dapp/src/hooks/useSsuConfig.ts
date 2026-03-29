import { getTenant } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import {
	type TenantId,
	discoverSsuUnifiedConfig,
	getContractAddresses,
	getObjectJson,
	queryMarketStandingsDetails,
	querySsuStandingsEntry,
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
	/** market_standings package ID (for trade TX builders). */
	marketStandingsPackageId: string | null;
	/** Move module of the linked market: "market_standings" or "market". */
	marketModule: "market_standings" | "market" | null;
	/** Package ID of the linked market (extracted from on-chain type). */
	marketPackageId: string | null;
	isPublic: boolean;
	/** Minimum standing to deposit items (0-6). */
	minDeposit?: number;
	/** Minimum standing to withdraw items (0-6). */
	minWithdraw?: number;
}

/**
 * Discover and query the config for an SSU.
 *
 * Tries the new SsuUnifiedConfig first (per-user owned objects).
 * Falls back to the legacy SsuStandingsConfig shared object for SSUs
 * that haven't been migrated yet.
 */
export function useSsuConfig(
	ssuObjectId: string | null | undefined,
	extensionType: string | null | undefined,
) {
	const client = useSuiClient();

	const hasSsuExtension =
		!!extensionType &&
		(extensionType.includes("::ssu_unified::") ||
			extensionType.includes("::ssu_market::") ||
			extensionType.includes("::ssu_standings::"));

	return useQuery({
		queryKey: ["ssu-config", ssuObjectId],
		queryFn: async (): Promise<SsuConfigResult | null> => {
			if (!ssuObjectId) return null;

			const tenant = getTenant() as TenantId;
			const addrs = getContractAddresses(tenant);

			// ── Try new SsuUnifiedConfig first ──────────────────────────
			const ssuUnified = addrs.ssuUnified;
			if (ssuUnified?.packageId) {
				const configId = await discoverSsuUnifiedConfig(
					client,
					ssuUnified.packageId,
					ssuObjectId,
					ssuUnified.previousOriginalPackageIds,
				);

				if (configId) {
					const config = await querySsuUnifiedConfig(client, configId);
					if (config) {
						// Resolve coinType and market module from linked Market<T>
						let coinType: string | null = null;
						let marketModule: "market_standings" | "market" | null = null;
						let marketPackageId: string | null = null;
						if (config.marketId) {
							try {
								const obj = await getObjectJson(client, config.marketId);
								// Match "PKG::market_standings::Market<COIN>" or "PKG::market::Market<COIN>"
								const match = obj.type?.match(
									/^(.+?)::(market_standings|market)::Market<(.+)>$/,
								);
								if (match) {
									marketModule = match[2] as "market_standings" | "market";
									coinType = match[3];
									// The type string has the original/defining package ID, but
									// function calls need the latest upgraded package ID from config
									marketPackageId =
										marketModule === "market_standings"
											? (addrs.marketStandings?.packageId ?? match[1])
											: (addrs.market?.packageId ?? match[1]);
								}
							} catch {
								// non-fatal
							}
						}

						return {
							ssuConfigId: config.objectId,
							owner: config.owner,
							delegates: config.delegates,
							marketId: config.marketId,
							coinType,
							registryId: config.registryId || null,
							packageId: ssuUnified.packageId,
							marketStandingsPackageId: addrs.marketStandings?.packageId || null,
							marketModule,
							marketPackageId,
							isPublic: config.isPublic,
							minDeposit: config.minDeposit,
							minWithdraw: config.minWithdraw,
						};
					}
				}
			}

			// ── Fallback: legacy SsuStandingsConfig (shared object) ─────
			const ssuStandings = addrs.ssuStandings;
			if (ssuStandings?.configObjectId) {
				const entry = await querySsuStandingsEntry(
					client,
					ssuStandings.configObjectId,
					ssuStandings.packageId,
					ssuObjectId,
				);
				if (entry) {
					return {
						ssuConfigId: ssuStandings.configObjectId,
						owner: entry.configOwner,
						delegates: [],
						marketId: null,
						coinType: null,
						registryId: entry.registryId || null,
						packageId: ssuStandings.packageId,
						marketStandingsPackageId: addrs.marketStandings?.packageId || null,
						marketModule: null,
						marketPackageId: null,
						isPublic: true,
						minDeposit: entry.minDeposit,
						minWithdraw: entry.minWithdraw,
					};
				}
			}

			return null;
		},
		enabled: !!ssuObjectId && hasSsuExtension,
		staleTime: 60_000,
	});
}
