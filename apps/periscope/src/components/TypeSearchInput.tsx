import { db } from "@/db";
import type { GameType } from "@/db/types";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface TypeSearchInputProps {
	value: number | null;
	onChange: (typeId: number | null) => void;
	placeholder?: string;
	className?: string;
}

export function TypeSearchInput({
	value,
	onChange,
	placeholder = "Search items...",
	className = "",
}: TypeSearchInputProps) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<GameType[]>([]);
	const [isOpen, setIsOpen] = useState(false);
	const [highlightIndex, setHighlightIndex] = useState(0);
	const [selectedName, setSelectedName] = useState<string | null>(null);

	const wrapperRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Resolve name for existing value
	useEffect(() => {
		if (value !== null) {
			db.gameTypes.get(value).then((gt) => {
				setSelectedName(gt?.name ?? `Type #${value}`);
			});
		} else {
			setSelectedName(null);
		}
	}, [value]);

	// Debounced search
	useEffect(() => {
		if (!query.trim()) {
			setResults([]);
			setIsOpen(false);
			return;
		}

		const timer = setTimeout(async () => {
			const q = query.trim().toLowerCase();

			// Indexed prefix search first
			let items = await db.gameTypes.where("name").startsWithIgnoreCase(q).limit(20).toArray();

			// Supplement with substring/group search if needed
			if (items.length < 5) {
				const existingIds = new Set(items.map((i) => i.id));
				const extra = await db.gameTypes
					.filter(
						(t) =>
							!existingIds.has(t.id) &&
							(t.name.toLowerCase().includes(q) || t.groupName.toLowerCase().includes(q)),
					)
					.limit(20)
					.toArray();
				items = [...items, ...extra];
			}

			// Cap total at 20
			setResults(items.slice(0, 20));
			setHighlightIndex(0);
			setIsOpen(items.length > 0);
		}, 300);

		return () => clearTimeout(timer);
	}, [query]);

	// Click outside to close
	useEffect(() => {
		function handleMouseDown(e: MouseEvent) {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		}
		document.addEventListener("mousedown", handleMouseDown);
		return () => document.removeEventListener("mousedown", handleMouseDown);
	}, []);

	const handleSelect = useCallback(
		(item: GameType) => {
			onChange(item.id);
			setSelectedName(item.name);
			setQuery("");
			setIsOpen(false);
		},
		[onChange],
	);

	function handleClear() {
		onChange(null);
		setSelectedName(null);
		setQuery("");
		setResults([]);
		setIsOpen(false);
		inputRef.current?.focus();
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (!isOpen) return;

		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				setHighlightIndex((prev) => Math.min(prev + 1, results.length - 1));
				break;
			case "ArrowUp":
				e.preventDefault();
				setHighlightIndex((prev) => Math.max(prev - 1, 0));
				break;
			case "Enter":
				e.preventDefault();
				if (results[highlightIndex]) {
					handleSelect(results[highlightIndex]);
				}
				break;
			case "Escape":
				setIsOpen(false);
				break;
		}
	}

	// Selected chip view
	if (value !== null && selectedName) {
		return (
			<div className={`relative ${className}`} ref={wrapperRef}>
				<div className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100">
					<span className="flex-1 truncate">
						{selectedName} <span className="text-xs text-zinc-500">#{value}</span>
					</span>
					<button
						type="button"
						onClick={handleClear}
						className="shrink-0 text-zinc-500 hover:text-zinc-300"
					>
						<X size={14} />
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className={`relative ${className}`} ref={wrapperRef}>
			<div className="relative">
				<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onFocus={() => {
						if (results.length > 0) setIsOpen(true);
					}}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					className="w-full rounded border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>

			{isOpen && (
				<div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 shadow-lg">
					{results.map((item, idx) => (
						<button
							key={item.id}
							type="button"
							onClick={() => handleSelect(item)}
							className={`flex w-full flex-col px-3 py-2 text-left ${
								idx === highlightIndex ? "bg-zinc-700" : "hover:bg-zinc-700/50"
							}`}
						>
							<span className="text-sm font-medium text-zinc-100">{item.name}</span>
							<span className="flex items-center gap-2">
								<span className="text-xs text-zinc-500">
									{item.groupName} &gt; {item.categoryName}
								</span>
								<span className="font-mono text-xs text-zinc-600">#{item.id}</span>
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
