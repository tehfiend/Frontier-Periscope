import { fetchCharacterByAddress, searchCachedCharacters } from "@/chain/manifest";
import { db } from "@/db";
import type { ManifestCharacter } from "@/db/types";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useLiveQuery } from "dexie-react-hooks";
import { Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyAddress } from "./CopyAddress";

interface ContactPickerProps {
	onSelect: (character: ManifestCharacter) => void;
	placeholder?: string;
	excludeAddresses?: string[];
	tenant?: string;
}

/**
 * Search-as-you-type character picker backed by the manifestCharacters Dexie table.
 * Shows matching characters with name, tribe, and truncated address.
 */
export function ContactPicker({
	onSelect,
	placeholder = "Search characters...",
	excludeAddresses,
	tenant,
}: ContactPickerProps) {
	const client = useSuiClient();
	const activeTenant = useActiveTenant();
	const effectiveTenant = tenant ?? activeTenant;

	const [query, setQuery] = useState("");
	const [results, setResults] = useState<ManifestCharacter[]>([]);
	const [loading, setLoading] = useState(false);
	const [open, setOpen] = useState(false);
	const [lookingUp, setLookingUp] = useState(false);
	const [highlightIndex, setHighlightIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// Tribe name lookup
	const allTribes = useLiveQuery(() => db.manifestTribes.toArray()) ?? [];
	const tribeMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const t of allTribes) map[t.id] = t.name;
		return map;
	}, [allTribes]);

	const excludeSet = useMemo(() => new Set(excludeAddresses ?? []), [excludeAddresses]);

	const doSearch = useCallback(
		async (q: string) => {
			if (q.length < 2) {
				setResults([]);
				setOpen(false);
				return;
			}
			setLoading(true);
			try {
				let found = await searchCachedCharacters(q, 20);
				// Filter by tenant if specified
				if (effectiveTenant) {
					found = found.filter((c) => c.tenant === effectiveTenant);
				}
				// Filter out excluded addresses
				if (excludeSet.size > 0) {
					found = found.filter((c) => !excludeSet.has(c.suiAddress));
				}
				setResults(found);
				setOpen(true);
				setHighlightIndex(0);
			} finally {
				setLoading(false);
			}
		},
		[effectiveTenant, excludeSet],
	);

	const handleQueryChange = useCallback(
		(value: string) => {
			setQuery(value);
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => doSearch(value), 200);
		},
		[doSearch],
	);

	// Cleanup debounce on unmount
	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	// Close on outside click
	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		if (open) document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	const handleSelect = useCallback(
		(character: ManifestCharacter) => {
			onSelect(character);
			setQuery("");
			setResults([]);
			setOpen(false);
		},
		[onSelect],
	);

	const isAddressQuery = query.trim().startsWith("0x") && query.trim().length >= 10;

	const handleLookup = useCallback(async () => {
		if (!isAddressQuery || lookingUp) return;
		setLookingUp(true);
		try {
			const result = await fetchCharacterByAddress(
				client,
				query.trim(),
				effectiveTenant as "stillness" | "utopia",
			);
			if (result) {
				handleSelect(result);
			}
		} finally {
			setLookingUp(false);
		}
	}, [client, query, effectiveTenant, isAddressQuery, lookingUp, handleSelect]);

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Escape") {
			setOpen(false);
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			if (results.length > 0 && highlightIndex < results.length) {
				handleSelect(results[highlightIndex]);
			} else if (isAddressQuery && results.length === 0) {
				handleLookup();
			}
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setHighlightIndex((i) => Math.min(i + 1, results.length - 1));
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			setHighlightIndex((i) => Math.max(i - 1, 0));
		}
	}

	return (
		<div ref={containerRef} className="relative">
			<div className="relative">
				<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={(e) => handleQueryChange(e.target.value)}
					onFocus={() => {
						if (results.length > 0) setOpen(true);
					}}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-8 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
				{loading && (
					<Loader2
						size={14}
						className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-zinc-500"
					/>
				)}
			</div>

			{open && (
				<div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
					{results.length > 0 ? (
						results.map((char, i) => (
							<button
								key={char.id}
								type="button"
								onClick={() => handleSelect(char)}
								className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-zinc-800 ${
									i === highlightIndex ? "bg-zinc-800" : ""
								}`}
							>
								<div className="min-w-0 flex-1">
									<span className="text-sm font-medium text-zinc-100">
										{char.name || "(unnamed)"}
									</span>
									{char.tribeId > 0 && tribeMap[char.tribeId] && (
										<span className="ml-2 text-xs text-zinc-500">{tribeMap[char.tribeId]}</span>
									)}
								</div>
								<CopyAddress
									address={char.suiAddress}
									sliceStart={6}
									sliceEnd={4}
									className="shrink-0 text-[10px] text-zinc-600"
								/>
							</button>
						))
					) : query.length >= 2 && !loading ? (
						<div className="px-3 py-3 text-center text-xs text-zinc-600">
							{isAddressQuery ? (
								<button
									type="button"
									onClick={handleLookup}
									disabled={lookingUp}
									className="flex w-full items-center justify-center gap-1.5 rounded bg-zinc-800 px-3 py-2 text-xs text-cyan-400 transition-colors hover:bg-zinc-700 disabled:opacity-50"
								>
									{lookingUp ? (
										<Loader2 size={12} className="animate-spin" />
									) : (
										<Search size={12} />
									)}
									Look up on chain
								</button>
							) : (
								"No matching characters"
							)}
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}
