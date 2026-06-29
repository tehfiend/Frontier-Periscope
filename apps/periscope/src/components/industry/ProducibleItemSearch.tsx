import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// ── Item search component ───────────────────────────────────────────────────

export interface ItemSearchProps {
	/** Only producible items (blueprint outputs) */
	producibleItems: Array<{ typeId: number; typeName: string }>;
	onSelect: (typeId: number, typeName: string) => void;
	placeholder?: string;
}

export function ProducibleItemSearch({
	producibleItems,
	onSelect,
	placeholder = "Search producible items...",
}: ItemSearchProps) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<Array<{ typeId: number; typeName: string }>>([]);
	const [isOpen, setIsOpen] = useState(false);
	const [highlightIndex, setHighlightIndex] = useState(0);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!query.trim()) {
			setResults([]);
			setIsOpen(false);
			return;
		}
		const q = query.toLowerCase();
		const matched = producibleItems
			.filter((item) => item.typeName.toLowerCase().includes(q))
			.slice(0, 20);
		setResults(matched);
		setHighlightIndex(0);
		setIsOpen(matched.length > 0);
	}, [query, producibleItems]);

	useEffect(() => {
		function handleMouseDown(e: MouseEvent) {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		}
		document.addEventListener("mousedown", handleMouseDown);
		return () => document.removeEventListener("mousedown", handleMouseDown);
	}, []);

	function handleSelect(item: { typeId: number; typeName: string }) {
		onSelect(item.typeId, item.typeName);
		setQuery("");
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
				if (results[highlightIndex]) handleSelect(results[highlightIndex]);
				break;
			case "Escape":
				setIsOpen(false);
				break;
		}
	}

	return (
		<div className="relative" ref={wrapperRef}>
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
							key={item.typeId}
							type="button"
							onClick={() => handleSelect(item)}
							className={`flex w-full items-center px-3 py-2 text-left text-sm ${
								idx === highlightIndex ? "bg-zinc-700" : "hover:bg-zinc-700/50"
							}`}
						>
							<span className="font-medium text-zinc-100">{item.typeName}</span>
							<span className="ml-2 font-mono text-xs text-zinc-600">#{item.typeId}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
