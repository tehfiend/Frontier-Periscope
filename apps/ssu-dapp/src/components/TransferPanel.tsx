import type { InventoryData } from "@/hooks/useInventory";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { useWalletItems } from "@/hooks/useWalletItems";
import { getTenant, getWorldPackageId } from "@/lib/constants";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { useState } from "react";

interface TransferPanelProps {
	ssuObjectId: string;
	characterObjectId: string;
	ownerCap: OwnerCapInfo;
	ownerInventory: InventoryData;
}

type Tab = "withdraw" | "deposit";

/**
 * Owner-only transfer panel with Withdraw and Deposit tabs.
 *
 * Withdraw: Pull partial stacks from the SSU owner inventory into the wallet.
 * Deposit: Push wallet-held Item objects (full or partial) into the SSU owner inventory.
 */
export function TransferPanel({
	ssuObjectId,
	characterObjectId,
	ownerCap,
	ownerInventory,
}: TransferPanelProps) {
	const [activeTab, setActiveTab] = useState<Tab>("withdraw");

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h3 className="mb-3 text-sm font-medium text-zinc-300">Transfer Items</h3>

			{/* Tab bar */}
			<div className="mb-4 flex gap-1 rounded-lg bg-zinc-800/50 p-1">
				<TabButton active={activeTab === "withdraw"} onClick={() => setActiveTab("withdraw")}>
					Withdraw
				</TabButton>
				<TabButton active={activeTab === "deposit"} onClick={() => setActiveTab("deposit")}>
					Deposit
				</TabButton>
			</div>

			{activeTab === "withdraw" ? (
				<WithdrawTab
					ssuObjectId={ssuObjectId}
					characterObjectId={characterObjectId}
					ownerCap={ownerCap}
					ownerInventory={ownerInventory}
				/>
			) : (
				<DepositTab
					ssuObjectId={ssuObjectId}
					characterObjectId={characterObjectId}
					ownerCap={ownerCap}
					ownerInventory={ownerInventory}
				/>
			)}
		</div>
	);
}

