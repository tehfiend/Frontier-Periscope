import type { AssemblyKind, ExtensionTemplate, TenantId } from "@/chain/config";
import { buildAuthorizeExtension } from "@/chain/transactions";
import { db } from "@/db";
import type { StructureExtensionConfig } from "@/db/types";
import { walletErrorMessage } from "@/lib/format";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useState } from "react";

export type DeployStatus = "idle" | "building" | "signing" | "confirming" | "done" | "error";

interface DeployResult {
	txDigest?: string;
	error?: string;
}

export function useExtensionDeploy() {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const [status, setStatus] = useState<DeployStatus>("idle");
	const [result, setResult] = useState<DeployResult>({});

	async function deploy(params: {
		template: ExtensionTemplate;
		assemblyId: string;
		assemblyType: AssemblyKind;
		characterId: string;
		ownerCapId: string;
		tenant: TenantId;
		/** Standings config for new-style extensions */
		standingsConfig?: Partial<StructureExtensionConfig>;
		/** Update structure name during authorization */
		newName?: string;
		/** Update dApp URL during authorization */
		newUrl?: string;
	}) {
		if (!account) return;

		setStatus("building");
		setResult({});

		try {
			// Build authorize transaction
			const tx = buildAuthorizeExtension({
				tenant: params.tenant,
				template: params.template,
				assemblyType: params.assemblyType,
				assemblyId: params.assemblyId,
				characterId: params.characterId,
				ownerCapId: params.ownerCapId,
				senderAddress: account.address,
				newName: params.newName,
				newUrl: params.newUrl,
			});

			setStatus("signing");
			const authResult = await signAndExecute({ transaction: tx });

			setStatus("done");
			const txDigest = authResult.Transaction?.digest ?? authResult.FailedTransaction?.digest ?? "";
			setResult({ txDigest });

			// Record in IndexedDB
			const now = new Date().toISOString();
			await db.extensions.put({
				id: `${params.assemblyId}-${params.template.id}`,
				assemblyId: params.assemblyId,
				assemblyType: params.assemblyType,
				templateId: params.template.id,
				templateName: params.template.name,
				status: "authorized",
				txDigest,
				authorizedAt: now,
				owner: account.address,
				createdAt: now,
				updatedAt: now,
			});

			// Write standings config to structureExtensionConfigs if provided
			if (params.standingsConfig?.registryId) {
				await db.structureExtensionConfigs.put({
					id: params.assemblyId,
					assemblyId: params.assemblyId,
					assemblyType: params.assemblyType,
					registryId: params.standingsConfig.registryId,
					registryName: params.standingsConfig.registryName,
					...params.standingsConfig,
				} as StructureExtensionConfig);
			}
		} catch (err) {
			setStatus("error");
			setResult({ error: walletErrorMessage(err) });
		}
	}

	function reset() {
		setStatus("idle");
		setResult({});
	}

	return {
		deploy,
		reset,
		status,
		txDigest: result.txDigest,
		error: result.error,
	};
}
