import { db } from "@/db";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import {
	type BuyOrderInfo,
	type OrgMarketInfo,
	type TenantId,
	discoverOrgMarket,
	getContractAddresses,
	queryBuyOrders,
	queryOrgMarket,
} from "@tehfrontier/chain-shared";

interface OrgMarketData {
	orgMarketId: string | null;
	orgMarketInfo: OrgMarketInfo | null;
	buyOrders: BuyOrderInfo[];
}

/** Minimal org shape needed by this hook */
interface OrgLike {
	id: string;
	chainObjectId?: string;
	orgMarketId?: string;
}

export function useOrgMarket(org: OrgLike | undefined, tenant: TenantId) {
	const client = useCurrentClient();
	const ssuMarketPkgId = getContractAddresses(tenant).ssuMarket?.packageId;

	const { data, isLoading, error, refetch } = useQuery<OrgMarketData>({
		queryKey: ["orgMarket", org?.id, tenant],
		staleTime: 60_000,
		enabled: !!org?.chainObjectId && !!ssuMarketPkgId,
		queryFn: async (): Promise<OrgMarketData> => {
			const nullResult: OrgMarketData = {
				orgMarketId: null,
				orgMarketInfo: null,
				buyOrders: [],
			};

			if (!org?.chainObjectId || !ssuMarketPkgId) return nullResult;

			// 1. Resolve orgMarketId: check local, then discover
			let orgMarketId = org.orgMarketId ?? null;

			if (!orgMarketId) {
				const discovered = await discoverOrgMarket(client, ssuMarketPkgId, org.chainObjectId);
				if (discovered) {
					orgMarketId = discovered;
					await db.organizations.update(org.id, {
						orgMarketId: discovered,
					});
				}
			}

			if (!orgMarketId) return nullResult;

			// 2. Fetch OrgMarket info
			const info = await queryOrgMarket(client, orgMarketId);
			if (!info) {
				// Object deleted or invalid — clear cache
				await db.organizations.update(org.id, {
					orgMarketId: undefined,
				});
				return nullResult;
			}

			// 3. Fetch buy orders
			const orders = await queryBuyOrders(client, orgMarketId);

			return { orgMarketId, orgMarketInfo: info, buyOrders: orders };
		},
	});

	return {
		orgMarketId: data?.orgMarketId ?? null,
		orgMarketInfo: data?.orgMarketInfo ?? null,
		buyOrders: data?.buyOrders ?? [],
		isLoading,
		error: error as Error | null,
		refetch,
	};
}
