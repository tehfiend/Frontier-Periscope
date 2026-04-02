import type { AssemblyMetadata } from "@/hooks/useAssembly";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { getTenant, getWorldPackageId, getWorldPublishedAt } from "@/lib/constants";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { type TenantId, getContractAddresses } from "@tehfrontier/chain-shared";
import { Transaction } from "@mysten/sui/transactions";
import { useState } from "react";
import { MarketPicker } from "./MarketPicker";
import { RegistryPicker } from "./RegistryPicker";

interface ExtensionInfoProps {
	extensionType: string | null;
	isOwner: boolean;
	characterObjectId?: string;
	ownerCap?: OwnerCapInfo;
	ssuObjectId?: string;
	/** Existing config from legacy ssu_standings (for pre-filling deploy form). */
	ssuConfig?: SsuConfigResult;
	/** Current on-chain metadata for pre-filling name/URL during deploy. */
	metadata?: AssemblyMetadata | null;
	/** In-game item ID for constructing the dApp URL. */
	itemId?: string | null;
}

/**
 * Display extension type, provide revoke control for owners,
 * and deploy the Periscope SSU extension when none is configured.
 */
export function ExtensionInfo({
	extensionType,
	isOwner,
	characterObjectId,
	ownerCap,
	ssuObjectId,
	ssuConfig,
	metadata,
	itemId,
}: ExtensionInfoProps) {
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	// Deploy form state -- pre-fill from existing legacy config
	const [showDeploy, setShowDeploy] = useState(false);
	const [registryId, setRegistryId] = useState(ssuConfig?.registryId ?? "");
	const [marketId, setMarketId] = useState(ssuConfig?.marketId ?? "");
	const [minDeposit, setMinDeposit] = useState(ssuConfig?.minDeposit ?? 3);
	const [minWithdraw, setMinWithdraw] = useState(ssuConfig?.minWithdraw ?? 3);
	const [ssuName, setSsuName] = useState(metadata?.name ?? "");
	const [setDappUrl, setSetDappUrl] = useState(true);

	const [resetUrl, setResetUrl] = useState(true);

	const canRevoke = extensionType && isOwner && characterObjectId && ownerCap && ssuObjectId && account;
	const canDeploy = !extensionType && isOwner && characterObjectId && ownerCap && ssuObjectId && account;

	async function handleRevoke() {
		if (!confirming) {
			setConfirming(true);
			return;
		}

		if (!characterObjectId || !ownerCap || !ssuObjectId || !account) return;

		setError(null);
		setSuccess(null);

		try {
			const tenant = getTenant();
			const worldPkg = getWorldPublishedAt(tenant);
			const worldType = getWorldPackageId(tenant);
			const tx = new Transaction();
			tx.setSender(account.address);

			// Step 1: Borrow OwnerCap
			const [borrowedCap, receipt] = tx.moveCall({
				target: `${worldPkg}::character::borrow_owner_cap`,
				typeArguments: [`${worldType}::storage_unit::StorageUnit`],
				arguments: [tx.object(characterObjectId), tx.object(ownerCap.objectId)],
			});

			// Step 2: Revoke extension
			tx.moveCall({
				target: `${worldPkg}::storage_unit::revoke_extension_authorization`,
				arguments: [tx.object(ssuObjectId), borrowedCap],
			});

			// Step 3 (optional): Reset dApp URL to blank
			if (resetUrl) {
				tx.moveCall({
					target: `${worldPkg}::storage_unit::update_metadata_url`,
					arguments: [tx.object(ssuObjectId), borrowedCap, tx.pure.string("")],
				});
			}

			// Step 4: Return OwnerCap
			tx.moveCall({
				target: `${worldPkg}::character::return_owner_cap`,
				typeArguments: [`${worldType}::storage_unit::StorageUnit`],
				arguments: [tx.object(characterObjectId), borrowedCap, receipt],
			});

			await signAndExecute(tx);
			setSuccess("Extension removed successfully");
			setConfirming(false);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
			setConfirming(false);
		}
	}

	async function handleDeploy() {
		if (!characterObjectId || !ownerCap || !ssuObjectId || !account || !registryId) return;

		setError(null);
		setSuccess(null);

		try {
			const tenant = getTenant() as TenantId;
			const addrs = getContractAddresses(tenant);
			const ssuUnifiedPkg = addrs.ssuUnified?.packageId;
			if (!ssuUnifiedPkg) throw new Error("ssu_unified not deployed on this tenant");

			const worldPkg = getWorldPublishedAt(tenant);
			const worldType = getWorldPackageId(tenant);
			const witnessType = `${ssuUnifiedPkg}::ssu_unified::SsuUnifiedAuth`;

			const tx = new Transaction();
			tx.setSender(account.address);

			// Step 1: Borrow OwnerCap
			const [borrowedCap, receipt] = tx.moveCall({
				target: `${worldPkg}::character::borrow_owner_cap`,
				typeArguments: [`${worldType}::storage_unit::StorageUnit`],
				arguments: [
					tx.object(characterObjectId),
					tx.receivingRef({
						objectId: ownerCap.objectId,
						version: String(ownerCap.version),
						digest: ownerCap.digest,
					}),
				],
			});

			// Step 2: Authorize ssu_unified extension
			tx.moveCall({
				target: `${worldPkg}::storage_unit::authorize_extension`,
				typeArguments: [witnessType],
				arguments: [tx.object(ssuObjectId), borrowedCap],
			});

			// Step 3: Update metadata name + dApp URL (while OwnerCap is borrowed)
			if (ssuName && ssuName !== (metadata?.name ?? "")) {
				tx.moveCall({
					target: `${worldPkg}::storage_unit::update_metadata_name`,
					arguments: [tx.object(ssuObjectId), borrowedCap, tx.pure.string(ssuName)],
				});
			}
			if (setDappUrl) {
				const tenant = getTenant();
				const dappBase = new URL("https://dapp.frontierperiscope.com/");
				dappBase.searchParams.set("tenant", tenant);
				if (itemId) dappBase.searchParams.set("itemId", itemId);
				const generatedUrl = dappBase.toString();
				if (generatedUrl !== (metadata?.url ?? "")) {
					tx.moveCall({
						target: `${worldPkg}::storage_unit::update_metadata_url`,
						arguments: [tx.object(ssuObjectId), borrowedCap, tx.pure.string(generatedUrl)],
					});
				}
			}

			// Step 4: Return OwnerCap
			tx.moveCall({
				target: `${worldPkg}::character::return_owner_cap`,
				typeArguments: [`${worldType}::storage_unit::StorageUnit`],
				arguments: [tx.object(characterObjectId), borrowedCap, receipt],
			});

			// Step 5: Create SsuUnifiedConfig (with or without market)
			const configArgs = [
				tx.pure.id(ssuObjectId),
				tx.pure.id(registryId),
				tx.pure.u8(minDeposit),
				tx.pure.u8(minWithdraw),
			];

			if (marketId) {
				tx.moveCall({
					target: `${ssuUnifiedPkg}::ssu_unified::create_config_with_market`,
					arguments: [...configArgs, tx.pure.id(marketId)],
				});
			} else {
				tx.moveCall({
					target: `${ssuUnifiedPkg}::ssu_unified::create_config`,
					arguments: configArgs,
				});
			}

			await signAndExecute(tx);
			setSuccess("Extension deployed and config created");
			setShowDeploy(false);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	if (!extensionType && !isOwner) return null;

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h3 className="mb-3 text-sm font-medium text-zinc-300">Extension</h3>

			{extensionType ? (
				<div className="space-y-3">
					<div>
						<p className="text-xs text-zinc-500">Registered Extension</p>
						<p className="mt-0.5 break-all font-mono text-xs text-zinc-300">{extensionType}</p>
					</div>

					{canRevoke && !success && (
						<div className="space-y-2">
							{confirming ? (
								<div className="space-y-2">
									<label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
										<input
											type="checkbox"
											checked={resetUrl}
											onChange={(e) => setResetUrl(e.target.checked)}
											className="rounded border-zinc-600 accent-cyan-500"
										/>
										Reset dApp URL
									</label>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={handleRevoke}
											disabled={isPending}
											className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
										>
											{isPending ? "Removing..." : "Confirm Remove"}
										</button>
										{!isPending && (
											<button
												type="button"
												onClick={() => setConfirming(false)}
												className="text-xs text-zinc-500 hover:text-zinc-300"
											>
												Cancel
											</button>
										)}
									</div>
								</div>
							) : (
								<button
									type="button"
									onClick={handleRevoke}
									className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-600"
								>
									Remove Extension
								</button>
							)}
						</div>
					)}

					{error && <p className="text-xs text-red-400">{error}</p>}
					{success && <p className="text-xs text-emerald-400">{success}</p>}
				</div>
			) : (
				<div className="space-y-3">
					<p className="text-xs text-zinc-600">No extension configured</p>

					{canDeploy && !success && !showDeploy && (
						<button
							type="button"
							onClick={() => setShowDeploy(true)}
							className="rounded-lg bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-600"
						>
							Deploy Periscope SSU
						</button>
					)}

					{showDeploy && canDeploy && (
						<div className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
							<div>
								<label htmlFor="deploy-name" className="mb-1 block text-xs text-zinc-500">
									Structure Name
								</label>
								<input
									id="deploy-name"
									type="text"
									value={ssuName}
									onChange={(e) => setSsuName(e.target.value)}
									placeholder="Storage unit name"
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
							</div>
							<label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
								<input
									type="checkbox"
									checked={setDappUrl}
									onChange={(e) => setSetDappUrl(e.target.checked)}
									className="rounded border-zinc-600 accent-cyan-500"
								/>
								Set Periscope dApp URL
							</label>
							<div>
								<label className="mb-1 block text-xs text-zinc-500">
									Standings Registry *
								</label>
								<RegistryPicker value={registryId} onChange={setRegistryId} />
							</div>
							<div>
								<label className="mb-1 block text-xs text-zinc-500">
									Market (optional)
								</label>
								<MarketPicker value={marketId} onChange={setMarketId} />
							</div>
							<div className="flex gap-4">
								<div className="flex-1">
									<label htmlFor="deploy-min-deposit" className="mb-1 block text-xs text-zinc-500">
										Min Deposit ({minDeposit})
									</label>
									<input
										id="deploy-min-deposit"
										type="range"
										min={0}
										max={6}
										value={minDeposit}
										onChange={(e) => setMinDeposit(Number(e.target.value))}
										className="w-full"
									/>
								</div>
								<div className="flex-1">
									<label
										htmlFor="deploy-min-withdraw"
										className="mb-1 block text-xs text-zinc-500"
									>
										Min Withdraw ({minWithdraw})
									</label>
									<input
										id="deploy-min-withdraw"
										type="range"
										min={0}
										max={6}
										value={minWithdraw}
										onChange={(e) => setMinWithdraw(Number(e.target.value))}
										className="w-full"
									/>
								</div>
							</div>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={handleDeploy}
									disabled={isPending || !registryId}
									className="rounded-lg bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-50"
								>
									{isPending ? "Deploying..." : "Deploy"}
								</button>
								<button
									type="button"
									onClick={() => setShowDeploy(false)}
									className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-600"
								>
									Cancel
								</button>
							</div>
						</div>
					)}

					{error && <p className="text-xs text-red-400">{error}</p>}
					{success && <p className="text-xs text-emerald-400">{success}</p>}
				</div>
			)}
		</div>
	);
}
