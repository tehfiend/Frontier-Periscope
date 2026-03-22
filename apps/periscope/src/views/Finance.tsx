import { useSuiClient } from "@/hooks/useSuiClient";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
	ChevronDown,
	ChevronUp,
	Coins,
	Flame,
	Loader2,
	Package,
	Plus,
	RefreshCw,
	Send,
	Settings,
	UserMinus,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { TenantId } from "@/chain/config";
import { CopyAddress } from "@/components/CopyAddress";
import { db, notDeleted } from "@/db";
import type { CurrencyRecord } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import {
	buildAddAuthorized,
	buildBurn,
	buildCreateMarket,
	buildMint,
	buildPublishToken,
	buildRemoveAuthorized,
	buildSetMarket,
	buildUpdateFee,
	discoverSsuConfig,
	getCoinMetadata,
	getContractAddresses,
	parsePublishResult,
	queryMarketDetails,
	queryMarkets,
	queryOwnedCoins,
	queryTreasuryCap,
} from "@tehfrontier/chain-shared";
import type { MarketInfo } from "@tehfrontier/chain-shared";

type BuildStatus = "idle" | "building" | "minting" | "burning" | "done" | "error";

export function Finance() {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const tenant = useActiveTenant();
	const currencies = useLiveQuery(() => db.currencies.filter(notDeleted).toArray());

	const [creating, setCreating] = useState(false);
	const [symbol, setSymbol] = useState("");
	const [tokenName, setTokenName] = useState("");
	const [description, setDescription] = useState("");
	const [decimals, setDecimals] = useState(9);
	const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
	const [buildError, setBuildError] = useState("");

	const suiClient = useSuiClient();

	const isProcessing =
		buildStatus === "building" || buildStatus === "minting" || buildStatus === "burning";

	// Sync currencies from chain -- discovers tokens via Market<T> objects
	const syncMarkets = useCallback(async () => {
		if (!suiAddress) return;

		const addresses = getContractAddresses(tenant);
		const marketPkg = addresses.market?.packageId;
		if (!marketPkg) return;

		try {
			const markets = await queryMarkets(suiClient, marketPkg);
			const validMarketIds = new Set<string>();

			for (const market of markets) {
				// Only import markets where the current user is creator or authorized
				const walletAddr = account?.address;
				if (
					market.creator !== suiAddress &&
					!market.authorized.includes(suiAddress) &&
					(!walletAddr ||
						(market.creator !== walletAddr && !market.authorized.includes(walletAddr)))
				) {
					continue;
				}

				validMarketIds.add(market.objectId);

				const existing = await db.currencies.where("coinType").equals(market.coinType).first();
				if (existing) {
					// Update marketId if missing
					if (!existing.marketId) {
						await db.currencies.update(existing.id, {
							marketId: market.objectId,
						});
					}
					continue;
				}

				const parts = market.coinType.split("::");
				const packageId = parts[0] ?? "";
				const moduleName = parts.length >= 2 ? parts[1] : "";
				const structName = parts.length >= 3 ? parts[2] : moduleName;
				const sym = structName.replace(/_TOKEN$/, "");

				// Query actual decimals from on-chain metadata
				let coinDecimals = 9;
				try {
					const meta = await getCoinMetadata(suiClient, market.coinType);
					if (meta) coinDecimals = meta.decimals;
				} catch {
					// Fall back to 9 if metadata unavailable
				}

				const now = new Date().toISOString();
				await db.currencies.add({
					id: crypto.randomUUID(),
					symbol: sym,
					name: `${sym} Token`,
					description: "",
					moduleName,
					coinType: market.coinType,
					packageId,
					marketId: market.objectId,
					decimals: coinDecimals,
					createdAt: now,
					updatedAt: now,
				});
			}

			// Remove currencies whose Market is on an old/incompatible package
			const allCurrencies = await db.currencies.filter(notDeleted).toArray();
			for (const c of allCurrencies) {
				if (c.marketId && !validMarketIds.has(c.marketId)) {
					await db.currencies.delete(c.id);
				}
			}
		} catch {
			// Silent -- sync is best-effort
		}
	}, [suiAddress, suiClient, tenant, account?.address]);

	useEffect(() => {
		syncMarkets();
	}, [syncMarkets]);

	if (!activeCharacter || !suiAddress) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<Coins size={48} className="mx-auto mb-4 text-zinc-700" />
					<p className="text-sm text-zinc-500">Select a character to manage finance</p>
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

	async function handleCreateCurrency() {
		if (!symbol.trim() || !tokenName.trim()) return;

		setBuildStatus("building");
		setBuildError("");

		try {
			// Build publish transaction in-browser (no server needed)
			const tx = await buildPublishToken({
				symbol: symbol.trim().toUpperCase(),
				name: tokenName.trim(),
				description: description.trim() || `${tokenName.trim()} token`,
				decimals,
			});

			// User signs with their wallet (EVE Vault sponsors gas)
			const result = await signAndExecute({
				transaction: tx,
			});

			// Parse the published package details from effects
			const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";
			const fullResult = await suiClient.waitForTransaction({
				digest,
				include: { effects: true, objectTypes: true },
			});
			const fullTx = fullResult.Transaction ?? fullResult.FailedTransaction;
			const changedObjects = fullTx?.effects?.changedObjects ?? [];
			const objectTypesMap = fullTx?.objectTypes ?? {};

			// Convert to objectChanges for parsePublishResult
			const objectChanges: Array<{
				type: string;
				packageId?: string;
				objectType?: string;
				objectId?: string;
				modules?: string[];
			}> = changedObjects.map((change) => {
				if (change.outputState === "PackageWrite" && change.idOperation === "Created") {
					return { type: "published", packageId: change.objectId };
				}
				return {
					type: change.idOperation === "Created" ? "created" : "mutated",
					objectId: change.objectId,
					objectType: objectTypesMap[change.objectId],
				};
			});

			const parsed = parsePublishResult(objectChanges);
			if (!parsed) {
				throw new Error(
					"Token published but could not parse result. Check transaction on explorer.",
				);
			}

			const now = new Date().toISOString();
			await db.currencies.add({
				id: crypto.randomUUID(),
				symbol: symbol.trim().toUpperCase(),
				name: tokenName.trim(),
				description: description.trim(),
				moduleName: parsed.moduleName,
				coinType: parsed.coinType,
				packageId: parsed.packageId,
				marketId: parsed.marketId,
				decimals,
				createdAt: now,
				updatedAt: now,
			});

			setSymbol("");
			setTokenName("");
			setDescription("");
			setCreating(false);
			setBuildStatus("done");
		} catch (err) {
			setBuildStatus("error");
			setBuildError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div className="mx-auto max-w-3xl p-6">
			<Header />

			{/* Status Banner */}
			{buildStatus !== "idle" && buildStatus !== "done" && (
				<StatusBanner
					status={buildStatus}
					error={buildError}
					onDismiss={() => {
						setBuildStatus("idle");
						setBuildError("");
					}}
				/>
			)}

			{buildStatus === "done" && (
				<div className="mb-6 rounded-lg border border-green-900/50 bg-green-950/20 p-4">
					<p className="text-sm text-green-400">Operation completed successfully.</p>
					<button
						type="button"
						onClick={() => setBuildStatus("idle")}
						className="mt-2 text-xs text-zinc-400 hover:text-zinc-300"
					>
						Dismiss
					</button>
				</div>
			)}

			{/* Currency List */}
			{(currencies ?? []).length > 0 && (
				<div className="mb-6 space-y-3">
					<h2 className="text-sm font-medium text-zinc-400">Currencies ({currencies?.length})</h2>
					{currencies?.map((c) => (
						<CurrencyCard
							key={c.id}
							currency={c}
							tenant={tenant}
							suiAddress={suiAddress}
							onStatusChange={(s, e) => {
								setBuildStatus(s);
								setBuildError(e ?? "");
							}}
							onMarketCreated={syncMarkets}
						/>
					))}
				</div>
			)}

			{/* Create Currency */}
			{creating ? (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
					<h2 className="mb-4 text-lg font-medium text-zinc-100">Create Currency</h2>
					<div className="space-y-4">
						<div>
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">Symbol</label>
							<input
								type="text"
								value={symbol}
								onChange={(e) => setSymbol(e.target.value)}
								placeholder="e.g., GOLD"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
								maxLength={10}
							/>
						</div>
						<div>
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">Name</label>
							<input
								type="text"
								value={tokenName}
								onChange={(e) => setTokenName(e.target.value)}
								placeholder="e.g., Organization Gold"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
								maxLength={100}
							/>
						</div>
						<div>
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">Description</label>
							<textarea
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="e.g., Official currency of our organization"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
								maxLength={500}
								rows={2}
							/>
						</div>
						<div>
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">Decimals</label>
							<input
								type="number"
								value={decimals}
								onChange={(e) => setDecimals(Number(e.target.value))}
								min={0}
								max={18}
								className="w-32 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
							/>
						</div>
						<div className="flex gap-2">
							{account ? (
								<button
									type="button"
									onClick={handleCreateCurrency}
									disabled={!symbol.trim() || !tokenName.trim() || isProcessing}
									className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{isProcessing ? (
										<span className="flex items-center gap-2">
											<Loader2 size={14} className="animate-spin" /> Publishing...
										</span>
									) : (
										"Create Currency"
									)}
								</button>
							) : (
								<span className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-500">
									EVE Vault not connected
								</span>
							)}
							<button
								type="button"
								onClick={() => setCreating(false)}
								className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-300"
							>
								Cancel
							</button>
						</div>
						{isProcessing && (
							<p className="text-xs text-zinc-500">
								Your wallet will prompt you to sign. The token and Market will be published directly
								to Sui testnet.
							</p>
						)}
					</div>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setCreating(true)}
					className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 py-3 text-sm text-zinc-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
				>
					<Plus size={16} />
					Create Currency
				</button>
			)}
		</div>
	);
}

