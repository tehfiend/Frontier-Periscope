import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function StatCard({
	label,
	value,
	sub,
	color,
	icon: Icon,
	active,
}: {
	label: string;
	value: string;
	sub: ReactNode;
	color: string;
	icon: LucideIcon;
	active?: boolean;
}) {
	return (
		<div
			className={`rounded-lg border bg-zinc-900/50 p-3 ${active ? "border-zinc-700" : "border-zinc-800"}`}
		>
			<div className="flex items-center gap-2">
				<Icon size={14} className={active ? color : "text-zinc-600"} />
				<p className="text-xs text-zinc-500">{label}</p>
			</div>
			<p
				className={`mt-1 text-2xl font-bold ${active ? color : "text-zinc-600"}`}
			>
				{value}
			</p>
			<div className="mt-0.5 text-xs text-zinc-600">{sub}</div>
		</div>
	);
}
