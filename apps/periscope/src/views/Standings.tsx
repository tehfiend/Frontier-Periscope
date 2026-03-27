import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
	Archive,
	ArchiveRestore,
	BookUser,
	Filter,
	Globe,
	Info,
	Loader2,
	Pencil,
	Plus,
	RefreshCw,
	Shield,
	Star,
	Trash2,
	UserPlus,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContactPicker } from "@/components/ContactPicker";
import { CopyAddress } from "@/components/CopyAddress";
import { StandingBadge } from "@/components/StandingBadge";
import { ConnectWalletButton } from "@/components/WalletConnect";
import { db } from "@/db";
import type { Contact, RegistryStanding } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import {
	useAddContact,
	useContacts,
	useDeleteContact,
	useUpdateContact,
} from "@/hooks/useContacts";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import {
	useArchiveRegistry,
	useRegistryStandings,
	useSubscribeRegistry,
	useSubscribedRegistries,
	useSyncRegistryStandings,
	useUnsubscribeRegistry,
} from "@/hooks/useRegistrySubscriptions";
import { useSuiClient } from "@/hooks/useSuiClient";
import { discoverRegistries } from "@/chain/manifest";
import type { ManifestRegistry } from "@/db/types";
import {
	REGISTRY_STANDING_LABELS,
	type StandingsRegistryInfo,
	type TenantId,
	buildAddRegistryAdmin,
	buildCreateRegistry,
	buildRemoveCharacterStanding,
	buildRemoveRegistryAdmin,
	buildRemoveTribeStanding,
	buildSetCharacterStanding,
	buildSetTribeStanding,
	displayToStanding,
	getContractAddresses,
	standingToDisplay,
} from "@tehfrontier/chain-shared";

// ── Tab Types ───────────────────────────────────────────────────────────────

type StandingsTab = "contacts" | "registries" | "my-registries";

// ── Standing Selector ───────────────────────────────────────────────────────

const STANDING_OPTIONS = [3, 2, 1, 0, -1, -2, -3];

function StandingSelect({
	value,
	onChange,
	className,
}: {
	value: number;
	onChange: (v: number) => void;
	className?: string;
}) {
	return (
		<select
			value={value}
			onChange={(e) => onChange(Number(e.target.value))}
			className={`rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-300 focus:border-cyan-500 focus:outline-none ${className ?? ""}`}
		>
			{STANDING_OPTIONS.map((v) => {
				const raw = displayToStanding(v);
				const label = REGISTRY_STANDING_LABELS.get(raw) ?? "Unknown";
				return (
					<option key={v} value={v}>
						{v > 0 ? `+${v}` : v} {label}
					</option>
				);
			})}
		</select>
	);
}

// ── Contextual Help ─────────────────────────────────────────────────────────

function StandingsHelp() {
	const [dismissed, setDismissed] = useState(
		() => localStorage.getItem("periscope:standings-help-dismissed") === "1",
	);

	if (dismissed) return null;

	return (
		<div className="mb-4 flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
			<Info size={16} className="mt-0.5 shrink-0 text-cyan-500" />
			<div className="flex-1 text-xs text-zinc-400">
				<ul className="list-inside list-disc space-y-1">
					<li>
						<strong className="text-zinc-300">Contacts</strong> -- private standings stored locally
						on your device. Only you can see them.
					</li>
					<li>
						<strong className="text-zinc-300">Registries</strong> -- on-chain standings published to
						the blockchain. Used by smart assemblies (SSUs, gates, turrets) to control access.
					</li>
				</ul>
			</div>
			<button
				type="button"
				onClick={() => {
					localStorage.setItem("periscope:standings-help-dismissed", "1");
					setDismissed(true);
				}}
				className="shrink-0 rounded p-0.5 text-zinc-600 transition-colors hover:text-zinc-400"
				title="Dismiss"
			>
				<X size={14} />
			</button>
		</div>
	);
}

const TAB_DESCRIPTIONS: Record<StandingsTab, string> = {
	contacts: "Your private standings for characters and tribes, stored locally.",
	registries: "On-chain standings registries published by other players. Subscribe to track them.",
	"my-registries":
		"Registries you own or admin. Used by your smart assemblies to set access rules.",
};

// ── Main Component ──────────────────────────────────────────────────────────

