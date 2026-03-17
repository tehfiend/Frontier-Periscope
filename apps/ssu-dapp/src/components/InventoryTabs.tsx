import { useState } from "react";
import type { SsuInventories } from "@/hooks/useInventory";
import { InventoryTable } from "./InventoryTable";

interface InventoryTabsProps {
	inventories: SsuInventories;
	isLoading?: boolean;
}

type TabId = "owner" | "extension" | "open";

const TABS: Array<{ id: TabId; label: string }> = [
	{ id: "owner", label: "Owner Inventory" },
	{ id: "extension", label: "Extension Inventory" },
	{ id: "open", label: "Open Inventory" },
];

export function InventoryTabs({ inventories, isLoading }: InventoryTabsProps) {
	const [activeTab, setActiveTab] = useState<TabId>("owner");

	const inventoryForTab = {
		owner: inventories.ownerInventory,
		extension: inventories.extensionInventory,
		open: inventories.openInventory,
	};

	const currentInventory = inventoryForTab[activeTab];
	const itemCounts = {
		owner: inventories.ownerInventory.items.length,
		extension: inventories.extensionInventory.items.length,
		open: inventories.openInventory.items.length,
	};

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			{/* Tab bar */}
			<div className="mb-4 flex gap-1 rounded-lg bg-zinc-800/50 p-1">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id)}
						className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
							activeTab === tab.id
								? "bg-zinc-700 text-zinc-100"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						{tab.label}
						{itemCounts[tab.id] > 0 && (
							<span className="ml-1.5 rounded-full bg-zinc-600/50 px-1.5 py-0.5 text-xs">
								{itemCounts[tab.id]}
							</span>
						)}
					</button>
				))}
			</div>

			{/* Content */}
			<InventoryTable inventory={currentInventory} isLoading={isLoading} />
		</div>
	);
}
