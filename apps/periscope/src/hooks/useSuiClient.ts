import { useCurrentClient } from "@mysten/dapp-kit-react";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";

/**
 * Typed wrapper for useCurrentClient() that returns SuiGraphQLClient.
 * At runtime, the DAppKit createClient callback returns SuiGraphQLClient,
 * but TypeScript erases the generic and returns ClientWithCoreApi.
 * This cast is safe because WalletProvider always creates SuiGraphQLClient.
 */
export function useSuiClient(): SuiGraphQLClient {
	return useCurrentClient() as unknown as SuiGraphQLClient;
}
