import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
	Box,
	Building2,
	CheckCircle2,
	Coins,
	Crosshair,
	Database,
	DoorOpen,
	Link2,
	Loader2,
	Package,
	Puzzle,
	Shield,
	ShoppingBag,
	User,
	Wifi,
	WifiOff,
} from "lucide-react";
import { useState } from "react";

import { getTemplatesForAssemblyType } from "@/chain/config";
import type { OwnedAssembly } from "@/chain/queries";
import { CopyAddress } from "@/components/CopyAddress";
import { DeployExtensionPanel } from "@/components/extensions/DeployExtensionPanel";
import { db, notDeleted } from "@/db";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant, useOwnedAssemblies } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useQuery } from "@tanstack/react-query";
import { discoverSsuConfig, getContractAddresses, querySsuConfig } from "@tehfrontier/chain-shared";

const assemblyIcons = {
	turret: Crosshair,
	gate: DoorOpen,
	storage_unit: Box,
	smart_storage_unit: Package,
	network_node: Wifi,
	protocol_depot: Database,
} as const;

const assemblyLabels = {
	turret: "Turret",
	gate: "Gate",
	storage_unit: "Storage Unit",
	smart_storage_unit: "Smart Storage Unit",
	network_node: "Network Node",
	protocol_depot: "Protocol Depot",
} as const;

export function Extensions() {
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const { data, isLoading, error } = useOwnedAssemblies();
	const tenant = useActiveTenant();
	const extensions = useLiveQuery(() => db.extensions.filter(notDeleted).toArray()) ?? [];
	const org = useLiveQuery(() => db.organizations.filter(notDeleted).first());
	const currencies = useLiveQuery(() => db.currencies.filter(notDeleted).toArray());
	const tradeNodesList = useLiveQuery(() => db.tradeNodes.toArray()) ?? [];
	const [selectedAssembly, setSelectedAssembly] = useState<OwnedAssembly | null>(null);

	// Prefer character address, fall back to wallet
	const address = activeCharacter?.suiAddress ?? account?.address;

	// No address available at all
	if (!address) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<Header />
				<div className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
					{activeCharacter ? (
						<>
							<Link2 size={48} className="text-zinc-700" />
							<p className="text-sm text-zinc-500">
								No Sui address linked to{" "}
								<span className="text-zinc-300">{activeCharacter.characterName}</span>
							</p>
							<p className="text-xs text-zinc-600">
								Connect your wallet to auto-link, or add an address in Settings
							</p>
						</>
					) : (
						<>
							<User size={48} className="text-zinc-700" />
							<p className="text-sm text-zinc-500">Select a character or connect your wallet</p>
						</>
					)}
				</div>
			</div>
		);
	}

	// Loading
	if (isLoading) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<Header />
				<div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
					<Loader2 size={32} className="animate-spin text-cyan-500" />
					<p className="text-sm text-zinc-400">
						Discovering assemblies for {activeCharacter?.characterName ?? "character"}...
					</p>
				</div>
			</div>
		);
	}

	// Error
	if (error) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<Header />
				<div className="flex flex-col items-center gap-3 rounded-lg border border-red-900/50 bg-red-950/20 py-16">
					<AlertCircle size={32} className="text-red-400" />
					<p className="text-sm text-red-300">{error.message}</p>
				</div>
			</div>
		);
	}

	const assemblies = data?.assemblies ?? [];
	const character = data?.character;

	return (
		<div className="mx-auto max-w-3xl p-6">
			<Header />

			{character && (
				<div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm">
					<span className="text-zinc-500">Character: </span>
					<span className="text-zinc-300">
						{character.name ?? activeCharacter?.characterName ?? "Unknown"}
					</span>
					<CopyAddress
						address={character.characterObjectId}
						sliceStart={10}
						sliceEnd={0}
						className="ml-3 text-xs text-zinc-600"
					/>
				</div>
			)}

			{/* On-Chain Objects */}
			<OnChainObjects
				org={org}
				currencies={currencies ?? []}
				tradeNodes={tradeNodesList}
				tenant={tenant}
			/>

			{assemblies.length === 0 ? (
				<div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
					<Box size={48} className="text-zinc-700" />
					<p className="text-sm text-zinc-500">
						No assemblies found on <span className="capitalize font-medium">{tenant}</span>
					</p>
					<p className="text-xs text-zinc-600">
						Make sure the server switcher matches where your assemblies are deployed.
					</p>
				</div>
			) : (
				<div className="space-y-3">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-medium text-zinc-400">Assemblies ({assemblies.length})</h2>
						{!account && (
							<div className="flex items-center gap-2 text-xs text-zinc-600">
								<span>EVE Vault not connected -- extensions require a wallet</span>
							</div>
						)}
					</div>
					{assemblies.map((assembly) => (
						<AssemblyCard
							key={assembly.objectId}
							assembly={assembly}
							extensionRecord={extensions.find((e) => e.assemblyId === assembly.objectId)}
							onDeploy={() => setSelectedAssembly(assembly)}
							walletConnected={!!account}
							tenant={tenant}
						/>
					))}
				</div>
			)}

			{selectedAssembly && character && account && (
				<DeployExtensionPanel
					assembly={selectedAssembly}
					characterId={character.characterObjectId}
					tenant={tenant}
					onClose={() => setSelectedAssembly(null)}
				/>
			)}
		</div>
	);
}

