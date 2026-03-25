import { db } from "@/db";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, ExternalLink, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

interface RegistrySelectorProps {
	value: string | null;
	onChange: (registryId: string) => void;
	/** Filter to specific tenant */
	tenant?: string;
}

/**
 * Dropdown selector for subscribed StandingsRegistries.
 * Shows registry name, ticker, and default standing.
 * Includes a "Create Registry" option that links to the Standings view.
 */
export function RegistrySelector({ value, onChange, tenant }: RegistrySelectorProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const registries = useLiveQuery(() => db.subscribedRegistries.toArray(), []);

	const filtered = useMemo(() => {
		let items = registries ?? [];
		if (tenant) {
			items = items.filter((r) => r.tenant === tenant);
		}
		if (search) {
			const q = search.toLowerCase();
			items = items.filter(
				(r) => r.name.toLowerCase().includes(q) || r.ticker.toLowerCase().includes(q),
			);
		}
		return items;
	}, [registries, tenant, search]);

	const selected = useMemo(
		() => (registries ?? []).find((r) => r.id === value) ?? null,
		[registries, value],
	);

	const standingLabel = (raw: number) => {
		const labels = ["Opposition", "Hostile", "Unfriendly", "Neutral", "Friendly", "Ally", "Trust"];
		return labels[raw] ?? `${raw}`;
	};

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:border-zinc-600 focus:border-cyan-500 focus:outline-none"
			>
				{selected ? (
					<span>
						<span className="font-medium">{selected.name}</span>
						<span className="ml-2 text-xs text-zinc-500">[{selected.ticker}]</span>
					</span>
				) : (
					<span className="text-zinc-500">Select a registry...</span>
				)}
				<ChevronDown size={14} className="text-zinc-500" />
			</button>

			{open && (
				<div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
					{/* Search */}
					<div className="border-b border-zinc-800 p-2">
						<div className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-2 py-1">
							<Search size={12} className="text-zinc-500" />
							<input
								type="text"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Escape") setOpen(false);
								}}
								placeholder="Search registries..."
								className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
							/>
						</div>
					</div>

					{/* Options */}
					<div className="max-h-48 overflow-auto">
						{filtered.map((reg) => (
							<button
								key={reg.id}
								type="button"
								onClick={() => {
									onChange(reg.id);
									setOpen(false);
									setSearch("");
								}}
								className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-zinc-800 ${
									reg.id === value ? "text-cyan-400" : "text-zinc-300"
								}`}
							>
								<div>
									<span className="font-medium">{reg.name}</span>
									<span className="ml-2 text-zinc-600">[{reg.ticker}]</span>
								</div>
								<span className="text-zinc-600">Default: {standingLabel(reg.defaultStanding)}</span>
							</button>
						))}
						{filtered.length === 0 && (
							<div className="px-3 py-3 text-xs text-zinc-600">
								{(registries ?? []).length === 0
									? "No registries subscribed. Create one in the Standings view."
									: "No matches"}
							</div>
						)}
					</div>

					{/* Footer actions */}
					<div className="border-t border-zinc-800 p-2">
						<a
							href="#/standings"
							className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-cyan-400 hover:bg-cyan-900/20"
						>
							<Plus size={12} />
							Create Registry
							<ExternalLink size={10} className="ml-auto text-zinc-600" />
						</a>
					</div>
				</div>
			)}
		</div>
	);
}
