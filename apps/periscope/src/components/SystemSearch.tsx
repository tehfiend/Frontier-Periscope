import { useState, useMemo } from "react";
import { MapPin, Search, X } from "lucide-react";
import type { SolarSystem } from "@/db/types";

interface SystemSearchProps {
	value: number | null;
	onChange: (id: number | null) => void;
	systems: SolarSystem[];
	placeholder?: string;
	label?: string;
	/** Compact mode reduces padding for use inside popovers */
	compact?: boolean;
}

export function SystemSearch({
	value,
	onChange,
	systems,
	placeholder = "Search system...",
	label,
	compact,
}: SystemSearchProps) {
	const [query, setQuery] = useState("");
	const [focused, setFocused] = useState(false);

	const selectedName = value ? (systems.find((s) => s.id === value)?.name ?? `#${value}`) : "";

	const results = useMemo(() => {
		if (!query || query.length < 2) return [];
		const q = query.toLowerCase();
		return systems
			.filter((s) => s.name?.toLowerCase().includes(q) || String(s.id).includes(q))
			.slice(0, 12);
	}, [query, systems]);

	function handleSelect(system: SolarSystem) {
		onChange(system.id);
		setQuery("");
		setFocused(false);
	}

	function handleClear() {
		onChange(null);
		setQuery("");
	}

	const py = compact ? "py-1.5" : "py-2";
	const textSize = compact ? "text-xs" : "text-sm";

	return (
		<div className="relative">
			{label && (
				<label className="mb-1 block text-xs font-medium text-zinc-500">{label}</label>
			)}
			{value ? (
				<div
					className={`flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 ${py}`}
				>
					<MapPin size={14} className="shrink-0 text-cyan-500" />
					<span className={`flex-1 ${textSize} text-zinc-100`}>{selectedName}</span>
					<button
						type="button"
						onClick={handleClear}
						className="text-zinc-500 hover:text-zinc-300"
					>
						<X size={14} />
					</button>
				</div>
			) : (
				<div className="relative">
					<Search
						size={14}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
					/>
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onFocus={() => setFocused(true)}
						onBlur={() => setTimeout(() => setFocused(false), 200)}
						placeholder={placeholder}
						className={`w-full rounded-lg border border-zinc-700 bg-zinc-800 ${py} pl-9 pr-3 ${textSize} text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none`}
					/>
				</div>
			)}

			{focused && results.length > 0 && (
				<div className="absolute z-30 mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
					{results.map((system) => (
						<button
							key={system.id}
							type="button"
							onMouseDown={() => handleSelect(system)}
							className={`flex w-full items-center gap-2 px-3 ${py} text-left ${textSize} hover:bg-zinc-800`}
						>
							<MapPin size={12} className="shrink-0 text-zinc-600" />
							<span className="text-zinc-200">
								{system.name ?? `System ${system.id}`}
							</span>
							<span className="ml-auto font-mono text-xs text-zinc-600">
								{system.id}
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
