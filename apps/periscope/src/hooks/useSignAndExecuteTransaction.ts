import { useDAppKit } from "@mysten/dapp-kit-react";
import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import type { Transaction } from "@mysten/sui/transactions";

/**
 * Compatibility shim: replaces @mysten/dapp-kit v0.20 useSignAndExecuteTransaction
 * with dapp-kit-react v2 useDAppKit().signAndExecuteTransaction, wrapped in useMutation.
 */
export function useSignAndExecuteTransaction(): UseMutationResult<
	unknown,
	Error,
	{ transaction: Transaction }
> {
	const dAppKit = useDAppKit();

	return useMutation({
		mutationFn: (args: { transaction: Transaction }) =>
			dAppKit.signAndExecuteTransaction({ transaction: args.transaction }),
	});
}
