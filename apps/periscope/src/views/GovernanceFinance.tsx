import { useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useLiveQuery } from "dexie-react-hooks";
import { Coins, Plus, Loader2, AlertCircle, Package } from "lucide-react";
import { WalletConnect } from "@/components/WalletConnect";
import { db, notDeleted } from "@/db";
import type { CurrencyRecord } from "@/db/types";

export function GovernanceFinance() {
	const account = useCurrentAccount();
	const org = useLiveQuery(() => db.organizations.filter(notDeleted).first());
	const currencies = useLiveQuery(
		() => org ? db.currencies.where("orgId").equals(org.id).filter(notDeleted).toArray() : [],
		[org?.id],
	);

	const [creating, setCreating] = useState(false);
	const [symbol, setSymbol] = useState("");
	const [tokenName, setTokenName] = useState("");
	const [description, setDescription] = useState("");
	const [decimals, setDecimals] = useState(9);
	const [isSubmitting, setIsSubmitting] = useState(false);

	if (!account) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<Coins size={48} className="mx-auto mb-4 text-zinc-700" />
					<p className="text-sm text-zinc-500">Connect your wallet to manage finance</p>
					<div className="mt-4">
						<WalletConnect />
					</div>
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
					<a
						href="/governance"
						className="text-xs text-cyan-400 hover:text-cyan-300"
					>
						Go to Organization →
					</a>
				</div>
			</div>
		);
	}

	async function handleCreateCurrency() {
		if (!symbol.trim() || !tokenName.trim() || !org) return;
		setIsSubmitting(true);

		try {
			// Phase 1: store locally. User pays gas for on-chain token publish (via token-factory).
			// Full integration with buildPublishToken() deferred until gas station supports it.
			const now = new Date().toISOString();
			await db.currencies.add({
				id: crypto.randomUUID(),
				orgId: org.id,
				symbol: symbol.trim().toUpperCase(),
				name: tokenName.trim(),
				coinType: "", // Filled after on-chain publish
				packageId: "", // Filled after on-chain publish
				treasuryCapId: "", // Filled after on-chain publish
				decimals,
				createdAt: now,
				updatedAt: now,
			});

			setSymbol("");
			setTokenName("");
			setDescription("");
			setCreating(false);
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<div className="mx-auto max-w-3xl p-6">
			<Header />

			<div className="mb-6 rounded-lg border border-amber-900/50 bg-amber-950/20 p-4">
				<p className="text-sm text-amber-400">
					Phase 1: Currency creation records are stored locally. On-chain token publishing requires
					user-paid gas via wallet. Gas station sponsorship for token publish coming in Phase 2.
				</p>
			</div>

			{/* Currency List */}
			{(currencies ?? []).length > 0 && (
				<div className="mb-6 space-y-3">
					<h2 className="text-sm font-medium text-zinc-400">
						Currencies ({currencies?.length})
					</h2>
					{currencies?.map((c) => (
						<CurrencyCard key={c.id} currency={c} />
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
							<button
								type="button"
								onClick={handleCreateCurrency}
								disabled={!symbol.trim() || !tokenName.trim() || isSubmitting}
								className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{isSubmitting ? (
									<span className="flex items-center gap-2">
										<Loader2 size={14} className="animate-spin" /> Creating...
									</span>
								) : (
									"Create Currency"
								)}
							</button>
							<button
								type="button"
								onClick={() => setCreating(false)}
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
			<WalletConnect />
		</div>
	);
}

function CurrencyCard({ currency }: { currency: CurrencyRecord }) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<div className="rounded-lg bg-zinc-800 p-2">
						<Package size={16} className="text-cyan-500" />
					</div>
					<div>
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-zinc-200">{currency.symbol}</span>
							<span className="text-xs text-zinc-500">{currency.name}</span>
						</div>
						{currency.packageId ? (
							<p className="font-mono text-xs text-zinc-600">
								{currency.packageId.slice(0, 10)}...{currency.packageId.slice(-6)}
							</p>
						) : (
							<p className="text-xs text-amber-500">Not published yet</p>
						)}
					</div>
				</div>
				<span className="text-xs text-zinc-600">{currency.decimals} decimals</span>
			</div>
		</div>
	);
}
