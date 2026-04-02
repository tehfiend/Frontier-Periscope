import type { AssemblyKind, ExtensionTemplate, TenantId } from "@/chain/config";
import { getAssemblyExtension } from "@/chain/queries";
import { buildAuthorizeExtension } from "@/chain/transactions";
import { db } from "@/db";
import type { StructureExtensionConfig } from "@/db/types";
import { useSuiClient } from "@/hooks/useSuiClient";
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
	const suiClient = useSuiClient();
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

			const txDigest = authResult.Transaction?.digest ?? "";
			if (!txDigest) {
				setStatus("error");
				setResult({ error: "Transaction failed on-chain" });
				return;
			}

			// Verify the extension was actually set on-chain (retry for indexer lag)
			setStatus("confirming");
			let chainExtension: string | null = null;
			for (let attempt = 0; attempt < 5; attempt++) {
				chainExtension = await getAssemblyExtension(suiClient, params.assemblyId);
				if (chainExtension) break;
				await new Promise((r) => setTimeout(r, 2000));
			}
			if (!chainExtension) {
				setStatus("error");
				setResult({ error: "Extension not confirmed on-chain" });
				return;
			}

			setStatus("done");
			setResult({ txDigest });

			// Record chain-confirmed state in IndexedDB
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

			// Update deployable/assembly with chain-confirmed extensionType
			const existing = await db.deployables.where("objectId").equals(params.assemblyId).first();
			if (existing) {
				await db.deployables.update(existing.id, { extensionType: chainExtension, updatedAt: now });
			} else {
				const existingAsm = await db.assemblies.where("objectId").equals(params.assemblyId).first();
				if (existingAsm) {
					await db.assemblies.update(existingAsm.id, { extensionType: chainExtension, updatedAt: now });
				}
			}

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