function Header() {
	return (
		<div className="mb-6 flex items-center justify-between">
			<div>
				<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
					<Coins size={24} className="text-cyan-500" />
					Finance
				</h1>
				<p className="mt-1 text-sm text-zinc-500">Create and manage currencies via Market</p>
			</div>
		</div>
	);
}

function StatusBanner({
	status,
	error,
	onDismiss,
}: {
	status: BuildStatus;
	error: string;
	onDismiss: () => void;
}) {
	const messages: Record<string, string> = {
		building: "Building and publishing token on-chain...",
		minting: "Minting tokens...",
		burning: "Burning tokens...",
		error: "Operation failed",
	};

	const isError = status === "error";

	return (
		<div
			className={`mb-6 rounded-lg border p-4 ${
				isError ? "border-red-900/50 bg-red-950/20" : "border-cyan-900/50 bg-cyan-950/20"
			}`}
		>
			<div className="flex items-center gap-2">
				{isError ? (
					<AlertCircle size={16} className="text-red-400" />
				) : (
					<Loader2 size={16} className="animate-spin text-cyan-400" />
				)}
				<span className={`text-sm ${isError ? "text-red-300" : "text-cyan-300"}`}>
					{messages[status] ?? "Processing..."}
				</span>
			</div>
			{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
			{isError && (
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

function CurrencyCard({
	currency,
	tenant,
	suiAddress,
	onStatusChange,
	onMarketCreated,
}: {
	currency: CurrencyRecord;
	tenant: TenantId;
	suiAddress: string;
	onStatusChange: (status: BuildStatus, error?: string) => void;
	onMarketCreated: () => void;
}) {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const suiClient = useSuiClient();

	const [expanded, setExpanded] = useState(false);
	const [marketInfo, setMarketInfo] = useState<MarketInfo | null>(null);
	const [loadingMarket, setLoadingMarket] = useState(false);
	const [totalSupply, setTotalSupply] = useState<bigint | null>(null);

	// Mint state
	const [showMint, setShowMint] = useState(false);
	const [mintAmount, setMintAmount] = useState("");
	const [mintRecipient, setMintRecipient] = useState("");

	// Burn state
	const [showBurn, setShowBurn] = useState(false);
	const [burnCoinId, setBurnCoinId] = useState("");
	const [ownedCoins, setOwnedCoins] = useState<Array<{ objectId: string; balance: bigint }>>([]);
	const [loadingCoins, setLoadingCoins] = useState(false);

	// Authorization state
	const [showAuth, setShowAuth] = useState(false);
	const [authAddress, setAuthAddress] = useState("");

	// Fee state
	const [showFees, setShowFees] = useState(false);
	const [feeBps, setFeeBps] = useState("");
	const [feeRecipient, setFeeRecipient] = useState("");

	const isPublished = !!currency.packageId;
	const hasMarket = !!currency.marketId;
	const addresses = getContractAddresses(tenant);
	const marketPkg = addresses.market?.packageId;
	const isCreator = marketInfo?.creator === suiAddress;

	useEffect(() => {
		if (expanded && hasMarket && currency.marketId) {
			loadMarketInfo();
		}
	}, [expanded, hasMarket, currency.marketId]);

	async function loadMarketInfo() {
		if (!currency.marketId) return;
		setLoadingMarket(true);
		try {
			const info = await queryMarketDetails(suiClient, currency.marketId);
			setMarketInfo(info);

			// Supply is embedded in Market's treasury_cap
			if (info?.totalSupply != null) {
				setTotalSupply(BigInt(info.totalSupply));
			}
		} catch {
			setMarketInfo(null);
		} finally {
			setLoadingMarket(false);
		}
	}

	async function loadOwnedCoins() {
		if (!currency.coinType) return;
		setLoadingCoins(true);
		try {
			const coins = await queryOwnedCoins(suiClient, suiAddress, currency.coinType);
			setOwnedCoins(coins);
		} catch {
			setOwnedCoins([]);
		} finally {
			setLoadingCoins(false);
		}
	}

	async function handleMint() {
		if (!mintAmount || !currency.marketId || !currency.coinType || !marketPkg) return;

		onStatusChange("minting");
		try {
			const amount = BigInt(Math.floor(Number(mintAmount) * 10 ** currency.decimals));
			const recipient = mintRecipient.trim() || suiAddress;
			const tx = buildMint({
				packageId: marketPkg,
				marketId: currency.marketId,
				coinType: currency.coinType,
				amount: Number(amount),
				recipient,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowMint(false);
			setMintAmount("");
			setMintRecipient("");
			onStatusChange("done");

			// Refresh after chain consistency delay
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleBurn() {
		if (!burnCoinId || !currency.marketId || !currency.coinType || !marketPkg) return;

		onStatusChange("burning");
		try {
			const tx = buildBurn({
				packageId: marketPkg,
				marketId: currency.marketId,
				coinType: currency.coinType,
				coinObjectId: burnCoinId,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowBurn(false);
			setBurnCoinId("");
			onStatusChange("done");

			// Refresh after chain consistency delay
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleAddAuthorized() {
		if (!authAddress.trim() || !currency.marketId || !currency.coinType || !marketPkg) return;

		onStatusChange("building");
		try {
			const tx = buildAddAuthorized({
				packageId: marketPkg,
				marketId: currency.marketId,
				coinType: currency.coinType,
				addr: authAddress.trim(),
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setAuthAddress("");
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleRemoveAuthorized(addr: string) {
		if (!currency.marketId || !currency.coinType || !marketPkg) return;

		onStatusChange("building");
		try {
			const tx = buildRemoveAuthorized({
				packageId: marketPkg,
				marketId: currency.marketId,
				coinType: currency.coinType,
				addr,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleUpdateFee() {
		if (!currency.marketId || !currency.coinType || !marketPkg) return;

		onStatusChange("building");
		try {
			const tx = buildUpdateFee({
				packageId: marketPkg,
				marketId: currency.marketId,
				coinType: currency.coinType,
				feeBps: Number(feeBps) || 0,
				feeRecipient: feeRecipient.trim() || suiAddress,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowFees(false);
			onStatusChange("done");
			setTimeout(() => loadMarketInfo(), 1500);
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	// Trade nodes for "Link to SSU" action
	const tradeNodes = useLiveQuery(() => db.tradeNodes.toArray()) ?? [];

	// All SSUs from the local deployables database
	const allSsus =
		useLiveQuery(() =>
			db.deployables.where("assemblyType").equals("Smart Storage Unit").toArray(),
		) ?? [];

	async function handleDiscoverMarket() {
		if (!currency.coinType || !marketPkg) return;

		onStatusChange("building");
		try {
			// Search for Market<CoinType> on-chain
			const markets = await queryMarkets(suiClient, marketPkg, currency.coinType);

			if (markets.length === 0) {
				// No Market found -- try creating one from TreasuryCap
				const treasuryCapId = await queryTreasuryCap(suiClient, currency.coinType, suiAddress);
				if (!treasuryCapId) {
					onStatusChange(
						"error",
						"No Market found on-chain and no TreasuryCap in your wallet. The Market may have been created with a different market package version.",
					);
					return;
				}

				const tx = buildCreateMarket({
					packageId: marketPkg,
					coinType: currency.coinType,
					treasuryCapId,
					senderAddress: suiAddress,
				});

				const result = await signAndExecute({ transaction: tx });

				const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";
				const fullResult = await suiClient.waitForTransaction({
					digest,
					include: { effects: true, objectTypes: true },
				});
				const fullTx = fullResult.Transaction ?? fullResult.FailedTransaction;
				const changedObjects = fullTx?.effects?.changedObjects ?? [];
				const objectTypesMap = fullTx?.objectTypes ?? {};

				let marketId: string | undefined;
				for (const change of changedObjects) {
					const objType = objectTypesMap[change.objectId] ?? "";
					if (objType.includes("::market::Market<")) {
						marketId = change.objectId;
						break;
					}
				}

				if (marketId) {
					await db.currencies.update(currency.id, {
						marketId,
						updatedAt: new Date().toISOString(),
					});
				}

				onStatusChange("done");
				onMarketCreated();
				return;
			}

			// Market found -- update local DB
			const market = markets[0];
			await db.currencies.update(currency.id, {
				marketId: market.objectId,
				updatedAt: new Date().toISOString(),
			});

			onStatusChange("done");
			onMarketCreated();
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleLinkToSsu(ssuObjectId: string) {
		if (!currency.marketId || !currency.coinType) return;

		const ssuMarketAddresses = getContractAddresses(tenant).ssuMarket;
		const ssuMarketPkg = ssuMarketAddresses?.packageId;
		const originalPkg = ssuMarketAddresses?.originalPackageId ?? ssuMarketPkg;
		const previousPkgs = ssuMarketAddresses?.previousOriginalPackageIds;
		if (!ssuMarketPkg || !originalPkg) return;

		onStatusChange("building");
		try {
			// Discover the CURRENT SsuConfig (may differ from stale local record)
			const currentConfigId = await discoverSsuConfig(
				suiClient,
				originalPkg,
				ssuObjectId,
				previousPkgs,
			);
			if (!currentConfigId) {
				onStatusChange(
					"error",
					"No SsuConfig found on-chain for this SSU. Deploy the extension first.",
				);
				return;
			}

			const tx = buildSetMarket({
				packageId: ssuMarketPkg,
				ssuConfigId: currentConfigId,
				marketId: currency.marketId,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });

			// Update local trade node with current SsuConfig
			const tn = tradeNodes.find((t) => t.id === ssuObjectId);
			if (tn) {
				await db.tradeNodes.update(tn.id, { marketConfigId: currentConfigId });
			}

			onStatusChange("done");
			onMarketCreated();
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	const [linkSsuId, setLinkSsuId] = useState("");

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
			{/* Header row */}
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center justify-between p-4"
			>
				<div className="flex items-center gap-3">
					<div className="rounded-lg bg-zinc-800 p-2">
						<Package size={16} className="text-cyan-500" />
					</div>
					<div className="text-left">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-zinc-200">{currency.symbol}</span>
							<span className="text-xs text-zinc-500">{currency.name}</span>
							{hasMarket && (
								<span className="rounded bg-green-500/10 px-1.5 py-0.5 text-xs text-green-400">
									Market
								</span>
							)}
						</div>
						{isPublished ? (
							<CopyAddress
								address={currency.packageId}
								sliceStart={10}
								sliceEnd={6}
								className="text-xs text-zinc-600"
							/>
						) : (
							<p className="text-xs text-amber-500">Not published yet</p>
						)}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-zinc-600">{currency.decimals} decimals</span>
					{expanded ? (
						<ChevronUp size={14} className="text-zinc-500" />
					) : (
						<ChevronDown size={14} className="text-zinc-500" />
					)}
				</div>
			</button>

			{/* Expanded content */}
			{expanded && (
				<div className="border-t border-zinc-800 p-4">
					{/* Market Dashboard */}
					{hasMarket && (
						<div className="space-y-4">
							{/* Market info */}
							<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
								<div className="mb-2 flex items-center justify-between">
									<h4 className="text-xs font-medium text-zinc-400">Market Overview</h4>
									<button
										type="button"
										onClick={loadMarketInfo}
										className="text-zinc-500 hover:text-zinc-300"
										title="Refresh"
									>
										<RefreshCw size={12} />
									</button>
								</div>
								{loadingMarket ? (
									<div className="flex items-center gap-2 text-xs text-zinc-500">
										<Loader2 size={12} className="animate-spin" />
										Loading...
									</div>
								) : marketInfo ? (
									<div className="space-y-2">
										<div className="grid grid-cols-2 gap-3">
											<div>
												<p className="text-xs text-zinc-500">Total Supply</p>
												<p className="text-sm font-medium text-zinc-200">
													{totalSupply != null
														? `${formatTokenAmount(totalSupply, currency.decimals)} ${currency.symbol}`
														: "--"}
												</p>
											</div>
											<div>
												<p className="text-xs text-zinc-500">Fee</p>
												<p className="text-sm font-medium text-zinc-200">{marketInfo.feeBps} bps</p>
											</div>
										</div>
										<div>
											<p className="text-xs text-zinc-500">Creator</p>
											<p className="font-mono text-xs text-zinc-400">
												{marketInfo.creator.slice(0, 10)}
												...
												{marketInfo.creator.slice(-6)}
												{isCreator && <span className="ml-2 text-cyan-400">(you)</span>}
											</p>
										</div>
										<div>
											<p className="text-xs text-zinc-500">Market ID</p>
											<p className="font-mono text-xs text-zinc-400">
												{currency.marketId?.slice(0, 10)}
												...
												{currency.marketId?.slice(-6)}
											</p>
										</div>
										{marketInfo.authorized.length > 0 && (
											<div>
												<p className="text-xs text-zinc-500">
													Authorized ({marketInfo.authorized.length})
												</p>
												<div className="mt-1 space-y-0.5">
													{marketInfo.authorized.map((addr) => (
														<div key={addr} className="flex items-center justify-between">
															<span className="font-mono text-xs text-zinc-400">
																{addr.slice(0, 10)}
																...
																{addr.slice(-6)}
																{addr === suiAddress && (
																	<span className="ml-1 text-cyan-400">(you)</span>
																)}
															</span>
															{isCreator && (
																<button
																	type="button"
																	onClick={() => handleRemoveAuthorized(addr)}
																	className="text-zinc-600 transition-colors hover:text-red-400"
																	title="Remove"
																>
																	<UserMinus size={12} />
																</button>
															)}
														</div>
													))}
												</div>
											</div>
										)}
										{marketInfo.feeRecipient && (
											<div>
												<p className="text-xs text-zinc-500">Fee Recipient</p>
												<p className="font-mono text-xs text-zinc-400">
													{marketInfo.feeRecipient.slice(0, 10)}
													...
													{marketInfo.feeRecipient.slice(-6)}
												</p>
											</div>
										)}
									</div>
								) : (
									<p className="text-xs text-zinc-600">Click refresh to load market data</p>
								)}
							</div>

							{/* Action buttons */}
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									onClick={() => {
										setShowMint(!showMint);
										setShowBurn(false);
										setShowAuth(false);
										setShowFees(false);
									}}
									className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
										showMint
											? "bg-cyan-600/20 text-cyan-400"
											: "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
									}`}
								>
									<Send size={12} />
									Mint
								</button>
								<button
									type="button"
									onClick={() => {
										setShowBurn(!showBurn);
										setShowMint(false);
										setShowAuth(false);
										setShowFees(false);
										if (!showBurn) loadOwnedCoins();
									}}
									className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
										showBurn
											? "bg-red-600/20 text-red-400"
											: "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
									}`}
								>
									<Flame size={12} />
									Burn
								</button>
								{isCreator && (
									<>
										<button
											type="button"
											onClick={() => {
												setShowAuth(!showAuth);
												setShowMint(false);
												setShowBurn(false);
												setShowFees(false);
											}}
											className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
												showAuth
													? "bg-amber-600/20 text-amber-400"
													: "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
											}`}
										>
											<UserPlus size={12} />
											Authorize
										</button>
										<button
											type="button"
											onClick={() => {
												setShowFees(!showFees);
												setShowMint(false);
												setShowBurn(false);
												setShowAuth(false);
												if (marketInfo) {
													setFeeBps(String(marketInfo.feeBps));
													setFeeRecipient(marketInfo.feeRecipient);
												}
											}}
											className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
												showFees
													? "bg-purple-600/20 text-purple-400"
													: "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
											}`}
										>
											<Settings size={12} />
											Fees
										</button>
									</>
								)}
							</div>

							{/* Mint Form */}
							{showMint && (
								<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
									<h4 className="mb-3 text-xs font-medium text-zinc-400">Mint {currency.symbol}</h4>
									<div className="space-y-3">
										<div>
											<label className="mb-1 block text-xs text-zinc-500">Amount</label>
											<input
												type="number"
												value={mintAmount}
												onChange={(e) => setMintAmount(e.target.value)}
												placeholder="e.g., 1000"
												min={0}
												step="any"
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
										<div>
											<label className="mb-1 block text-xs text-zinc-500">
												Recipient (blank = your wallet)
											</label>
											<input
												type="text"
												value={mintRecipient}
												onChange={(e) => setMintRecipient(e.target.value)}
												placeholder={suiAddress.slice(0, 16)}
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
										{account ? (
											<button
												type="button"
												onClick={handleMint}
												disabled={!mintAmount}
												className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
											>
												Mint {currency.symbol}
											</button>
										) : (
											<span className="text-xs text-zinc-500">EVE Vault not connected</span>
										)}
									</div>
								</div>
							)}

							{/* Burn Form */}
							{showBurn && (
								<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
									<h4 className="mb-3 text-xs font-medium text-zinc-400">Burn {currency.symbol}</h4>
									{loadingCoins ? (
										<div className="flex items-center gap-2 text-xs text-zinc-500">
											<Loader2 size={12} className="animate-spin" />
											Loading your coins...
										</div>
									) : ownedCoins.length === 0 ? (
										<p className="text-xs text-zinc-600">
											No {currency.symbol} coins in your wallet.
										</p>
									) : (
										<div className="space-y-2">
											<label className="mb-1 block text-xs text-zinc-500">
												Select Coin to Burn
											</label>
											<select
												value={burnCoinId}
												onChange={(e) => setBurnCoinId(e.target.value)}
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
											>
												<option value="">Choose a coin...</option>
												{ownedCoins.map((c) => (
													<option key={c.objectId} value={c.objectId}>
														{formatTokenAmount(c.balance, currency.decimals)} {currency.symbol} (
														{c.objectId.slice(0, 10)}
														...)
													</option>
												))}
											</select>
											{account ? (
												<button
													type="button"
													onClick={handleBurn}
													disabled={!burnCoinId}
													className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
												>
													Burn Selected Coin
												</button>
											) : (
												<span className="text-xs text-zinc-500">EVE Vault not connected</span>
											)}
										</div>
									)}
								</div>
							)}

							{/* Authorization Form (creator only) */}
							{showAuth && isCreator && (
								<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
									<h4 className="mb-3 text-xs font-medium text-zinc-400">Add Authorized Minter</h4>
									<div className="space-y-3">
										<div>
											<label className="mb-1 block text-xs text-zinc-500">Sui Address</label>
											<input
												type="text"
												value={authAddress}
												onChange={(e) => setAuthAddress(e.target.value)}
												placeholder="0x..."
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
										<button
											type="button"
											onClick={handleAddAuthorized}
											disabled={!authAddress.trim()}
											className="flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
										>
											<UserPlus size={12} />
											Add Authorized
										</button>
									</div>
								</div>
							)}

							{/* Fee Management (creator only) */}
							{showFees && isCreator && (
								<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
									<h4 className="mb-3 text-xs font-medium text-zinc-400">
										Update Fee Configuration
									</h4>
									<div className="space-y-3">
										<div>
											<label className="mb-1 block text-xs text-zinc-500">
												Fee (basis points, 100 = 1%)
											</label>
											<input
												type="number"
												value={feeBps}
												onChange={(e) => setFeeBps(e.target.value)}
												placeholder="e.g., 250"
												min={0}
												max={10000}
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
										<div>
											<label className="mb-1 block text-xs text-zinc-500">Fee Recipient</label>
											<input
												type="text"
												value={feeRecipient}
												onChange={(e) => setFeeRecipient(e.target.value)}
												placeholder="0x..."
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
										<button
											type="button"
											onClick={handleUpdateFee}
											className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-500"
										>
											<Settings size={12} />
											Update Fee
										</button>
									</div>
								</div>
							)}
						</div>
					)}

					{/* Create Market (when currency has no Market yet) */}
					{isPublished && !hasMarket && (
						<div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
							<h4 className="mb-2 text-xs font-medium text-amber-400">No Market Linked</h4>
							<p className="mb-3 text-xs text-zinc-500">
								Search for the existing Market on-chain, or create one if none exists.
							</p>
							{account ? (
								<button
									type="button"
									onClick={handleDiscoverMarket}
									className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500"
								>
									Find / Create Market
								</button>
							) : (
								<span className="text-xs text-zinc-500">Connect wallet</span>
							)}
						</div>
					)}

					{/* Link Market to SSU */}
					{hasMarket && account && (
						<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
							<h4 className="mb-2 text-xs font-medium text-zinc-400">Link Market to SSU</h4>
							<p className="mb-2 text-[10px] text-zinc-600">
								Link this currency's Market to an SSU so items can be sold for this currency.
							</p>
							<div className="flex items-center gap-2">
								<select
									value={linkSsuId}
									onChange={(e) => setLinkSsuId(e.target.value)}
									className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none"
								>
									<option value="">Select an SSU...</option>
									{allSsus.map((ssu) => (
										<option key={ssu.objectId} value={ssu.objectId}>
											{ssu.label || ssu.objectId.slice(0, 14) + "..."}
											{ssu.systemId ? ` (System ${ssu.systemId})` : ""}
										</option>
									))}
								</select>
								<button
									type="button"
									onClick={() => {
										if (linkSsuId) handleLinkToSsu(linkSsuId);
									}}
									disabled={!linkSsuId}
									className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
								>
									Link
								</button>
							</div>
						</div>
					)}

					{/* Coin type info for published currencies */}
					{isPublished && currency.coinType && (
						<div className="mt-3 space-y-1 border-t border-zinc-800 pt-3 text-xs text-zinc-600">
							<p>
								<span className="text-zinc-500">Coin Type:</span>{" "}
								<span className="font-mono">{currency.coinType}</span>
							</p>
							{currency.moduleName && (
								<p>
									<span className="text-zinc-500">Module:</span>{" "}
									<span className="font-mono">{currency.moduleName}</span>
								</p>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function formatTokenAmount(raw: bigint, decimals: number): string {
	if (decimals === 0) return raw.toString();
	const divisor = 10n ** BigInt(decimals);
	const whole = raw / divisor;
	const frac = raw % divisor;
	if (frac === 0n) return whole.toString();
	const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${whole}.${fracStr}`;
}