export function Standings() {
	const account = useCurrentAccount();
	const { activeCharacter, activeSuiAddresses } = useActiveCharacter();
	const tenant = useActiveTenant();
	const walletAddress = account?.address;
	const chainAddress = activeCharacter?.suiAddress ?? activeSuiAddresses[0] ?? null;

	const [activeTab, setActiveTab] = useState<StandingsTab>("contacts");

	const tabs: { id: StandingsTab; label: string; icon: React.ReactNode }[] = [
		{ id: "contacts", label: "Contacts", icon: <BookUser size={14} /> },
		{ id: "registries", label: "Registries", icon: <Globe size={14} /> },
		{ id: "my-registries", label: "My Registries", icon: <Star size={14} /> },
	];

	return (
		<div className="mx-auto max-w-4xl p-6">
			{/* Header */}
			<div className="mb-4">
				<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
					<Shield size={24} />
					Standings
				</h1>
				<p className="mt-1 text-sm text-zinc-500">
					Manage contacts, browse on-chain registries, and set standings
				</p>
			</div>

			<StandingsHelp />

			{/* Tabs */}
			<div className="mb-2 flex gap-1 border-b border-zinc-800">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id)}
						className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
							activeTab === tab.id
								? "border-cyan-500 text-cyan-400"
								: "border-transparent text-zinc-500 hover:text-zinc-300"
						}`}
					>
						{tab.icon}
						{tab.label}
					</button>
				))}
			</div>

			{/* Tab Description */}
			<p className="mb-4 text-xs text-zinc-500">{TAB_DESCRIPTIONS[activeTab]}</p>

			{/* Tab Content */}
			{activeTab === "contacts" && <ContactsTab />}
			{activeTab === "registries" && (
				<RegistriesTab tenant={tenant} walletAddress={walletAddress} />
			)}
			{activeTab === "my-registries" && (
				<MyRegistriesTab
					tenant={tenant}
					chainAddress={chainAddress}
					walletAddress={walletAddress}
				/>
			)}
		</div>
	);
}

// ── Contacts Tab ────────────────────────────────────────────────────────────

function ContactsTab() {
	const contacts = useContacts();
	const addContact = useAddContact();
	const updateContact = useUpdateContact();
	const deleteContact = useDeleteContact();

	const [showAddDialog, setShowAddDialog] = useState(false);
	const [editingContact, setEditingContact] = useState<Contact | null>(null);
	const [filterKind, setFilterKind] = useState<"all" | "character" | "tribe">("all");

	const filtered = useMemo(() => {
		let result = contacts;
		if (filterKind !== "all") {
			result = result.filter((c) => c.kind === filterKind);
		}
		return result.sort(
			(a, b) =>
				b.standing - a.standing ||
				(a.characterName ?? a.tribeName ?? "").localeCompare(b.characterName ?? b.tribeName ?? ""),
		);
	}, [contacts, filterKind]);

	// Resolve tribe names from manifest
	const tribeIds = useMemo(
		() => contacts.filter((c) => c.kind === "tribe" && c.tribeId).map((c) => c.tribeId as number),
		[contacts],
	);
	const manifestTribes = useLiveQuery(
		() => (tribeIds.length > 0 ? db.manifestTribes.where("id").anyOf(tribeIds).toArray() : []),
		[tribeIds.join(",")],
	);
	const tribeNameMap = useMemo(() => {
		const map = new Map<number, string>();
		for (const t of manifestTribes ?? []) map.set(t.id, t.name);
		return map;
	}, [manifestTribes]);

	return (
		<div className="space-y-4">
			{/* Actions */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-1.5">
						<Filter size={14} className="text-zinc-600" />
						<select
							value={filterKind}
							onChange={(e) => setFilterKind(e.target.value as "all" | "character" | "tribe")}
							className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-cyan-500 focus:outline-none"
						>
							<option value="all">All Types</option>
							<option value="character">Characters</option>
							<option value="tribe">Tribes</option>
						</select>
					</div>
					<span className="text-xs text-zinc-600">
						{filtered.length} contact{filtered.length !== 1 ? "s" : ""}
					</span>
				</div>
				<button
					type="button"
					onClick={() => setShowAddDialog(true)}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
				>
					<Plus size={14} />
					Add Contact
				</button>
			</div>

			{/* Contact List */}
			{filtered.length === 0 ? (
				<EmptyState
					icon={<BookUser size={48} className="text-zinc-700" />}
					title="No contacts"
					description="Add characters or tribes to track their standings locally."
				/>
			) : (
				<div className="divide-y divide-zinc-800/50 rounded-lg border border-zinc-800 bg-zinc-900/50">
					{filtered.map((contact) => {
						const displayName =
							contact.kind === "character"
								? (contact.characterName ?? `Character #${contact.characterId}`)
								: (contact.tribeName ??
									tribeNameMap.get(contact.tribeId ?? 0) ??
									`Tribe #${contact.tribeId}`);
						return (
							<div key={contact.id} className="flex items-center justify-between px-4 py-3">
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-zinc-200">{displayName}</span>
										<span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
											{contact.kind}
										</span>
										<StandingBadge standing={contact.standing} source="contacts" />
									</div>
									{contact.notes && <p className="mt-0.5 text-xs text-zinc-500">{contact.notes}</p>}
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<button
										type="button"
										onClick={() => setEditingContact(contact)}
										title="Edit contact"
										className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
									>
										<Pencil size={14} />
									</button>
									<button
										type="button"
										onClick={() => deleteContact(contact.id)}
										title="Delete contact"
										className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-red-400"
									>
										<Trash2 size={14} />
									</button>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* Add Contact Dialog */}
			{showAddDialog && (
				<AddContactDialog onClose={() => setShowAddDialog(false)} onAdd={addContact} />
			)}

			{/* Edit Contact Dialog */}
			{editingContact && (
				<EditContactDialog
					contact={editingContact}
					onClose={() => setEditingContact(null)}
					onUpdate={updateContact}
				/>
			)}
		</div>
	);
}

// ── Registries Tab ──────────────────────────────────────────────────────────

/** Convert ManifestRegistry to StandingsRegistryInfo for UI compatibility */
function toRegistryInfo(r: ManifestRegistry): StandingsRegistryInfo {
	return {
		objectId: r.id,
		owner: r.owner,
		admins: r.admins,
		name: r.name,
		ticker: r.ticker,
		defaultStanding: r.defaultStanding,
	};
}

