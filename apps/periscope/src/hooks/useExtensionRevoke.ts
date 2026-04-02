import type { AssemblyKind, TenantId } from "@/chain/config";
import { ASSEMBLY_MODULE_MAP, buildRemoveExtension } from "@/chain/transactions";
import { db } from "@/db";
import { walletErrorMessage } from "@/lib/format";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useState } from "react";

export type RevokeStatus = "idle" | "building" | "signing" | "confirming" | "done" | "error";

interface RevokeResult {
	txDigest?: string;
	error?: string;
}

/** Assembly types that support extension removal (network_node does NOT). */
const REVOCABLE_TYPES = new Set<AssemblyKind>([
	"turret",
	"gate",
	"storage_unit",
	"smart_storage_unit",
	"protocol_depot",
]);

export function canRevokeExtension(assemblyType: string): boolean {
	return REVOCABLE_TYPES.has(assemblyType as AssemblyKind);
}

export function useExtensionRevoke() {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const [status, setStatus] = useState<RevokeStatus>("idle");
	const [result, setResult] = useState<RevokeResult>({});

	async function revoke(params: {
		assemblyId: string;
		assemblyType: string;
		characterId: string;
		ownerCapId: string;
		tenant: TenantId;
		resetUrl?: boolean;
		senderAddress?: string;
	}) {
		const sender = params.senderAddress ?? account?.address;
		if (!sender) throw new Error("Wallet not connected");

		const { assemblyId, assemblyType, characterId, ownerCapId, tenant, resetUrl } = params;

		// Validate assembly type is in the module map and is revocable
		if (!(assemblyType in ASSEMBLY_MODULE_MAP)) {
			throw new Error(`Assembly type "${assemblyType}" is not supported`);
		}

		if (!canRevokeExtension(assemblyType)) {
			throw new Error(`Extension removal not supported for ${assemblyType}`);
		}

		setStatus("building");
		setResult({});

		try {
			const tx = buildRemoveExtension({
				tenant,
				assemblyType: assemblyType as AssemblyKind,
				assemblyId,
				characterId,
				ownerCapId,
				senderAddress: sender,
				resetUrl,
			});

			setStatus("signing");
			const txResult = await signAndExecute({ transaction: tx });

			const txDigest = txResult.Transaction?.digest ?? "";
			if (!txDigest) {
				setStatus("error");
				setResult({ error: "Transaction failed on-chain" });
				throw new Error("Transaction failed on-chain");
			}
			setStatus("done");
			setResult({ txDigest });

			// Soft-delete local extension record for this assembly
			const extensionRecords = await db.extensions.where("assemblyId").equals(assemblyId).toArray();
			const now = new Date().toISOString();
			for (const ext of extensionRecords) {
				await db.extensions.update(ext.id, { _deleted: true, updatedAt: now });
			}
		} catch (err) {
			setStatus("error");
			setResult({ error: walletErrorMessage(err) });
			throw err;
		}
	}

	function reset() {
		setStatus("idle");
		setResult({});
	}

	return {
		revoke,
		reset,
		status,
		txDigest: result.txDigest,
		error: result.error,
	};
}
