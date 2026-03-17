import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Edit2,
	Info,
	Loader2,
	Package,
	Plus,
	RefreshCw,
	ShoppingBag,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { type TenantId, TENANTS, getTemplate } from "@/chain/config";
import { buildAuthorizeExtension } from "@/chain/transactions";
import type { CharacterInfo, OwnedAssembly } from "@/chain/queries";
import { SsuInventoryPanel } from "@/components/SsuInventoryPanel";
import { TypeSearchInput } from "@/components/TypeSearchInput";
import { db, notDeleted } from "@/db";
import type { CurrencyRecord } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useExtensionDeploy } from "@/hooks/useExtensionDeploy";
import { useOrgMarket } from "@/hooks/useOrgMarket";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useOwnedAssemblies } from "@/hooks/useOwnedAssemblies";
import {
	buildAddAuthorizedSsu,
	buildCancelBuyOrder,
	buildCancelSellOrder,
	buildConfirmBuyOrderFill,
	buildCreateMarket,
	buildCreateOrgMarket,
	buildCreateSellOrder,
	buildFundBuyOrder,
	buildRemoveAuthorizedSsu,
	buildUpdateSellPrice,
	discoverMarketConfig,
	getContractAddresses,
} from "@tehfrontier/chain-shared";
import { useSellOrders } from "@/hooks/useSellOrders";

type Tab = "sell" | "buy";

type OpStatus = "idle" | "processing" | "done" | "error";

interface DiscoveryData {
	character: CharacterInfo | null;
	assemblies: OwnedAssembly[];
}

export function GovernanceTrade() {
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const tenant = useActiveTenant();
	const [tab, setTab] = useState<Tab>("sell");

	// Lift useOwnedAssemblies to parent — shared by both tabs + TradeNodeManager
	const { data: discovery } = useOwnedAssemblies();

	const org = useLiveQuery(() => db.organizations.filter(notDeleted).first());
	const currencies = useLiveQuery(
		() => (org ? db.currencies.where("orgId").equals(org.id).filter(notDeleted).toArray() : []),
		[org?.id],
	);

	const publishedCurrencies = (currencies ?? []).filter((c) => c.packageId && c.orgTreasuryId);

	console.log("[Trade] activeCharacter:", activeCharacter?.id, "org:", org?.id, org?.chainObjectId, "currencies:", currencies?.length, "published:", publishedCurrencies.length, "raw:", currencies);

	if (!activeCharacter || !suiAddress) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<ShoppingBag size={48} className="mx-auto mb-4 text-zinc-700" />
					<p className="text-sm text-zinc-500">Select a character to manage trade</p>
					<a
						href="/manifest"
						className="mt-2 inline-block text-xs text-cyan-400 hover:text-cyan-300"
					>
						Go to Manifest &rarr;
					</a>
				</div>
			</div>
		);
	}

	if (!org) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<Header />
				<div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
					<AlertCircle size={32} className="text-zinc-600" />
					<p className="text-sm text-zinc-500">Create an organization first</p>
					<a href="/governance" className="text-xs text-cyan-400 hover:text-cyan-300">
						Go to Organization &rarr;
					</a>
				</div>
			</div>
		);
	}

	if (publishedCurrencies.length === 0) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<Header />
				<div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
					<Package size={32} className="text-zinc-600" />
					<p className="text-sm text-zinc-500">Set up a currency with OrgTreasury first</p>
					<a href="/governance/finance" className="text-xs text-cyan-400 hover:text-cyan-300">
						Go to Finance &rarr;
					</a>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-3xl p-6">
			<Header />

			{/* Trade Node Manager */}
			<TradeNodeManager discovery={discovery ?? null} tenant={tenant} org={org} />

			{/* Tabs */}
			<div className="mb-6 flex gap-1 rounded-lg bg-zinc-900/50 p-1">
				{(["sell", "buy"] as Tab[]).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
							tab === t ? "bg-zinc-800 text-cyan-400" : "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						{t === "sell" ? "Sell Orders" : "Buy Orders"}
					</button>
				))}
			</div>

			{tab === "sell" && (
				<SellOrdersTab
					tenant={tenant}
					account={account ?? undefined}
					discovery={discovery ?? null}
				/>
			)}

			{tab === "buy" && (
				<BuyOrdersTab
					org={org}
					currencies={publishedCurrencies}
					tenant={tenant}
					account={account ?? undefined}
					discovery={discovery ?? null}
				/>
			)}
		</div>
	);
}

function Header() {
	return (
		<div className="mb-6 flex items-center justify-between">
			<div>
				<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
					<ShoppingBag size={24} className="text-cyan-500" />
					Trade
				</h1>
				<p className="mt-1 text-sm text-zinc-500">SSU market management and org procurement</p>
			</div>
		</div>
	);
}

// ── Trade Node Manager ────────────────────────────────────────────────────

