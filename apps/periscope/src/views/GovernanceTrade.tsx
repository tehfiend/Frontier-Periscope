import { useState, useEffect, useCallback } from "react";
import {
	useCurrentAccount,
	useSignAndExecuteTransaction,
	useSuiClient,
} from "@mysten/dapp-kit";
import { useLiveQuery } from "dexie-react-hooks";
import {
	ShoppingBag,
	Plus,
	Loader2,
	AlertCircle,
	Trash2,
	Package,
	CheckCircle2,
	Info,
	RefreshCw,
} from "lucide-react";
import { WalletConnect } from "@/components/WalletConnect";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useOwnedAssemblies } from "@/hooks/useOwnedAssemblies";
import { db, notDeleted } from "@/db";
import type { CurrencyRecord } from "@/db/types";
import { TENANTS } from "@/chain/config";
import {
	buildCreateMarket,
	buildSetListing,
	buildCreateOrgMarket,
	buildAddAuthorizedSsu,
	buildRemoveAuthorizedSsu,
	buildFundBuyOrder,
	buildConfirmBuyOrderFill,
	buildCancelBuyOrder,
	queryOrgMarket,
	queryBuyOrders,
	getContractAddresses,
	type TenantId as ChainTenantId,
	type BuyOrderInfo,
	type OrgMarketInfo,
} from "@tehfrontier/chain-shared";

type Tab = "sell" | "buy";

type OpStatus = "idle" | "processing" | "done" | "error";

export function GovernanceTrade() {
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const tenant = useActiveTenant();
	const [tab, setTab] = useState<Tab>("sell");

	const org = useLiveQuery(() => db.organizations.filter(notDeleted).first());
	const currencies = useLiveQuery(
		() =>
			org
				? db.currencies
						.where("orgId")
						.equals(org.id)
						.filter(notDeleted)
						.toArray()
				: [],
		[org?.id],
	);

	const publishedCurrencies = (currencies ?? []).filter(
		(c) => c.packageId && c.orgTreasuryId,
	);

	if (!activeCharacter || !suiAddress) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<ShoppingBag
						size={48}
						className="mx-auto mb-4 text-zinc-700"
					/>
					<p className="text-sm text-zinc-500">
						Select a character to manage trade
					</p>
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
					<p className="text-sm text-zinc-500">
						Create an organization first
					</p>
					<a
						href="/governance"
						className="text-xs text-cyan-400 hover:text-cyan-300"
					>
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
					<p className="text-sm text-zinc-500">
						Set up a currency with OrgTreasury first
					</p>
					<a
						href="/governance/finance"
						className="text-xs text-cyan-400 hover:text-cyan-300"
					>
						Go to Finance &rarr;
					</a>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-3xl p-6">
			<Header />

			{/* Tabs */}
			<div className="mb-6 flex gap-1 rounded-lg bg-zinc-900/50 p-1">
				{(["sell", "buy"] as Tab[]).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
							tab === t
								? "bg-zinc-800 text-cyan-400"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						{t === "sell" ? "Sell Orders" : "Buy Orders"}
					</button>
				))}
			</div>

			{tab === "sell" && (
				<SellOrdersTab
					org={org}
					currencies={publishedCurrencies}
					tenant={tenant}
					account={account ?? undefined}
				/>
			)}

			{tab === "buy" && (
				<BuyOrdersTab
					org={org}
					currencies={publishedCurrencies}
					tenant={tenant}
					account={account ?? undefined}
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
				<p className="mt-1 text-sm text-zinc-500">
					SSU market management and org procurement
				</p>
			</div>
			<WalletConnect />
		</div>
	);
}

// ── Sell Orders Tab ───────────────────────────────────────────────────────

