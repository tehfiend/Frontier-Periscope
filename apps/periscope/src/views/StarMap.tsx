import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { useAppStore } from "@/stores/appStore";
import { dijkstra, buildAdjacency } from "@/lib/pathfinder";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Map, Search, X, LocateFixed, Route, Sparkles } from "lucide-react";
import type { SolarSystem, Jump, RiftIntel } from "@/db/types";

// ── Constants ────────────────────────────────────────────────────────────────

// Scale factor to bring EVE coords into Three.js range (~200 units across)
const SCALE = 1e-17;
const POINT_SIZE = 0.3;
const SELECTED_COLOR = new THREE.Color(0x00ffff);
const DEFAULT_COLOR = new THREE.Color(0.4, 0.5, 0.7);
const JUMP_COLOR = new THREE.Color(0.15, 0.2, 0.3);
const RIFT_COLOR = new THREE.Color(0xd946ef);

// Read-side display bound: only plot rifts revealed within this window. There is
// no on-chain despawn event, so without this the map would accumulate unbounded
// stale markers (heavier TTL prune / manual clear is Phase 5).
const RIFT_DISPLAY_WINDOW_MS = 48 * 60 * 60 * 1000;

// ── Main View ────────────────────────────────────────────────────────────────

export function StarMap() {
	const systemCount = useLiveQuery(() => db.solarSystems.count()) ?? 0;
	const jumpCount = useLiveQuery(() => db.jumps.count()) ?? 0;
	const systems = useLiveQuery(() => db.solarSystems.toArray());
	const jumps = useLiveQuery(() => db.jumps.toArray());
	const rifts = useLiveQuery(() => {
		const cutoffIso = new Date(Date.now() - RIFT_DISPLAY_WINDOW_MS).toISOString();
		return db.rifts
			.where("revealedAt")
			.above(cutoffIso)
			.and((r) => r.status === "revealed")
			.toArray();
	});
	const riftTotal = useLiveQuery(() => db.rifts.count()) ?? 0;
	const riftRevealed =
		useLiveQuery(() => db.rifts.where("status").equals("revealed").count()) ?? 0;
	const { selectedSystemId, selectSystem } = useAppStore();
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<SolarSystem[]>([]);
	const [routeFrom, setRouteFrom] = useState<number | null>(null);
	const [routeTo, setRouteTo] = useState<number | null>(null);
	const [showRoute, setShowRoute] = useState(false);
	const [showRifts, setShowRifts] = useState(false);
	const [selectedRiftId, setSelectedRiftId] = useState<string | null>(null);

	// Build adjacency list and compute route
	const adjacency = useMemo(
		() => (jumps ? buildAdjacency(jumps) : null),
		[jumps],
	);

	const route = useMemo(() => {
		if (!adjacency || !routeFrom || !routeTo) return null;
		return dijkstra(adjacency, routeFrom, routeTo);
	}, [adjacency, routeFrom, routeTo]);

	const routePathSet = useMemo(
		() => (route ? new Set(route.path) : new Set<number>()),
		[route],
	);

	const selectedSystem = useMemo(
		() => systems?.find((s) => s.id === selectedSystemId),
		[systems, selectedSystemId],
	);

	const selectedRift = useMemo(
		() => rifts?.find((r) => r.id === selectedRiftId) ?? null,
		[rifts, selectedRiftId],
	);

	const handleSearch = useCallback(
		(query: string) => {
			setSearchQuery(query);
			if (!query || !systems) {
				setSearchResults([]);
				return;
			}
			const q = query.toLowerCase();
			setSearchResults(
				systems.filter((s) => s.name?.toLowerCase().includes(q)).slice(0, 20),
			);
		},
		[systems],
	);

	if (!systems || systems.length === 0) {
		return (
			<div className="flex h-full items-center justify-center bg-zinc-950">
				<p className="text-sm text-zinc-500">Loading star map data...</p>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			{/* Toolbar */}
			<div className="flex items-center gap-4 border-b border-zinc-800 px-4 py-2">
				<Map size={18} className="shrink-0 text-cyan-500" />
				<h1 className="shrink-0 text-sm font-semibold text-zinc-100">Star Map</h1>
				<span className="shrink-0 text-xs text-zinc-500">
					{systemCount.toLocaleString()} systems / {jumpCount.toLocaleString()} jumps
				</span>

				{/* Show Rifts toggle */}
				<button
					type="button"
					onClick={() => setShowRifts((v) => !v)}
					className={`ml-auto flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-xs ${
						showRifts
							? "border-fuchsia-700 bg-fuchsia-500/10 text-fuchsia-300"
							: "border-zinc-700 text-zinc-400 hover:border-fuchsia-700 hover:text-fuchsia-400"
					}`}
					title="Toggle rift markers"
				>
					<Sparkles size={14} />
					Rifts
					<span className="text-zinc-500">
						{riftRevealed} revealed of {riftTotal}
					</span>
				</button>

				{/* Search */}
				<div className="relative w-64">
					<Search size={14} className="absolute left-2.5 top-2 text-zinc-500" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => handleSearch(e.target.value)}
						placeholder="Search systems..."
						className="w-full rounded border border-zinc-700 bg-zinc-900 py-1.5 pl-8 pr-8 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-600 focus:outline-none"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => handleSearch("")}
							className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300"
						>
							<X size={14} />
						</button>
					)}
					{searchResults.length > 0 && (
						<div className="absolute top-full z-50 mt-1 max-h-60 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-900 shadow-lg">
							{searchResults.map((s) => (
								<button
									key={s.id}
									type="button"
									onClick={() => {
										selectSystem(s.id);
										handleSearch("");
									}}
									className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800"
								>
									<span className="font-mono text-cyan-400">{s.name ?? s.id}</span>
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Selected system / route info */}
			{(selectedSystem || showRoute) && (
				<div className="flex items-center gap-4 border-b border-zinc-800 bg-zinc-900/50 px-4 py-2 text-xs">
					{selectedSystem && !showRoute && (
						<>
							<LocateFixed size={14} className="text-cyan-400" />
							<span className="font-mono font-medium text-cyan-300">{selectedSystem.name ?? selectedSystem.id}</span>
							<span className="text-zinc-500">ID: {selectedSystem.id}</span>
							<button
								type="button"
								onClick={() => { setRouteFrom(selectedSystem.id); setShowRoute(true); }}
								className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-400 hover:border-cyan-700 hover:text-cyan-400"
							>
								<Route size={12} className="inline mr-1" />Route from here
							</button>
							<button
								type="button"
								onClick={() => selectSystem(null)}
								className="ml-auto text-zinc-500 hover:text-zinc-300"
							>
								<X size={14} />
							</button>
						</>
					)}
					{showRoute && (
						<>
							<Route size={14} className="text-green-400" />
							<span className="text-zinc-400">From:</span>
							<span className="font-mono text-cyan-300">
								{systems.find((s) => s.id === routeFrom)?.name ?? routeFrom ?? "—"}
							</span>
							<span className="text-zinc-400">To:</span>
							<span className="font-mono text-cyan-300">
								{systems.find((s) => s.id === routeTo)?.name ?? (routeTo ? routeTo : "click a system")}
							</span>
							{route && (
								<span className="font-medium text-green-400">{route.jumps} jumps</span>
							)}
							{!route && routeFrom && routeTo && (
								<span className="text-red-400">No route found</span>
							)}
							<button
								type="button"
								onClick={() => { setShowRoute(false); setRouteFrom(null); setRouteTo(null); }}
								className="ml-auto text-zinc-500 hover:text-zinc-300"
							>
								<X size={14} />
							</button>
						</>
					)}
				</div>
			)}

			{/* 3D Canvas */}
			<div className="relative flex-1">
				<Canvas
					camera={{ position: [0, 100, 200], far: 10000 }}
					gl={{ antialias: true }}
					style={{ background: "#09090b" }}
				>
					<ambientLight intensity={0.3} />
					<StarField
						systems={systems}
						jumps={jumps ?? []}
						rifts={showRifts ? (rifts ?? []) : []}
						selectedId={selectedSystemId}
						routePath={routePathSet}
						routeOrder={route?.path ?? []}
						onSelect={(id) => {
							if (showRoute && routeFrom && !routeTo && id) {
								setRouteTo(id);
							} else {
								selectSystem(id);
							}
						}}
						onSelectRift={(riftId, systemId) => {
							setSelectedRiftId(riftId);
							selectSystem(systemId);
						}}
					/>
					<OrbitControls
						enableDamping
						dampingFactor={0.1}
						minDistance={5}
						maxDistance={3000}
					/>
				</Canvas>

				{/* Rift detail panel */}
				{selectedRift && (
					<div className="absolute bottom-4 left-4 w-64 rounded border border-fuchsia-800 bg-zinc-900/95 p-3 text-xs shadow-lg">
						<div className="mb-2 flex items-center justify-between">
							<span className="flex items-center gap-1.5 font-semibold text-fuchsia-300">
								<Sparkles size={14} /> Rift
							</span>
							<button
								type="button"
								onClick={() => setSelectedRiftId(null)}
								className="text-zinc-500 hover:text-zinc-300"
							>
								<X size={14} />
							</button>
						</div>
						<dl className="space-y-1 text-zinc-400">
							<div className="flex justify-between gap-2">
								<dt>System</dt>
								<dd className="font-mono text-fuchsia-200">
									{systems.find((s) => s.id === selectedRift.solarsystem)?.name ??
										selectedRift.solarsystem ??
										"—"}
								</dd>
							</div>
							{selectedRift.lPoint && (
								<div className="flex justify-between gap-2">
									<dt>L-Point</dt>
									<dd className="font-mono text-zinc-200">{selectedRift.lPoint}</dd>
								</div>
							)}
							<div className="flex justify-between gap-2">
								<dt>Item ID</dt>
								<dd className="truncate font-mono text-zinc-300" title={selectedRift.riftItemId}>
									{selectedRift.riftItemId || "—"}
								</dd>
							</div>
							{selectedRift.revealedAt && (
								<div className="flex justify-between gap-2">
									<dt>Revealed</dt>
									<dd className="font-mono text-zinc-300">
										{new Date(selectedRift.revealedAt).toLocaleString()}
									</dd>
								</div>
							)}
							<div className="flex justify-between gap-2">
								<dt>Coords</dt>
								<dd
									className="truncate font-mono text-zinc-500"
									title={`${selectedRift.x}, ${selectedRift.y}, ${selectedRift.z}`}
								>
									{selectedRift.x}, {selectedRift.y}, {selectedRift.z}
								</dd>
							</div>
						</dl>
					</div>
				)}
			</div>
		</div>
	);
}

// ── Star Field (InstancedMesh) ───────────────────────────────────────────────

const ROUTE_COLOR = new THREE.Color(0x00ff88);

function StarField({
	systems,
	jumps,
	rifts,
	selectedId,
	routePath,
	routeOrder,
	onSelect,
	onSelectRift,
}: {
	systems: SolarSystem[];
	jumps: Jump[];
	rifts: RiftIntel[];
	selectedId: number | null;
	routePath: Set<number>;
	routeOrder: number[];
	onSelect: (id: number | null) => void;
	onSelectRift: (riftId: string, systemId: number | null) => void;
}) {
	const meshRef = useRef<THREE.InstancedMesh>(null);
	const { camera } = useThree();

	// Build position lookup and instance data
	const { positions, idToIndex, indexToId } = useMemo(() => {
		const positions = new Float32Array(systems.length * 3);
		const idToIndex: globalThis.Map<number, number> = new globalThis.Map();
		const indexToId = new Int32Array(systems.length);

		for (let i = 0; i < systems.length; i++) {
			const s = systems[i];
			positions[i * 3] = s.center[0] * SCALE;
			positions[i * 3 + 1] = s.center[1] * SCALE;
			positions[i * 3 + 2] = s.center[2] * SCALE;
			idToIndex.set(s.id, i);
			indexToId[i] = s.id;
		}

		return { positions, idToIndex, indexToId };
	}, [systems]);

	// Set instance transforms
	useEffect(() => {
		if (!meshRef.current) return;
		const dummy = new THREE.Object3D();

		for (let i = 0; i < systems.length; i++) {
			dummy.position.set(
				positions[i * 3],
				positions[i * 3 + 1],
				positions[i * 3 + 2],
			);
			dummy.updateMatrix();
			meshRef.current.setMatrixAt(i, dummy.matrix);
		}
		meshRef.current.instanceMatrix.needsUpdate = true;
	}, [systems, positions]);

	// Set instance colors
	useEffect(() => {
		if (!meshRef.current) return;

		for (let i = 0; i < systems.length; i++) {
			const sysId = indexToId[i];
			const isSelected = sysId === selectedId;
			const isOnRoute = routePath.has(sysId);
			meshRef.current.setColorAt(
				i,
				isSelected ? SELECTED_COLOR : isOnRoute ? ROUTE_COLOR : DEFAULT_COLOR,
			);
		}
		if (meshRef.current.instanceColor) {
			meshRef.current.instanceColor.needsUpdate = true;
		}
	}, [systems, selectedId, routePath, indexToId]);

	// Jump connection lines
	const jumpGeometry = useMemo(() => {
		const verts: number[] = [];
		for (const j of jumps) {
			const fromIdx = idToIndex.get(j.fromSystemId);
			const toIdx = idToIndex.get(j.toSystemId);
			if (fromIdx === undefined || toIdx === undefined) continue;
			// Only render one direction to avoid double lines
			if (j.fromSystemId > j.toSystemId) continue;
			verts.push(
				positions[fromIdx * 3], positions[fromIdx * 3 + 1], positions[fromIdx * 3 + 2],
				positions[toIdx * 3], positions[toIdx * 3 + 1], positions[toIdx * 3 + 2],
			);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
		return geo;
	}, [jumps, positions, idToIndex]);

	// Click handler
	const handleClick = useCallback(
		(e: ThreeEvent<MouseEvent>) => {
			e.stopPropagation();
			if (e.instanceId !== undefined) {
				const id = indexToId[e.instanceId];
				onSelect(id);

				// Move camera to look at selected
				const idx = e.instanceId;
				const target = new THREE.Vector3(
					positions[idx * 3],
					positions[idx * 3 + 1],
					positions[idx * 3 + 2],
				);
				camera.lookAt(target);
			}
		},
		[indexToId, onSelect, positions, camera],
	);

	// Route path line (continuous bright line along the route)
	const routeGeometry = useMemo(() => {
		if (routeOrder.length < 2) return null;
		const pathArray = routeOrder;
		const verts: number[] = [];
		for (let i = 0; i < pathArray.length - 1; i++) {
			const fromIdx = idToIndex.get(pathArray[i]);
			const toIdx = idToIndex.get(pathArray[i + 1]);
			if (fromIdx === undefined || toIdx === undefined) continue;
			verts.push(
				positions[fromIdx * 3], positions[fromIdx * 3 + 1], positions[fromIdx * 3 + 2],
				positions[toIdx * 3], positions[toIdx * 3 + 1], positions[toIdx * 3 + 2],
			);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
		return geo;
	}, [routeOrder, positions, idToIndex]);

	// Rift markers -- plotted at the host system's center (sub-system position is
	// conveyed via the lPoint label). Skip rifts whose host system isn't loaded.
	const riftMarkers = useMemo(() => {
		const markers: { rift: RiftIntel; pos: [number, number, number] }[] = [];
		for (const rift of rifts) {
			if (rift.solarsystem == null) continue;
			const idx = idToIndex.get(rift.solarsystem);
			if (idx === undefined) continue;
			markers.push({
				rift,
				pos: [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]],
			});
		}
		return markers;
	}, [rifts, idToIndex, positions]);

	return (
		<>
			<instancedMesh
				ref={meshRef}
				args={[undefined, undefined, systems.length]}
				onClick={handleClick}
			>
				<sphereGeometry args={[POINT_SIZE, 6, 4]} />
				<meshBasicMaterial />
			</instancedMesh>

			<lineSegments geometry={jumpGeometry}>
				<lineBasicMaterial color={JUMP_COLOR} transparent opacity={0.4} />
			</lineSegments>

			{routeGeometry && (
				<lineSegments geometry={routeGeometry}>
					<lineBasicMaterial color={ROUTE_COLOR} linewidth={2} />
				</lineSegments>
			)}

			{riftMarkers.map(({ rift, pos }) => (
				<mesh
					key={rift.id}
					position={pos}
					onClick={(e) => {
						e.stopPropagation();
						onSelectRift(rift.id, rift.solarsystem ?? null);
					}}
				>
					<icosahedronGeometry args={[POINT_SIZE * 2.5, 0]} />
					<meshBasicMaterial color={RIFT_COLOR} transparent opacity={0.85} />
				</mesh>
			))}
		</>
	);
}