function TradeNodeManager({
	discovery,
	tenant,
	org,
}: {
	discovery: DiscoveryData | null;
	tenant: TenantId;
	org: { id: string; chainObjectId?: string; orgMarketId?: string };
}) {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const suiClient = useSuiClient();
	const addresses = getContractAddresses(tenant);
	const tradeNodes = useLiveQuery(() => db.tradeNodes.toArray()) ?? [];
	const tradeNodeIds = useMemo(() => new Set(tradeNodes.map((tn) => tn.id)), [tradeNodes]);

	const [expanded, setExpanded] = useState(false);
	const [enablingId, setEnablingId] = useState<string | null>(null);
	const [newName, setNewName] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editName, setEditName] = useState("");
	const { deploy, status: deployStatus, reset: resetDeploy } = useExtensionDeploy();

	// Fetch org market from chain to get authorizedSsus
	const { orgMarketInfo } = useOrgMarket(org, tenant);
	const authorizedSsuIds = useMemo(
		() => new Set(orgMarketInfo?.authorizedSsus ?? []),
		[orgMarketInfo?.authorizedSsus],
	);

	// Also check local extensions DB for SSUs that were enabled but not yet authorized
	const localExtensions = useLiveQuery(() => db.extensions.toArray()) ?? [];
	const localExtensionAssemblyIds = useMemo(
		() => new Set(localExtensions.map((e) => e.assemblyId)),
		[localExtensions],
	);

	// Auto-sync: SSUs that are authorized on-chain or have local extensions are trade nodes
	useEffect(() => {
		if (!discovery?.assemblies) return;
		const storageTypes = new Set(["storage_unit", "smart_storage_unit", "protocol_depot"]);
		const ssus = discovery.assemblies.filter((a) => storageTypes.has(a.type));

		console.log("[TradeNode-sync] orgMarketInfo:", orgMarketInfo);
		console.log("[TradeNode-sync] authorizedSsus:", [...authorizedSsuIds]);
		console.log("[TradeNode-sync] localExtensions:", [...localExtensionAssemblyIds]);
		console.log("[TradeNode-sync] tradeNodeIds:", [...tradeNodeIds]);

		for (const ssu of ssus) {
			const isOnChain = authorizedSsuIds.has(ssu.objectId);
			const isLocal = localExtensionAssemblyIds.has(ssu.objectId);
			const hasExtField = !!ssu.extensionType;
			console.log(`[TradeNode-sync] SSU ${ssu.objectId.slice(0, 10)}: onChain=${isOnChain} local=${isLocal} extField=${hasExtField} inDB=${tradeNodeIds.has(ssu.objectId)}`);

			if ((isOnChain || isLocal || hasExtField) && !tradeNodeIds.has(ssu.objectId)) {
				db.tradeNodes.put({
					id: ssu.objectId,
					name: `Trade Node ${ssu.objectId.slice(0, 8)}`,
					enabledAt: new Date().toISOString(),
				});
			}
		}
	}, [discovery?.assemblies, tradeNodeIds, authorizedSsuIds, localExtensionAssemblyIds]);

	// SSUs that can become Trade Nodes (not already a trade node)
	const unregisteredSsus = useMemo(
		() =>
			(discovery?.assemblies ?? []).filter(
				(a) =>
					(a.type === "storage_unit" ||
						a.type === "smart_storage_unit" ||
						a.type === "protocol_depot") &&
					!tradeNodeIds.has(a.objectId) &&
					!authorizedSsuIds.has(a.objectId) &&
					!localExtensionAssemblyIds.has(a.objectId),
			),
		[discovery?.assemblies, tradeNodeIds, authorizedSsuIds, localExtensionAssemblyIds],
	);

	// Auto-expand if no Trade Nodes
	const showExpanded = expanded || tradeNodes.length === 0;

	async function handleEnable(ssu: OwnedAssembly) {
		if (!discovery?.character) return;
		if (!ssu.ownerCapId) return;

		const template = getTemplate("ssu_market");
		if (!template) return;

		const name = newName.trim() || `Trade Node ${ssu.objectId.slice(0, 8)}`;

		setEnablingId(ssu.objectId);
		resetDeploy();

		await deploy({
			template,
			assemblyId: ssu.objectId,
			assemblyType: ssu.type,
			characterId: discovery.character.characterObjectId,
			ownerCapId: ssu.ownerCapId,
			tenant,
		});

		// Auto-create market config after extension deploy
		let marketConfigId: string | undefined;
		if (addresses.ssuMarket?.packageId && account?.address) {
			try {
				const tx = buildCreateMarket({
					packageId: addresses.ssuMarket.packageId,
					ssuId: ssu.objectId,
					senderAddress: account.address,
				});

				const result = await signAndExecute({ transaction: tx });

				const txResponse = await suiClient.waitForTransaction({
					digest: result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "",
					include: { effects: true, objectTypes: true },
				});
				const txData = txResponse.Transaction ?? txResponse.FailedTransaction;
				const changed = txData?.effects?.changedObjects ?? [];
				const typeMap = txData?.objectTypes ?? {};

				const marketCreated = changed.find(
					(change) =>
						change.idOperation === "Created" &&
						(typeMap[change.objectId] ?? "").includes("::ssu_market::MarketConfig"),
				);

				if (marketCreated) {
					marketConfigId = marketCreated.objectId;
				}
			} catch (err) {
				console.warn("[TradeNode] Failed to auto-create market:", err);
			}
		}

		await db.tradeNodes.put({
			id: ssu.objectId,
			name,
			enabledAt: new Date().toISOString(),
			marketConfigId,
		});

		setEnablingId(null);
		setNewName("");
		resetDeploy();
	}

	async function handleRename(id: string) {
		if (editName.trim()) {
			await db.tradeNodes.update(id, { name: editName.trim() });
		}
		setEditingId(null);
		setEditName("");
	}

	const [reauthorizingId, setReauthorizingId] = useState<string | null>(null);

	async function handleReauthorize(ssuId: string) {
		if (!discovery?.character || !account) return;
		const ssu = discovery.assemblies.find((a) => a.objectId === ssuId);
		if (!ssu?.ownerCapId) return;

		const template = getTemplate("ssu_market");
		if (!template) return;

		setReauthorizingId(ssuId);
		try {
			const tx = buildAuthorizeExtension({
				tenant,
				template,
				assemblyType: ssu.type,
				assemblyId: ssu.objectId,
				characterId: discovery.character.characterObjectId,
				ownerCapId: ssu.ownerCapId,
				senderAddress: account.address,
			});
			await signAndExecute({ transaction: tx });
		} catch (err) {
			console.error("[ReAuth] Failed:", err);
		} finally {
			setReauthorizingId(null);
		}
	}

	function statusDot(ssu: OwnedAssembly | undefined) {
		if (!ssu) return <span className="h-2 w-2 rounded-full bg-zinc-600" />;
		const color =
			ssu.status === "online"
				? "bg-green-400"
				: ssu.status === "anchoring"
					? "bg-yellow-400"
					: "bg-zinc-600";
		return <span className={`h-2 w-2 rounded-full ${color}`} />;
	}

	return (
		<div className="mb-6">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="mb-3 flex w-full items-center gap-2 text-sm font-medium text-zinc-400 hover:text-zinc-300"
			>
				{showExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				Trade Nodes ({tradeNodes.length})
			</button>

			{showExpanded && (
				<div className="space-y-3">
					{/* Existing Trade Nodes */}
					{tradeNodes.length > 0 && (
						<div className="space-y-1">
							{tradeNodes.map((tn) => {
								const ssu = discovery?.assemblies.find((a) => a.objectId === tn.id);
								return (
									<div
										key={tn.id}
										className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-zinc-800/30"
									>
										{statusDot(ssu)}
										{editingId === tn.id ? (
											<>
												<input
													type="text"
													value={editName}
													onChange={(e) => setEditName(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === "Enter") handleRename(tn.id);
													}}
													className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
												/>
												<button
													type="button"
													onClick={() => handleRename(tn.id)}
													className="text-green-400 hover:text-green-300"
												>
													<Check size={12} />
												</button>
											</>
										) : (
											<>
												<span className="flex-1 text-zinc-200">{tn.name}</span>
												<span className="font-mono text-xs text-zinc-600">
													{tn.id.slice(0, 10)}...
												</span>
												<button
													type="button"
													onClick={() => {
														setEditingId(tn.id);
														setEditName(tn.name);
													}}
													className="text-zinc-600 hover:text-zinc-400"
													title="Rename"
												>
													<Edit2 size={12} />
												</button>
												{account ? (
													<button
														type="button"
														onClick={() => handleReauthorize(tn.id)}
														disabled={reauthorizingId === tn.id}
														className="rounded bg-amber-600/20 px-2 py-0.5 text-[10px] text-amber-400 hover:bg-amber-600/30 disabled:opacity-40"
														title="Re-authorize ssu_market extension on this SSU"
													>
														{reauthorizingId === tn.id ? (
															<span className="flex items-center gap-1">
																<Loader2 size={10} className="animate-spin" />
																Auth...
															</span>
														) : (
															"Re-auth"
														)}
													</button>
												) : (
													<span className="text-xs text-zinc-500">EVE Vault not connected</span>
												)}
											</>
										)}
									</div>
								);
							})}
						</div>
					)}

					{/* Enable New Trade Node */}
					{unregisteredSsus.length > 0 ? (
						<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
							<h4 className="mb-2 text-xs font-medium text-zinc-400">Enable New Trade Node</h4>
							<div className="space-y-2">
								{unregisteredSsus.map((ssu) => (
									<div key={ssu.objectId} className="flex items-center gap-2 text-xs">
										{statusDot(ssu)}
										<span className="font-mono text-zinc-400">
											{ssu.type} -- {ssu.objectId.slice(0, 10)}
											...
										</span>
										{enablingId === ssu.objectId ? (
											<div className="ml-auto flex items-center gap-2">
												<input
													type="text"
													value={newName}
													onChange={(e) => setNewName(e.target.value)}
													placeholder={`Trade Node ${ssu.objectId.slice(0, 8)}`}
													className="w-40 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
												/>
												{!ssu.ownerCapId ? (
													<span className="text-xs text-red-400">OwnerCap not found</span>
												) : !discovery?.character ? (
													<span className="text-xs text-red-400">No character</span>
												) : (
													<button
														type="button"
														onClick={() => handleEnable(ssu)}
														disabled={
															deployStatus === "building" ||
															deployStatus === "signing" ||
															deployStatus === "confirming"
														}
														className="rounded bg-cyan-600/20 px-2 py-1 text-xs text-cyan-400 hover:bg-cyan-600/30 disabled:opacity-40"
													>
														{deployStatus === "building" ||
														deployStatus === "signing" ||
														deployStatus === "confirming" ? (
															<span className="flex items-center gap-1">
																<Loader2 size={10} className="animate-spin" />
																Enabling...
															</span>
														) : (
															"Confirm"
														)}
													</button>
												)}
												<button
													type="button"
													onClick={() => {
														setEnablingId(null);
														setNewName("");
														resetDeploy();
													}}
													className="text-zinc-500 hover:text-zinc-300"
												>
													Cancel
												</button>
											</div>
										) : (
											<button
												type="button"
												onClick={() => setEnablingId(ssu.objectId)}
												className="ml-auto rounded bg-cyan-600/20 px-2 py-1 text-xs text-cyan-400 hover:bg-cyan-600/30"
											>
												Enable as Trade Node
											</button>
										)}
									</div>
								))}
							</div>
						</div>
					) : tradeNodes.length === 0 ? (
						<p className="text-xs text-zinc-500">
							No owned SSUs found. Deploy a Storage Unit in-game first.
						</p>
					) : null}
				</div>
			)}
		</div>
	);
}