function SellOrdersTab({
	org,
	currencies,
	tenant,
	account,
}: {
	org: { id: string; name: string; chainObjectId?: string };
	currencies: CurrencyRecord[];
	tenant: string;
	account?: { address: string };
}) {
	const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
	const suiClient = useSuiClient();
	const { data: discovery } = useOwnedAssemblies();
	const addresses = getContractAddresses(tenant as ChainTenantId);

	const [opStatus, setOpStatus] = useState<OpStatus>("idle");
	const [opError, setOpError] = useState("");

	// Create market state
	const [creatingMarket, setCreatingMarket] = useState(false);
	const [marketSsuId, setMarketSsuId] = useState("");

	// Listing state
	const [addingListing, setAddingListing] = useState(false);
	const [listingConfigId, setListingConfigId] = useState("");
	const [listingTypeId, setListingTypeId] = useState("");
	const [listingPrice, setListingPrice] = useState("");
	const [listingAvailable, setListingAvailable] = useState(true);

	const ssus =
		discovery?.assemblies.filter(
			(a) =>
				a.type === "storage_unit" ||
				a.type === "smart_storage_unit" ||
				a.type === "protocol_depot",
		) ?? [];

	async function handleCreateMarket() {
		if (!marketSsuId || !addresses.ssuMarket?.packageId || !account) return;

		setOpStatus("processing");
		setOpError("");
		try {
			const tx = buildCreateMarket({
				packageId: addresses.ssuMarket.packageId,
				ssuId: marketSsuId,
				senderAddress: account.address,
			});

			const result = await signAndExecute({ transaction: tx });

			const txResponse = await suiClient.waitForTransaction({
				digest: result.digest,
				options: { showObjectChanges: true },
			});

			const marketCreated = txResponse.objectChanges?.find(
				(change) =>
					change.type === "created" &&
					change.objectType.includes("::ssu_market::MarketConfig"),
			);

			if (marketCreated && marketCreated.type === "created") {
				setListingConfigId(marketCreated.objectId);
			}

			setCreatingMarket(false);
			setMarketSsuId("");
			setOpStatus("done");
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleSetListing() {
		if (
			!listingConfigId ||
			!listingTypeId ||
			!listingPrice ||
			!addresses.ssuMarket?.packageId ||
			!account
		)
			return;

		setOpStatus("processing");
		setOpError("");
		try {
			const tx = buildSetListing({
				packageId: addresses.ssuMarket.packageId,
				configObjectId: listingConfigId,
				typeId: Number(listingTypeId),
				pricePerUnit: Number(listingPrice),
				available: listingAvailable,
				senderAddress: account.address,
			});

			await signAndExecute({ transaction: tx });
			setAddingListing(false);
			setListingTypeId("");
			setListingPrice("");
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

			{/* Create Market Section */}
			<div className="mb-6">
				<h3 className="mb-3 text-sm font-medium text-zinc-400">
					SSU Markets
				</h3>

				{creatingMarket ? (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
						<h4 className="mb-3 text-xs font-medium text-zinc-300">
							Create Market on SSU
						</h4>
						<div className="space-y-3">
							<div>
								<label className="mb-1.5 block text-xs text-zinc-500">
									Storage Unit
								</label>
								<select
									value={marketSsuId}
									onChange={(e) =>
										setMarketSsuId(e.target.value)
									}
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
								>
									<option value="">Choose an SSU...</option>
									{ssus.map((s) => (
										<option
											key={s.objectId}
											value={s.objectId}
										>
											{s.type} --{" "}
											{s.objectId.slice(0, 10)}...
										</option>
									))}
								</select>
							</div>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={handleCreateMarket}
									disabled={
										!marketSsuId ||
										opStatus === "processing"
									}
									className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{opStatus === "processing" ? (
										<span className="flex items-center gap-2">
											<Loader2
												size={14}
												className="animate-spin"
											/>{" "}
											Creating...
										</span>
									) : (
										"Create Market"
									)}
								</button>
								<button
									type="button"
									onClick={() => setCreatingMarket(false)}
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
						onClick={() => setCreatingMarket(true)}
						className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 py-3 text-sm text-zinc-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
					>
						<Plus size={16} />
						Create SSU Market
					</button>
				)}
			</div>

			{/* Listing Management */}
			<div className="mb-6">
				<h3 className="mb-3 text-sm font-medium text-zinc-400">
					Manage Listings
				</h3>

				{addingListing ? (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
						<h4 className="mb-3 text-xs font-medium text-zinc-300">
							Set Listing
						</h4>
						<div className="space-y-3">
							<div>
								<label className="mb-1.5 block text-xs text-zinc-500">
									MarketConfig Object ID
								</label>
								<input
									type="text"
									value={listingConfigId}
									onChange={(e) =>
										setListingConfigId(e.target.value)
									}
									placeholder="0x..."
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
							</div>
							<div>
								<label className="mb-1.5 block text-xs text-zinc-500">
									Item Type ID
								</label>
								<input
									type="number"
									value={listingTypeId}
									onChange={(e) =>
										setListingTypeId(e.target.value)
									}
									placeholder="e.g., 78437"
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
							</div>
							<div>
								<label className="mb-1.5 block text-xs text-zinc-500">
									Price Per Unit (smallest currency unit)
								</label>
								<input
									type="number"
									value={listingPrice}
									onChange={(e) =>
										setListingPrice(e.target.value)
									}
									placeholder="e.g., 10"
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
							</div>
							<div className="flex items-center gap-2">
								<input
									type="checkbox"
									id="listing-available"
									checked={listingAvailable}
									onChange={(e) =>
										setListingAvailable(e.target.checked)
									}
									className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-500"
								/>
								<label
									htmlFor="listing-available"
									className="text-xs text-zinc-400"
								>
									Available for purchase
								</label>
							</div>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={handleSetListing}
									disabled={
										!listingConfigId ||
										!listingTypeId ||
										!listingPrice ||
										opStatus === "processing"
									}
									className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
								>
									Set Listing
								</button>
								<button
									type="button"
									onClick={() => setAddingListing(false)}
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
						onClick={() => setAddingListing(true)}
						className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 py-3 text-sm text-zinc-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
					>
						<Plus size={16} />
						Add / Update Listing
					</button>
				)}
			</div>

			{/* Buyer flow info */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
				<div className="flex items-start gap-2">
					<Info size={14} className="mt-0.5 shrink-0 text-zinc-500" />
					<p className="text-xs text-zinc-500">
						Buyers purchase items using{" "}
						<code className="text-zinc-400">buy_and_withdraw</code>{" "}
						-- they pay with org currency and receive items
						atomically from the SSU. The buyer flow is handled by
						external clients (game UI, CLI, or dapp).
					</p>
				</div>
			</div>
		</div>
	);
}

// ── Buy Orders Tab ────────────────────────────────────────────────────────

function BuyOrdersTab({
	org,
	currencies,
	tenant,
	account,
}: {
	org: { id: string; name: string; chainObjectId?: string };
	currencies: CurrencyRecord[];
	tenant: string;
	account?: { address: string };
}) {
	const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
	const suiClient = useSuiClient();
	const { data: discovery } = useOwnedAssemblies();
	const addresses = getContractAddresses(tenant as ChainTenantId);

	const [opStatus, setOpStatus] = useState<OpStatus>("idle");
	const [opError, setOpError] = useState("");

	// OrgMarket state
	const [orgMarketId, setOrgMarketId] = useState("");
	const [orgMarketInfo, setOrgMarketInfo] = useState<OrgMarketInfo | null>(
		null,
	);
	const [loadingMarket, setLoadingMarket] = useState(false);
	const [creatingOrgMarket, setCreatingOrgMarket] = useState(false);

	// Authorized SSU state
	const [addingSsu, setAddingSsu] = useState(false);
	const [ssuToAdd, setSsuToAdd] = useState("");

	// Fund buy order state
	const [fundingOrder, setFundingOrder] = useState(false);
	const [orderCurrency, setOrderCurrency] = useState(
		currencies[0]?.id ?? "",
	);
	const [orderSsuId, setOrderSsuId] = useState("");
	const [orderTypeId, setOrderTypeId] = useState("");
	const [orderPrice, setOrderPrice] = useState("");
	const [orderQuantity, setOrderQuantity] = useState("");

	// Active orders
	const [buyOrders, setBuyOrders] = useState<BuyOrderInfo[]>([]);
	const [loadingOrders, setLoadingOrders] = useState(false);

	// Confirm fill state
	const [confirmingFill, setConfirmingFill] = useState<number | null>(null);
	const [fillSellerAddress, setFillSellerAddress] = useState("");
	const [fillQuantity, setFillQuantity] = useState("");

	const ssus =
		discovery?.assemblies.filter(
			(a) =>
				a.type === "storage_unit" ||
				a.type === "smart_storage_unit" ||
				a.type === "protocol_depot",
		) ?? [];

	const loadOrgMarket = useCallback(async () => {
		if (!orgMarketId) return;
		setLoadingMarket(true);
		try {
			const info = await queryOrgMarket(suiClient, orgMarketId);
			setOrgMarketInfo(info);
		} catch {
			setOrgMarketInfo(null);
		} finally {
			setLoadingMarket(false);
		}
	}, [orgMarketId, suiClient]);

	const loadBuyOrders = useCallback(async () => {
		if (!orgMarketId) return;
		setLoadingOrders(true);
		try {
			const orders = await queryBuyOrders(suiClient, orgMarketId);
			setBuyOrders(orders);
		} catch {
			setBuyOrders([]);
		} finally {
			setLoadingOrders(false);
		}
	}, [orgMarketId, suiClient]);

	useEffect(() => {
		if (orgMarketId) {
			loadOrgMarket();
			loadBuyOrders();
		}
	}, [orgMarketId, loadOrgMarket, loadBuyOrders]);

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

			const txResponse = await suiClient.waitForTransaction({
				digest: result.digest,
				options: { showObjectChanges: true },
			});

			const marketCreated = txResponse.objectChanges?.find(
				(change) =>
					change.type === "created" &&
					change.objectType.includes("::ssu_market::OrgMarket"),
			);

			if (marketCreated && marketCreated.type === "created") {
				setOrgMarketId(marketCreated.objectId);
			}

			setCreatingOrgMarket(false);
			setOpStatus("done");
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
			loadOrgMarket();
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleRemoveSsu(ssuId: string) {
		if (
			!orgMarketId ||
			!org.chainObjectId ||
			!addresses.ssuMarket?.packageId ||
			!account
		)
			return;

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
			loadOrgMarket();
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleFundBuyOrder() {
		if (
			!orderSsuId ||
			!orderTypeId ||
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
				typeId: Number(orderTypeId),
				pricePerUnit,
				quantity,
				senderAddress: account.address,
			});

			await signAndExecute({ transaction: tx });
			setFundingOrder(false);
			setOrderTypeId("");
			setOrderPrice("");
			setOrderQuantity("");
			setOpStatus("done");
			loadBuyOrders();
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
			loadBuyOrders();
		} catch (err) {
			setOpStatus("error");
			setOpError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleConfirmFill(orderId: number) {
		if (
			!fillSellerAddress ||
			!fillQuantity ||
			!orgMarketId ||
			!org.chainObjectId ||
			!account
		)
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
			loadBuyOrders();
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

			{/* OrgMarket Setup */}
			{!orgMarketId ? (
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-medium text-zinc-400">
						OrgMarket Setup
					</h3>
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
						<p className="mb-3 text-xs text-zinc-500">
							Enter an existing OrgMarket ID or create a new one.
							Buy orders require an OrgMarket to operate.
						</p>
						<div className="mb-3">
							<input
								type="text"
								value={orgMarketId}
								onChange={(e) =>
									setOrgMarketId(e.target.value)
								}
								placeholder="Existing OrgMarket Object ID (0x...)"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
						</div>
						{org.chainObjectId ? (
							creatingOrgMarket ? (
								<div className="flex items-center gap-2">
									<Loader2
										size={14}
										className="animate-spin text-cyan-400"
									/>
									<span className="text-xs text-cyan-400">
										Creating OrgMarket...
									</span>
								</div>
							) : (
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
							)
						) : (
							<p className="text-xs text-amber-400">
								Publish your org to chain first to create an
								OrgMarket.
							</p>
						)}
					</div>
				</div>
			) : (
				<>
					{/* OrgMarket Info */}
					<div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
						<div className="mb-2 flex items-center justify-between">
							<h3 className="text-sm font-medium text-zinc-400">
								OrgMarket
							</h3>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => {
										loadOrgMarket();
										loadBuyOrders();
									}}
									className="text-zinc-500 hover:text-zinc-300"
									title="Refresh"
								>
									<RefreshCw size={12} />
								</button>
								<button
									type="button"
									onClick={() => {
										setOrgMarketId("");
										setOrgMarketInfo(null);
										setBuyOrders([]);
									}}
									className="text-xs text-zinc-500 hover:text-zinc-300"
								>
									Change
								</button>
							</div>
						</div>
						<p className="mb-2 font-mono text-xs text-zinc-500">
							{orgMarketId.slice(0, 14)}...
							{orgMarketId.slice(-8)}
						</p>

						{loadingMarket ? (
							<div className="flex items-center gap-2 text-xs text-zinc-500">
								<Loader2
									size={12}
									className="animate-spin"
								/>
								Loading...
							</div>
						) : orgMarketInfo ? (
							<div className="text-xs text-zinc-500">
								<p>
									Orders:{" "}
									{orgMarketInfo.nextOrderId} created
								</p>
								<p>
									Authorized SSUs:{" "}
									{orgMarketInfo.authorizedSsus.length}
								</p>
							</div>
						) : null}
					</div>

					{/* Authorized SSUs */}
					<div className="mb-6">
						<div className="mb-3 flex items-center justify-between">
							<h3 className="text-sm font-medium text-zinc-400">
								Authorized Delivery Points
							</h3>
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
								<select
									value={ssuToAdd}
									onChange={(e) =>
										setSsuToAdd(e.target.value)
									}
									className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
								>
									<option value="">Choose an SSU...</option>
									{ssus.map((s) => (
										<option
											key={s.objectId}
											value={s.objectId}
										>
											{s.type} --{" "}
											{s.objectId.slice(0, 10)}...
										</option>
									))}
								</select>
								<input
									type="text"
									value={ssuToAdd}
									onChange={(e) =>
										setSsuToAdd(e.target.value)
									}
									placeholder="Or paste SSU ID"
									className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
								<button
									type="button"
									onClick={handleAddSsu}
									disabled={
										!ssuToAdd ||
										opStatus === "processing"
									}
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
										<span className="font-mono text-zinc-400">
											{ssuId.slice(0, 14)}...
											{ssuId.slice(-8)}
										</span>
										<button
											type="button"
											onClick={() =>
												handleRemoveSsu(ssuId)
											}
											className="text-zinc-600 hover:text-red-400"
										>
											<Trash2 size={12} />
										</button>
									</div>
								))}
							</div>
						) : (
							<p className="text-xs text-zinc-600">
								No authorized SSUs yet. Add SSUs where players
								can deliver items.
							</p>
						)}
					</div>

					{/* Fund Buy Order */}
					<div className="mb-6">
						<h3 className="mb-3 text-sm font-medium text-zinc-400">
							Fund Buy Order
						</h3>

						{fundingOrder ? (
							<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
								<div className="space-y-3">
									<div>
										<label className="mb-1.5 block text-xs text-zinc-500">
											Currency
										</label>
										<select
											value={orderCurrency}
											onChange={(e) =>
												setOrderCurrency(
													e.target.value,
												)
											}
											className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
										>
											{currencies.map((c) => (
												<option
													key={c.id}
													value={c.id}
												>
													{c.symbol} - {c.name}
												</option>
											))}
										</select>
									</div>
									<div>
										<label className="mb-1.5 block text-xs text-zinc-500">
											Target SSU (delivery point)
										</label>
										<input
											type="text"
											value={orderSsuId}
											onChange={(e) =>
												setOrderSsuId(e.target.value)
											}
											placeholder="SSU Object ID (0x...)"
											className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
										/>
									</div>
									<div>
										<label className="mb-1.5 block text-xs text-zinc-500">
											Item Type ID
										</label>
										<input
											type="number"
											value={orderTypeId}
											onChange={(e) =>
												setOrderTypeId(e.target.value)
											}
											placeholder="e.g., 78437"
											className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
										/>
									</div>
									<div className="grid grid-cols-2 gap-3">
										<div>
											<label className="mb-1.5 block text-xs text-zinc-500">
												Price Per Unit
											</label>
											<input
												type="number"
												value={orderPrice}
												onChange={(e) =>
													setOrderPrice(
														e.target.value,
													)
												}
												placeholder="e.g., 5"
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
										<div>
											<label className="mb-1.5 block text-xs text-zinc-500">
												Quantity
											</label>
											<input
												type="number"
												value={orderQuantity}
												onChange={(e) =>
													setOrderQuantity(
														e.target.value,
													)
												}
												placeholder="e.g., 500"
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
									</div>
									{orderPrice && orderQuantity && (
										<p className="text-xs text-zinc-500">
											Will mint{" "}
											<span className="text-cyan-400">
												{Number(orderPrice) *
													Number(orderQuantity)}
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
												!orderTypeId ||
												!orderPrice ||
												!orderQuantity ||
												opStatus === "processing"
											}
											className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
										>
											{opStatus === "processing" ? (
												<span className="flex items-center gap-2">
													<Loader2
														size={14}
														className="animate-spin"
													/>{" "}
													Funding...
												</span>
											) : (
												"Fund from Treasury"
											)}
										</button>
										<button
											type="button"
											onClick={() =>
												setFundingOrder(false)
											}
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
								{buyOrders.length > 0 &&
									` (${buyOrders.length})`}
							</h3>
							<button
								type="button"
								onClick={loadBuyOrders}
								className="text-zinc-500 hover:text-zinc-300"
								title="Refresh"
							>
								<RefreshCw size={12} />
							</button>
						</div>

						{loadingOrders ? (
							<div className="flex items-center gap-2 text-xs text-zinc-500">
								<Loader2
									size={12}
									className="animate-spin"
								/>
								Loading orders...
							</div>
						) : buyOrders.length === 0 ? (
							<p className="text-xs text-zinc-600">
								No active buy orders.
							</p>
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
														Type #{order.typeId}
													</span>
													<span className="text-xs text-zinc-500">
														{order.pricePerUnit}{" "}
														/unit
													</span>
													<span className="text-xs text-zinc-500">
														x{order.quantity}{" "}
														wanted
													</span>
												</div>
												<p className="mt-1 font-mono text-xs text-zinc-600">
													SSU:{" "}
													{order.ssuId.slice(0, 10)}
													...
													{order.ssuId.slice(-6)}
												</p>
											</div>
											<div className="flex items-center gap-2">
												{confirmingFill ===
												order.orderId ? null : (
													<>
														<button
															type="button"
															onClick={() =>
																setConfirmingFill(
																	order.orderId,
																)
															}
															className="rounded bg-green-600/20 px-2 py-1 text-xs text-green-400 hover:bg-green-600/30"
														>
															Confirm Fill
														</button>
														<button
															type="button"
															onClick={() =>
																handleCancelOrder(
																	order.orderId,
																)
															}
															className="text-zinc-600 hover:text-red-400"
														>
															<Trash2
																size={14}
															/>
														</button>
													</>
												)}
											</div>
										</div>

										{/* Confirm Fill inline form */}
										{confirmingFill ===
											order.orderId && (
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
															value={
																fillSellerAddress
															}
															onChange={(e) =>
																setFillSellerAddress(
																	e.target
																		.value,
																)
															}
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
															onChange={(e) =>
																setFillQuantity(
																	e.target
																		.value,
																)
															}
															placeholder={`max ${order.quantity}`}
															className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
														/>
													</div>
													<div className="flex gap-2">
														<button
															type="button"
															onClick={() =>
																handleConfirmFill(
																	order.orderId,
																)
															}
															disabled={
																!fillSellerAddress ||
																!fillQuantity ||
																opStatus ===
																	"processing"
															}
															className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
														>
															Release Payment
														</button>
														<button
															type="button"
															onClick={() => {
																setConfirmingFill(
																	null,
																);
																setFillSellerAddress(
																	"",
																);
																setFillQuantity(
																	"",
																);
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
							<Info
								size={14}
								className="mt-0.5 shrink-0 text-zinc-500"
							/>
							<div className="text-xs text-zinc-500">
								<p className="mb-1 font-medium text-zinc-400">
									Buy Order Fill Process (Hackathon):
								</p>
								<ol className="list-decimal space-y-0.5 pl-4">
									<li>
										Post a buy order specifying items wanted,
										price, and delivery SSU
									</li>
									<li>
										Player flies to the SSU and deposits
										items via the game client
									</li>
									<li>
										Player notifies a stakeholder that
										delivery was made
									</li>
									<li>
										Stakeholder clicks "Confirm Fill" to
										release payment to the seller
									</li>
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
				{status === "processing" && (
					<Loader2 size={14} className="animate-spin text-cyan-400" />
				)}
				{status === "done" && (
					<CheckCircle2 size={14} className="text-green-400" />
				)}
				{status === "error" && (
					<AlertCircle size={14} className="text-red-400" />
				)}
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
