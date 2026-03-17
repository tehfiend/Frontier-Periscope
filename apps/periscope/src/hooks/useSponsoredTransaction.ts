import { useDAppKit } from "@mysten/dapp-kit-react";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { TENANTS } from "@/chain/config";
import type { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";

/**
 * Hook for executing sponsored transactions.
 *
 * Flow:
 *   1. Build Transaction with user as sender
 *   2. Serialize to bytes
 *   3. POST /sponsor → get sponsor's signature
 *   4. User signs via wallet (signTransaction, not signAndExecute)
 *   5. Execute with both signatures
 */
export function useSponsoredTransaction() {
	const dAppKit = useDAppKit();
	const client = useSuiClient();
	const tenant = useActiveTenant();
	const gasStationUrl = TENANTS[tenant].gasStationUrl;

	async function executeSponsored(tx: Transaction): Promise<{ digest: string }> {
		if (!gasStationUrl) {
			throw new Error(`Gas station URL not configured for tenant "${tenant}"`);
		}

		// Build the transaction bytes for the sponsor to inspect + sign
		const txBytes = await tx.build({ client });
		const txBytesBase64 = toBase64(txBytes);

		// Get sponsor signature from gas station
		const sponsorRes = await fetch(`${gasStationUrl}/sponsor`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ txBytes: txBytesBase64 }),
		});

		if (!sponsorRes.ok) {
			const err = await sponsorRes.json().catch(() => ({ error: "Gas station error" }));
			throw new Error(err.error ?? `Sponsor request failed: ${sponsorRes.status}`);
		}

		const { sponsorSignature } = (await sponsorRes.json()) as { sponsorSignature: string };

		// User signs the same transaction
		const { signature: userSignature } = await dAppKit.signTransaction({ transaction: tx });

		// Execute with both signatures via GraphQL client
		const result = await client.executeTransaction({
			transaction: txBytes,
			signatures: [userSignature, sponsorSignature],
		});

		// Extract digest from the transaction result
		const txData = result.Transaction ?? result.FailedTransaction;
		const digest = txData?.digest ?? "";
		return { digest };
	}

	return {
		executeSponsored,
		available: !!gasStationUrl,
	};
}
