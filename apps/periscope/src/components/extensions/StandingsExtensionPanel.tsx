import type { TenantId } from "@/chain/config";
import { buildConfigureGateStandings, buildConfigureSsuStandings } from "@/chain/transactions";
import { ContactPicker } from "@/components/ContactPicker";
import { db } from "@/db";
import type { StructureExtensionConfig } from "@/db/types";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import {
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
	/** Character Sui object ID (needed for turret publish flow) */
	characterId?: string;
	/** OwnerCap object ID (needed for turret publish flow) */
	ownerCapId?: string;
	/** Existing config (if reconfiguring) */
	existingConfig?: StructureExtensionConfig;
	onConfigured?: () => void;
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
}: {
	values: GateConfigValues;
	onChange: (v: GateConfigValues) => void;
	account: { address: string } | null;
	resolvedTreasuryId: string | null;
}) {
	const durationMinutes = Math.round(Number(values.permitDurationMs) / 60_000);
	const isCustomCurrency = !!values.tollCoinType;

	// Resolve the selected currency symbol for the toll fee label
	const currencies = useLiveQuery(() => db.currencies.filter((c) => !c._archived).toArray(), []);
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
			existingConfig={existingConfig}
			onConfigured={onConfigured}
		/>
	);
}

/** Inner panel for gate/SSU standings configuration (uses hooks, cannot be after early return). */
function StandingsExtensionPanelInner({
	assemblyId,
	assemblyType,
	structureKind,
	tenant,
	existingConfig,
	onConfigured,
}: Omit<StandingsExtensionPanelProps, "characterId" | "ownerCapId">) {
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
			let tx: import("@mysten/sui/transactions").Transaction;

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
			} else {
				// SSU market-only -- no on-chain standings TX, just save locally
				await saveConfigToDb();
				setStatus("done");
				onConfigured?.();
				return;
			}

			setStatus("signing");
			await signAndExecute({ transaction: tx });

			// For new SSU configs, discover the created SsuUnifiedConfig object ID
			let createdConfigId: string | undefined;
			if (structureKind === "ssu" && !existingConfig?.ssuConfigId) {
				setStatus("confirming");
				const addrs = getContractAddresses(tenant);
				const pkgId = addrs.ssuUnified?.packageId;
				if (pkgId) {
					createdConfigId =
						(await discoverSsuUnifiedConfig(suiClient, pkgId, assemblyId)) ?? undefined;
				}
			}

			await saveConfigToDb(createdConfigId);

			setStatus("done");
			onConfigured?.();
		} catch (err) {
			setStatus("error");
			setError(err instanceof Error ? err.message : String(err));
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
				ssuConfigId: ssuConfigId || existingConfig?.ssuConfigId,
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
				<GateStandingsConfig values={gateConfig} onChange={setGateConfig} account={account} resolvedTreasuryId={resolvedTreasuryId} />
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