// ── Tab Button ──────────────────────────────────────────────────────────────

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
				active ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
			}`}
		>
			{children}
		</button>
	);
}

// ── Withdraw Tab ────────────────────────────────────────────────────────────

function WithdrawTab({
	ssuObjectId,
	characterObjectId,
	ownerCap,
	ownerInventory,
}: TransferPanelProps) {
	const account = useCurrentAccount();
	const walletAddress = account?.address;
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [selectedTypeId, setSelectedTypeId] = useState<string>("");
	const [quantity, setQuantity] = useState<string>("1");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const selectedItem = ownerInventory.items.find((i) => String(i.typeId) === selectedTypeId);
	const maxQty = selectedItem?.quantity ?? 0;

	async function handleWithdraw() {
		if (!selectedTypeId || !quantity || !walletAddress) return;

		setError(null);
		setSuccess(null);

		const qty = Number(quantity);
		if (qty <= 0 || qty > maxQty) {
			setError(`Quantity must be between 1 and ${maxQty}`);
			return;
		}

		try {
			const tenant = getTenant();
			const worldPkg = getWorldPackageId(tenant);
			const tx = new Transaction();

			// 1. Borrow OwnerCap from Character
			const [borrowedCap, receipt] = tx.moveCall({
				target: `${worldPkg}::character::borrow_owner_cap`,
				typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
				arguments: [
					tx.object(characterObjectId),
					tx.receivingRef({
						objectId: ownerCap.objectId,
						version: String(ownerCap.version),
						digest: ownerCap.digest,
					}),
				],
			});

			// 2. Withdraw by owner -- produces an Item object with the requested quantity
			const withdrawnItem = tx.moveCall({
				target: `${worldPkg}::storage_unit::withdraw_by_owner`,
				typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
				arguments: [
					tx.object(ssuObjectId),
					tx.object(characterObjectId),
					borrowedCap,
					tx.pure.u64(BigInt(selectedTypeId)),
					tx.pure.u32(qty),
				],
			});

			// 3. Return OwnerCap
			tx.moveCall({
				target: `${worldPkg}::character::return_owner_cap`,
				typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
				arguments: [tx.object(characterObjectId), borrowedCap, receipt],
			});

			// 4. Transfer withdrawn item to wallet address (NOT characterObjectId)
			tx.transferObjects([withdrawnItem], tx.pure.address(walletAddress));

			await signAndExecute(tx);
			setSuccess(`Withdrew ${qty}x ${selectedItem?.name ?? selectedTypeId}`);
			setQuantity("1");
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	if (ownerInventory.items.length === 0) {
		return <p className="text-xs text-zinc-600">No items in owner inventory to withdraw.</p>;
	}

	return (
		<div className="space-y-3">
			<p className="text-xs text-zinc-500">
				Withdraw items from the SSU owner inventory to your wallet.
			</p>

			{/* Item selector */}
			<div>
				<label className="mb-1 block text-xs text-zinc-500">Item</label>
				<select
					value={selectedTypeId}
					onChange={(e) => {
						setSelectedTypeId(e.target.value);
						setQuantity("1");
						setError(null);
						setSuccess(null);
					}}
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
				>
					<option value="">Select item...</option>
					{ownerInventory.items.map((item) => (
						<option key={item.typeId} value={String(item.typeId)}>
							{item.name} (x{item.quantity})
						</option>
					))}
				</select>
			</div>

			{/* Quantity input */}
			{selectedItem && (
				<div>
					<label className="mb-1 block text-xs text-zinc-500">
						Quantity (max: {maxQty.toLocaleString()})
					</label>
					<div className="flex gap-2">
						<input
							type="number"
							min={1}
							max={maxQty}
							value={quantity}
							onChange={(e) => setQuantity(e.target.value)}
							className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
						/>
						<button
							type="button"
							onClick={() => setQuantity(String(maxQty))}
							className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200"
						>
							Max
						</button>
					</div>
				</div>
			)}

			{/* Withdraw button */}
			<button
				type="button"
				onClick={handleWithdraw}
				disabled={!selectedTypeId || isPending}
				className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
			>
				{isPending ? "Withdrawing..." : "Withdraw to Wallet"}
			</button>

			{error && <p className="text-xs text-red-400">{error}</p>}
			{success && <p className="text-xs text-emerald-400">{success}</p>}
		</div>
	);
}

// ── Deposit Tab ─────────────────────────────────────────────────────────────

function DepositTab({
	ssuObjectId,
	characterObjectId,
	ownerCap,
	ownerInventory,
}: TransferPanelProps) {
	const account = useCurrentAccount();
	const walletAddress = account?.address;
	const { data: walletItems, isLoading: walletItemsLoading } = useWalletItems(walletAddress);
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [selectedObjectId, setSelectedObjectId] = useState<string>("");
	const [quantity, setQuantity] = useState<string>("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const selectedItem = walletItems.find((i) => i.objectId === selectedObjectId);
	const maxQty = selectedItem?.quantity ?? 0;
	const isPartial = quantity !== "" && Number(quantity) < maxQty;

	// Capacity validation
	const depositVolume = selectedItem ? selectedItem.volume * (Number(quantity) || maxQty) : 0;
	const remainingCapacity = ownerInventory.maxCapacity - ownerInventory.usedCapacity;
	const hasCapacity = depositVolume <= remainingCapacity;

	async function handleDeposit() {
		if (!selectedObjectId || !walletAddress || !selectedItem) return;

		setError(null);
		setSuccess(null);

		const qty = Number(quantity) || maxQty;
		if (qty <= 0 || qty > maxQty) {
			setError(`Quantity must be between 1 and ${maxQty}`);
			return;
		}

		// Capacity validation
		const depositVol = selectedItem.volume * qty;
		const remaining = ownerInventory.maxCapacity - ownerInventory.usedCapacity;
		if (depositVol > remaining) {
			const remainingM3 = (remaining / 1000).toLocaleString();
			const depositM3 = (depositVol / 1000).toLocaleString();
			setError(
				`Insufficient capacity: ${depositM3} m\u00B3 needed, ${remainingM3} m\u00B3 available`,
			);
			return;
		}

		try {
			const tenant = getTenant();
			const worldPkg = getWorldPackageId(tenant);
			const tx = new Transaction();

			// 1. Borrow OwnerCap from Character
			const [borrowedCap, receipt] = tx.moveCall({
				target: `${worldPkg}::character::borrow_owner_cap`,
				typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
				arguments: [
					tx.object(characterObjectId),
					tx.receivingRef({
						objectId: ownerCap.objectId,
						version: String(ownerCap.version),
						digest: ownerCap.digest,
					}),
				],
			});

			if (qty === maxQty) {
				// Full deposit -- deposit the entire Item object
				tx.moveCall({
					target: `${worldPkg}::storage_unit::deposit_by_owner`,
					typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
					arguments: [
						tx.object(ssuObjectId),
						tx.object(characterObjectId),
						borrowedCap,
						tx.object(selectedObjectId),
					],
				});
			} else {
				// Partial deposit -- deposit full item, then withdraw the remainder
				// This is because there is no public split function on Item objects.
				// Pattern: deposit_by_owner(full_item) -> withdraw_by_owner(type_id, remainder)
				tx.moveCall({
					target: `${worldPkg}::storage_unit::deposit_by_owner`,
					typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
					arguments: [
						tx.object(ssuObjectId),
						tx.object(characterObjectId),
						borrowedCap,
						tx.object(selectedObjectId),
					],
				});

				// Withdraw the remainder back to the wallet
				const remainderQty = maxQty - qty;
				const remainderItem = tx.moveCall({
					target: `${worldPkg}::storage_unit::withdraw_by_owner`,
					typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
					arguments: [
						tx.object(ssuObjectId),
						tx.object(characterObjectId),
						borrowedCap,
						tx.pure.u64(BigInt(selectedItem.typeId)),
						tx.pure.u32(remainderQty),
					],
				});

				// Transfer remainder back to wallet
				tx.transferObjects([remainderItem], tx.pure.address(walletAddress));
			}

			// Return OwnerCap
			tx.moveCall({
				target: `${worldPkg}::character::return_owner_cap`,
				typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
				arguments: [tx.object(characterObjectId), borrowedCap, receipt],
			});

			await signAndExecute(tx);
			setSuccess(
				`Deposited ${qty}x ${selectedItem.name}${isPartial ? ` (${maxQty - qty} returned to wallet)` : ""}`,
			);
			setSelectedObjectId("");
			setQuantity("");
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	if (walletItemsLoading) {
		return (
			<div className="flex items-center gap-2 py-4">
				<div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
				<p className="text-xs text-zinc-500">Loading wallet items...</p>
			</div>
		);
	}

	if (walletItems.length === 0) {
		return (
			<p className="text-xs text-zinc-600">
				No Item objects in your wallet. Withdraw items from an SSU first.
			</p>
		);
	}

	return (
		<div className="space-y-3">
			<p className="text-xs text-zinc-500">
				Deposit wallet-held items into the SSU owner inventory.
			</p>

			{/* Wallet item selector */}
			<div>
				<label className="mb-1 block text-xs text-zinc-500">Wallet Item</label>
				<select
					value={selectedObjectId}
					onChange={(e) => {
						setSelectedObjectId(e.target.value);
						const item = walletItems.find((i) => i.objectId === e.target.value);
						setQuantity(item ? String(item.quantity) : "");
						setError(null);
						setSuccess(null);
					}}
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
				>
					<option value="">Select item...</option>
					{walletItems.map((item) => (
						<option key={item.objectId} value={item.objectId}>
							{item.name} (x{item.quantity}) -- {item.objectId.slice(0, 8)}...
						</option>
					))}
				</select>
			</div>

			{/* Quantity input */}
			{selectedItem && (
				<div>
					<label className="mb-1 block text-xs text-zinc-500">
						Quantity (max: {maxQty.toLocaleString()})
					</label>
					<div className="flex gap-2">
						<input
							type="number"
							min={1}
							max={maxQty}
							value={quantity}
							onChange={(e) => setQuantity(e.target.value)}
							className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
						/>
						<button
							type="button"
							onClick={() => setQuantity(String(maxQty))}
							className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200"
						>
							All
						</button>
					</div>
					{isPartial && (
						<p className="mt-1 text-xs text-zinc-600">
							Partial deposit: {maxQty - Number(quantity)} will be returned to wallet.
						</p>
					)}
				</div>
			)}

			{/* Capacity warning */}
			{selectedItem && !hasCapacity && (
				<p className="text-xs text-red-400">
					Insufficient capacity: needs {(depositVolume / 1000).toLocaleString()} m{"\u00B3"}, have{" "}
					{(remainingCapacity / 1000).toLocaleString()} m{"\u00B3"} available
				</p>
			)}

			{/* Deposit button */}
			<button
				type="button"
				onClick={handleDeposit}
				disabled={!selectedObjectId || isPending || !hasCapacity}
				className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
			>
				{isPending ? "Depositing..." : isPartial ? "Deposit (Partial)" : "Deposit to SSU"}
			</button>

			{error && <p className="text-xs text-red-400">{error}</p>}
			{success && <p className="text-xs text-emerald-400">{success}</p>}
		</div>
	);
}