function Header() {
	const { activeCharacter } = useActiveCharacter();
	const globalTenant = useActiveTenant();
	const tenant = activeCharacter?.tenant ?? globalTenant;
	return (
		<div className="mb-6 flex items-center justify-between">
			<div>
				<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
					<Puzzle size={24} />
					Extensions
				</h1>
				<p className="mt-1 text-sm text-zinc-500">
					{activeCharacter ? activeCharacter.characterName : "Select a character"}
					<span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-xs capitalize">
						{tenant}
					</span>
				</p>
			</div>
		</div>
	);
}

// ── On-Chain Objects Panel ─────────────────────────────────────────────────

function OnChainObjects({
	org,
	currencies,
	tradeNodes,
	tenant,
}: {
	org?: { id: string; name: string; chainObjectId?: string };
	currencies: Array<{
		id: string;
		symbol: string;
		name: string;
		coinType: string;
		packageId: string;
		marketId?: string;
	}>;
	tradeNodes: Array<{ id: string; name: string; marketConfigId?: string }>;
	tenant: string;
}) {
	const hasAnything = org || currencies.length > 0 || tradeNodes.length > 0;
	if (!hasAnything) return null;

	return (
		<div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<h2 className="mb-3 text-sm font-medium text-zinc-400">On-Chain Objects</h2>

			<div className="space-y-3 text-xs">
				{/* Organization */}
				{org && (
					<div className="space-y-1">
						<div className="flex items-center gap-1.5">
							<Building2 size={12} className="text-cyan-500" />
							<span className="font-medium text-zinc-300">Organization: {org.name}</span>
						</div>
						{org.chainObjectId ? (
							<p className="pl-5 font-mono text-zinc-500">{org.chainObjectId}</p>
						) : (
							<p className="pl-5 text-zinc-600">Not published to chain</p>
						)}
					</div>
				)}

				{/* Currencies / Market */}
				{currencies.map((c) => (
					<div key={c.id} className="space-y-1">
						<div className="flex items-center gap-1.5">
							<Coins size={12} className="text-amber-500" />
							<span className="font-medium text-zinc-300">
								{c.symbol} -- {c.name}
							</span>
						</div>
						<div className="space-y-0.5 pl-5">
							<div>
								<span className="text-zinc-400">Package: </span>
								<span className="font-mono text-zinc-500">{c.packageId}</span>
							</div>
							<div>
								<span className="text-zinc-400">Coin Type: </span>
								<span className="font-mono text-zinc-500">{c.coinType}</span>
							</div>
							{c.marketId && (
								<div>
									<span className="text-zinc-400">Market: </span>
									<span className="font-mono text-zinc-500">{c.marketId}</span>
								</div>
							)}
						</div>
					</div>
				))}

				{/* Trade Nodes / SsuConfigs */}
				{tradeNodes.length > 0 && (
					<div className="space-y-1">
						<div className="flex items-center gap-1.5">
							<ShoppingBag size={12} className="text-green-500" />
							<span className="font-medium text-zinc-300">Trade Nodes ({tradeNodes.length})</span>
						</div>
						{tradeNodes.map((tn) => (
							<div key={tn.id} className="pl-5">
								<span className="text-zinc-300">{tn.name}</span>
								<span className="ml-2 font-mono text-zinc-600">{tn.id.slice(0, 14)}...</span>
								{tn.marketConfigId ? (
									<div className="mt-0.5">
										<span className="text-zinc-400">SsuConfig: </span>
										<span className="font-mono text-zinc-500">{tn.marketConfigId}</span>
									</div>
								) : (
									<div className="mt-0.5 text-zinc-600">No SsuConfig</div>
								)}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

// ── Assembly Card ─────────────────────────────────────────────────────────

function AssemblyCard({
	assembly,
	extensionRecord,
	onDeploy,
	walletConnected,
	tenant,
}: {
	assembly: OwnedAssembly;
	extensionRecord?: { templateName: string; status: string };
	onDeploy: () => void;
	walletConnected: boolean;
	tenant: string;
}) {
	const Icon = assemblyIcons[assembly.type];
	const label = assemblyLabels[assembly.type];
	const isOnline = assembly.status === "online" || assembly.status === "ONLINE";
	const templates = getTemplatesForAssemblyType(assembly.type);
	const hasExtension = !!assembly.extensionType || !!extensionRecord;
	const isStorageType =
		assembly.type === "storage_unit" ||
		assembly.type === "smart_storage_unit" ||
		assembly.type === "protocol_depot";

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="flex items-start justify-between">
				<div className="flex items-center gap-3">
					<div className="rounded-lg bg-zinc-800 p-2">
						<Icon size={20} className="text-cyan-500" />
					</div>
					<div>
						<p className="text-sm font-medium text-zinc-200">{label}</p>
						<CopyAddress
							address={assembly.objectId}
							sliceStart={10}
							sliceEnd={6}
							className="text-xs text-zinc-600"
						/>
						{assembly.ownerCapId && (
							<div className="text-xs text-zinc-700">
								OwnerCap:{" "}
								<CopyAddress
									address={assembly.ownerCapId}
									sliceStart={10}
									sliceEnd={0}
									className="text-zinc-700"
								/>
							</div>
						)}
					</div>
				</div>
				<div className="flex items-center gap-1.5">
					{isOnline ? (
						<>
							<Wifi size={12} className="text-green-500" />
							<span className="text-xs text-green-500">Online</span>
						</>
					) : (
						<>
							<WifiOff size={12} className="text-zinc-600" />
							<span className="text-xs text-zinc-600">{assembly.status}</span>
						</>
					)}
				</div>
			</div>

			{/* Extension info */}
			<div className="mt-3 flex items-center justify-between border-t border-zinc-800/50 pt-3">
				{hasExtension ? (
					<div className="flex items-center gap-1.5">
						<CheckCircle2 size={14} className="text-cyan-500" />
						<span className="text-xs text-zinc-400">
							{extensionRecord?.templateName ?? assembly.extensionType ?? "Extension active"}
						</span>
						{extensionRecord?.status && (
							<span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-xs text-cyan-400">
								{extensionRecord.status}
							</span>
						)}
					</div>
				) : (
					<span className="text-xs text-zinc-600">No extension</span>
				)}

				{templates.length > 0 && (
					<button
						type="button"
						onClick={onDeploy}
						disabled={!walletConnected}
						title={walletConnected ? undefined : "Connect wallet to deploy"}
						className="rounded-lg bg-cyan-600/20 px-3 py-1.5 text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{hasExtension ? "Change Extension" : "Deploy Extension"}
					</button>
				)}
			</div>

			{/* On-chain config discovery for SSU market */}
			{isStorageType && <SsuConfigPanel assemblyId={assembly.objectId} tenant={tenant} />}
		</div>
	);
}

/** Discovers and displays SsuConfig for an SSU */
function SsuConfigPanel({ assemblyId, tenant }: { assemblyId: string; tenant: string }) {
	const client = useSuiClient();
	const addresses = getContractAddresses(tenant as Parameters<typeof getContractAddresses>[0]);
	const originalPkgId = addresses.ssuMarket?.originalPackageId;
	const previousPkgIds = addresses.ssuMarket?.previousOriginalPackageIds;

	const { data: configId, isLoading } = useQuery({
		queryKey: ["ssuConfig-discover", assemblyId, originalPkgId],
		queryFn: () => discoverSsuConfig(client, originalPkgId!, assemblyId, previousPkgIds),
		enabled: !!originalPkgId,
		staleTime: 60_000,
	});

	const { data: config } = useQuery({
		queryKey: ["ssuConfig", configId],
		queryFn: () => querySsuConfig(client, configId!),
		enabled: !!configId,
		staleTime: 60_000,
	});

	if (isLoading) {
		return (
			<div className="mt-2 border-t border-zinc-800/50 pt-2 text-xs text-zinc-600">
				<Loader2 size={10} className="inline animate-spin" /> Checking SsuConfig...
			</div>
		);
	}

	if (!configId) {
		return (
			<div className="mt-2 border-t border-zinc-800/50 pt-2 text-xs text-zinc-600">
				No SsuConfig found
			</div>
		);
	}

	return (
		<div className="mt-2 space-y-1 border-t border-zinc-800/50 pt-2">
			<div className="flex items-center gap-1.5">
				<Shield size={12} className="text-amber-500" />
				<span className="text-xs text-zinc-400">SsuConfig</span>
			</div>
			<p className="font-mono text-xs text-zinc-500">{configId}</p>
			{config && (
				<div className="space-y-0.5 text-xs text-zinc-600">
					<p>Owner: {config.owner.slice(0, 10)}...</p>
					<p>SSU: {config.ssuId.slice(0, 10)}...</p>
					{config.delegates.length > 0 && <p>Delegates: {config.delegates.length}</p>}
					{config.marketId && (
						<p>
							Market: {config.marketId.slice(0, 10)}...
							{config.marketId.slice(-6)}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
