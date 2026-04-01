import { TENANTS, type TenantId, getWorldTarget } from "@/chain/config";
import { buildConfigureGateStandings, buildConfigureSsuStandings } from "@/chain/transactions";
import { ContactPicker } from "@/components/ContactPicker";
import { db } from "@/db";
import type { StructureExtensionConfig } from "@/db/types";
import { useSuiClient } from "@/hooks/useSuiClient";
import { walletErrorMessage } from "@/lib/format";
import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import {
	ASSEMBLY_MODULE_MAP,
	REGISTRY_STANDING_LABELS,
	discoverSsuUnifiedConfig,
	getContractAddresses,
	standingToDisplay,
} from "@tehfrontier/chain-shared";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle, CheckCircle2, Loader2, Settings2, Vault } from "lucide-react";
import { useMemo, useState } from "react";
import { CurrencySelector } from "./CurrencySelector";
import { MarketSelector } from "./MarketSelector";
import { RegistrySelector } from "./RegistrySelector";
import { TurretPublishFlow } from "./TurretPublishFlow";

// ── Types ───────────────────────────────────────────────────────────────────

interface StandingsExtensionPanelProps {
	assemblyId: string;
	assemblyType: string;
	/** "gate" | "storage_unit" | "turret" -- the structure category for config sections */
	structureKind: "gate" | "ssu" | "turret";
	tenant: TenantId;
	/** Character Sui object ID (needed for turret publish flow and metadata updates) */
	characterId?: string;
	/** OwnerCap object ID (needed for turret publish flow and metadata updates) */
	ownerCapId?: string;
	/** Existing config (if reconfiguring) */
	existingConfig?: StructureExtensionConfig;
	onConfigured?: () => void;
	/** Update structure name during config apply */
	newName?: string;
	/** Update dApp URL during config apply */
	newUrl?: string;
}

type ConfigStatus = "idle" | "building" | "signing" | "confirming" | "done" | "error";

// ── Standing Slider ─────────────────────────────────────────────────────────

function StandingSlider({
	label,
	value,
	onChange,
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
}) {
	const displayVal = standingToDisplay(value);
	const standingName = REGISTRY_STANDING_LABELS.get(value) ?? `${value}`;

	return (
		<div>
			<label className="mb-1.5 block text-xs font-medium text-zinc-400">
				{label}: <span className="text-zinc-200">{standingName}</span>
				<span className="ml-1 text-zinc-600">
					({displayVal >= 0 ? "+" : ""}
					{displayVal})
				</span>
			</label>
			<input
				type="range"
				min={0}
				max={6}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="w-full accent-cyan-500"
			/>
			<div className="mt-0.5 flex justify-between text-[10px] text-zinc-600">
				<span>Opposition</span>
				<span>Neutral</span>
				<span>Full Trust</span>
			</div>
		</div>
	);
}

// ── Gate Config ─────────────────────────────────────────────────────────────

