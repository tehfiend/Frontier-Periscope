import { useDAppKit } from "@mysten/dapp-kit-react";
import type { Transaction } from "@mysten/sui/transactions";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

/**
 * Wrapper around dapp-kit-react's signAndExecuteTransaction that
 * invalidates SSU-related queries after a successful transaction.
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
				// Invalidate SSU data after successful TX
				queryClient.invalidateQueries({ queryKey: ["assembly"] });
				queryClient.invalidateQueries({ queryKey: ["itemNames"] });
				queryClient.invalidateQueries({ queryKey: ["ownerCap"] });
				queryClient.invalidateQueries({ queryKey: ["ssu-inventories"] });
				queryClient.invalidateQueries({ queryKey: ["marketListings"] });
				queryClient.invalidateQueries({ queryKey: ["marketBuyOrders"] });
				return result;
			} finally {
				setIsPending(false);
			}
		},
		[dAppKit, queryClient],
	);

	return { mutateAsync: execute, isPending };
}