function RegistriesTab({
	tenant,
}: {
	tenant: string;
	walletAddress?: string;
}) {
	const client = useSuiClient();
	const subscribed = useSubscribedRegistries(tenant);
	const subscribe = useSubscribeRegistry();
	const unsubscribe = useUnsubscribeRegistry();
	const archiveRegistry = useArchiveRegistry();
	const syncStandings = useSyncRegistryStandings();

	const cachedRegistries = useLiveQuery(() => db.manifestRegistries.toArray()) ?? [];
	const allRegistries = useMemo(
		() => cachedRegistries.map(toRegistryInfo),
		[cachedRegistries],
	);
	const [isLoading, setIsLoading] = useState(false);
	const [selectedRegistryId, setSelectedRegistryId] = useState<string | null>(null);
	const [showArchived, setShowArchived] = useState(false);

	const addresses = getContractAddresses(tenant as TenantId);
	const packageId = addresses.standingsRegistry?.packageId;

	// Build a set of archived subscription IDs for filtering
	const archivedSubIds = useMemo(
		() => new Set(subscribed.filter((s) => s._archived).map((s) => s.id)),
		[subscribed],
	);

	// Filter allRegistries to hide archived subscriptions unless toggle is on
	const visibleRegistries = useMemo(
		() =>
			showArchived ? allRegistries : allRegistries.filter((r) => !archivedSubIds.has(r.objectId)),
		[allRegistries, archivedSubIds, showArchived],
	);

	// Refresh registries from chain into manifest cache
	const handleBrowse = useCallback(async () => {
		if (!packageId) return;
		setIsLoading(true);
		try {
			await discoverRegistries(client);
		} catch {
			// Fetch error
		} finally {
			setIsLoading(false);
		}
	}, [client, packageId]);

	const subscribedIds = useMemo(() => new Set(subscribed.map((s) => s.id)), [subscribed]);

	// Resolve creator names from manifest
	const creatorAddresses = useMemo(
		() => [...new Set(allRegistries.map((r) => r.owner))],
		[allRegistries],
	);
	const manifestChars = useLiveQuery(
		() =>
			creatorAddresses.length > 0
				? db.manifestCharacters.where("suiAddress").anyOf(creatorAddresses).toArray()
				: [],
		[creatorAddresses.join(",")],
	);
	const creatorNameMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const c of manifestChars ?? []) {
			if (c.name) map.set(c.suiAddress, c.name);
		}
		return map;
	}, [manifestChars]);

	// Selected registry standings
	const selectedStandings = useRegistryStandings(selectedRegistryId);

	return (
		<div className="space-y-4">
			{/* Actions */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<span className="text-xs text-zinc-600">
						{allRegistries.length} registr{allRegistries.length !== 1 ? "ies" : "y"} found
						{" -- "}
						{subscribed.filter((s) => !s._archived).length} subscribed
					</span>
					<button
						type="button"
						onClick={() => setShowArchived(!showArchived)}
						title={showArchived ? "Hide archived" : "Show archived"}
						className={`rounded-lg p-1.5 text-xs transition-colors ${
							showArchived
								? "bg-amber-900/30 text-amber-400"
								: "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
						}`}
					>
						<Archive size={14} />
					</button>
				</div>
				<button
					type="button"
					onClick={handleBrowse}
					disabled={isLoading || !packageId}
					className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-50"
				>
					<RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
					Browse
				</button>
			</div>

			{!packageId && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-8 text-center text-sm text-zinc-600">
					Standings Registry contract not yet published for this tenant.
				</div>
			)}

			{/* Registry List */}
			{visibleRegistries.length === 0 && packageId ? (
				<EmptyState
					icon={<Globe size={48} className="text-zinc-700" />}
					title="No registries found"
					description={
						isLoading
							? "Searching chain..."
							: "No StandingsRegistry objects found on-chain. Create one in the My Registries tab."
					}
				/>
			) : (
				<div className="space-y-2">
					{visibleRegistries.map((registry) => {
						const isSubscribed = subscribedIds.has(registry.objectId);
						const isArchived = archivedSubIds.has(registry.objectId);
						const isSelected = selectedRegistryId === registry.objectId;
						const creatorName = creatorNameMap.get(registry.owner);

						return (
							<div
								key={registry.objectId}
								className={`rounded-lg border p-4 transition-colors ${
									isArchived
										? "border-zinc-800/50 bg-zinc-900/30 opacity-60"
										: isSelected
											? "border-cyan-500/50 bg-cyan-500/5"
											: "border-zinc-800 bg-zinc-900/50"
								}`}
							>
								<div className="flex items-center justify-between">
									<button
										type="button"
										onClick={() => setSelectedRegistryId(isSelected ? null : registry.objectId)}
										className="min-w-0 flex-1 text-left"
									>
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium text-zinc-200">{registry.name}</span>
											<span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
												{registry.ticker}
											</span>
											{isArchived && (
												<span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
													archived
												</span>
											)}
										</div>
										<div className="mt-1 flex items-center gap-3 text-xs text-zinc-600">
											<span>
												Creator:{" "}
												{creatorName ?? (
													<CopyAddress
														address={registry.owner}
														sliceStart={8}
														sliceEnd={4}
														className="text-zinc-500"
													/>
												)}
											</span>
											<span>
												{registry.admins.length} admin{registry.admins.length !== 1 ? "s" : ""}
											</span>
											<span>
												Default:{" "}
												<StandingBadge standing={standingToDisplay(registry.defaultStanding)} />
											</span>
										</div>
									</button>
									<div className="flex shrink-0 items-center gap-1.5">
										{isSubscribed ? (
											<>
												<button
													type="button"
													onClick={() => unsubscribe(registry.objectId)}
													className="rounded-lg bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-700"
												>
													Unsubscribe
												</button>
												<button
													type="button"
													onClick={() => archiveRegistry(registry.objectId, !isArchived)}
													title={isArchived ? "Unarchive" : "Archive"}
													className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
												>
													{isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
												</button>
											</>
										) : (
											<button
												type="button"
												onClick={() => subscribe(registry, tenant, creatorName)}
												className="rounded-lg bg-cyan-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
											>
												Subscribe
											</button>
										)}
										{isSubscribed && !isArchived && (
											<button
												type="button"
												onClick={() => syncStandings(client, registry.objectId)}
												title="Sync standings"
												className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
											>
												<RefreshCw size={14} />
											</button>
										)}
									</div>
								</div>

								{/* Expanded: show standings */}
								{isSelected && isSubscribed && (
									<RegistryStandingsView
										standings={selectedStandings}
										defaultStanding={registry.defaultStanding}
									/>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

// ── My Registries Tab ───────────────────────────────────────────────────────

function MyRegistriesTab({
	tenant,
	chainAddress,
	walletAddress,
}: {
	tenant: string;
	chainAddress?: string | null;
	walletAddress?: string;
}) {
	const client = useSuiClient();
	const dAppKit = useDAppKit();
	const queryAddress = chainAddress ?? walletAddress ?? null;

	const [isLoading, setIsLoading] = useState(false);
	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [selectedRegistryId, setSelectedRegistryId] = useState<string | null>(null);
	const [showSetStandingDialog, setShowSetStandingDialog] = useState(false);
	const [showAddAdminDialog, setShowAddAdminDialog] = useState(false);

	const addresses = getContractAddresses(tenant as TenantId);
	const packageId = addresses.standingsRegistry?.packageId;

	// Read from manifest cache, filter to user's owned/admin registries
	const cachedRegistries = useLiveQuery(() => db.manifestRegistries.toArray()) ?? [];
	const myRegistries = useMemo(() => {
		const all = cachedRegistries.map(toRegistryInfo);
		return walletAddress
			? all.filter((r) => r.owner === walletAddress || r.admins.includes(walletAddress))
			: [];
	}, [cachedRegistries, walletAddress]);

	// Refresh registries from chain into manifest cache
	const handleRefresh = useCallback(async () => {
		if (!packageId || !queryAddress) return;
		setIsLoading(true);
		try {
			await discoverRegistries(client);
		} catch {
			// Fetch error
		} finally {
			setIsLoading(false);
		}
	}, [client, packageId]);

	const fetchedRef = useRef<string | null>(null);
	useEffect(() => {
		if (packageId && queryAddress && fetchedRef.current !== queryAddress) {
			fetchedRef.current = queryAddress;
			handleRefresh();
		}
	}, [packageId, queryAddress, handleRefresh]);

	const selectedRegistry = selectedRegistryId
		? (myRegistries.find((r) => r.objectId === selectedRegistryId) ?? null)
		: null;

	const isOwner = !!(walletAddress && selectedRegistry?.owner === walletAddress);

	if (!queryAddress) {
		return (
			<EmptyState
				icon={<Star size={48} className="text-zinc-700" />}
				title="No address available"
				description="Add a character with a linked Sui address to view your registries, or connect your wallet."
			/>
		);
	}

	return (
		<div className="space-y-4">
			{/* Actions */}
			<div className="flex items-center justify-between">
				<span className="text-xs text-zinc-600">
					{myRegistries.length} registr{myRegistries.length !== 1 ? "ies" : "y"}
				</span>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={handleRefresh}
						disabled={isLoading || !packageId}
						className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-50"
					>
						<RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
						Refresh
					</button>
					{packageId && walletAddress ? (
						<button
							type="button"
							onClick={() => setShowCreateDialog(true)}
							className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
						>
							<Plus size={14} />
							Create Registry
						</button>
					) : packageId ? (
						<ConnectWalletButton className="text-xs" />
					) : null}
				</div>
			</div>

			{!packageId && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-8 text-center text-sm text-zinc-600">
					Standings Registry contract not yet published for this tenant.
				</div>
			)}

			{/* Registry List */}
			{myRegistries.length === 0 && packageId ? (
				<EmptyState
					icon={<Star size={48} className="text-zinc-700" />}
					title="No registries"
					description={
						isLoading
							? "Loading..."
							: "You have no standings registries. Create one to get started."
					}
				/>
			) : (
				<div className="space-y-2">
					{myRegistries.map((registry) => {
						const isSelected = selectedRegistryId === registry.objectId;
						return (
							<div
								key={registry.objectId}
								className={`rounded-lg border p-4 transition-colors ${
									isSelected ? "border-cyan-500/50 bg-cyan-500/5" : "border-zinc-800 bg-zinc-900/50"
								}`}
							>
								<button
									type="button"
									onClick={() => setSelectedRegistryId(isSelected ? null : registry.objectId)}
									className="w-full text-left"
								>
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-zinc-200">{registry.name}</span>
										<span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
											{registry.ticker}
										</span>
										{registry.owner === queryAddress && (
											<span className="rounded bg-cyan-900/30 px-1.5 py-0.5 text-[10px] text-cyan-400">
												owner
											</span>
										)}
									</div>
									<div className="mt-1 flex items-center gap-3 text-xs text-zinc-600">
										<CopyAddress
											address={registry.objectId}
											sliceStart={14}
											sliceEnd={6}
											className="text-zinc-600"
										/>
										<span>
											{registry.admins.length} admin{registry.admins.length !== 1 ? "s" : ""}
										</span>
										<span>
											Default:{" "}
											<StandingBadge standing={standingToDisplay(registry.defaultStanding)} />
										</span>
									</div>
								</button>

								{/* Expanded: manage registry */}
								{isSelected && (
									<div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
										{/* Admin list */}
										<div>
											<p className="text-xs text-zinc-500">Admins:</p>
											<div className="mt-1 flex flex-wrap gap-1.5">
												{registry.admins.map((addr) => (
													<span
														key={addr}
														className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400"
													>
														<CopyAddress
															address={addr}
															sliceStart={6}
															sliceEnd={4}
															className="text-zinc-500"
														/>
														{isOwner && addr !== walletAddress && (
															<button
																type="button"
																onClick={async () => {
																	if (!packageId || !walletAddress) return;
																	try {
																		const tx = buildRemoveRegistryAdmin({
																			packageId,
																			registryId: registry.objectId,
																			adminAddress: addr,
																			senderAddress: walletAddress,
																		});
																		await dAppKit.signAndExecuteTransaction({
																			transaction: tx,
																		});
																		await new Promise((r) => setTimeout(r, 2000));
																		handleRefresh();
																	} catch {
																		// TX failed
																	}
																}}
																title="Remove admin"
																className="text-zinc-600 hover:text-red-400"
															>
																<Trash2 size={10} />
															</button>
														)}
													</span>
												))}
											</div>
										</div>

										{/* Actions */}
										<div className="flex items-center gap-2">
											{packageId && walletAddress ? (
												<button
													type="button"
													onClick={() => setShowSetStandingDialog(true)}
													className="flex items-center gap-1 rounded-lg bg-cyan-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
												>
													<Plus size={12} />
													Set Standing
												</button>
											) : packageId ? (
												<ConnectWalletButton className="text-xs" />
											) : null}
											{isOwner && packageId && (
												<button
													type="button"
													onClick={() => setShowAddAdminDialog(true)}
													className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
												>
													<UserPlus size={12} />
													Add Admin
												</button>
											)}
										</div>

										{/* Registry standings */}
										<RegistryStandingsManagement
											registry={registry}
											packageId={packageId ?? ""}
											walletAddress={walletAddress}
											onRefresh={handleRefresh}
										/>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* Dialogs */}
			{showCreateDialog && packageId && walletAddress && (
				<CreateRegistryDialog
					packageId={packageId}
					senderAddress={walletAddress}
					onClose={() => setShowCreateDialog(false)}
					onCreated={handleRefresh}
				/>
			)}

			{showSetStandingDialog && selectedRegistry && packageId && walletAddress && (
				<SetRegistryStandingDialog
					packageId={packageId}
					registry={selectedRegistry}
					senderAddress={walletAddress}
					tenant={tenant}
					onClose={() => setShowSetStandingDialog(false)}
					onSet={handleRefresh}
				/>
			)}

			{showAddAdminDialog && selectedRegistry && packageId && walletAddress && (
				<AddAdminDialog
					packageId={packageId}
					registryId={selectedRegistry.objectId}
					senderAddress={walletAddress}
					onClose={() => setShowAddAdminDialog(false)}
					onAdded={handleRefresh}
				/>
			)}
		</div>
	);
}

// ── Registry Standings View (read-only, for Registries tab) ─────────────────

function RegistryStandingsView({
	standings,
}: {
	standings: RegistryStanding[];
	defaultStanding: number;
}) {
	// Resolve names
	const tribeIds = useMemo(
		() => standings.filter((s) => s.kind === "tribe").map((s) => s.tribeId as number),
		[standings],
	);
	const charIds = useMemo(
		() => standings.filter((s) => s.kind === "character").map((s) => s.characterId as number),
		[standings],
	);

	const manifestTribes = useLiveQuery(
		() => (tribeIds.length > 0 ? db.manifestTribes.where("id").anyOf(tribeIds).toArray() : []),
		[tribeIds.join(",")],
	);
	const manifestChars = useLiveQuery(
		() =>
			charIds.length > 0
				? db.manifestCharacters.filter((c) => charIds.includes(Number(c.characterItemId))).toArray()
				: [],
		[charIds.join(",")],
	);

	const tribeNameMap = useMemo(() => {
		const map = new Map<number, string>();
		for (const t of manifestTribes ?? []) map.set(t.id, t.name);
		return map;
	}, [manifestTribes]);

	const charNameMap = useMemo(() => {
		const map = new Map<number, string>();
		for (const c of manifestChars ?? []) {
			if (c.characterItemId) map.set(Number(c.characterItemId), c.name);
		}
		return map;
	}, [manifestChars]);

	if (standings.length === 0) {
		return (
			<div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-xs text-zinc-600">
				No standings set in this registry
			</div>
		);
	}

	const sorted = [...standings].sort((a, b) => b.standing - a.standing);

	return (
		<div className="mt-3 divide-y divide-zinc-800/50 rounded-lg border border-zinc-800 bg-zinc-900/50">
			{sorted.map((entry) => {
				const name =
					entry.kind === "tribe"
						? (tribeNameMap.get(entry.tribeId ?? 0) ?? `Tribe #${entry.tribeId}`)
						: (charNameMap.get(entry.characterId ?? 0) ?? `Character #${entry.characterId}`);
				return (
					<div key={entry.id} className="flex items-center justify-between px-4 py-2.5">
						<div className="flex items-center gap-2">
							<span className="text-sm text-zinc-300">{name}</span>
							<span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
								{entry.kind}
							</span>
						</div>
						<StandingBadge standing={standingToDisplay(entry.standing)} />
					</div>
				);
			})}
		</div>
	);
}

// ── Registry Standings Management (for My Registries tab) ───────────────────

function RegistryStandingsManagement({
	registry,
	packageId,
	walletAddress,
}: {
	registry: StandingsRegistryInfo;
	packageId: string;
	walletAddress?: string;
	onRefresh: () => void;
}) {
	const client = useSuiClient();
	const dAppKit = useDAppKit();
	const [standings, setStandings] = useState<
		Array<{ kind: "tribe" | "character"; id: number; standing: number }>
	>([]);
	const [isLoading, setIsLoading] = useState(false);

	// Fetch standings
	const fetchStandings = useCallback(async () => {
		setIsLoading(true);
		try {
			const { queryRegistryStandings } = await import("@tehfrontier/chain-shared");
			const entries = await queryRegistryStandings(client, registry.objectId);
			setStandings(
				entries.map((e) => ({
					kind: e.kind,
					id: (e.kind === "tribe" ? e.tribeId : e.characterId) ?? 0,
					standing: e.standing,
				})),
			);
		} catch {
			// Fetch error
		} finally {
			setIsLoading(false);
		}
	}, [client, registry.objectId]);

	const fetchedRef = useRef(false);
	useEffect(() => {
		if (!fetchedRef.current) {
			fetchedRef.current = true;
			fetchStandings();
		}
	}, [fetchStandings]);

	// Resolve names
	const tribeIds = useMemo(
		() => standings.filter((s) => s.kind === "tribe").map((s) => s.id),
		[standings],
	);
	const charIds = useMemo(
		() => standings.filter((s) => s.kind === "character").map((s) => s.id),
		[standings],
	);

	const manifestTribes = useLiveQuery(
		() => (tribeIds.length > 0 ? db.manifestTribes.where("id").anyOf(tribeIds).toArray() : []),
		[tribeIds.join(",")],
	);
	const manifestChars = useLiveQuery(
		() =>
			charIds.length > 0
				? db.manifestCharacters.filter((c) => charIds.includes(Number(c.characterItemId))).toArray()
				: [],
		[charIds.join(",")],
	);

	const tribeNameMap = useMemo(() => {
		const map = new Map<number, string>();
		for (const t of manifestTribes ?? []) map.set(t.id, t.name);
		return map;
	}, [manifestTribes]);

	const charNameMap = useMemo(() => {
		const map = new Map<number, string>();
		for (const c of manifestChars ?? []) {
			if (c.characterItemId) map.set(Number(c.characterItemId), c.name);
		}
		return map;
	}, [manifestChars]);

	const handleRemove = async (kind: "tribe" | "character", entityId: number) => {
		if (!packageId || !walletAddress) return;
		try {
			const tx =
				kind === "tribe"
					? buildRemoveTribeStanding({
							packageId,
							registryId: registry.objectId,
							tribeId: entityId,
							senderAddress: walletAddress,
						})
					: buildRemoveCharacterStanding({
							packageId,
							registryId: registry.objectId,
							characterId: entityId,
							senderAddress: walletAddress,
						});
			await dAppKit.signAndExecuteTransaction({ transaction: tx });
			await new Promise((r) => setTimeout(r, 2000));
			fetchStandings();
		} catch {
			// TX failed
		}
	};

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 text-xs text-zinc-500">
				<Loader2 size={14} className="animate-spin" />
				Loading standings...
			</div>
		);
	}

	const sorted = [...standings].sort((a, b) => b.standing - a.standing);

	return (
		<div>
			<div className="flex items-center justify-between">
				<p className="text-xs text-zinc-500">
					{standings.length} standing{standings.length !== 1 ? "s" : ""}
				</p>
				<button
					type="button"
					onClick={fetchStandings}
					className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
				>
					<RefreshCw size={12} />
				</button>
			</div>
			{sorted.length > 0 && (
				<div className="mt-2 divide-y divide-zinc-800/50 rounded-lg border border-zinc-800 bg-zinc-900/50">
					{sorted.map((entry) => {
						const name =
							entry.kind === "tribe"
								? (tribeNameMap.get(entry.id) ?? `Tribe #${entry.id}`)
								: (charNameMap.get(entry.id) ?? `Character #${entry.id}`);
						return (
							<div
								key={`${entry.kind}:${entry.id}`}
								className="flex items-center justify-between px-4 py-2"
							>
								<div className="flex items-center gap-2">
									<span className="text-sm text-zinc-300">{name}</span>
									<span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
										{entry.kind}
									</span>
								</div>
								<div className="flex items-center gap-2">
									<StandingBadge standing={standingToDisplay(entry.standing)} />
									{walletAddress && (
										<button
											type="button"
											onClick={() => handleRemove(entry.kind, entry.id)}
											title="Remove standing"
											className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-red-400"
										>
											<Trash2 size={12} />
										</button>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

// ── Shared Sub-Components ───────────────────────────────────────────────────

function EmptyState({
	icon,
	title,
	description,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
			{icon}
			<p className="text-sm text-zinc-400">{title}</p>
			<p className="text-xs text-zinc-600">{description}</p>
		</div>
	);
}

function DialogOverlay({
	children,
	onClose,
}: {
	children: React.ReactNode;
	onClose: () => void;
}) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div
				className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={() => {}}
			>
				{children}
			</div>
		</div>
	);
}

// ── Add Contact Dialog ──────────────────────────────────────────────────────

function AddContactDialog({
	onClose,
	onAdd,
}: {
	onClose: () => void;
	onAdd: (params: {
		kind: "character" | "tribe";
		characterId?: number;
		characterName?: string;
		tribeId?: number;
		tribeName?: string;
		standing: number;
		notes?: string;
	}) => Promise<Contact>;
}) {
	const [kind, setKind] = useState<"character" | "tribe">("character");
	const [standing, setStanding] = useState(0);
	const [notes, setNotes] = useState("");
	const [isPending, setIsPending] = useState(false);

	// Character selection
	const [selectedCharacter, setSelectedCharacter] = useState<{
		characterItemId: string;
		name: string;
	} | null>(null);

	// Tribe selection
	const [tribeSearch, setTribeSearch] = useState("");
	const allTribes = useLiveQuery(() => db.manifestTribes.toArray()) ?? [];
	const matchedTribes = useMemo(() => {
		if (!tribeSearch || tribeSearch.length < 2) return [];
		const q = tribeSearch.toLowerCase();
		return allTribes
			.filter(
				(t) =>
					t.name.toLowerCase().includes(q) ||
					t.nameShort.toLowerCase().includes(q) ||
					String(t.id) === tribeSearch,
			)
			.slice(0, 10);
	}, [allTribes, tribeSearch]);
	const [selectedTribe, setSelectedTribe] = useState<{
		id: number;
		name: string;
	} | null>(null);

	const canSubmit =
		(kind === "character" && selectedCharacter) || (kind === "tribe" && selectedTribe);

	const handleAdd = async () => {
		if (!canSubmit) return;
		setIsPending(true);
		try {
			if (kind === "character" && selectedCharacter) {
				await onAdd({
					kind: "character",
					characterId: Number(selectedCharacter.characterItemId),
					characterName: selectedCharacter.name,
					standing,
					notes,
				});
			} else if (kind === "tribe" && selectedTribe) {
				await onAdd({
					kind: "tribe",
					tribeId: selectedTribe.id,
					tribeName: selectedTribe.name,
					standing,
					notes,
				});
			}
			setIsPending(false);
			// Defer dialog close to a macrotask so Dexie's liveQuery re-read
			// completes before React processes the unmount state update
			setTimeout(() => onClose(), 0);
		} catch {
			setIsPending(false);
		}
	};

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Add Contact</h2>

			{/* Kind selector */}
			<div className="mb-4 flex gap-2">
				<button
					type="button"
					onClick={() => setKind("character")}
					className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
						kind === "character"
							? "bg-cyan-600 text-white"
							: "bg-zinc-800 text-zinc-400 hover:text-zinc-300"
					}`}
				>
					Character
				</button>
				<button
					type="button"
					onClick={() => setKind("tribe")}
					className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
						kind === "tribe"
							? "bg-cyan-600 text-white"
							: "bg-zinc-800 text-zinc-400 hover:text-zinc-300"
					}`}
				>
					Tribe
				</button>
			</div>

			{/* Search */}
			{kind === "character" ? (
				<div className="mb-4">
					<span className="mb-1 block text-xs text-zinc-400">Character</span>
					{selectedCharacter ? (
						<div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
							<span className="text-sm text-zinc-200">{selectedCharacter.name}</span>
							<button
								type="button"
								onClick={() => setSelectedCharacter(null)}
								className="text-xs text-zinc-500 hover:text-zinc-300"
							>
								Change
							</button>
						</div>
					) : (
						<ContactPicker
							onSelect={(character) =>
								setSelectedCharacter({
									characterItemId: character.characterItemId,
									name: character.name,
								})
							}
							placeholder="Search characters..."
						/>
					)}
				</div>
			) : (
				<div className="mb-4">
					<span className="mb-1 block text-xs text-zinc-400">Tribe</span>
					{selectedTribe ? (
						<div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
							<span className="text-sm text-zinc-200">
								{selectedTribe.name} (#{selectedTribe.id})
							</span>
							<button
								type="button"
								onClick={() => setSelectedTribe(null)}
								className="text-xs text-zinc-500 hover:text-zinc-300"
							>
								Change
							</button>
						</div>
					) : (
						<div className="relative">
							<input
								type="text"
								value={tribeSearch}
								onChange={(e) => setTribeSearch(e.target.value)}
								placeholder="Search tribes by name or ID..."
								className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
							{matchedTribes.length > 0 && (
								<div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl">
									{matchedTribes.map((t) => (
										<button
											key={t.id}
											type="button"
											onClick={() => {
												setSelectedTribe({ id: t.id, name: t.name });
												setTribeSearch("");
											}}
											className="w-full px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
										>
											{t.name} <span className="text-zinc-500">#{t.id}</span>
										</button>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* Standing */}
			<div className="mb-3">
				<span className="mb-1 block text-xs text-zinc-400">Standing</span>
				<StandingSelect value={standing} onChange={setStanding} className="w-full" />
			</div>

			{/* Notes */}
			<label className="mb-4 block">
				<span className="mb-1 block text-xs text-zinc-400">Notes (optional)</span>
				<textarea
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					placeholder="Private notes about this contact..."
					rows={2}
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</label>

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleAdd}
					disabled={!canSubmit || isPending}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending && <Loader2 size={14} className="animate-spin" />}
					Add
				</button>
			</div>
		</DialogOverlay>
	);
}

// ── Edit Contact Dialog ─────────────────────────────────────────────────────

function EditContactDialog({
	contact,
	onClose,
	onUpdate,
}: {
	contact: Contact;
	onClose: () => void;
	onUpdate: (
		id: string,
		updates: Partial<Pick<Contact, "standing" | "notes" | "characterName" | "tribeName">>,
	) => Promise<void>;
}) {
	const [standing, setStanding] = useState(contact.standing);
	const [notes, setNotes] = useState(contact.notes);
	const [isPending, setIsPending] = useState(false);

	const handleSave = async () => {
		setIsPending(true);
		try {
			await onUpdate(contact.id, { standing, notes });
			onClose();
		} catch {
			// Update failed
		} finally {
			setIsPending(false);
		}
	};

	const displayName =
		contact.kind === "character"
			? (contact.characterName ?? `Character #${contact.characterId}`)
			: (contact.tribeName ?? `Tribe #${contact.tribeId}`);

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Edit Contact</h2>
			<p className="mb-4 text-sm text-zinc-400">{displayName}</p>

			<div className="mb-3">
				<span className="mb-1 block text-xs text-zinc-400">Standing</span>
				<StandingSelect value={standing} onChange={setStanding} className="w-full" />
			</div>

			<label className="mb-4 block">
				<span className="mb-1 block text-xs text-zinc-400">Notes</span>
				<textarea
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					rows={3}
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</label>

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleSave}
					disabled={isPending}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending && <Loader2 size={14} className="animate-spin" />}
					Save
				</button>
			</div>
		</DialogOverlay>
	);
}

// ── Create Registry Dialog ──────────────────────────────────────────────────

function CreateRegistryDialog({
	packageId,
	senderAddress,
	onClose,
	onCreated,
}: {
	packageId: string;
	senderAddress: string;
	onClose: () => void;
	onCreated: () => void;
}) {
	const dAppKit = useDAppKit();
	const [name, setName] = useState("");
	const [ticker, setTicker] = useState("");
	const [defaultStanding, setDefaultStanding] = useState(0);
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const tickerValid = /^[A-Z0-9]{3,6}$/.test(ticker);

	const handleCreate = async () => {
		if (!name.trim() || !tickerValid) return;
		setIsPending(true);
		setError(null);

		try {
			const tx = buildCreateRegistry({
				packageId,
				name: name.trim(),
				ticker: ticker.trim(),
				defaultStanding: displayToStanding(defaultStanding),
				senderAddress,
			});

			await dAppKit.signAndExecuteTransaction({ transaction: tx });
			await new Promise((r) => setTimeout(r, 3000));
			onCreated();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsPending(false);
		}
	};

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Create Standings Registry</h2>

			<label className="mb-3 block">
				<span className="mb-1 block text-xs text-zinc-400">Registry Name</span>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g., Alliance Standings"
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</label>

			<label className="mb-3 block">
				<span className="mb-1 block text-xs text-zinc-400">Ticker (3-6 chars, A-Z 0-9)</span>
				<input
					type="text"
					value={ticker}
					onChange={(e) =>
						setTicker(
							e.target.value
								.toUpperCase()
								.replace(/[^A-Z0-9]/g, "")
								.slice(0, 6),
						)
					}
					placeholder="e.g., BURQE"
					className={`w-full rounded-lg border bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none ${
						ticker && !tickerValid
							? "border-red-500 focus:border-red-500"
							: "border-zinc-700 focus:border-cyan-500"
					}`}
				/>
				{ticker && !tickerValid && (
					<p className="mt-1 text-[10px] text-red-400">Must be 3-6 characters, A-Z and 0-9 only</p>
				)}
			</label>

			<div className="mb-4">
				<span className="mb-1 block text-xs text-zinc-400">Default Standing</span>
				<StandingSelect value={defaultStanding} onChange={setDefaultStanding} className="w-full" />
				<p className="mt-1 text-[10px] text-zinc-600">
					Standing for entities not explicitly listed
				</p>
			</div>

			{error && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleCreate}
					disabled={!name.trim() || !tickerValid || isPending}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending && <Loader2 size={14} className="animate-spin" />}
					Create
				</button>
			</div>
		</DialogOverlay>
	);
}

// ── Set Registry Standing Dialog ────────────────────────────────────────────

function SetRegistryStandingDialog({
	packageId,
	registry,
	senderAddress,
	tenant,
	onClose,
	onSet,
}: {
	packageId: string;
	registry: StandingsRegistryInfo;
	senderAddress: string;
	tenant: string;
	onClose: () => void;
	onSet: () => void;
}) {
	const dAppKit = useDAppKit();
	const [kind, setKind] = useState<"character" | "tribe">("tribe");
	const [standing, setStanding] = useState(0);
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Character selection
	const [selectedCharacter, setSelectedCharacter] = useState<{
		characterItemId: string;
		name: string;
	} | null>(null);

	// Tribe selection
	const [tribeSearch, setTribeSearch] = useState("");
	const allTribes = useLiveQuery(() => db.manifestTribes.toArray()) ?? [];
	const matchedTribes = useMemo(() => {
		if (!tribeSearch || tribeSearch.length < 2) return [];
		const q = tribeSearch.toLowerCase();
		return allTribes
			.filter(
				(t) =>
					t.name.toLowerCase().includes(q) ||
					t.nameShort.toLowerCase().includes(q) ||
					String(t.id) === tribeSearch,
			)
			.slice(0, 10);
	}, [allTribes, tribeSearch]);
	const [selectedTribe, setSelectedTribe] = useState<{
		id: number;
		name: string;
	} | null>(null);

	const canSubmit =
		(kind === "character" && selectedCharacter) || (kind === "tribe" && selectedTribe);

	const handleSet = async () => {
		if (!canSubmit) return;
		setIsPending(true);
		setError(null);

		try {
			const rawStanding = displayToStanding(standing);

			if (kind === "tribe" && selectedTribe) {
				const tx = buildSetTribeStanding({
					packageId,
					registryId: registry.objectId,
					tribeId: selectedTribe.id,
					standing: rawStanding,
					senderAddress,
				});
				await dAppKit.signAndExecuteTransaction({ transaction: tx });
			} else if (kind === "character" && selectedCharacter) {
				const tx = buildSetCharacterStanding({
					packageId,
					registryId: registry.objectId,
					characterId: Number(selectedCharacter.characterItemId),
					standing: rawStanding,
					senderAddress,
				});
				await dAppKit.signAndExecuteTransaction({ transaction: tx });
			}

			await new Promise((r) => setTimeout(r, 2000));
			onSet();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsPending(false);
		}
	};

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Set Standing</h2>
			<p className="mb-4 text-xs text-zinc-500">
				Registry: {registry.name} ({registry.ticker})
			</p>

			{/* Kind selector */}
			<div className="mb-4 flex gap-2">
				<button
					type="button"
					onClick={() => setKind("tribe")}
					className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
						kind === "tribe"
							? "bg-cyan-600 text-white"
							: "bg-zinc-800 text-zinc-400 hover:text-zinc-300"
					}`}
				>
					Tribe
				</button>
				<button
					type="button"
					onClick={() => setKind("character")}
					className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
						kind === "character"
							? "bg-cyan-600 text-white"
							: "bg-zinc-800 text-zinc-400 hover:text-zinc-300"
					}`}
				>
					Character
				</button>
			</div>

			{/* Entity search */}
			{kind === "character" ? (
				<div className="mb-4">
					<span className="mb-1 block text-xs text-zinc-400">Character</span>
					{selectedCharacter ? (
						<div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
							<span className="text-sm text-zinc-200">{selectedCharacter.name}</span>
							<button
								type="button"
								onClick={() => setSelectedCharacter(null)}
								className="text-xs text-zinc-500 hover:text-zinc-300"
							>
								Change
							</button>
						</div>
					) : (
						<ContactPicker
							onSelect={(character) =>
								setSelectedCharacter({
									characterItemId: character.characterItemId,
									name: character.name,
								})
							}
							placeholder="Search characters..."
							tenant={tenant}
						/>
					)}
				</div>
			) : (
				<div className="mb-4">
					<span className="mb-1 block text-xs text-zinc-400">Tribe</span>
					{selectedTribe ? (
						<div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
							<span className="text-sm text-zinc-200">
								{selectedTribe.name} (#{selectedTribe.id})
							</span>
							<button
								type="button"
								onClick={() => setSelectedTribe(null)}
								className="text-xs text-zinc-500 hover:text-zinc-300"
							>
								Change
							</button>
						</div>
					) : (
						<div className="relative">
							<input
								type="text"
								value={tribeSearch}
								onChange={(e) => setTribeSearch(e.target.value)}
								placeholder="Search tribes..."
								className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
							{matchedTribes.length > 0 && (
								<div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl">
									{matchedTribes.map((t) => (
										<button
											key={t.id}
											type="button"
											onClick={() => {
												setSelectedTribe({ id: t.id, name: t.name });
												setTribeSearch("");
											}}
											className="w-full px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
										>
											{t.name} <span className="text-zinc-500">#{t.id}</span>
										</button>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* Standing */}
			<div className="mb-4">
				<span className="mb-1 block text-xs text-zinc-400">Standing</span>
				<StandingSelect value={standing} onChange={setStanding} className="w-full" />
			</div>

			{error && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleSet}
					disabled={!canSubmit || isPending}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending && <Loader2 size={14} className="animate-spin" />}
					Set Standing
				</button>
			</div>
		</DialogOverlay>
	);
}

// ── Add Admin Dialog ────────────────────────────────────────────────────────

function AddAdminDialog({
	packageId,
	registryId,
	senderAddress,
	onClose,
	onAdded,
}: {
	packageId: string;
	registryId: string;
	senderAddress: string;
	onClose: () => void;
	onAdded: () => void;
}) {
	const dAppKit = useDAppKit();
	const [selectedCharacter, setSelectedCharacter] = useState<{
		suiAddress: string;
		name: string;
	} | null>(null);
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleAdd = async () => {
		if (!selectedCharacter) return;
		setIsPending(true);
		setError(null);

		try {
			const tx = buildAddRegistryAdmin({
				packageId,
				registryId,
				adminAddress: selectedCharacter.suiAddress,
				senderAddress,
			});

			await dAppKit.signAndExecuteTransaction({ transaction: tx });
			await new Promise((r) => setTimeout(r, 2000));
			onAdded();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsPending(false);
		}
	};

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Add Admin</h2>

			<div className="mb-4">
				<span className="mb-1 block text-xs text-zinc-400">Admin Address</span>
				{selectedCharacter ? (
					<div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
						<span className="text-sm text-zinc-200">{selectedCharacter.name}</span>
						<button
							type="button"
							onClick={() => setSelectedCharacter(null)}
							className="text-xs text-zinc-500 hover:text-zinc-300"
						>
							Change
						</button>
					</div>
				) : (
					<ContactPicker
						onSelect={(character) =>
							setSelectedCharacter({
								suiAddress: character.suiAddress,
								name: character.name,
							})
						}
						placeholder="Search characters..."
						excludeAddresses={[senderAddress]}
					/>
				)}
			</div>

			{error && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleAdd}
					disabled={!selectedCharacter || isPending}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending && <Loader2 size={14} className="animate-spin" />}
					Add Admin
				</button>
			</div>
		</DialogOverlay>
	);
}