function GateStandingsConfig({
	values,
	onChange,
	account,
	resolvedTreasuryId,
	currencies,
}: {
	values: GateConfigValues;
	onChange: (v: GateConfigValues) => void;
	account: { address: string } | null;
	resolvedTreasuryId: string | null;
	currencies: Array<{ coinType: string; symbol: string }> | undefined;
}) {
	const durationMinutes = Math.round(Number(values.permitDurationMs) / 60_000);
	const isCustomCurrency = !!values.tollCoinType;

	// Resolve the selected currency symbol for the toll fee label
	const currencySymbol = useMemo(() => {
		if (!values.tollCoinType) return "SUI";
		const match = (currencies ?? []).find((c) => c.coinType === values.tollCoinType);
		return match?.symbol ?? "TOKEN";
	}, [values.tollCoinType, currencies]);

	return (
		<div className="space-y-4">
			<StandingSlider
				label="Min Access"
				value={values.minAccess}
				onChange={(v) => onChange({ ...values, minAccess: v })}
			/>
			<StandingSlider
				label="Free Access"
				value={values.freeAccess}
				onChange={(v) => onChange({ ...values, freeAccess: v })}
			/>

			{/* Toll Currency */}
			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">Toll Currency</label>
				<CurrencySelector
					value={values.tollCoinType}
					onChange={(coinType) =>
						onChange({
							...values,
							tollCoinType: coinType,
							// Reset revenue destination to direct when switching to SUI
							// (treasury deposits are only for custom currencies)
							revenueDestination: coinType ? values.revenueDestination : "direct",
							tollTreasuryId: coinType ? values.tollTreasuryId : undefined,
						})
					}
				/>
				<p className="mt-1 text-xs text-zinc-600">Select a custom currency or use SUI (default).</p>
			</div>

			{/* Toll Fee */}
			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">
					Toll Fee ({currencySymbol})
				</label>
				<input
					type="text"
					value={values.tollFee}
					onChange={(e) => onChange({ ...values, tollFee: e.target.value })}
					placeholder="0"
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>

			{/* Revenue Destination (only for custom currency) */}
			{isCustomCurrency && (
				<div>
					<label className="mb-1.5 block text-xs font-medium text-zinc-400">
						<Vault size={12} className="mr-1 inline" />
						Revenue Destination
					</label>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() =>
								onChange({
									...values,
									revenueDestination: "direct",
									tollTreasuryId: undefined,
								})
							}
							className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
								values.revenueDestination === "direct"
									? "border-cyan-500 bg-cyan-950/30 text-cyan-300"
									: "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
							}`}
						>
							Direct to address
						</button>
						<button
							type="button"
							onClick={() => onChange({ ...values, revenueDestination: "treasury" })}
							className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
								values.revenueDestination === "treasury"
									? "border-cyan-500 bg-cyan-950/30 text-cyan-300"
									: "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
							}`}
						>
							Deposit to treasury
						</button>
					</div>
				</div>
			)}

			{/* Treasury info (custom currency + treasury destination) */}
			{isCustomCurrency && values.revenueDestination === "treasury" && (
				<div>
					{resolvedTreasuryId ? (
						<p className="rounded border border-zinc-700 bg-zinc-800/50 px-3 py-2 font-mono text-xs text-zinc-400">
							Treasury: {resolvedTreasuryId.slice(0, 16)}...
						</p>
					) : (
						<p className="rounded border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-400">
							Selected currency has no treasury.
						</p>
					)}
				</div>
			)}

			{/* Toll Recipient (direct mode or SUI) */}
			{(!isCustomCurrency || values.revenueDestination === "direct") && (
				<div>
					<label className="mb-1.5 block text-xs font-medium text-zinc-400">Toll Recipient</label>
					<ContactPicker
						placeholder="Search character or paste address..."
						onSelect={(char) => onChange({ ...values, tollRecipient: char.suiAddress })}
					/>
					<input
						type="text"
						value={values.tollRecipient}
						onChange={(e) => onChange({ ...values, tollRecipient: e.target.value })}
						placeholder="0x..."
						className="mt-1.5 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</div>
			)}

			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">
					Permit Duration: {durationMinutes} min
				</label>
				<input
					type="range"
					min={1}
					max={60}
					value={durationMinutes}
					onChange={(e) =>
						onChange({ ...values, permitDurationMs: BigInt(Number(e.target.value) * 60_000) })
					}
					className="w-full accent-cyan-500"
				/>
				<div className="mt-0.5 flex justify-between text-[10px] text-zinc-600">
					<span>1 min</span>
					<span>60 min</span>
				</div>
			</div>
		</div>
	);
}

// ── SSU Config ──────────────────────────────────────────────────────────────

