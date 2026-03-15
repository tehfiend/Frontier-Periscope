"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
	{ href: "/", label: "Dashboard" },
	{ href: "/governance", label: "Governance" },
	{ href: "/trading", label: "Trading" },
	{ href: "/claims", label: "Claims" },
	{ href: "/alliances", label: "Alliances" },
];

export function Sidebar() {
	const pathname = usePathname();

	return (
		<aside className="flex w-56 flex-col border-r border-border bg-card">
			<div className="p-4">
				<h1 className="text-lg font-bold text-primary">TehFrontier</h1>
			</div>
			<nav className="flex-1 space-y-1 px-2">
				{navItems.map((item) => {
					const isActive = pathname === item.href;
					return (
						<Link
							key={item.href}
							href={item.href}
							className={cn(
								"block rounded-md px-3 py-2 text-sm transition-colors",
								isActive
									? "bg-primary/10 text-primary"
									: "text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
						>
							{item.label}
						</Link>
					);
				})}
			</nav>
		</aside>
	);
}
