import { formatRelativeMs } from "@/components/buildqueue/shared";
import type { SolarSystem } from "@/db/types";
import type { RecentSystem } from "@/hooks/useCharacterRecentSystems";
import { ChevronDown, History, MapPin, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface SystemPickerProps {
	value: number | null;
	onChange: (id: number | null) => void;
	systems: SolarSystem[];
	/** Recently visited systems for the active character (from useCharacterRecentSystems). */
	recent: RecentSystem[];
	placeholder?: string;
	/** Compact mode reduces padding for inline/order rows. */
	compact?: boolean;
	/** True when `value` is inherited (e.g. an order showing the queue location) rather than set here. */
	inherited?: boolean;
}

/**
 * Location combobox: a click-to-open dropdown listing the character's recently visited systems, with
 * a search field to find any system. Replaces the bare SystemSearch so the queue and order location
 * boxes both offer one-click selection from where you've actually been.
 */
export function SystemPicker({
	value,
	onChange,
	systems,
	recent,
	placeholder = "Select system...",
	compact,
	inherited,
}: SystemPickerProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const ref = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const selectedName =
		value != null ? (systems.find((s) => s.id === value)?.name ?? `#${value}`) : "";

	const results = useMemo(() => {
		if (!query || query.length < 2) return [];
		const q = query.toLowerCase();
		return systems
			.filter((s) => s.name?.toLowerCase().includes(q) || String(s.id).includes(q))
			.slice(0, 20);
	}, [query, systems]);

	useEffect(() => {
		if (!open) return;
		function onDoc(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("mousedown", onDoc);
		return () => document.removeEventListener("mousedown", onDoc);
	}, [open]);

	useEffect(() => {
		if (open) inputRef.current?.focus();
	}, [open]);

	function select(id: number | null) {
		onChange(id);
		setQuery("");
		setOpen(false);
	}

	const py = compact ? "py-1.5" : "py-2";
	const textSize = compact ? "text-xs" : "text-sm";

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className={`flex w-full items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 ${py} ${textSize} focus:border-cyan-500 focus:outline-none`}
			>
				<MapPin size={14} className="shrink-0 text-cyan-500" />
				<span
					className={`min-w-0 flex-1 truncate text-left ${
						value != null ? (inherited ? "italic text-zinc-400" : "text-zinc-100") : "text-zinc-600"
					}`}
				>
					{value != null ? selectedName : placeholder}
				</span>
				{value != null && !inherited && (
					<X
						size={14}
						className="shrink-0 text-zinc-500 hover:text-zinc-200"
						onClick={(e) => {
							e.stopPropagation();
							select(null);
						}}
					/>
				)}
				<ChevronDown size={12} className="shrink-0 text-zinc-600" />
			</button>

			{open && (
				<div className="absolute left-0 top-full z-30 mt-1 w-full min-w-[16rem] rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
					<div className="relative border-b border-zinc-800 p-2">
						<Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
						<input
							ref={inputRef}
							type="text"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search all systems..."
							className="w-full rounded border border-zinc-700 bg-zinc-800 py-1.5 pl-8 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
						/>
					</div>

					<div className="max-h-64 overflow-y-auto py-1">
						{query.length >= 2 ? (
							results.length > 0 ? (
								results.map((s) => (
									<button
										key={s.id}
										type="button"
										onMouseDown={() => select(s.id)}
										className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800"
									>
										<MapPin size={12} className="shrink-0 text-zinc-600" />
										<span className="min-w-0 flex-1 truncate text-zinc-200">
											{s.name ?? `System ${s.id}`}
										</span>
										<span className="shrink-0 font-mono text-[10px] text-zinc-600">{s.id}</span>
									</button>
								))
							) : (
								<p className="px-3 py-2 text-xs text-zinc-600">No systems match.</p>
							)
						) : (
							<>
								<div className="flex items-center gap-1 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
									<History size={10} />
									Recently visited
								</div>
								{recent.length > 0 ? (
									recent.map((r) => (
										<button
											key={r.systemId}
											type="button"
											onMouseDown={() => select(r.systemId)}
											className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${
												r.systemId === value ? "text-cyan-300" : "text-zinc-300"
											}`}
										>
											<MapPin size={12} className="shrink-0 text-cyan-500/70" />
											<span className="min-w-0 flex-1 truncate">{r.name}</span>
											<span className="shrink-0 text-[10px] text-zinc-600">
												{formatRelativeMs(new Date(r.lastVisited).getTime())}
											</span>
										</button>
									))
								) : (
									<p className="px-3 py-2 text-xs text-zinc-600">
										No recent systems yet. Search above, or travel with logs enabled.
									</p>
								)}
							</>
						)}
					</div>

					{value != null && !inherited && (
						<button
							type="button"
							onMouseDown={() => select(null)}
							className="flex w-full items-center gap-2 border-t border-zinc-800 px-3 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-800 hover:text-amber-300"
						>
							<RotateCcw size={11} />
							Clear location
						</button>
					)}
				</div>
			)}
		</div>
	);
}