function SsuStandingsConfig({
	values,
	onChange,
	hasRegistry,
}: {
	values: SsuConfigValues;
	onChange: (v: SsuConfigValues) => void;
	hasRegistry: boolean;
}) {
	return (
		<div className="space-y-4">
			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">
					Market (optional)
				</label>
				<MarketSelector
					value={values.marketId}
					onChange={(marketId) => onChange({ ...values, marketId })}
				/>
				<p className="mt-1 text-xs text-zinc-600">
					Link a Market object to enable trading on this SSU.
				</p>
			</div>

			{hasRegistry && (
				<>
					<StandingSlider
						label="Min Deposit Standing"
						value={values.minDeposit}
						onChange={(v) => onChange({ ...values, minDeposit: v })}
					/>
					<StandingSlider
						label="Min Withdraw Standing"
						value={values.minWithdraw}
						onChange={(v) => onChange({ ...values, minWithdraw: v })}
					/>
				</>
			)}

			{!hasRegistry && values.marketId && (
				<p className="text-xs text-zinc-500">
					Select a standings registry above to control who can deposit and withdraw.
					Without one, the SSU is open to everyone.
				</p>
			)}
		</div>
	);
}

// ── Config Value Types ──────────────────────────────────────────────────────

type RevenueDestination = "direct" | "treasury";

interface GateConfigValues {
	minAccess: number;
	freeAccess: number;
	tollFee: string;
	tollRecipient: string;
	permitDurationMs: bigint;
	/** Custom toll currency coin type (undefined = SUI via gate-standings) */
	tollCoinType?: string;
	/** Treasury object ID for toll revenue deposit (custom currency only) */
	tollTreasuryId?: string;
	/** Revenue destination: "direct" (address) or "treasury" */
	revenueDestination: RevenueDestination;
}

interface SsuConfigValues {
	minDeposit: number;
	minWithdraw: number;
	marketId: string;
}

// ── Main Panel ──────────────────────────────────────────────────────────────

export function StandingsExtensionPanel({
	assemblyId,
	assemblyType,
	structureKind,
	tenant,
	characterId,
	ownerCapId,
	existingConfig,
	onConfigured,
	newName,
	newUrl,
}: StandingsExtensionPanelProps) {
	// Early return for turrets -- delegate to TurretPublishFlow
	if (structureKind === "turret") {
		return (
			<TurretPublishFlow
				assemblyId={assemblyId}
				assemblyType={assemblyType}
				characterId={characterId ?? ""}
				ownerCapId={ownerCapId ?? ""}
				tenant={tenant}
				existingConfig={existingConfig}
				onConfigured={onConfigured}
			/>
		);
	}

	return (
		<StandingsExtensionPanelInner
			assemblyId={assemblyId}
			assemblyType={assemblyType}
			structureKind={structureKind}
			tenant={tenant}
			characterId={characterId}
			ownerCapId={ownerCapId}
			existingConfig={existingConfig}
			onConfigured={onConfigured}
			newName={newName}
			newUrl={newUrl}
		/>
	);
}

