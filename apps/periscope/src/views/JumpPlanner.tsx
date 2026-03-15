import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import {
	findRouteWithGrid,
	getOrBuildGrid,
	buildAdjacency,
	buildPositions,
	type RouteMode,
	type RouteResult,
	METERS_PER_LY,
} from "@/lib/pathfinder";
import {
	Route,
	Search,
	X,
	ArrowDown,
	Plus,
	Trash2,
	Copy,
	MapPin,
	Zap,
	AlertTriangle,
	ChevronRight,
	RotateCcw,
	Fuel,
	Gauge,
	Navigation,
	Milestone,
	Check,
} from "lucide-react";
import type { SolarSystem } from "@/db/types";

// ── Types ───────────────────────────────────────────────────────────────────

interface RouteSegment {
	result: RouteResult;
	fromName: string;
	toName: string;
}

interface FullRoute {
	segments: RouteSegment[];
	totalJumps: number;
	totalDistanceLY: number;
	totalGateJumps: number;
	/** All system IDs in order */
	systems: number[];
	/** Region IDs visited (consecutive deduped) */
	regions: number[];
}

// ── Route Mode Config ───────────────────────────────────────────────────────

const ROUTE_MODES: { id: RouteMode; label: string; description: string; icon: typeof Navigation }[] = [
	{ id: "fewest_jumps", label: "Fewest Jumps", description: "Minimize hop count", icon: Milestone },
	{ id: "shortest", label: "Shortest Distance", description: "Minimize total distance", icon: Navigation },
	{ id: "prefer_gates", label: "Prefer Gates", description: "Use free gate connections", icon: Zap },
];

// ── System Search Component ─────────────────────────────────────────────────

