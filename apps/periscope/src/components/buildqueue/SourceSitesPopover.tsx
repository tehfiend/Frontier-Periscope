// "Where does this spawn?" popover for a raw material in the build tree. The source cell names the
// resource's group (e.g. "Ember Ores"); this button opens the list of SITE TYPES (ecosystem biomes)
// the resource is found in -- what to warp to and mine -- rather than enumerating every one of the
// ~23k systems. That is the honest granularity of the static data: a site's ecosystem determines the
// weighted pool of layouts (and thus which ores/salvage CAN spawn); exact per-site contents and yields
// are runtime and not knowable. For proximity, each site type also shows its nearest example system.

import { useLandscapeData } from "@/lib/landscapeData";
import { nearestSourceSites } from "@/lib/proximity";
import { MapPin, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface SiteTypeRank {
	ecosystemId: number;
	name: string;
	/** Nearest system that has this site type with the resource, and its jump distance. */
	nearestSystemId: number;
	nearestJumps: number | undefined;
	/** How many systems host this site type with the resource (a "how common" signal). */
	systemCount: number;
}

function jumpLabel(jumps: number | undefined): string {
	if (jumps == null) return "--";
	return `${jumps}j`;
}

export function SourceSitesPopover({
	typeId,
	resourceName,
	sourceSystemId,
	systemNames,
}: {
	typeId: number;
	resourceName: string;
	sourceSystemId?: number | null;
	systemNames?: Map<number, string>;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	// Landscape data is loaded lazily; subscribing keeps the list correct once it arrives.
	const landscapeData = useLandscapeData();

	// Roll the jump-ranked systems up into distinct site types. `nearestSourceSites` returns systems
	// sorted nearest-first, each carrying only the ecosystems that actually host this resource, so the
	// FIRST time we see an ecosystem is at its nearest system.
	const { siteTypes, mineTarget } = useMemo(() => {
		if (!landscapeData) return { siteTypes: [] as SiteTypeRank[], mineTarget: null as string | null };
		const material = landscapeData.materials.get(typeId);
		const sites = nearestSourceSites(sourceSystemId, [typeId]);
		const byType = new Map<number, SiteTypeRank>();
		for (const site of sites) {
			for (const eco of site.ecosystems) {
				const existing = byType.get(eco.id);
				if (existing) {
					existing.systemCount += 1;
				} else {
					byType.set(eco.id, {
						ecosystemId: eco.id,
						name: eco.name,
						nearestSystemId: site.systemId,
						nearestJumps: site.jumps,
						systemCount: 1,
					});
				}
			}
		}
		const siteTypes = [...byType.values()].sort((a, b) => {
			if (a.nearestJumps == null && b.nearestJumps == null) return a.name.localeCompare(b.name);
			if (a.nearestJumps == null) return 1;
			if (b.nearestJumps == null) return -1;
			return a.nearestJumps - b.nearestJumps || a.name.localeCompare(b.name);
		});
		return { siteTypes, mineTarget: material?.label ?? null };
	}, [landscapeData, sourceSystemId, typeId]);

	useEffect(() => {
		if (!open) return;
		function onDoc(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("mousedown", onDoc);
		return () => document.removeEventListener("mousedown", onDoc);
	}, [open]);

	// Nothing landscape-sourced for this type (e.g. a reprocessing-only output): no button.
	if (siteTypes.length === 0) return null;

	const systemName = (id: number) => systemNames?.get(id) ?? `#${id}`;

	return (
		<div ref={ref} className="relative inline-block">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="inline-flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:border-cyan-500/50 hover:text-cyan-300"
				title={`Show the site types where ${resourceName} spawns`}
			>
				<MapPin size={10} className="text-cyan-500/70" />
				{siteTypes.length} site type{siteTypes.length === 1 ? "" : "s"}
			</button>

			{open && (
				<div className="absolute left-0 top-full z-40 mt-1 max-h-80 w-80 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
					<div className="sticky top-0 border-b border-zinc-800 bg-zinc-900 px-3 py-2">
						<div className="flex items-center justify-between gap-2">
							<span className="min-w-0 truncate text-xs font-medium text-zinc-200">
								{resourceName}
								<span className="ml-1 font-normal text-zinc-500">
									· {siteTypes.length} site type{siteTypes.length === 1 ? "" : "s"}
								</span>
							</span>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="shrink-0 text-zinc-500 hover:text-zinc-200"
								aria-label="Close"
							>
								<X size={12} />
							</button>
						</div>
						{mineTarget && (
							<span className="mt-0.5 block text-[10px] text-cyan-300/80">{mineTarget}</span>
						)}
					</div>
					{sourceSystemId == null && (
						<p className="px-3 py-1.5 text-[10px] text-zinc-600">
							Set the queue/order location to sort these by distance.
						</p>
					)}
					<ul className="divide-y divide-zinc-800/60">
						{siteTypes.map((site) => (
							<li key={site.ecosystemId} className="flex items-start gap-2 px-3 py-1.5 text-xs">
								<span className="w-10 shrink-0 pt-0.5 text-right font-mono text-[10px] text-cyan-400/80">
									{jumpLabel(site.nearestJumps)}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block text-zinc-200">{site.name}</span>
									<span className="block text-[10px] text-zinc-500">
										nearest: {systemName(site.nearestSystemId)}
										{site.systemCount > 1 ? ` · in ${site.systemCount.toLocaleString()} systems` : ""}
									</span>
								</span>
							</li>
						))}
					</ul>
					<p className="border-t border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-600">
						Every site of a type rolls its contents from the same pool -- exact ores and yields vary
						per site and are not in static data.
					</p>
				</div>
			)}
		</div>
	);
}
