import { db } from "@/db";
import type { CurrencyRecord } from "@/db/types";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, Coins } from "lucide-react";
import { useMemo, useState } from "react";

interface CurrencySelectorProps {
	/** Selected coin type string, or undefined/null for SUI (native). */
	value: string | undefined;
	/** Called with the selected coin type, or undefined for SUI. */
	onChange: (coinType: string | undefined) => void;
}

interface CurrencyOption {
	coinType: string | undefined;
	symbol: string;
	name: string;
	label: string;
}

const SUI_OPTION: CurrencyOption = {
	coinType: undefined,
	symbol: "SUI",
	name: "SUI (native)",
	label: "SUI (native)",
};

/**
 * Dropdown listing "SUI (native)" + all non-archived currencies from db.currencies.
 * Returns the selected coin type string (undefined = SUI).
 */
export function CurrencySelector({ value, onChange }: CurrencySelectorProps) {
	const [open, setOpen] = useState(false);

	// Reactive currency list from IndexedDB, excluding archived
	const currencies = useLiveQuery(() => db.currencies.filter((c) => !c._archived).toArray(), []);

	const options: CurrencyOption[] = useMemo(() => {
		const currencyOptions: CurrencyOption[] = (currencies ?? []).map((c: CurrencyRecord) => ({
			coinType: c.coinType,
			symbol: c.symbol,
			name: c.name || c.symbol,
			label: `${c.symbol} -- ${c.name || c.coinType}`,
		}));
		return [SUI_OPTION, ...currencyOptions];
	}, [currencies]);

	const selected =
		options.find((o) => (value ? o.coinType === value : o.coinType === undefined)) ?? SUI_OPTION;

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:border-zinc-600 focus:border-cyan-500 focus:outline-none"
			>
				<span className="flex items-center gap-2">
					<Coins size={12} className="text-zinc-500" />
					<span className="font-medium">{selected.symbol}</span>
					{selected.coinType && <span className="text-xs text-zinc-500">{selected.name}</span>}
				</span>
				<ChevronDown size={14} className="text-zinc-500" />
			</button>

			{open && (
				<div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
					<div className="max-h-48 overflow-auto">
						{options.map((opt) => (
							<button
								key={opt.coinType ?? "__sui__"}
								type="button"
								onClick={() => {
									onChange(opt.coinType);
									setOpen(false);
								}}
								className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-800 ${
									(opt.coinType ?? "") === (value ?? "") ? "text-cyan-400" : "text-zinc-300"
								}`}
							>
								<span className="font-medium">{opt.symbol}</span>
								{opt.coinType ? (
									<span className="truncate text-zinc-500">{opt.name}</span>
								) : (
									<span className="text-zinc-500">(native)</span>
								)}
							</button>
						))}
						{options.length <= 1 && (
							<div className="px-3 py-2 text-xs text-zinc-600">
								No custom currencies found. Create one in Treasury.
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
