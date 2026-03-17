import { useState, useEffect, useCallback } from "react";
import {
	useCurrentAccount,
	useCurrentClient,
	useDAppKit,
} from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	Coins,
	Plus,
	Loader2,
	AlertCircle,
	ArrowDownToLine,
	Package,
	Send,
	Flame,
	Target,
	ChevronDown,
	ChevronUp,
	RefreshCw,
} from "lucide-react";

import type { TenantId } from "@/chain/config";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { db, notDeleted } from "@/db";
import type { CurrencyRecord } from "@/db/types";
import {
	buildDepositTreasuryCap,
	buildMintAndTransfer,
	buildBurn,
	buildFundBounty,
	queryOrgTreasury,
	getContractAddresses,
	queryTokenSupply,
	queryOwnedCoins,
	buildPublishToken,
	parsePublishResult,
} from "@tehfrontier/chain-shared";

type BuildStatus =
	| "idle"
	| "building"
	| "depositing"
	| "minting"
	| "burning"
	| "posting-bounty"
	| "done"
	| "error";

export function GovernanceFinance() {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const tenant = useActiveTenant();
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

	const [creating, setCreating] = useState(false);
	const [symbol, setSymbol] = useState("");
	const [tokenName, setTokenName] = useState("");
	const [description, setDescription] = useState("");
	const [decimals, setDecimals] = useState(9);
	const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
	const [buildError, setBuildError] = useState("");

	const suiClient = useCurrentClient();

	const isProcessing =
		buildStatus === "building" ||
		buildStatus === "depositing" ||
		buildStatus === "minting" ||
		buildStatus === "burning" ||
		buildStatus === "posting-bounty";

	// Sync TreasuryCaps from chain — discovers tokens created outside the app
	// or tokens that failed to save locally after publishing
	const syncTreasuryCaps = useCallback(async () => {
		if (!suiAddress || !org) return;
		try {
			let cursor: string | null = null;
			let hasMore = true;
			while (hasMore) {
				const page = await suiClient.listOwnedObjects({
					owner: suiAddress,
					type: "0x2::coin::TreasuryCap",
					include: { json: true },
					cursor: cursor ?? undefined,
					limit: 50,
				});
				for (const obj of page.objects) {
					const objectType = obj.type;
					const objectId = obj.objectId;
					if (!objectType || !objectId) continue;

					// Extract coinType from TreasuryCap<0xpkg::module::STRUCT>
					const match = objectType.match(/TreasuryCap<(.+)>/);
					if (!match) continue;
					const coinType = match[1];

					// Check if already in local DB
					const existing = await db.currencies
						.where("coinType")
						.equals(coinType)
						.first();
					if (existing) continue;

					// Derive metadata from coinType: "0xpkg::gold_token::GOLD_TOKEN"
					const parts = coinType.split("::");
					const packageId = parts[0] ?? "";
					const moduleName = parts.length >= 2 ? parts[1] : "";
					const structName = parts.length >= 3 ? parts[2] : moduleName;
					// Derive symbol: "GOLD_TOKEN" → "GOLD" (strip _TOKEN suffix)
					const symbol = structName.replace(/_TOKEN$/, "");

					const now = new Date().toISOString();
					await db.currencies.add({
						id: crypto.randomUUID(),
						orgId: org.id,
						symbol,
						name: `${symbol} Token`,
						description: "",
						moduleName,
						coinType,
						packageId,
						treasuryCapId: objectId,
						decimals: 9,
						createdAt: now,
						updatedAt: now,
					});
				}
				hasMore = page.hasNextPage;
				cursor = page.cursor ?? null;
			}
		} catch {
			// Silent — sync is best-effort
		}
	}, [suiAddress, org, suiClient]);

	useEffect(() => {
		syncTreasuryCaps();
	}, [syncTreasuryCaps]);

	if (!activeCharacter || !suiAddress) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<Coins size={48} className="mx-auto mb-4 text-zinc-700" />
					<p className="text-sm text-zinc-500">
						Select a character to manage finance
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

	async function handleCreateCurrency() {
		if (!symbol.trim() || !tokenName.trim() || !org) return;

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

			// Parse the published package details from effects objectChanges
			const txData = result.Transaction ?? result.FailedTransaction;
			const objectChanges = (txData?.effects?.objectChanges ?? []) as Array<{
				type: string;
				packageId?: string;
				objectType?: string;
				objectId?: string;
				modules?: string[];
			}>;

			const parsed = parsePublishResult(objectChanges);
			if (!parsed) {
				throw new Error(
					"Token published but could not parse result. Check transaction on explorer.",
				);
			}

			const now = new Date().toISOString();
			await db.currencies.add({
				id: crypto.randomUUID(),
				orgId: org.id,
				symbol: symbol.trim().toUpperCase(),
				name: tokenName.trim(),
				description: description.trim(),
				moduleName: parsed.moduleName,
				coinType: parsed.coinType,
				packageId: parsed.packageId,
				treasuryCapId: parsed.treasuryCapId,
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

			{/* No gas station warning removed — manual import is always available */}

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
					<p className="text-sm text-green-400">
						Operation completed successfully.
					</p>
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
					<h2 className="text-sm font-medium text-zinc-400">
						Currencies ({currencies?.length})
					</h2>
					{currencies?.map((c) => (
						<CurrencyCard
							key={c.id}
							currency={c}
							org={org}
							tenant={tenant}

							suiAddress={suiAddress}
							onStatusChange={(s, e) => {
								setBuildStatus(s);
								setBuildError(e ?? "");
							}}
						/>
					))}
				</div>
			)}

			{/* Create Currency */}
			{creating ? (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
					<h2 className="mb-4 text-lg font-medium text-zinc-100">
						Create Currency
					</h2>
					<div className="space-y-4">
						<div>
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">
								Symbol
							</label>
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
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">
								Name
							</label>
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
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">
								Description
							</label>
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
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">
								Decimals
							</label>
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
											<Loader2 size={14} className="animate-spin" />{" "}
											Publishing...
										</span>
									) : (
										"Create Currency"
									)}
								</button>
							) : (
								<span className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-500">EVE Vault not connected</span>
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
								Your wallet will prompt you to sign. The token will be
								published directly to Sui testnet.
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
				<p className="mt-1 text-sm text-zinc-500">
					Create and manage organization currencies
				</p>
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
		depositing: "Depositing TreasuryCap to OrgTreasury...",
		minting: "Minting tokens...",
		burning: "Burning tokens...",
		"posting-bounty": "Posting bounty...",
		error: "Operation failed",
	};

	const isError = status === "error";

	return (
		<div
			className={`mb-6 rounded-lg border p-4 ${
				isError
					? "border-red-900/50 bg-red-950/20"
					: "border-cyan-900/50 bg-cyan-950/20"
			}`}
		>
			<div className="flex items-center gap-2">
				{isError ? (
					<AlertCircle size={16} className="text-red-400" />
				) : (
					<Loader2 size={16} className="animate-spin text-cyan-400" />
				)}
				<span
					className={`text-sm ${isError ? "text-red-300" : "text-cyan-300"}`}
				>
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
	org,
	tenant,
	suiAddress,
	onStatusChange,
}: {
	currency: CurrencyRecord;
	org: { id: string; name: string; chainObjectId?: string };
	tenant: TenantId;
	suiAddress: string;
	onStatusChange: (status: BuildStatus, error?: string) => void;
}) {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const suiClient = useCurrentClient();

	const [expanded, setExpanded] = useState(false);
	const [treasuryInfo, setTreasuryInfo] = useState<{
		totalSupply: bigint;
	} | null>(null);
	const [loadingTreasury, setLoadingTreasury] = useState(false);

	// Mint state
	const [showMint, setShowMint] = useState(false);
	const [mintAmount, setMintAmount] = useState("");
	const [mintRecipient, setMintRecipient] = useState("");

	// Burn state
	const [showBurn, setShowBurn] = useState(false);
	const [burnCoinId, setBurnCoinId] = useState("");
	const [ownedCoins, setOwnedCoins] = useState<
		Array<{ objectId: string; balance: bigint }>
	>([]);
	const [loadingCoins, setLoadingCoins] = useState(false);

	// Bounty state
	const [showBounty, setShowBounty] = useState(false);
	const [bountyTarget, setBountyTarget] = useState("");
	const [bountyAmount, setBountyAmount] = useState("");
	const [bountyExpiry, setBountyExpiry] = useState("");

	const isPublished = !!currency.packageId;
	const hasTreasury = !!currency.orgTreasuryId;
	const addresses = getContractAddresses(tenant);

	useEffect(() => {
		if (expanded && hasTreasury && currency.orgTreasuryId) {
			loadTreasuryInfo();
		}
	}, [expanded, hasTreasury, currency.orgTreasuryId]);

	async function loadTreasuryInfo() {
		if (!currency.orgTreasuryId) return;
		setLoadingTreasury(true);
		try {
			const info = await queryOrgTreasury(
				suiClient,
				currency.orgTreasuryId,
			);
			setTreasuryInfo(info);
		} catch {
			setTreasuryInfo(null);
		} finally {
			setLoadingTreasury(false);
		}
	}

	async function loadOwnedCoins() {
		if (!currency.coinType) return;
		setLoadingCoins(true);
		try {
			const coins = await queryOwnedCoins(
				suiClient,
				suiAddress,
				currency.coinType,
			);
			setOwnedCoins(coins);
		} catch {
			setOwnedCoins([]);
		} finally {
			setLoadingCoins(false);
		}
	}

	async function handleDeposit() {
		if (!currency.treasuryCapId || !currency.coinType || !org.chainObjectId) return;

		if (!addresses.governanceExt?.packageId) {
			onStatusChange(
				"error",
				"GovernanceExt contract not deployed yet.",
			);
			return;
		}

		onStatusChange("depositing");
		try {
			const tx = buildDepositTreasuryCap({
				governanceExtPackageId: addresses.governanceExt.packageId,
				orgObjectId: org.chainObjectId,
				treasuryCapId: currency.treasuryCapId,
				coinType: currency.coinType,
				senderAddress: suiAddress,
			});

			const result = await signAndExecute({ transaction: tx });

			// Parse objectChanges to find OrgTreasury
			const txResponse = await suiClient.waitForTransaction({
				digest: result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "",
				options: { showObjectChanges: true },
			});

			const treasuryCreated = txResponse.objectChanges?.find(
				(change) =>
					change.type === "created" &&
					change.objectType.includes("::treasury::OrgTreasury"),
			);
			const orgTreasuryId =
				treasuryCreated && treasuryCreated.type === "created"
					? treasuryCreated.objectId
					: undefined;

			if (orgTreasuryId) {
				await db.currencies.update(currency.id, {
					orgTreasuryId,
					updatedAt: new Date().toISOString(),
				});
			}

			onStatusChange("done");
		} catch (err) {
			onStatusChange(
				"error",
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	async function handleMint() {
		if (!mintAmount || !currency.orgTreasuryId || !currency.coinType || !org.chainObjectId)
			return;

		if (!addresses.governanceExt?.packageId) {
			onStatusChange(
				"error",
				"GovernanceExt contract not deployed yet.",
			);
			return;
		}

		onStatusChange("minting");
		try {
			const amount = BigInt(
				Math.floor(
					Number(mintAmount) * 10 ** currency.decimals,
				),
			);
			// Mint to the connected wallet (stakeholder mints to self)
			const tx = buildMintAndTransfer({
				governanceExtPackageId: addresses.governanceExt.packageId,
				orgTreasuryId: currency.orgTreasuryId,
				orgObjectId: org.chainObjectId,
				coinType: currency.coinType,
				amount,
				recipient: suiAddress,
				senderAddress: suiAddress,
			});

			await signAndExecute({
				transaction: tx,
			});
			setShowMint(false);
			setMintAmount("");
			onStatusChange("done");

			// Refresh treasury info after a short delay for chain consistency
			if (currency.orgTreasuryId) {
				setTimeout(() => loadTreasuryInfo(), 1500);
			}
		} catch (err) {
			onStatusChange(
				"error",
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	async function handleBurn() {
		if (!burnCoinId || !currency.orgTreasuryId || !currency.coinType) return;

		if (!addresses.governanceExt?.packageId) {
			onStatusChange(
				"error",
				"GovernanceExt contract not deployed yet.",
			);
			return;
		}

		onStatusChange("burning");
		try {
			const tx = buildBurn({
				governanceExtPackageId: addresses.governanceExt.packageId,
				orgTreasuryId: currency.orgTreasuryId,
				coinType: currency.coinType,
				coinObjectId: burnCoinId,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowBurn(false);
			setBurnCoinId("");
			onStatusChange("done");

			// Refresh after chain consistency delay
			if (currency.orgTreasuryId) {
				setTimeout(() => loadTreasuryInfo(), 1500);
			}
		} catch (err) {
			onStatusChange(
				"error",
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	async function handlePostBounty() {
		if (!bountyTarget || !bountyAmount || !currency.orgTreasuryId || !currency.coinType || !org.chainObjectId)
			return;

		if (!addresses.governanceExt?.packageId) {
			onStatusChange(
				"error",
				"GovernanceExt contract not deployed yet.",
			);
			return;
		}
		if (!addresses.bountyBoard?.packageId || !addresses.bountyBoard?.boardObjectId) {
			onStatusChange("error", "Bounty board contract not configured.");
			return;
		}

		onStatusChange("posting-bounty");
		try {
			const rewardAmount = BigInt(
				Math.floor(
					Number(bountyAmount) * 10 ** currency.decimals,
				),
			);
			const expiresAt = bountyExpiry
				? Math.floor(new Date(bountyExpiry).getTime() / 1000)
				: Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // Default 7 days

			const tx = buildFundBounty({
				governanceExtPackageId: addresses.governanceExt.packageId,
				bountyBoardPackageId: addresses.bountyBoard.packageId,
				orgTreasuryId: currency.orgTreasuryId,
				orgObjectId: org.chainObjectId,
				boardObjectId: addresses.bountyBoard.boardObjectId,
				coinType: currency.coinType,
				rewardAmount,
				targetCharacterId: Number(bountyTarget),
				expiresAt,
				senderAddress: suiAddress,
			});

			await signAndExecute({ transaction: tx });
			setShowBounty(false);
			setBountyTarget("");
			setBountyAmount("");
			setBountyExpiry("");
			onStatusChange("done");

			if (currency.orgTreasuryId) {
				loadTreasuryInfo();
			}
		} catch (err) {
			onStatusChange(
				"error",
				err instanceof Error ? err.message : String(err),
			);
		}
	}

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
							<span className="text-sm font-medium text-zinc-200">
								{currency.symbol}
							</span>
							<span className="text-xs text-zinc-500">
								{currency.name}
							</span>
							{hasTreasury && (
								<span className="rounded bg-green-500/10 px-1.5 py-0.5 text-xs text-green-400">
									Treasury
								</span>
							)}
						</div>
						{isPublished ? (
							<p className="font-mono text-xs text-zinc-600">
								{currency.packageId.slice(0, 10)}...
								{currency.packageId.slice(-6)}
							</p>
						) : (
							<p className="text-xs text-amber-500">
								Not published yet
							</p>
						)}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-zinc-600">
						{currency.decimals} decimals
					</span>
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
					{/* Deposit TreasuryCap (when published but no treasury) */}
					{isPublished && !hasTreasury && org.chainObjectId && (
						<div className="mb-4 rounded-lg border border-amber-900/30 bg-amber-950/10 p-3">
							<p className="mb-2 text-xs text-amber-400">
								Deposit the TreasuryCap into an OrgTreasury to
								enable stakeholder minting. This is irreversible
								-- the TreasuryCap cannot be extracted once
								deposited.
							</p>
							{account ? (
								<button
									type="button"
									onClick={handleDeposit}
									className="flex items-center gap-1.5 rounded bg-amber-600/20 px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-600/30"
								>
									<ArrowDownToLine size={12} />
									Deposit to OrgTreasury
								</button>
							) : (
								<span className="text-xs text-zinc-500">EVE Vault not connected</span>
							)}
						</div>
					)}

					{isPublished && !hasTreasury && !org.chainObjectId && (
						<div className="mb-4 text-xs text-amber-400/80">
							Publish your organization to chain first to deposit
							TreasuryCap.
						</div>
					)}

					{/* Treasury Dashboard */}
					{hasTreasury && (
						<div className="space-y-4">
							{/* Supply info */}
							<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
								<div className="mb-2 flex items-center justify-between">
									<h4 className="text-xs font-medium text-zinc-400">
										Treasury Overview
									</h4>
									<button
										type="button"
										onClick={loadTreasuryInfo}
										className="text-zinc-500 hover:text-zinc-300"
										title="Refresh"
									>
										<RefreshCw size={12} />
									</button>
								</div>
								{loadingTreasury ? (
									<div className="flex items-center gap-2 text-xs text-zinc-500">
										<Loader2
											size={12}
											className="animate-spin"
										/>
										Loading...
									</div>
								) : treasuryInfo ? (
									<div className="grid grid-cols-2 gap-3">
										<div>
											<p className="text-xs text-zinc-500">
												Total Supply
											</p>
											<p className="text-sm font-medium text-zinc-200">
												{formatTokenAmount(
													treasuryInfo.totalSupply,
													currency.decimals,
												)}{" "}
												{currency.symbol}
											</p>
										</div>
										<div>
											<p className="text-xs text-zinc-500">
												Treasury ID
											</p>
											<p className="font-mono text-xs text-zinc-400">
												{currency.orgTreasuryId?.slice(
													0,
													10,
												)}
												...
												{currency.orgTreasuryId?.slice(
													-6,
												)}
											</p>
										</div>
									</div>
								) : (
									<p className="text-xs text-zinc-600">
										Click refresh to load treasury data
									</p>
								)}
							</div>

							{/* Action buttons */}
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									onClick={() => {
										setShowMint(!showMint);
										setShowBurn(false);
										setShowBounty(false);
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
										setShowBounty(false);
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
								<button
									type="button"
									onClick={() => {
										setShowBounty(!showBounty);
										setShowMint(false);
										setShowBurn(false);
									}}
									className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
										showBounty
											? "bg-amber-600/20 text-amber-400"
											: "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
									}`}
								>
									<Target size={12} />
									Post Bounty
								</button>
							</div>

							{/* Mint Form */}
							{showMint && (
								<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
									<h4 className="mb-3 text-xs font-medium text-zinc-400">
										Mint {currency.symbol}
									</h4>
									<div className="space-y-3">
										<div>
											<label className="mb-1 block text-xs text-zinc-500">
												Amount
											</label>
											<input
												type="number"
												value={mintAmount}
												onChange={(e) =>
													setMintAmount(
														e.target.value,
													)
												}
												placeholder="e.g., 1000"
												min={0}
												step="any"
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
										<p className="text-xs text-zinc-600">
											Mints to your wallet ({suiAddress.slice(0, 8)}...)
										</p>
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
									<h4 className="mb-3 text-xs font-medium text-zinc-400">
										Burn {currency.symbol}
									</h4>
									{loadingCoins ? (
										<div className="flex items-center gap-2 text-xs text-zinc-500">
											<Loader2
												size={12}
												className="animate-spin"
											/>
											Loading your coins...
										</div>
									) : ownedCoins.length === 0 ? (
										<p className="text-xs text-zinc-600">
											No {currency.symbol} coins in your
											wallet.
										</p>
									) : (
										<div className="space-y-2">
											<label className="mb-1 block text-xs text-zinc-500">
												Select Coin to Burn
											</label>
											<select
												value={burnCoinId}
												onChange={(e) =>
													setBurnCoinId(
														e.target.value,
													)
												}
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
											>
												<option value="">
													Choose a coin...
												</option>
												{ownedCoins.map((c) => (
													<option
														key={c.objectId}
														value={c.objectId}
													>
														{formatTokenAmount(
															c.balance,
															currency.decimals,
														)}{" "}
														{currency.symbol} (
														{c.objectId.slice(
															0,
															10,
														)}
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

							{/* Bounty Form */}
							{showBounty && (
								<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
									<h4 className="mb-3 text-xs font-medium text-zinc-400">
										Post Bounty (funded from Treasury)
									</h4>
									<div className="space-y-3">
										<div>
											<label className="mb-1 block text-xs text-zinc-500">
												Target Character ID
											</label>
											<input
												type="number"
												value={bountyTarget}
												onChange={(e) =>
													setBountyTarget(
														e.target.value,
													)
												}
												placeholder="e.g., 2112077599"
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
										<div>
											<label className="mb-1 block text-xs text-zinc-500">
												Reward Amount (
												{currency.symbol})
											</label>
											<input
												type="number"
												value={bountyAmount}
												onChange={(e) =>
													setBountyAmount(
														e.target.value,
													)
												}
												placeholder="e.g., 100"
												min={0}
												step="any"
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
										<div>
											<label className="mb-1 block text-xs text-zinc-500">
												Expiration (optional, default 7
												days)
											</label>
											<input
												type="datetime-local"
												value={bountyExpiry}
												onChange={(e) =>
													setBountyExpiry(
														e.target.value,
													)
												}
												className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
											/>
										</div>
										{account ? (
										<button
											type="button"
											onClick={handlePostBounty}
											disabled={
												!bountyTarget ||
												!bountyAmount
											}
											className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
										>
											Mint &amp; Post Bounty
										</button>
									) : (
										<span className="text-xs text-zinc-500">EVE Vault not connected</span>
									)}
									</div>
								</div>
							)}
						</div>
					)}

					{/* Coin type info for published currencies */}
					{isPublished && currency.coinType && (
						<div className="mt-3 space-y-1 border-t border-zinc-800 pt-3 text-xs text-zinc-600">
							<p>
								<span className="text-zinc-500">
									Coin Type:
								</span>{" "}
								<span className="font-mono">
									{currency.coinType}
								</span>
							</p>
							{currency.moduleName && (
								<p>
									<span className="text-zinc-500">
										Module:
									</span>{" "}
									<span className="font-mono">
										{currency.moduleName}
									</span>
								</p>
							)}
							{currency.treasuryCapId && !hasTreasury && (
								<p>
									<span className="text-zinc-500">
										TreasuryCap:
									</span>{" "}
									<span className="font-mono">
										{currency.treasuryCapId.slice(0, 10)}
										...
										{currency.treasuryCapId.slice(-6)}
									</span>
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
