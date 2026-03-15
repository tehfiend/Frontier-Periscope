import { useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { buildAuthorizeExtension, buildConfigureTribeGate } from "@/chain/transactions";
import type { ExtensionTemplate, TenantId } from "@/chain/config";
import { db } from "@/db";

export type DeployStatus = "idle" | "building" | "signing" | "confirming" | "done" | "error";

interface DeployResult {
	txDigest?: string;
	error?: string;
}

export function useExtensionDeploy() {
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
	const [status, setStatus] = useState<DeployStatus>("idle");
	const [result, setResult] = useState<DeployResult>({});

	async function deploy(params: {
		template: ExtensionTemplate;
		assemblyId: string;
		assemblyType: "turret" | "gate" | "storage_unit" | "network_node";
		characterId: string;
		ownerCapId: string;
		tenant: TenantId;
		config?: {
			allowedTribes?: number[];
			permitDurationMs?: number;
		};
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
			});

			setStatus("signing");
			const authResult = await signAndExecute({ transaction: tx });

			// If template has config, build and submit config transaction
			if (params.template.hasConfig && params.config) {
				if (params.template.id === "gate_tribe" && params.config.allowedTribes) {
					setStatus("building");
					const configTx = buildConfigureTribeGate({
						tenant: params.tenant,
						template: params.template,
						gateId: params.assemblyId,
						allowedTribes: params.config.allowedTribes,
						permitDurationMs: params.config.permitDurationMs ?? 600_000,
						senderAddress: account.address,
					});

					setStatus("signing");
					await signAndExecute({ transaction: configTx });
				}
			}

			setStatus("done");
			const txDigest = authResult.digest;
			setResult({ txDigest });

			// Record in IndexedDB
			const now = new Date().toISOString();
			await db.extensions.put({
				id: `${params.assemblyId}-${params.template.id}`,
				assemblyId: params.assemblyId,
				assemblyType: params.assemblyType,
				templateId: params.template.id,
				templateName: params.template.name,
				status: params.template.hasConfig && params.config ? "configured" : "authorized",
				txDigest,
				configuration: params.config as Record<string, unknown> | undefined,
				authorizedAt: now,
				owner: account.address,
				createdAt: now,
				updatedAt: now,
			});

			// Auto-create permission policy for ACL extensions
			const isAclTemplate = params.template.id === "gate_acl";
			if (isAclTemplate) {
				const existingPolicy = await db.assemblyPolicies.get(params.assemblyId);
				if (!existingPolicy) {
					await db.assemblyPolicies.put({
						id: params.assemblyId,
						assemblyId: params.assemblyId,
						assemblyType: params.assemblyType,
						mode: "allowlist",
						groupIds: ["__self__"],
						permitDurationMs: params.assemblyType === "gate" ? 600_000 : undefined,
						syncStatus: "draft",
						extensionTemplateId: params.template.id,
						createdAt: now,
						updatedAt: now,
					});
				}
			}
		} catch (err) {
			setStatus("error");
			setResult({ error: err instanceof Error ? err.message : String(err) });
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
