import { useDAppKit } from "@mysten/dapp-kit-react";
import type { Transaction } from "@mysten/sui/transactions";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

/**
 * Wrapper around dapp-kit-react's signAndExecuteTransaction that
 * invalidates market-related queries after a successful transaction.
 */
export function useSignAndExecute(): {
	mutateAsync: (tx: Transaction) => Promise<unknown>;
	isPending: boolean;
} {
	const dAppKit = useDAppKit();
	const queryClient = useQueryClient();
	const [isPending, setIsPending] = useState(false);

	const execute = useCallback(
		async (tx: Transaction) => {
			setIsPending(true);
			try {
				const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
				// Invalidate market data after successful TX
				queryClient.invalidateQueries({ queryKey: ["sellOrders"] });
				queryClient.invalidateQueries({ queryKey: ["marketConfig"] });
				queryClient.invalidateQueries({ queryKey: ["ssuInventory"] });
				queryClient.invalidateQueries({ queryKey: ["currencyMarkets"] });
				queryClient.invalidateQueries({ queryKey: ["currencyMarketListings"] });
				queryClient.invalidateQueries({ queryKey: ["currencyMarketBuyOrders"] });
				return result;
			} finally {
				setIsPending(false);
			}
		},
		[dAppKit, queryClient],
	);

	return { mutateAsync: execute, isPending };
}