function SystemSearch({
	value,
	onChange,
	systems,
	placeholder,
	label,
}: {
	value: number | null;
	onChange: (id: number | null) => void;
	systems: SolarSystem[];
	placeholder: string;
	label: string;
}) {
	const [query, setQuery] = useState("");
	const [focused, setFocused] = useState(false);

	const selectedName = value ? systems.find((s) => s.id === value)?.name ?? `#${value}` : "";

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

	return (
		<div className="relative">
			{label && <label className="mb-1 block text-xs font-medium text-zinc-500">{label}</label>}
			{value ? (
				<div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
					<MapPin size={14} className="shrink-0 text-cyan-500" />
					<span className="flex-1 text-sm text-zinc-100">{selectedName}</span>
					<button type="button" onClick={handleClear} className="text-zinc-500 hover:text-zinc-300">
						<X size={14} />
					</button>
				</div>
			) : (
				<div className="relative">
					<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onFocus={() => setFocused(true)}
						onBlur={() => setTimeout(() => setFocused(false), 200)}
						placeholder={placeholder}
						className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
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
							className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-800"
						>
							<MapPin size={12} className="shrink-0 text-zinc-600" />
							<span className="text-zinc-200">{system.name ?? `System ${system.id}`}</span>
							<span className="ml-auto font-mono text-xs text-zinc-600">{system.id}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// ── Main Component ──────────────────────────────────────────────────────────

export function JumpPlanner() {
	const systems = useLiveQuery(() => db.solarSystems.toArray()) ?? [];
	const jumps = useLiveQuery(() => db.jumps.toArray()) ?? [];
	const regions = useLiveQuery(() => db.regions.toArray()) ?? [];
	const constellations = useLiveQuery(() => db.constellations.toArray()) ?? [];

	const [origin, setOrigin] = useState<number | null>(null);
	const [destination, setDestination] = useState<number | null>(null);
	const [waypoints, setWaypoints] = useState<number[]>([]);
	const [avoidSystems, setAvoidSystems] = useState<number[]>([]);
	const [avoidInput, setAvoidInput] = useState<number | null>(null);

	// Ship parameters
	const [jumpRangeLY, setJumpRangeLY] = useState(10);
	const [routeMode, setRouteMode] = useState<RouteMode>("fewest_jumps");
	const [useGates, setUseGates] = useState(true);
	const [fuelPerLY, setFuelPerLY] = useState<number | null>(null);
	const [copied, setCopied] = useState(false);
	const [restored, setRestored] = useState(false);

	// Restore saved settings on mount
	useEffect(() => {
		db.settings.get("jumpPlanner").then((entry) => {
			if (entry?.value) {
				const s = entry.value as Record<string, unknown>;
				if (s.origin != null) setOrigin(s.origin as number);
				if (s.destination != null) setDestination(s.destination as number);
				if (Array.isArray(s.waypoints)) setWaypoints(s.waypoints as number[]);
				if (Array.isArray(s.avoidSystems)) setAvoidSystems(s.avoidSystems as number[]);
				if (typeof s.jumpRangeLY === "number") setJumpRangeLY(s.jumpRangeLY);
				if (s.routeMode) setRouteMode(s.routeMode as RouteMode);
				if (typeof s.useGates === "boolean") setUseGates(s.useGates);
				if (s.fuelPerLY != null) setFuelPerLY(s.fuelPerLY as number);
			}
			setRestored(true);
		});
	}, []);

	// Save settings on change (debounced to avoid thrashing)
	const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => {
		if (!restored) return;
		clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => {
			db.settings.put({
				key: "jumpPlanner",
				value: { origin, destination, waypoints, avoidSystems, jumpRangeLY, routeMode, useGates, fuelPerLY },
			});
		}, 300);
		return () => clearTimeout(saveTimer.current);
	}, [origin, destination, waypoints, avoidSystems, jumpRangeLY, routeMode, useGates, fuelPerLY, restored]);

	// Lookup maps
	const systemMap = useMemo(() => {
		const map: Record<number, SolarSystem> = {};
		for (const s of systems) map[s.id] = s;
		return map;
	}, [systems]);

	const regionMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const r of regions) if (r.name) map[r.id] = r.name;
		return map;
	}, [regions]);

	const constellationMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const c of constellations) if (c.name) map[c.id] = c.name;
		return map;
	}, [constellations]);

	// Build system positions and spatial index for pathfinder
	const positions = useMemo(() => buildPositions(systems), [systems]);

	const grid = useMemo(() => {
		if (positions.length === 0) return null;
		const avoidSet = avoidSystems.length > 0 ? new Set(avoidSystems) : undefined;
		if (avoidSet) return getOrBuildGrid(positions, avoidSet);
		return getOrBuildGrid(positions);
	}, [positions, avoidSystems]);

	// Build gate adjacency from static jump data
	const gateEdges = useMemo(() => {
		if (!useGates || jumps.length === 0) return undefined;
		return buildAdjacency(jumps);
	}, [jumps, useGates]);

	// Compute route through waypoints
	const route: FullRoute | null = useMemo(() => {
		if (!origin || !destination || !grid) return null;

		const stops = [origin, ...waypoints.filter((w) => w > 0), destination];
		const segments: RouteSegment[] = [];
		const allSystems: number[] = [];

		for (let i = 0; i < stops.length - 1; i++) {
			const result = findRouteWithGrid(grid, stops[i], stops[i + 1], {
				mode: routeMode,
				jumpRangeLY,
			}, gateEdges);

			if (!result) return null;

			const fromName = systemMap[stops[i]]?.name ?? `#${stops[i]}`;
			const toName = systemMap[stops[i + 1]]?.name ?? `#${stops[i + 1]}`;
			segments.push({ result, fromName, toName });

			if (i === 0) {
				allSystems.push(...result.path);
			} else {
				allSystems.push(...result.path.slice(1));
			}
		}

		const regionIds = allSystems
			.map((id) => systemMap[id]?.regionId)
			.filter((r): r is number => r != null);

		const uniqueRegions: number[] = [];
		for (const r of regionIds) {
			if (uniqueRegions[uniqueRegions.length - 1] !== r) uniqueRegions.push(r);
		}

		return {
			segments,
			totalJumps: segments.reduce((sum, s) => sum + s.result.jumps, 0),
			totalDistanceLY: segments.reduce((sum, s) => sum + s.result.totalDistanceLY, 0),
			totalGateJumps: segments.reduce((sum, s) => sum + s.result.gateJumps, 0),
			systems: allSystems,
			regions: uniqueRegions,
		};
	}, [origin, destination, waypoints, grid, routeMode, jumpRangeLY, gateEdges, systemMap]);

	// Compute straight-line distance for reference
	const straightLineLY = useMemo(() => {
		if (!origin || !destination) return null;
		const a = systems.find((s) => s.id === origin);
		const b = systems.find((s) => s.id === destination);
		if (!a || !b) return null;
		const dx = a.center[0] - b.center[0];
		const dy = a.center[1] - b.center[1];
		const dz = a.center[2] - b.center[2];
		return Math.sqrt(dx * dx + dy * dy + dz * dz) / METERS_PER_LY;
	}, [origin, destination, systems]);

	function handleSwap() {
		const tmp = origin;
		setOrigin(destination);
		setDestination(tmp);
		setWaypoints([...waypoints].reverse());
	}

	function handleCopyRoute() {
		if (!route) return;
		const text = route.systems
			.map((id) => systemMap[id]?.name ?? `#${id}`)
			.join(" → ");
		navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	function handleReset() {
		setOrigin(null);
		setDestination(null);
		setWaypoints([]);
		setAvoidSystems([]);
	}

	return (
		<div className="flex h-full">
			{/* Sidebar panel */}
			<div className="w-96 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-6">
				{/* Header */}
				<div className="mb-6 flex items-center gap-2">
					<Route size={20} className="text-green-400" />
					<h1 className="text-lg font-semibold text-zinc-100">Jump Planner</h1>
					<button
						type="button"
						onClick={handleReset}
						className="ml-auto rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
						title="Reset"
					>
						<RotateCcw size={14} />
					</button>
				</div>

				{/* Ship Parameters */}
				<div className="mb-6 space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<h3 className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
						<Gauge size={12} />
						SHIP PARAMETERS
					</h3>

					{/* Jump Range */}
					<div>
						<label className="mb-1 flex items-center justify-between text-xs text-zinc-500">
							<span>Jump Range</span>
							<span className="font-mono text-zinc-400">{jumpRangeLY} LY</span>
						</label>
						<input
							type="range"
							min={1}
							max={500}
							step={1}
							value={jumpRangeLY}
							onChange={(e) => setJumpRangeLY(Number(e.target.value))}
							className="w-full accent-cyan-500"
						/>
						<div className="mt-1 flex gap-1">
							{[5, 10, 25, 50, 100, 250, 499].map((v) => (
								<button
									key={v}
									type="button"
									onClick={() => setJumpRangeLY(v)}
									className={`flex-1 rounded px-1 py-0.5 text-[10px] transition-colors ${
										jumpRangeLY === v
											? "bg-cyan-900/50 text-cyan-400"
											: "bg-zinc-800 text-zinc-600 hover:text-zinc-400"
									}`}
								>
									{v}
								</button>
							))}
						</div>
					</div>

					{/* Fuel per LY */}
					<div>
						<label className="mb-1 block text-xs text-zinc-500">
							Fuel per LY (optional)
						</label>
						<input
							type="number"
							min={0}
							step={0.1}
							value={fuelPerLY ?? ""}
							onChange={(e) => setFuelPerLY(e.target.value ? Number(e.target.value) : null)}
							placeholder="e.g. 1.5"
							className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
						/>
					</div>
				</div>

				{/* Route Mode */}
				<div className="mb-6">
					<h3 className="mb-2 text-xs font-medium text-zinc-500">ROUTE OPTIMIZATION</h3>
					<div className="space-y-1">
						{ROUTE_MODES.map((m) => (
							<button
								key={m.id}
								type="button"
								onClick={() => setRouteMode(m.id)}
								className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
									routeMode === m.id
										? "bg-cyan-950/30 border border-cyan-900/40 text-cyan-400"
										: "border border-transparent text-zinc-400 hover:bg-zinc-800/50"
								}`}
							>
								<m.icon size={14} />
								<div>
									<p className="font-medium">{m.label}</p>
									<p className="text-[10px] text-zinc-600">{m.description}</p>
								</div>
							</button>
						))}
					</div>
					<label className="mt-2 flex items-center gap-2 px-1 text-xs text-zinc-500">
						<input
							type="checkbox"
							checked={useGates}
							onChange={(e) => setUseGates(e.target.checked)}
							className="accent-cyan-500"
						/>
						Include gate connections (free jumps)
					</label>
				</div>

				{/* Origin */}
				<SystemSearch
					value={origin}
					onChange={setOrigin}
					systems={systems}
					placeholder="Search origin system..."
					label="ORIGIN"
				/>

				{/* Swap button */}
				<div className="my-2 flex justify-center">
					<button
						type="button"
						onClick={handleSwap}
						className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
						title="Swap origin and destination"
					>
						<ArrowDown size={16} />
					</button>
				</div>

				{/* Waypoints */}
				{waypoints.map((wp, idx) => (
					<div key={idx} className="mb-2 flex items-end gap-2">
						<div className="flex-1">
							<SystemSearch
								value={wp || null}
								onChange={(id) => {
									const next = [...waypoints];
									next[idx] = id ?? 0;
									setWaypoints(next);
								}}
								systems={systems}
								placeholder="Search waypoint..."
								label={`WAYPOINT ${idx + 1}`}
							/>
						</div>
						<button
							type="button"
							onClick={() => setWaypoints(waypoints.filter((_, i) => i !== idx))}
							className="mb-0.5 rounded p-2 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
						>
							<Trash2 size={14} />
						</button>
					</div>
				))}

				<button
					type="button"
					onClick={() => setWaypoints([...waypoints, 0])}
					className="mb-4 flex items-center gap-1 text-xs text-zinc-500 hover:text-cyan-400"
				>
					<Plus size={12} /> Add Waypoint
				</button>

				{/* Destination */}
				<SystemSearch
					value={destination}
					onChange={setDestination}
					systems={systems}
					placeholder="Search destination system..."
					label="DESTINATION"
				/>

				{/* Route summary */}
				{origin && destination && (
					<div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
						{route ? (
							<>
								<div className="flex items-start justify-between">
									<div>
										<p className="text-2xl font-bold text-green-400">{route.totalJumps}</p>
										<p className="text-xs text-zinc-500">
											jump{route.totalJumps !== 1 ? "s" : ""}
										</p>
									</div>
									<div className="text-right">
										<p className="font-mono text-sm text-zinc-300">
											{route.totalDistanceLY.toFixed(1)} LY
										</p>
										{straightLineLY != null && (
											<p className="text-[10px] text-zinc-600">
												{straightLineLY.toFixed(1)} LY straight
											</p>
										)}
										<p className="text-xs text-zinc-500">
											{route.systems.length} systems
											{route.totalGateJumps > 0 && ` · ${route.totalGateJumps} gate${route.totalGateJumps !== 1 ? "s" : ""}`}
										</p>
									</div>
								</div>

								{/* Fuel estimate */}
								{fuelPerLY != null && fuelPerLY > 0 && (
									<div className="mt-2 flex items-center gap-1.5 rounded bg-amber-950/20 px-2 py-1 text-xs text-amber-400">
										<Fuel size={12} />
										Est. fuel: {(route.totalDistanceLY * fuelPerLY).toFixed(1)}
									</div>
								)}

								{/* Region path */}
								<div className="mt-3 flex flex-wrap gap-1">
									{route.regions.map((rid, i) => (
										<span key={i} className="flex items-center gap-0.5 text-xs text-zinc-500">
											{i > 0 && <ChevronRight size={10} className="text-zinc-700" />}
											<span className="rounded bg-zinc-800 px-1.5 py-0.5">{regionMap[rid] ?? `Region ${rid}`}</span>
										</span>
									))}
								</div>
								<button
									type="button"
									onClick={handleCopyRoute}
									className="mt-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-cyan-400"
								>
									{copied ? <Check size={12} /> : <Copy size={12} />}
									{copied ? "Copied!" : "Copy route"}
								</button>
							</>
						) : (
							<div className="space-y-2">
								<div className="flex items-center gap-2 text-sm text-red-400">
									<AlertTriangle size={14} />
									No route found
								</div>
								<p className="text-xs text-zinc-600">
									{straightLineLY != null && (
										<>
											Straight-line distance: {straightLineLY.toFixed(1)} LY.{" "}
										</>
									)}
									{jumpRangeLY < 5 && "Try increasing your jump range. "}
									{avoidSystems.length > 0 && "Try removing avoided systems. "}
									{!useGates && "Try enabling gate connections. "}
								</p>
							</div>
						)}
					</div>
				)}

				{/* Avoidance */}
				<div className="mt-6">
					<h3 className="mb-2 text-xs font-medium text-zinc-500">AVOID SYSTEMS</h3>
					{avoidSystems.length > 0 && (
						<div className="mb-2 flex flex-wrap gap-1">
							{avoidSystems.map((id) => (
								<span
									key={id}
									className="flex items-center gap-1 rounded bg-red-950/30 px-2 py-0.5 text-xs text-red-400"
								>
									{systemMap[id]?.name ?? `#${id}`}
									<button type="button" onClick={() => setAvoidSystems(avoidSystems.filter((x) => x !== id))} className="hover:text-red-300">
										<X size={10} />
									</button>
								</span>
							))}
						</div>
					)}
					<SystemSearch
						value={avoidInput}
						onChange={(id) => {
							if (id && !avoidSystems.includes(id)) setAvoidSystems([...avoidSystems, id]);
							setAvoidInput(null);
						}}
						systems={systems}
						placeholder="Add system to avoid..."
						label=""
					/>
				</div>
			</div>

			{/* Route detail panel */}
			<div className="flex-1 overflow-y-auto bg-zinc-950 p-6">
				{!route ? (
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<Route size={48} className="mx-auto mb-4 text-zinc-800" />
							<p className="text-sm text-zinc-600">
								{origin && destination
									? "No route available — try adjusting jump range or route settings"
									: "Select origin and destination to plan a route"}
							</p>
						</div>
					</div>
				) : (
					<div>
						<h2 className="mb-4 text-sm font-medium text-zinc-400">
							Route: {route.totalJumps} jump{route.totalJumps !== 1 ? "s" : ""} · {route.totalDistanceLY.toFixed(1)} LY
						</h2>

						<div className="space-y-0.5">
							{route.systems.map((systemId, idx) => {
								const system = systemMap[systemId];
								const isOrigin = idx === 0;
								const isDest = idx === route.systems.length - 1;
								const isWaypoint = waypoints.includes(systemId);
								const regionName = system ? (regionMap[system.regionId] ?? "") : "";
								const constName = system ? (constellationMap[system.constellationId] ?? "") : "";

								// Leg distance
								const allLegs = route.segments.flatMap((s) => s.result.legDistances);
								const legDist = idx > 0 ? allLegs[idx - 1] : null;

								// Is this a gate jump?
								const isGateJump = idx > 0 && useGates && jumps.some(
									(j) =>
										(j.fromSystemId === route.systems[idx - 1] && j.toSystemId === systemId) ||
										(j.fromSystemId === systemId && j.toSystemId === route.systems[idx - 1]),
								);

								// Region changed?
								const prevSystem = idx > 0 ? systemMap[route.systems[idx - 1]] : null;
								const regionChanged = prevSystem && system && prevSystem.regionId !== system.regionId;

								return (
									<div key={`${systemId}-${idx}`}>
										{regionChanged && (
											<div className="my-2 border-t border-zinc-800 pt-2">
												<span className="text-xs font-medium text-zinc-600">
													Entering: {regionName}
												</span>
											</div>
										)}
										<div
											className={`flex items-center gap-3 rounded px-3 py-1.5 ${
												isOrigin || isDest
													? "bg-cyan-950/20 border border-cyan-900/30"
													: isWaypoint
														? "bg-amber-950/20 border border-amber-900/30"
														: "hover:bg-zinc-900/50"
											}`}
										>
											{/* Jump number */}
											<span className="w-8 shrink-0 text-right font-mono text-xs text-zinc-600">
												{isOrigin ? "—" : idx}
											</span>

											{/* Connector dot */}
											<div className="flex w-4 shrink-0 justify-center">
												{isOrigin ? (
													<div className="h-3 w-3 rounded-full border-2 border-green-500 bg-green-500/20" />
												) : isDest ? (
													<div className="h-3 w-3 rounded-full border-2 border-red-500 bg-red-500/20" />
												) : isWaypoint ? (
													<div className="h-3 w-3 rounded-full border-2 border-amber-500 bg-amber-500/20" />
												) : (
													<div className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
												)}
											</div>

											{/* System info */}
											<div className="flex-1">
												<span className={`text-sm ${isOrigin || isDest ? "font-medium text-zinc-100" : "text-zinc-300"}`}>
													{system?.name ?? `System ${systemId}`}
												</span>
												{(isOrigin || isDest || isWaypoint || regionChanged) && constName && (
													<span className="ml-2 text-xs text-zinc-600">{constName}</span>
												)}
											</div>

											{/* Leg distance */}
											{legDist != null && (
												<span className="shrink-0 font-mono text-xs text-zinc-600">
													{legDist < 1 ? `${(legDist * 1000).toFixed(0)} mLY` : `${legDist.toFixed(1)} LY`}
												</span>
											)}

											{/* Gate indicator */}
											{isGateJump && (
												<span className="shrink-0 rounded bg-emerald-950/30 px-1 py-0.5 text-[10px] text-emerald-400">
													Gate
												</span>
											)}

											{/* Labels */}
											{isOrigin && (
												<span className="shrink-0 rounded bg-green-900/30 px-1.5 py-0.5 text-xs text-green-400">Origin</span>
											)}
											{isDest && (
												<span className="shrink-0 rounded bg-red-900/30 px-1.5 py-0.5 text-xs text-red-400">Dest</span>
											)}
											{isWaypoint && !isOrigin && !isDest && (
												<span className="shrink-0 rounded bg-amber-900/30 px-1.5 py-0.5 text-xs text-amber-400">WP</span>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
