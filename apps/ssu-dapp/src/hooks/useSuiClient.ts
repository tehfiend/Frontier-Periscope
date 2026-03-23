import { useCurrentClient } from "@mysten/dapp-kit-react";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";

/**
 * Typed wrapper for useCurrentClient() that returns SuiGraphQLClient.
 * At runtime, the DAppKit createClient callback returns SuiGraphQLClient,
 * but TypeScript erases the generic and returns ClientWithCoreApi.
 *
 * The double cast (as unknown as SuiGraphQLClient) is needed because
 * dApp-kit's useCurrentClient() returns `ClientWithCoreApi` which is
 * structurally incompatible with `SuiGraphQLClient` at the type level,
 * even though the actual runtime object IS a SuiGraphQLClient created
 * via our createClient callback in main.tsx.
 */
export function useSuiClient(): SuiGraphQLClient {
	const client = useCurrentClient() as unknown as SuiGraphQLClient;
	// biome-ignore lint/suspicious/noExplicitAny: runtime type guard for double-cast safety
	if (typeof (client as any).query !== "function") {
		throw new Error(
			"useSuiClient: returned client does not have a query method. " +
				"Ensure DAppKitProvider is configured with a SuiGraphQLClient.",
		);
	}
	return client;
}