/** Inner panel for gate/SSU standings configuration (uses hooks, cannot be after early return). */
function StandingsExtensionPanelInner({
	assemblyId,
	assemblyType,
	structureKind,
	tenant,
	characterId,
	ownerCapId,
	existingConfig,
	onConfigured,
	newName,
	newUrl,
}: Omit<StandingsExtensionPanelProps, never>) {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute, connectWallet } = useDAppKit();
	const wallets = useWallets();
	const suiClient = useSuiClient();

	// Registry selection
	const [registryId, setRegistryId] = useState<string | null>(existingConfig?.registryId ?? null);

	// Gate config
	const [gateConfig, setGateConfig] = useState<GateConfigValues>({
		minAccess: existingConfig?.minAccess ?? 1,
		freeAccess: existingConfig?.freeAccess ?? 4,
		tollFee: existingConfig?.tollFee ?? "0",
		tollRecipient: existingConfig?.tollRecipient ?? account?.address ?? "",
		permitDurationMs: BigInt(existingConfig?.permitDurationMs ?? 600_000),
		tollCoinType: existingConfig?.tollCoinType,
		tollTreasuryId: existingConfig?.tollTreasuryId,
		revenueDestination: existingConfig?.tollTreasuryId ? "treasury" : "direct",
	});

	// SSU config
	const [ssuConfig, setSsuConfig] = useState<SsuConfigValues>({
		minDeposit: existingConfig?.minDeposit ?? 3,
		minWithdraw: existingConfig?.minWithdraw ?? 3,
		marketId: existingConfig?.marketId ?? "",
	});

	// Resolve treasury ID from the selected toll currency
	const currencies = useLiveQuery(() => db.currencies.filter((c) => !c._archived).toArray(), []);
	const resolvedTreasuryId = useMemo(() => {
		if (!gateConfig.tollCoinType) return null;
		const match = (currencies ?? []).find((c) => c.coinType === gateConfig.tollCoinType);
		return match?.treasuryId ?? null;
	}, [gateConfig.tollCoinType, currencies]);

	const [status, setStatus] = useState<ConfigStatus>("idle");
	const [error, setError] = useState<string | null>(null);

	const isConfiguring = status === "building" || status === "signing" || status === "confirming";

	/** Record extension in db.extensions + update deployable extensionType so the datagrid detects it. */
	async function recordExtension(owner: string) {
		const templateId = structureKind === "gate" ? "gate_standings" : "ssu_unified";
		const templateName = structureKind === "gate" ? "Periscope Gate" : "Periscope SSU";
		const addrs = getContractAddresses(tenant);
		const contractKey = structureKind === "gate" ? addrs.gateStandings : addrs.ssuUnified;
		const pkgId = contractKey?.packageId ?? "";
		const witnessType = structureKind === "gate"
			? "gate_standings::GateStandingsAuth"
			: "ssu_unified::SsuUnifiedAuth";
		const extensionType = pkgId ? `${pkgId}::${witnessType}` : undefined;

		const now = new Date().toISOString();
		await db.extensions.put({
			id: `${assemblyId}-${templateId}`,
			assemblyId,
			assemblyType: assemblyType as "turret" | "gate" | "storage_unit" | "smart_storage_unit" | "network_node" | "protocol_depot",
			templateId,
			templateName,
			status: "authorized",
			txDigest: "",
			authorizedAt: now,
			owner,
			createdAt: now,
			updatedAt: now,
		});

		// Also update the deployable record's extensionType directly
		if (extensionType) {
			const existing = await db.deployables.where("objectId").equals(assemblyId).first();
			if (existing) {
				await db.deployables.update(existing.id, { extensionType, updatedAt: now });
			} else {
				const existingAsm = await db.assemblies.where("objectId").equals(assemblyId).first();
				if (existingAsm) {
					await db.assemblies.update(existingAsm.id, { extensionType, updatedAt: now });
				}
			}
		}
	}

	/** Append OwnerCap borrow -> metadata update -> return to an existing TX. */
	function appendMetadataUpdates(tx: Transaction) {
		if ((!newName && !newUrl) || !characterId || !ownerCapId) return;

		const worldPkg = TENANTS[tenant].worldPackageId;
		const worldTarget = getWorldTarget(tenant);
		const entry = ASSEMBLY_MODULE_MAP[assemblyType as keyof typeof ASSEMBLY_MODULE_MAP];
		if (!entry) return;

		const fullType = `${worldPkg}::${entry.module}::${entry.type}`;

		const [borrowedCap, receipt] = tx.moveCall({
			target: `${worldTarget}::character::borrow_owner_cap`,
			typeArguments: [fullType],
			arguments: [tx.object(characterId), tx.object(ownerCapId)],
		});

		if (newName) {
			tx.moveCall({
				target: `${worldTarget}::${entry.module}::update_metadata_name`,
				arguments: [tx.object(assemblyId), borrowedCap, tx.pure.string(newName)],
			});
		}
		if (newUrl) {
			tx.moveCall({
				target: `${worldTarget}::${entry.module}::update_metadata_url`,
				arguments: [tx.object(assemblyId), borrowedCap, tx.pure.string(newUrl)],
			});
		}

		tx.moveCall({
			target: `${worldTarget}::character::return_owner_cap`,
			typeArguments: [fullType],
			arguments: [tx.object(characterId), borrowedCap, receipt],
		});
	}

	async function handleApply() {
		// Gates require a registry; SSUs can work with just a market
		if (structureKind === "gate" && !registryId) return;
		if (structureKind === "ssu" && !registryId && !ssuConfig.marketId) return;

		// Connect wallet if needed
		let senderAddress = account?.address;
		if (!senderAddress) {
			const eveVault = wallets.find(
				(w) => w.name === "Eve Vault" || w.name.includes("Eve Frontier"),
			);
			const wallet = eveVault || wallets[0];
			if (!wallet) return;
			const result = await connectWallet({ wallet });
			senderAddress = result.accounts[0]?.address;
			if (!senderAddress) return;
		}

		setStatus("building");
		setError(null);

		try {
			let tx: Transaction;
			let isNewSsuConfig = !existingConfig?.ssuConfigId;

			if (structureKind === "gate") {
				tx = buildConfigureGateStandings({
					tenant,
					gateId: assemblyId,
					registryId: registryId!,
					minAccess: gateConfig.minAccess,
					freeAccess: gateConfig.freeAccess,
					tollFee: BigInt(gateConfig.tollFee || "0"),
					tollRecipient: gateConfig.tollRecipient || senderAddress,
					permitDurationMs: gateConfig.permitDurationMs,
					senderAddress,
					tollCoinType: gateConfig.tollCoinType,
				});
				appendMetadataUpdates(tx);
			} else if (registryId) {
				tx = buildConfigureSsuStandings({
					tenant,
					ssuId: assemblyId,
					registryId,
					minDeposit: ssuConfig.minDeposit,
					minWithdraw: ssuConfig.minWithdraw,
					senderAddress,
					ssuConfigId: existingConfig?.ssuConfigId,
					marketId: ssuConfig.marketId || undefined,
				});
				appendMetadataUpdates(tx);

				// If reconfiguring, the old config may be from a previous (incompatible)
				// package version. Try signing; on TypeMismatch, retry with create-new.
				if (existingConfig?.ssuConfigId) {
					try {
						setStatus("signing");
						await signAndExecute({ transaction: tx });
					} catch (txErr) {
						const msg = txErr instanceof Error ? txErr.message : String(txErr);
						if (msg.includes("TypeMismatch")) {
							// Old config is from an incompatible package -- create new
							setStatus("building");
							tx = buildConfigureSsuStandings({
								tenant,
								ssuId: assemblyId,
								registryId,
								minDeposit: ssuConfig.minDeposit,
								minWithdraw: ssuConfig.minWithdraw,
								senderAddress,
								ssuConfigId: undefined,
								marketId: ssuConfig.marketId || undefined,
							});
							appendMetadataUpdates(tx);
							isNewSsuConfig = true;
							setStatus("signing");
							await signAndExecute({ transaction: tx });
						} else {
							throw txErr;
						}
					}
				}
			} else {
				// SSU market-only -- no standings TX needed
				// But if there are metadata updates (name/url), we still need an on-chain TX
				if (newName || newUrl) {
					const metaTx = new Transaction();
					appendMetadataUpdates(metaTx);
					setStatus("signing");
					await signAndExecute({ transaction: metaTx });
				}
				await saveConfigToDb();
				await recordExtension(senderAddress);
				setStatus("done");
				onConfigured?.();
				return;
			}

			// For non-reconfigure paths that haven't signed yet, sign now
			if (structureKind !== "ssu" || !existingConfig?.ssuConfigId) {
				setStatus("signing");
				await signAndExecute({ transaction: tx });
			}

			// Discover the SsuUnifiedConfig object ID after creation
			let resolvedConfigId: string | undefined;
			if (structureKind === "ssu" && isNewSsuConfig) {
				setStatus("confirming");
				const addrs = getContractAddresses(tenant);
				const ssuUnified = addrs.ssuUnified;
				// Use originalPackageId for type-based discovery (objects retain original type)
				const discoveryPkgId = ssuUnified?.originalPackageId ?? ssuUnified?.packageId;
				if (discoveryPkgId) {
					resolvedConfigId =
						(await discoverSsuUnifiedConfig(suiClient, discoveryPkgId, assemblyId)) ??
						undefined;
				}
			} else if (structureKind === "ssu" && !isNewSsuConfig) {
				// Keep the existing (compatible) config ID
				resolvedConfigId = existingConfig?.ssuConfigId;
			}

			await saveConfigToDb(resolvedConfigId);
			await recordExtension(senderAddress);

			setStatus("done");
			onConfigured?.();
		} catch (err) {
			setStatus("error");
			setError(walletErrorMessage(err));
		}
	}

	async function saveConfigToDb(ssuConfigId?: string) {
		// For gates, registry is required
		if (structureKind === "gate" && !registryId) return;

		let registryName: string | undefined;
		if (registryId) {
			const registries = await db.subscribedRegistries
				.where("id")
				.equals(registryId)
				.toArray();
			registryName = registries[0]?.name;
		}

		const config: StructureExtensionConfig = {
			id: assemblyId,
			assemblyId,
			assemblyType,
			registryId: registryId ?? undefined,
			registryName,
			...(structureKind === "gate" && {
				minAccess: gateConfig.minAccess,
				freeAccess: gateConfig.freeAccess,
				tollFee: gateConfig.tollFee,
				tollRecipient: gateConfig.tollRecipient,
				permitDurationMs: Number(gateConfig.permitDurationMs),
				tollCoinType: gateConfig.tollCoinType,
				tollTreasuryId:
					gateConfig.revenueDestination === "treasury" ? resolvedTreasuryId ?? undefined : undefined,
			}),
			...(structureKind === "ssu" && {
				minDeposit: ssuConfig.minDeposit,
				minWithdraw: ssuConfig.minWithdraw,
				marketId: ssuConfig.marketId || undefined,
				ssuConfigId: ssuConfigId,
			}),
		};

		await db.structureExtensionConfigs.put(config);
	}

	return (
		<div className="space-y-4">
			{/* Registry selector */}
			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">
					<Settings2 size={12} className="mr-1 inline" />
					Standings Registry
				</label>
				<RegistrySelector value={registryId} onChange={setRegistryId} tenant={tenant} />
			</div>

			{/* Structure-type-specific config */}
			{structureKind === "gate" && registryId && (
				<GateStandingsConfig values={gateConfig} onChange={setGateConfig} account={account} resolvedTreasuryId={resolvedTreasuryId} currencies={currencies} />
			)}
			{structureKind === "ssu" && (
				<SsuStandingsConfig
					values={ssuConfig}
					onChange={setSsuConfig}
					hasRegistry={!!registryId}
				/>
			)}

			{/* Status feedback */}
			{status !== "idle" && status !== "done" && (
				<div
					className={`rounded-lg border p-3 ${
						status === "error"
							? "border-red-900/50 bg-red-950/20"
							: "border-cyan-900/50 bg-cyan-950/20"
					}`}
				>
					<div className="flex items-center gap-2">
						{status === "error" ? (
							<AlertCircle size={14} className="text-red-400" />
						) : (
							<Loader2 size={14} className="animate-spin text-cyan-400" />
						)}
						<span className={`text-xs ${status === "error" ? "text-red-300" : "text-cyan-300"}`}>
							{status === "building" && "Building transaction..."}
							{status === "signing" && "Waiting for wallet signature..."}
							{status === "confirming" && "Confirming on-chain..."}
							{status === "error" && "Configuration failed"}
						</span>
					</div>
					{error && <p className="mt-1 text-xs text-red-400">{error}</p>}
				</div>
			)}

			{status === "done" ? (
				<div className="rounded-lg border border-green-900/50 bg-green-950/20 p-3">
					<div className="flex items-center gap-2">
						<CheckCircle2 size={14} className="text-green-400" />
						<span className="text-xs text-green-300">Configuration applied successfully!</span>
					</div>
				</div>
			) : (
			<button
				type="button"
				onClick={handleApply}
				disabled={
					isConfiguring ||
					(structureKind === "gate" && !registryId) ||
					(structureKind === "ssu" && !registryId && !ssuConfig.marketId)
				}
				className="w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{isConfiguring ? (
					<span className="flex items-center justify-center gap-2">
						<Loader2 size={14} className="animate-spin" />
						Configuring...
					</span>
				) : existingConfig ? (
					"Update Configuration"
				) : (
					"Apply Configuration"
				)}
			</button>
			)}
		</div>
	);
}