// ── Sell Orders Tab ───────────────────────────────────────────────────────

function SellOrdersTab({
	tenant,
	account,
	discovery,
}: {
	tenant: TenantId;
	account?: { address: string };
	discovery: DiscoveryData | null;
}) {
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const suiClient = useSuiClient();
	const addresses = getContractAddresses(tenant);
	const tenantConfig = (TENANTS as Record<string, { worldPackageId: string }>)[tenant];
	const worldPackageId = tenantConfig?.worldPackageId ?? "";
	const tradeNodes = useLiveQuery(() => db.tradeNodes.toArray()) ?? [];
	const tradeNodeIds = useMemo(() => new Set(tradeNodes.map((tn) => tn.id)), [tradeNodes]);

	// Filter SSUs to Trade Nodes only
	const ssus = useMemo(
		() =>
			(discovery?.assemblies ?? []).filter(
				(a) =>
					(a.type === "storage_unit" ||
						a.type === "smart_storage_unit" ||
						a.type === "protocol_depot") &&
					tradeNodeIds.has(a.objectId),
			),
		[discovery?.assemblies, tradeNodeIds],
	);

	// Auto-discover MarketConfig for trade nodes — always re-discover with current tenant's package
	// to handle tenant switches (Stillness vs Utopia use different ssu_market packages)
	useEffect(() => {
		const originalPkgId = addresses.ssuMarket?.originalPackageId;
		if (!originalPkgId) return;

		for (const tn of tradeNodes) {
			discoverMarketConfig(suiClient, originalPkgId, tn.id).then((configId) => {
				if (configId && configId !== tn.marketConfigId) {
					db.tradeNodes.update(tn.id, { marketConfigId: configId });
				} else if (!configId && tn.marketConfigId) {
					// Current tenant has no config — clear stale one from different tenant
					db.tradeNodes.update(tn.id, { marketConfigId: undefined });
				}
			});
		}
	}, [tradeNodes.length, addresses.ssuMarket?.originalPackageId, suiClient]);

	const [opStatus, setOpStatus] = useState<OpStatus>("idle");
	const [opError, setOpError] = useState("");

	// Create sell order form state
	const [creatingOrder, setCreatingOrder] = useState(false);
	const [orderSsuId, setOrderSsuId] = useState("");
	const [manualConfigId, setManualConfigId] = useState("");
	const [orderTypeId, setOrderTypeId] = useState<number | null>(null);
	const [orderQuantity, setOrderQuantity] = useState("");
	const [orderPrice, setOrderPrice] = useState("");

	// Inline edit price state
	const [editingPriceTypeId, setEditingPriceTypeId] = useState<number | null>(null);
	const [editPriceValue, setEditPriceValue] = useState("");
	const [editPriceConfigId, setEditPriceConfigId] = useState("");

	// Auto-create market state
	const [autoCreatingMarket, setAutoCreatingMarket] = useState(false);

	// Cancel order state
	const [cancellingTypeId, setCancellingTypeId] = useState<number | null>(null);
	const [cancelQuantity, setCancelQuantity] = useState("");
	const [cancelConfigId, setCancelConfigId] = useState("");
	const [cancelSsuId, setCancelSsuId] = useState("");

	// Type name map
	const gameTypes = useLiveQuery(() => db.gameTypes.toArray()) ?? [];
	const typeNameMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const gt of gameTypes) {
			map[gt.id] = gt.name;
		}
		return map;
	}, [gameTypes]);

	function tradeNodeLabel(objectId: string) {
		const tn = tradeNodes.find((n) => n.id === objectId);
		return tn ? `${tn.name} -- ${objectId.slice(0, 10)}...` : `${objectId.slice(0, 10)}...`;
	}

	// Get marketConfigId for selected SSU (DB value or manual entry)
	const selectedTradeNode = tradeNodes.find((tn) => tn.id === orderSsuId);
	const selectedConfigId = selectedTradeNode?.marketConfigId || manualConfigId || undefined;

	// Query sell orders for each trade node that has a marketConfigId
	const tradeNodesWithMarket = tradeNodes.filter((tn) => tn.marketConfigId);

	async function autoCreateMarket(ssuId: string) {
		if (!addresses.ssuMarket?.packageId || !account) return;

		setAutoCreatingMarket(true);
		try {
			const tx = buildCreateMarket({
				packageId: addresses.ssuMarket.packageId,
				ssuId,
				senderAddress: account.address,
			});

			const result = await signAndExecute({ transaction: tx });

			const txResponse = await suiClient.waitForTransaction({
				digest: result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "",
				include: { effects: true, objectTypes: true },
			});
			const txData = txResponse.Transaction ?? txResponse.FailedTransaction;
			const changed = txData?.effects?.changedObjects ?? [];
			const typeMap = txData?.objectTypes ?? {};

			const marketCreated = changed.find(
				(change) =>
					change.idOperation === "Created" &&
					(typeMap[change.objectId] ?? "").includes("::ssu_market::MarketConfig"),
			);

			if (marketCreated) {
				await db.tradeNodes.update(ssuId, {
					marketConfigId: marketCreated.objectId,
				});
			}
		} catch (err) {
			setOpError(err instanceof Error ? err.message : String(err));
			setOpStatus("error");
		} finally {
			setAutoCreatingMarket(false);
		}
	}

	function handleOrderSsuChange(ssuId: string) {
		setOrderSsuId(ssuId);
		if (!ssuId) return;
		const tn = tradeNodes.find((n) => n.id === ssuId);
		if (!tn?.marketConfigId) {
			autoCreateMarket(ssuId);
		}
	}

	async function handleCreateSellOrder() {
		const missing = [
			!orderSsuId && "orderSsuId",
			orderTypeId === null && "orderTypeId",
			!orderQuantity && "orderQuantity",
			!orderPrice && "orderPrice",
			!addresses.ssuMarket?.packageId && "ssuMarket.packageId",
			!account && "account (wallet not connected)",
			!discovery?.character && "discovery.character",
			!worldPackageId && "worldPackageId",
		].filter(Boolean);
		if (missing.length > 0) {
			console.warn("[CreateSellOrder] blocked by:", missing);
			setOpError(`Missing: ${missing.join(", ")}`);
			setOpStatus("error");
			return;
		}

		let configId = selectedConfigId;
		if (!configId) {
			// Auto-create market on the fly
			if (!addresses.ssuMarket?.packageId || !account) {
				setOpError("Cannot auto-create market: wallet not connected.");
				setOpStatus("error");
				return;
			}
			setOpStatus("processing");
			setOpError("");
			try {
				const marketTx = buildCreateMarket({
					packageId: addresses.ssuMarket.packageId,
					ssuId: orderSsuId,
					senderAddress: account.address,
				});
				const marketResult = await signAndExecute({ transaction: marketTx });
				const marketResponse = await suiClient.waitForTransaction({
					digest: marketResult.Transaction?.digest ?? marketResult.FailedTransaction?.digest ?? "",
					include: { effects: true, objectTypes: true },
				});
				const txData = marketResponse.Transaction ?? marketResponse.FailedTransaction;
				const changed = txData?.effects?.changedObjects ?? [];
				const typeMap = txData?.objectTypes ?? {};
				const created = changed.find(
					(c) =>
						c.idOperation === "Created" &&
						(typeMap[c.objectId] ?? "").includes("::ssu_market::MarketConfig"),
				);
				if (created) {
					configId = created.objectId;
					await db.tradeNodes.update(orderSsuId, { marketConfigId: configId });
				} else {
					setOpError("Market created but could not find MarketConfig in transaction. Check explorer.");
					setOpStatus("error");
					return;
				}
			} catch (err) {
				setOpError(`Failed to create market: ${err instanceof Error ? err.message : String(err)}`);
				setOpStatus("error");
				return;
			}
		}

		const ssu = ssus.find((s) => s.objectId === orderSsuId);
		if (!ssu?.ownerCapId) {
			setOpError("OwnerCap not found for this SSU");
			setOpStatus("error");
			return;
		}

		setOpStatus("processing");
		setOpError("");
		try {
			const tx = buildCreateSellOrder({
				packageId: addresses.ssuMarket!.packageId,
				worldPackageId,
				configObjectId: configId,
				ssuObjectId: orderSsuId,
				characterObjectId: discovery!.character!.characterObjectId,
				ownerCapReceivingId: ssu.ownerCapId,
				typeId: orderTypeId!,
				quantity: Number(orderQuantity),
				pricePerUnit: Number(orderPrice),
				senderAddress: account!.address,
			});

			await signAndExecute({ transaction: tx });
			setCreatingOrder(false);
			setOrderTypeId(null);
			setOrderQuantity("");
			setOrderPrice("");
			setOpStatus("done");
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleUpdatePrice() {
		if (
			editingPriceTypeId === null ||
			!editPriceValue ||
			!editPriceConfigId ||
			!addresses.ssuMarket?.packageId ||
			!account
		)
			return;

		setOpStatus("processing");
		setOpError("");
		try {
			const tx = buildUpdateSellPrice({
				packageId: addresses.ssuMarket.packageId,
				configObjectId: editPriceConfigId,
				typeId: editingPriceTypeId,
				pricePerUnit: Number(editPriceValue),
				senderAddress: account.address,
			});

			await signAndExecute({ transaction: tx });
			setEditingPriceTypeId(null);
			setEditPriceValue("");
			setEditPriceConfigId("");
			setOpStatus("done");
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleCancelSellOrder() {
		if (
			cancellingTypeId === null ||
			!cancelQuantity ||
			!cancelConfigId ||
			!cancelSsuId ||
			!addresses.ssuMarket?.packageId ||
			!account ||
			!discovery?.character
		)
			return;

		setOpStatus("processing");
		setOpError("");
		try {
			const tx = buildCancelSellOrder({
				packageId: addresses.ssuMarket.packageId,
				configObjectId: cancelConfigId,
				ssuObjectId: cancelSsuId,
				characterObjectId: discovery.character.characterObjectId,
				typeId: cancellingTypeId,
				quantity: Number(cancelQuantity),
				senderAddress: account.address,
			});

			await signAndExecute({ transaction: tx });
			setCancellingTypeId(null);
			setCancelQuantity("");
			setCancelConfigId("");
			setCancelSsuId("");
			setOpStatus("done");
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div>
			<OpStatusBanner
				status={opStatus}
				error={opError}
				onDismiss={() => {
					setOpStatus("idle");
					setOpError("");
				}}
			/>

			{/* Active Sell Orders per Trade Node */}
			{tradeNodesWithMarket.length > 0 && (
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-medium text-zinc-400">Active Sell Orders</h3>
					{tradeNodesWithMarket.map((tn) => (
						<SellOrdersForNode
							key={tn.id}
							tradeNode={tn}
							typeNameMap={typeNameMap}
							onEditPrice={(typeId, price, configId) => {
								setEditingPriceTypeId(typeId);
								setEditPriceValue(String(price));
								setEditPriceConfigId(configId);
							}}
							onCancel={(typeId, quantity, configId, ssuId) => {
								setCancellingTypeId(typeId);
								setCancelQuantity(String(quantity));
								setCancelConfigId(configId);
								setCancelSsuId(ssuId);
							}}
						/>
					))}
				</div>
			)}

			{/* Inline edit price */}
			{editingPriceTypeId !== null && (
				<div className="mb-4 rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-3">
					<h4 className="mb-2 text-xs font-medium text-cyan-400">
						Update Price -- {typeNameMap[editingPriceTypeId] ?? `Type #${editingPriceTypeId}`}
					</h4>
					<div className="flex items-center gap-2">
						<input
							type="number"
							value={editPriceValue}
							onChange={(e) => setEditPriceValue(e.target.value)}
							className="w-32 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
						/>
						<button
							type="button"
							onClick={handleUpdatePrice}
							disabled={!editPriceValue || opStatus === "processing"}
							className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
						>
							Save
						</button>
						<button
							type="button"
							onClick={() => {
								setEditingPriceTypeId(null);
								setEditPriceValue("");
							}}
							className="text-xs text-zinc-500 hover:text-zinc-300"
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Inline cancel */}
			{cancellingTypeId !== null && (
				<div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/20 p-3">
					<h4 className="mb-2 text-xs font-medium text-red-400">
						Cancel Sell Order -- {typeNameMap[cancellingTypeId] ?? `Type #${cancellingTypeId}`}
					</h4>
					<div className="flex items-center gap-2">
						<label className="text-xs text-zinc-500">Quantity:</label>
						<input
							type="number"
							value={cancelQuantity}
							onChange={(e) => setCancelQuantity(e.target.value)}
							className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
						/>
						<button
							type="button"
							onClick={handleCancelSellOrder}
							disabled={!cancelQuantity || opStatus === "processing"}
							className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
						>
							Confirm Cancel
						</button>
						<button
							type="button"
							onClick={() => {
								setCancellingTypeId(null);
								setCancelQuantity("");
							}}
							className="text-xs text-zinc-500 hover:text-zinc-300"
						>
							Dismiss
						</button>
					</div>
				</div>
			)}

			{/* Create Sell Order */}
			<div className="mb-6">
				<h3 className="mb-3 text-sm font-medium text-zinc-400">Create Sell Order</h3>

				{ssus.length === 0 ? (
					<p className="text-xs text-zinc-500">Enable an SSU as a Trade Node first (see above).</p>
				) : creatingOrder ? (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
						<div className="space-y-3">
							<div>
								<label className="mb-1.5 block text-xs text-zinc-500">Trade Node</label>
								<select
									value={orderSsuId}
									onChange={(e) => handleOrderSsuChange(e.target.value)}
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
								>
									<option value="">Choose a Trade Node...</option>
									{ssus.map((s) => (
										<option key={s.objectId} value={s.objectId}>
											{tradeNodeLabel(s.objectId)}
										</option>
									))}
								</select>
								{orderSsuId && !selectedTradeNode?.marketConfigId && (
									autoCreatingMarket ? (
										<div className="mt-1 flex items-center gap-2 text-xs text-cyan-400">
											<Loader2 size={10} className="animate-spin" />
											Setting up market...
										</div>
									) : (
										<div className="mt-2">
											<label className="mb-1 block text-xs text-zinc-500">
												MarketConfig ID (paste existing or create above)
											</label>
											<input
												type="text"
												value={manualConfigId}
												onChange={(e) => setManualConfigId(e.target.value.trim())}
												placeholder="0x..."
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
									)
								)}
							</div>

							{/* Inventory browser -- only show owner inventory (available to sell) */}
							{orderSsuId && (
								<SsuInventoryPanel
									assemblyId={orderSsuId}
									assemblyType="storage_unit"
									onSelectItem={(typeId) => setOrderTypeId(typeId)}
									filterKind="owner"
								/>
							)}

							<div>
								<label className="mb-1.5 block text-xs text-zinc-500">Item Type</label>
								<TypeSearchInput
									value={orderTypeId}
									onChange={setOrderTypeId}
									placeholder="Search items or click inventory..."
								/>
							</div>

							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className="mb-1.5 block text-xs text-zinc-500">Quantity</label>
									<input
										type="number"
										value={orderQuantity}
										onChange={(e) => setOrderQuantity(e.target.value)}
										placeholder="e.g., 100"
										className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
									/>
								</div>
								<div>
									<label className="mb-1.5 block text-xs text-zinc-500">Price Per Unit</label>
									<input
										type="number"
										value={orderPrice}
										onChange={(e) => setOrderPrice(e.target.value)}
										placeholder="e.g., 10"
										className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
									/>
								</div>
							</div>

							{orderQuantity && orderPrice && (
								<p className="text-xs text-zinc-500">
									Total value:{" "}
									<span className="text-cyan-400">
										{(Number(orderQuantity) * Number(orderPrice)).toLocaleString()}
									</span>
								</p>
							)}

							<div className="flex gap-2">
								{!account ? (
									<span className="text-sm text-zinc-500">EVE Vault not connected</span>
								) : (
									<button
										type="button"
										onClick={handleCreateSellOrder}
										disabled={
											!orderSsuId ||
											orderTypeId === null ||
											!orderQuantity ||
											!orderPrice ||
											opStatus === "processing"
										}
										className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{opStatus === "processing" ? (
											<span className="flex items-center gap-2">
												<Loader2 size={14} className="animate-spin" /> Creating...
											</span>
										) : (
											"Create Sell Order"
										)}
									</button>
								)}
								<button
									type="button"
									onClick={() => setCreatingOrder(false)}
									className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-300"
								>
									Cancel
								</button>
							</div>
						</div>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setCreatingOrder(true)}
						className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 py-3 text-sm text-zinc-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
					>
						<Plus size={16} />
						Create Sell Order
					</button>
				)}
			</div>

			{/* Info box */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
				<div className="flex items-start gap-2">
					<Info size={14} className="mt-0.5 shrink-0 text-zinc-500" />
					<p className="text-xs text-zinc-500">
						Sell orders escrow items from your SSU owner inventory into the extension inventory.
						Buyers pay with currency and receive items atomically via{" "}
						<code className="text-zinc-400">buy_sell_order</code>. Cancel to return items to your
						owned inventory.
					</p>
				</div>
			</div>
		</div>
	);
}

/** Sub-component: renders sell orders for a single trade node */
function SellOrdersForNode({
	tradeNode,
	typeNameMap,
	onEditPrice,
	onCancel,
}: {
	tradeNode: { id: string; name: string; marketConfigId?: string };
	typeNameMap: Record<number, string>;
	onEditPrice: (typeId: number, currentPrice: number, configId: string) => void;
	onCancel: (typeId: number, maxQuantity: number, configId: string, ssuId: string) => void;
}) {
	const { data: sellOrders, isLoading } = useSellOrders(tradeNode.marketConfigId);

	return (
		<div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
			<div className="mb-2 flex items-center justify-between">
				<span className="text-sm text-zinc-200">{tradeNode.name}</span>
				<span className="font-mono text-xs text-zinc-600">{tradeNode.id.slice(0, 10)}...</span>
			</div>

			{isLoading ? (
				<div className="flex h-10 items-center justify-center">
					<Loader2 size={14} className="animate-spin text-cyan-400" />
				</div>
			) : !sellOrders || sellOrders.length === 0 ? (
				<p className="text-xs text-zinc-600">No active sell orders.</p>
			) : (
				<div className="space-y-1">
					{sellOrders.map((order) => (
						<div
							key={order.typeId}
							className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-zinc-800/50"
						>
							<div className="flex items-center gap-2">
								<span className="text-zinc-200">
									{typeNameMap[order.typeId] ?? `Type #${order.typeId}`}
								</span>
								<span className="text-zinc-500">x{order.quantity.toLocaleString()}</span>
								<span className="text-cyan-400">
									{order.pricePerUnit.toLocaleString()}/unit
								</span>
							</div>
							<div className="flex items-center gap-1">
								<button
									type="button"
									onClick={() =>
										onEditPrice(
											order.typeId,
											order.pricePerUnit,
											tradeNode.marketConfigId!,
										)
									}
									className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-cyan-400"
									title="Update Price"
								>
									<Edit2 size={12} />
								</button>
								<button
									type="button"
									onClick={() =>
										onCancel(
											order.typeId,
											order.quantity,
											tradeNode.marketConfigId!,
											tradeNode.id,
										)
									}
									className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
									title="Cancel"
								>
									<Trash2 size={12} />
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ── Buy Orders Tab ────────────────────────────────────────────────────────

function BuyOrdersTab({
	org,
	currencies,
	tenant,
	account,
	discovery,
}: {
	org: { id: string; name: string; chainObjectId?: string; orgMarketId?: string };
	currencies: CurrencyRecord[];
	tenant: TenantId;
	account?: { address: string };
	discovery: DiscoveryData | null;
}) {
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const suiClient = useSuiClient();
	const addresses = getContractAddresses(tenant);
	const tradeNodes = useLiveQuery(() => db.tradeNodes.toArray()) ?? [];
	const tradeNodeIds = useMemo(() => new Set(tradeNodes.map((tn) => tn.id)), [tradeNodes]);

	// Trade Node-filtered SSUs
	const ssus = useMemo(
		() =>
			(discovery?.assemblies ?? []).filter(
				(a) =>
					(a.type === "storage_unit" ||
						a.type === "smart_storage_unit" ||
						a.type === "protocol_depot") &&
					tradeNodeIds.has(a.objectId),
			),
		[discovery?.assemblies, tradeNodeIds],
	);

	// OrgMarket auto-discovery via hook
	const {
		orgMarketId,
		orgMarketInfo,
		buyOrders,
		isLoading: isLoadingMarket,
		refetch,
	} = useOrgMarket(org, tenant);

	const [opStatus, setOpStatus] = useState<OpStatus>("idle");
	const [opError, setOpError] = useState("");

	// Create OrgMarket state
	const [creatingOrgMarket, setCreatingOrgMarket] = useState(false);

	// Manual ID fallback
	const [showManualId, setShowManualId] = useState(false);
	const [manualOrgMarketId, setManualOrgMarketId] = useState("");

	// Authorized SSU state
	const [addingSsu, setAddingSsu] = useState(false);
	const [ssuToAdd, setSsuToAdd] = useState("");

	// Fund buy order state
	const [fundingOrder, setFundingOrder] = useState(false);
	const [orderCurrency, setOrderCurrency] = useState(currencies[0]?.id ?? "");
	const [orderSsuId, setOrderSsuId] = useState("");
	const [orderTypeId, setOrderTypeId] = useState<number | null>(null);
	const [orderPrice, setOrderPrice] = useState("");
	const [orderQuantity, setOrderQuantity] = useState("");

	// Confirm fill state
	const [confirmingFill, setConfirmingFill] = useState<number | null>(null);
	const [fillSellerAddress, setFillSellerAddress] = useState("");
	const [fillQuantity, setFillQuantity] = useState("");

	// Type name map for buy order display
	const gameTypes = useLiveQuery(() => db.gameTypes.toArray()) ?? [];
	const typeNameMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const gt of gameTypes) {
			map[gt.id] = gt.name;
		}
		return map;
	}, [gameTypes]);

	function tradeNodeLabel(objectId: string) {
		const tn = tradeNodes.find((n) => n.id === objectId);
		return tn ? `${tn.name} -- ${objectId.slice(0, 10)}...` : `${objectId.slice(0, 10)}...`;
	}

	function isAuthorized(ssuId: string): boolean {
		return orgMarketInfo?.authorizedSsus.includes(ssuId) ?? false;
	}

	// SSUs not already authorized
	const unaddedTradeNodes = useMemo(
		() => ssus.filter((s) => !orgMarketInfo?.authorizedSsus.includes(s.objectId)),
		[ssus, orgMarketInfo],
	);

	function statusDot(objectId: string) {
		const ssu = discovery?.assemblies.find((a) => a.objectId === objectId);
		if (!ssu) return <span className="h-2 w-2 rounded-full bg-zinc-600" />;
		const color =
			ssu.status === "online"
				? "bg-green-400"
				: ssu.status === "anchoring"
					? "bg-yellow-400"
					: "bg-zinc-600";
		return <span className={`h-2 w-2 rounded-full ${color}`} />;
	}

	async function handleCreateOrgMarket() {
		if (!org.chainObjectId || !addresses.ssuMarket?.packageId || !account) return;

		setOpStatus("processing");
		setOpError("");
		try {
			const tx = buildCreateOrgMarket({
				packageId: addresses.ssuMarket.packageId,
				orgObjectId: org.chainObjectId,
				senderAddress: account.address,
			});

			const result = await signAndExecute({ transaction: tx });

			const txResponse2 = await suiClient.waitForTransaction({
				digest: result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "",
				include: { effects: true, objectTypes: true },
			});
			const txData2 = txResponse2.Transaction ?? txResponse2.FailedTransaction;
			const changed2 = txData2?.effects?.changedObjects ?? [];
			const typeMap2 = txData2?.objectTypes ?? {};

			const marketCreated2 = changed2.find(
				(change) =>
					change.idOperation === "Created" &&
					(typeMap2[change.objectId] ?? "").includes("::ssu_market::OrgMarket"),
			);

			if (marketCreated2) {
				await db.organizations.update(org.id, {
					orgMarketId: marketCreated2.objectId,
				});
			}

			setCreatingOrgMarket(false);
			setOpStatus("done");
			refetch();
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleAddSsu() {
		if (
			!ssuToAdd ||
			!orgMarketId ||
			!org.chainObjectId ||
			!addresses.ssuMarket?.packageId ||
			!account
		)
			return;

		setOpStatus("processing");
		setOpError("");
		try {
			const tx = buildAddAuthorizedSsu({
				packageId: addresses.ssuMarket.packageId,
				orgMarketId,
				orgObjectId: org.chainObjectId,
				ssuId: ssuToAdd,
				senderAddress: account.address,
			});

			await signAndExecute({ transaction: tx });
			setAddingSsu(false);
			setSsuToAdd("");
			setOpStatus("done");
			refetch();
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleRemoveSsu(ssuId: string) {
		if (!orgMarketId || !org.chainObjectId || !addresses.ssuMarket?.packageId || !account) return;

		setOpStatus("processing");
		setOpError("");
		try {
			const tx = buildRemoveAuthorizedSsu({
				packageId: addresses.ssuMarket.packageId,
				orgMarketId,
				orgObjectId: org.chainObjectId,
				ssuId,
				senderAddress: account.address,
			});

			await signAndExecute({ transaction: tx });
			setOpStatus("done");
			refetch();
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleFundBuyOrder() {
		if (
			!orderSsuId ||
			orderTypeId === null ||
			!orderPrice ||
			!orderQuantity ||
			!orgMarketId ||
			!org.chainObjectId ||
			!account
		)
			return;

		const currency = currencies.find((c) => c.id === orderCurrency);
		if (
			!currency?.orgTreasuryId ||
			!currency?.coinType ||
			!addresses.governanceExt?.packageId ||
			!addresses.ssuMarket?.packageId
		)
			return;

		setOpStatus("processing");
		setOpError("");
		try {
			const pricePerUnit = Number(orderPrice);
			const quantity = Number(orderQuantity);
			const mintAmount = BigInt(pricePerUnit) * BigInt(quantity);

			const tx = buildFundBuyOrder({
				governanceExtPackageId: addresses.governanceExt.packageId,
				ssuMarketPackageId: addresses.ssuMarket.packageId,
				orgTreasuryId: currency.orgTreasuryId,
				orgObjectId: org.chainObjectId,
				orgMarketId,
				coinType: currency.coinType,
				mintAmount,
				ssuId: orderSsuId,
				typeId: orderTypeId,
				pricePerUnit,
				quantity,
				senderAddress: account.address,
			});

			await signAndExecute({ transaction: tx });
			setFundingOrder(false);
			setOrderTypeId(null);
			setOrderPrice("");
			setOrderQuantity("");
			setOpStatus("done");
			refetch();
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleCancelOrder(orderId: number) {
		if (!orgMarketId || !org.chainObjectId || !account) return;

		const currency = currencies.find((c) => c.id === orderCurrency);
		if (!currency?.coinType || !addresses.ssuMarket?.packageId) return;

		setOpStatus("processing");
		setOpError("");
		try {
			const tx = buildCancelBuyOrder({
				packageId: addresses.ssuMarket.packageId,
				orgMarketId,
				orgObjectId: org.chainObjectId,
				coinType: currency.coinType,
				orderId,
				senderAddress: account.address,
			});

			await signAndExecute({ transaction: tx });
			setOpStatus("done");
			refetch();
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleConfirmFill(orderId: number) {
		if (!fillSellerAddress || !fillQuantity || !orgMarketId || !org.chainObjectId || !account)
			return;

		const currency = currencies.find((c) => c.id === orderCurrency);
		if (!currency?.coinType || !addresses.ssuMarket?.packageId) return;

		setOpStatus("processing");
		setOpError("");
		try {
			const tx = buildConfirmBuyOrderFill({
				packageId: addresses.ssuMarket.packageId,
				orgMarketId,
				orgObjectId: org.chainObjectId,
				coinType: currency.coinType,
				orderId,
				sellerAddress: fillSellerAddress.trim(),
				quantityFilled: Number(fillQuantity),
				senderAddress: account.address,
			});

			await signAndExecute({ transaction: tx });
			setConfirmingFill(null);
			setFillSellerAddress("");
			setFillQuantity("");
			setOpStatus("done");
			refetch();
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div>
			<OpStatusBanner
				status={opStatus}
				error={opError}
				onDismiss={() => {
					setOpStatus("idle");
					setOpError("");
				}}
			/>

			{/* OrgMarket Setup — auto-discovery */}
			{isLoadingMarket ? (
				<div className="mb-6 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-xs text-zinc-400">
					<Loader2 size={14} className="animate-spin text-cyan-400" />
					Discovering OrgMarket...
				</div>
			) : !orgMarketId ? (
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-medium text-zinc-400">OrgMarket Setup</h3>
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
						<p className="mb-3 text-xs text-zinc-500">
							No OrgMarket found for this organization. Create a new one to enable buy orders.
						</p>
						{org.chainObjectId ? (
							creatingOrgMarket ? (
								<div className="flex items-center gap-2">
									<Loader2 size={14} className="animate-spin text-cyan-400" />
									<span className="text-xs text-cyan-400">Creating OrgMarket...</span>
								</div>
							) : (
								<div className="space-y-3">
									<button
										type="button"
										onClick={() => {
											setCreatingOrgMarket(true);
											handleCreateOrgMarket();
										}}
										className="flex items-center gap-2 rounded bg-cyan-600/20 px-3 py-2 text-xs text-cyan-400 transition-colors hover:bg-cyan-600/30"
									>
										<Plus size={14} />
										Create New OrgMarket
									</button>
									<button
										type="button"
										onClick={() => setShowManualId(!showManualId)}
										className="text-xs text-zinc-600 hover:text-zinc-400"
									>
										{showManualId ? "Hide manual entry" : "Advanced: Enter ID manually"}
									</button>
									{showManualId && (
										<div className="flex gap-2">
											<input
												type="text"
												value={manualOrgMarketId}
												onChange={(e) => setManualOrgMarketId(e.target.value)}
												placeholder="OrgMarket Object ID (0x...)"
												className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
											<button
												type="button"
												disabled={!manualOrgMarketId}
												onClick={async () => {
													await db.organizations.update(org.id, {
														orgMarketId: manualOrgMarketId.trim(),
													});
													setManualOrgMarketId("");
													refetch();
												}}
												className="rounded bg-cyan-600/20 px-3 py-2 text-xs text-cyan-400 hover:bg-cyan-600/30 disabled:opacity-40"
											>
												Use
											</button>
										</div>
									)}
								</div>
							)
						) : (
							<p className="text-xs text-amber-400">
								Publish your org to chain first to create an OrgMarket.
							</p>
						)}
					</div>
				</div>
			) : (
				<>
					{/* OrgMarket Info */}
					<div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
						<div className="mb-2 flex items-center justify-between">
							<h3 className="text-sm font-medium text-zinc-400">OrgMarket</h3>
							<button
								type="button"
								onClick={() => refetch()}
								className="text-zinc-500 hover:text-zinc-300"
								title="Refresh"
							>
								<RefreshCw size={12} />
							</button>
						</div>
						<p className="mb-2 font-mono text-xs text-zinc-500">
							{orgMarketId.slice(0, 14)}...
							{orgMarketId.slice(-8)}
						</p>

						{orgMarketInfo ? (
							<div className="text-xs text-zinc-500">
								<p>Orders: {orgMarketInfo.nextOrderId} created</p>
								<p>Authorized SSUs: {orgMarketInfo.authorizedSsus.length}</p>
							</div>
						) : null}
					</div>

					{/* Authorized SSUs */}
					<div className="mb-6">
						<div className="mb-3 flex items-center justify-between">
							<h3 className="text-sm font-medium text-zinc-400">Authorized Delivery Points</h3>
							<button
								type="button"
								onClick={() => setAddingSsu(!addingSsu)}
								className="text-xs text-zinc-500 hover:text-zinc-300"
							>
								{addingSsu ? "Cancel" : "+ Add SSU"}
							</button>
						</div>

						{addingSsu && (
							<div className="mb-3 flex gap-2">
								{unaddedTradeNodes.length > 0 ? (
									<select
										value={ssuToAdd}
										onChange={(e) => setSsuToAdd(e.target.value)}
										className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
									>
										<option value="">Choose a Trade Node...</option>
										{unaddedTradeNodes.map((s) => (
											<option key={s.objectId} value={s.objectId}>
												{statusDot(s.objectId)} {tradeNodeLabel(s.objectId)}
											</option>
										))}
									</select>
								) : (
									<p className="flex-1 py-1.5 text-xs text-zinc-500">
										All Trade Nodes are already authorized.
									</p>
								)}
								<button
									type="button"
									onClick={handleAddSsu}
									disabled={!ssuToAdd || opStatus === "processing"}
									className="rounded bg-cyan-600/20 px-3 py-1.5 text-xs text-cyan-400 hover:bg-cyan-600/30 disabled:opacity-40"
								>
									Add
								</button>
							</div>
						)}

						{orgMarketInfo?.authorizedSsus.length ? (
							<div className="space-y-1">
								{orgMarketInfo.authorizedSsus.map((ssuId) => (
									<div
										key={ssuId}
										className="flex items-center justify-between rounded px-3 py-2 text-xs hover:bg-zinc-800/30"
									>
										<div className="flex items-center gap-2">
											{statusDot(ssuId)}
											<span className="text-zinc-300">{tradeNodeLabel(ssuId)}</span>
										</div>
										<button
											type="button"
											onClick={() => handleRemoveSsu(ssuId)}
											className="text-zinc-600 hover:text-red-400"
										>
											<Trash2 size={12} />
										</button>
									</div>
								))}
							</div>
						) : (
							<p className="text-xs text-zinc-600">
								{tradeNodes.length === 0
									? "Enable an SSU as a Trade Node first (see above)."
									: "No authorized SSUs yet. Add Trade Nodes where players can deliver items."}
							</p>
						)}
					</div>

					{/* Fund Buy Order */}
					<div className="mb-6">
						<h3 className="mb-3 text-sm font-medium text-zinc-400">Fund Buy Order</h3>

						{fundingOrder ? (
							<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
								<div className="space-y-3">
									<div>
										<label className="mb-1.5 block text-xs text-zinc-500">Currency</label>
										<select
											value={orderCurrency}
											onChange={(e) => setOrderCurrency(e.target.value)}
											className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
										>
											{currencies.map((c) => (
												<option key={c.id} value={c.id}>
													{c.symbol} - {c.name}
												</option>
											))}
										</select>
									</div>
									<div>
										<label className="mb-1.5 block text-xs text-zinc-500">
											Target Trade Node (delivery point)
										</label>
										{ssus.length > 0 ? (
											<select
												value={orderSsuId}
												onChange={(e) => setOrderSsuId(e.target.value)}
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
											>
												<option value="">Choose a Trade Node...</option>
												{ssus.map((s) => (
													<option key={s.objectId} value={s.objectId}>
														{statusDot(s.objectId)} {tradeNodeLabel(s.objectId)}{" "}
														{isAuthorized(s.objectId) ? "(authorized)" : "(not authorized)"}
													</option>
												))}
											</select>
										) : (
											<p className="text-xs text-zinc-500">
												Enable an SSU as a Trade Node first (see above).
											</p>
										)}
									</div>
									<div>
										<label className="mb-1.5 block text-xs text-zinc-500">Item Type</label>
										<TypeSearchInput
											value={orderTypeId}
											onChange={setOrderTypeId}
											placeholder="Search items..."
										/>
									</div>
									<div className="grid grid-cols-2 gap-3">
										<div>
											<label className="mb-1.5 block text-xs text-zinc-500">Price Per Unit</label>
											<input
												type="number"
												value={orderPrice}
												onChange={(e) => setOrderPrice(e.target.value)}
												placeholder="e.g., 5"
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
										<div>
											<label className="mb-1.5 block text-xs text-zinc-500">Quantity</label>
											<input
												type="number"
												value={orderQuantity}
												onChange={(e) => setOrderQuantity(e.target.value)}
												placeholder="e.g., 500"
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
									</div>
									{orderPrice && orderQuantity && (
										<p className="text-xs text-zinc-500">
											Will mint{" "}
											<span className="text-cyan-400">
												{Number(orderPrice) * Number(orderQuantity)}
											</span>{" "}
											tokens from treasury for escrow.
										</p>
									)}
									<div className="flex gap-2">
										<button
											type="button"
											onClick={handleFundBuyOrder}
											disabled={
												!orderSsuId ||
												orderTypeId === null ||
												!orderPrice ||
												!orderQuantity ||
												opStatus === "processing"
											}
											className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
										>
											{opStatus === "processing" ? (
												<span className="flex items-center gap-2">
													<Loader2 size={14} className="animate-spin" /> Funding...
												</span>
											) : (
												"Fund from Treasury"
											)}
										</button>
										<button
											type="button"
											onClick={() => setFundingOrder(false)}
											className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-300"
										>
											Cancel
										</button>
									</div>
								</div>
							</div>
						) : (
							<button
								type="button"
								onClick={() => setFundingOrder(true)}
								className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 py-3 text-sm text-zinc-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
							>
								<Plus size={16} />
								Fund Buy Order
							</button>
						)}
					</div>

					{/* Active Buy Orders */}
					<div>
						<div className="mb-3 flex items-center justify-between">
							<h3 className="text-sm font-medium text-zinc-400">
								Active Buy Orders
								{buyOrders.length > 0 && ` (${buyOrders.length})`}
							</h3>
							<button
								type="button"
								onClick={() => refetch()}
								className="text-zinc-500 hover:text-zinc-300"
								title="Refresh"
							>
								<RefreshCw size={12} />
							</button>
						</div>

						{buyOrders.length === 0 ? (
							<p className="text-xs text-zinc-600">No active buy orders.</p>
						) : (
							<div className="space-y-2">
								{buyOrders.map((order) => (
									<div
										key={order.orderId}
										className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
									>
										<div className="flex items-center justify-between">
											<div>
												<div className="flex items-center gap-2 text-sm">
													<span className="text-zinc-200">
														{typeNameMap[order.typeId] ?? `Type #${order.typeId}`}
													</span>
													<span className="font-mono text-xs text-zinc-600">#{order.typeId}</span>
													<span className="text-xs text-zinc-500">{order.pricePerUnit} /unit</span>
													<span className="text-xs text-zinc-500">x{order.quantity} wanted</span>
												</div>
												<p className="mt-1 flex items-center gap-1 font-mono text-xs text-zinc-600">
													{statusDot(order.ssuId)}
													SSU: {tradeNodeLabel(order.ssuId)}
												</p>
											</div>
											<div className="flex items-center gap-2">
												{confirmingFill === order.orderId ? null : (
													<>
														<button
															type="button"
															onClick={() => setConfirmingFill(order.orderId)}
															className="rounded bg-green-600/20 px-2 py-1 text-xs text-green-400 hover:bg-green-600/30"
														>
															Confirm Fill
														</button>
														<button
															type="button"
															onClick={() => handleCancelOrder(order.orderId)}
															className="text-zinc-600 hover:text-red-400"
														>
															<Trash2 size={14} />
														</button>
													</>
												)}
											</div>
										</div>

										{/* Confirm Fill inline form */}
										{confirmingFill === order.orderId && (
											<div className="mt-3 border-t border-zinc-800 pt-3">
												<h4 className="mb-2 text-xs font-medium text-green-400">
													Confirm Delivery
												</h4>
												<div className="space-y-2">
													<div>
														<label className="mb-1 block text-xs text-zinc-500">
															Seller Address
														</label>
														<input
															type="text"
															value={fillSellerAddress}
															onChange={(e) => setFillSellerAddress(e.target.value)}
															placeholder="0x..."
															className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
														/>
													</div>
													<div>
														<label className="mb-1 block text-xs text-zinc-500">
															Quantity Delivered
														</label>
														<input
															type="number"
															value={fillQuantity}
															onChange={(e) => setFillQuantity(e.target.value)}
															placeholder={`max ${order.quantity}`}
															className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
														/>
													</div>
													<div className="flex gap-2">
														<button
															type="button"
															onClick={() => handleConfirmFill(order.orderId)}
															disabled={
																!fillSellerAddress || !fillQuantity || opStatus === "processing"
															}
															className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
														>
															Release Payment
														</button>
														<button
															type="button"
															onClick={() => {
																setConfirmingFill(null);
																setFillSellerAddress("");
																setFillQuantity("");
															}}
															className="text-xs text-zinc-500 hover:text-zinc-300"
														>
															Cancel
														</button>
													</div>
												</div>
											</div>
										)}
									</div>
								))}
							</div>
						)}
					</div>

					{/* Manual fill flow info */}
					<div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
						<div className="flex items-start gap-2">
							<Info size={14} className="mt-0.5 shrink-0 text-zinc-500" />
							<div className="text-xs text-zinc-500">
								<p className="mb-1 font-medium text-zinc-400">
									Buy Order Fill Process (Hackathon):
								</p>
								<ol className="list-decimal space-y-0.5 pl-4">
									<li>Post a buy order specifying items wanted, price, and delivery SSU</li>
									<li>Player flies to the SSU and deposits items via the game client</li>
									<li>Player notifies a stakeholder that delivery was made</li>
									<li>Stakeholder clicks "Confirm Fill" to release payment to the seller</li>
								</ol>
							</div>
						</div>
					</div>
				</>
			)}
		</div>
	);
}

// ── Shared Components ─────────────────────────────────────────────────────

function OpStatusBanner({
	status,
	error,
	onDismiss,
}: {
	status: OpStatus;
	error: string;
	onDismiss: () => void;
}) {
	if (status === "idle") return null;

	return (
		<div
			className={`mb-4 rounded-lg border p-3 ${
				status === "error"
					? "border-red-900/50 bg-red-950/20"
					: status === "done"
						? "border-green-900/50 bg-green-950/20"
						: "border-cyan-900/50 bg-cyan-950/20"
			}`}
		>
			<div className="flex items-center gap-2">
				{status === "processing" && <Loader2 size={14} className="animate-spin text-cyan-400" />}
				{status === "done" && <CheckCircle2 size={14} className="text-green-400" />}
				{status === "error" && <AlertCircle size={14} className="text-red-400" />}
				<span
					className={`text-xs ${
						status === "error"
							? "text-red-300"
							: status === "done"
								? "text-green-300"
								: "text-cyan-300"
					}`}
				>
					{status === "processing"
						? "Processing transaction..."
						: status === "done"
							? "Transaction successful."
							: "Transaction failed."}
				</span>
			</div>
			{error && <p className="mt-1 text-xs text-red-400">{error}</p>}
			{(status === "done" || status === "error") && (
				<button
					type="button"
					onClick={onDismiss}
					className="mt-2 text-xs text-zinc-400 hover:text-zinc-300"
				>
					Dismiss
				</button>
			)}
		</div>
	);
}
