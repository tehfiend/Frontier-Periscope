import { useState, useRef, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { TENANTS, type TenantId } from "@/chain/config";
import { ChevronDown } from "lucide-react";

const SERVER_COLORS: Record<TenantId, string> = {
	stillness: "bg-green-500",
	utopia: "bg-amber-500",
};

const SERVER_LABELS: Record<TenantId, string> = {
	stillness: "Production",
	utopia: "Sandbox",
};

export function ServerSwitcher() {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const tenantSetting = useLiveQuery(() => db.settings.get("tenant"));
	const activeTenant = (tenantSetting?.value as TenantId) ?? "stillness";

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		if (open) document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	function selectServer(id: TenantId) {
		db.settings.put({ key: "tenant", value: id });
		setOpen(false);
	}

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-800/50"
				title={`${TENANTS[activeTenant].name} (${SERVER_LABELS[activeTenant]})`}
			>
				<span
					className={`h-2 w-2 shrink-0 rounded-full ${SERVER_COLORS[activeTenant]}`}
				/>
				<span className="text-zinc-300">{TENANTS[activeTenant].name}</span>
				<span className="text-xs text-zinc-600">{SERVER_LABELS[activeTenant]}</span>
				<ChevronDown
					size={12}
					className={`shrink-0 text-zinc-600 transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>

			{open && (
				<div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
					{(Object.keys(TENANTS) as TenantId[]).map((id) => (
						<button
							key={id}
							type="button"
							onClick={() => selectServer(id)}
							className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-zinc-800 ${
								activeTenant === id ? "text-cyan-400" : "text-zinc-300"
							}`}
						>
							<span className={`h-2 w-2 rounded-full ${SERVER_COLORS[id]}`} />
							<span className="flex-1 text-left">{TENANTS[id].name}</span>
							<span className="text-xs text-zinc-600">{SERVER_LABELS[id]}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
