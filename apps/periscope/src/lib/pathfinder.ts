/**
 * Pathfinder — A* route planning with jump range and multiple optimization modes.
 *
 * Systems are connected when within the ship's jump range (Euclidean distance).
 * Static gate connections from stellar_jumps.json can be used as free edges.
 *
 * Uses a 3D grid spatial index for fast neighbor lookups — reduces per-node
 * neighbor finding from O(n) to O(k) where k ≈ systems in nearby cells.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Meters per light-year */
export const METERS_PER_LY = 9.461e15;

// ── Types ────────────────────────────────────────────────────────────────────

export type RouteMode = "fewest_jumps" | "shortest" | "prefer_gates";

export interface SystemPosition {
	id: number;
	x: number;
	y: number;
	z: number;
}

export interface RouteOptions {
	mode: RouteMode;
	/** Maximum jump distance in light-years */
	jumpRangeLY: number;
	/** Systems to exclude from routing */
	avoidSystems?: Set<number>;
	/** Free gate connections (from static jump data or player gates) */
	gateEdges?: Map<number, number[]>;
}

export interface RouteResult {
	path: number[];
	jumps: number;
	totalDistanceLY: number;
	/** Number of jumps that used a gate (free connection) */
	gateJumps: number;
	/** Distance of each leg in LY */
	legDistances: number[];
}

// ── Min-Heap Priority Queue ──────────────────────────────────────────────────

interface HeapEntry {
	id: number;
	priority: number;
}

class MinHeap {
	private data: HeapEntry[] = [];

	get size() {
		return this.data.length;
	}

	push(id: number, priority: number) {
		this.data.push({ id, priority });
		this.bubbleUp(this.data.length - 1);
	}

	pop(): HeapEntry | undefined {
		if (this.data.length === 0) return undefined;
		const top = this.data[0];
		const last = this.data.pop()!;
		if (this.data.length > 0) {
			this.data[0] = last;
			this.sinkDown(0);
		}
		return top;
	}

	private bubbleUp(i: number) {
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (this.data[i].priority >= this.data[parent].priority) break;
			[this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
			i = parent;
		}
	}

	private sinkDown(i: number) {
		const n = this.data.length;
		while (true) {
			let smallest = i;
			const left = 2 * i + 1;
			const right = 2 * i + 2;
			if (left < n && this.data[left].priority < this.data[smallest].priority) smallest = left;
			if (right < n && this.data[right].priority < this.data[smallest].priority) smallest = right;
			if (smallest === i) break;
			[this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
			i = smallest;
		}
	}
}

// ── Distance helpers ─────────────────────────────────────────────────────────

function distSquared(a: SystemPosition, b: SystemPosition): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const dz = a.z - b.z;
	return dx * dx + dy * dy + dz * dz;
}

function distMeters(a: SystemPosition, b: SystemPosition): number {
	return Math.sqrt(distSquared(a, b));
}

export function distLY(a: SystemPosition, b: SystemPosition): number {
	return distMeters(a, b) / METERS_PER_LY;
}

// ── 3D Spatial Index ─────────────────────────────────────────────────────────

/** Grid cell size in meters — 50 LY works well for the EVE universe density */
const CELL_SIZE = 50 * METERS_PER_LY;

function cellKey(cx: number, cy: number, cz: number): string {
	return `${cx},${cy},${cz}`;
}

class SpatialGrid {
	private cells = new Map<string, SystemPosition[]>();
	private posMap = new Map<number, SystemPosition>();

	constructor(systems: SystemPosition[], avoidSystems?: Set<number>) {
		for (const s of systems) {
			if (avoidSystems?.has(s.id)) continue;
			this.posMap.set(s.id, s);
			const cx = Math.floor(s.x / CELL_SIZE);
			const cy = Math.floor(s.y / CELL_SIZE);
			const cz = Math.floor(s.z / CELL_SIZE);
			const key = cellKey(cx, cy, cz);
			let cell = this.cells.get(key);
			if (!cell) {
				cell = [];
				this.cells.set(key, cell);
			}
			cell.push(s);
		}
	}

	getPos(id: number): SystemPosition | undefined {
		return this.posMap.get(id);
	}

	/** Find all systems within `range` meters of the given system. */
	getNeighbors(sys: SystemPosition, rangeM: number, closed: Set<number>): SystemPosition[] {
		const rangeSq = rangeM * rangeM;
		const cellSpan = Math.ceil(rangeM / CELL_SIZE);
		const cx0 = Math.floor(sys.x / CELL_SIZE);
		const cy0 = Math.floor(sys.y / CELL_SIZE);
		const cz0 = Math.floor(sys.z / CELL_SIZE);
		const result: SystemPosition[] = [];

		for (let dx = -cellSpan; dx <= cellSpan; dx++) {
			for (let dy = -cellSpan; dy <= cellSpan; dy++) {
				for (let dz = -cellSpan; dz <= cellSpan; dz++) {
					const cell = this.cells.get(cellKey(cx0 + dx, cy0 + dy, cz0 + dz));
					if (!cell) continue;
					for (const s of cell) {
						if (s.id === sys.id || closed.has(s.id)) continue;
						if (distSquared(sys, s) <= rangeSq) {
							result.push(s);
						}
					}
				}
			}
		}
		return result;
	}
}

// ── A* Pathfinder ────────────────────────────────────────────────────────────

export function findRoute(
	systems: SystemPosition[],
	start: number,
	end: number,
	options: RouteOptions,
): RouteResult | null {
	if (start === end) {
		return { path: [start], jumps: 0, totalDistanceLY: 0, gateJumps: 0, legDistances: [] };
	}

	const { mode, jumpRangeLY, avoidSystems, gateEdges } = options;
	const jumpRangeMeters = jumpRangeLY * METERS_PER_LY;

	// Build spatial index
	const grid = new SpatialGrid(systems, avoidSystems);

	const startPos = grid.getPos(start);
	const endPos = grid.getPos(end);
	if (!startPos || !endPos) return null;

	// A* search
	const gScore = new Map<number, number>();
	const cameFrom = new Map<number, number>();
	const closed = new Set<number>();
	const heap = new MinHeap();

	gScore.set(start, 0);
	const h0 = heuristic(startPos, endPos, jumpRangeMeters, mode);
	heap.push(start, h0);

	while (heap.size > 0) {
		const current = heap.pop()!;
		if (current.id === end) break;
		if (closed.has(current.id)) continue;
		closed.add(current.id);

		const currentPos = grid.getPos(current.id)!;
		const currentG = gScore.get(current.id)!;

		// Spatial neighbors within jump range
		const spatialNeighbors = grid.getNeighbors(currentPos, jumpRangeMeters, closed);

		// Gate edges (free connections regardless of distance)
		const gateNeighborIds = gateEdges?.get(current.id);

		// Process spatial neighbors
		for (const neighborPos of spatialNeighbors) {
			const edgeDist = distMeters(currentPos, neighborPos);
			const isGate = gateNeighborIds?.includes(neighborPos.id) ?? false;
			const edgeCost = computeEdgeCost(edgeDist, isGate, mode);
			const tentativeG = currentG + edgeCost;

			const prevG = gScore.get(neighborPos.id);
			if (prevG !== undefined && tentativeG >= prevG) continue;

			gScore.set(neighborPos.id, tentativeG);
			cameFrom.set(neighborPos.id, current.id);

			const h = heuristic(neighborPos, endPos, jumpRangeMeters, mode);
			heap.push(neighborPos.id, tentativeG + h);
		}

		// Gate neighbors that might be out of jump range
		if (gateNeighborIds) {
			for (const gid of gateNeighborIds) {
				if (closed.has(gid)) continue;
				const gatePos = grid.getPos(gid);
				if (!gatePos) continue;

				// Skip if already processed as spatial neighbor
				const dSq = distSquared(currentPos, gatePos);
				if (dSq <= jumpRangeMeters * jumpRangeMeters) continue;

				const edgeDist = Math.sqrt(dSq);
				const edgeCost = computeEdgeCost(edgeDist, true, mode);
				const tentativeG = currentG + edgeCost;

				const prevG = gScore.get(gid);
				if (prevG !== undefined && tentativeG >= prevG) continue;

				gScore.set(gid, tentativeG);
				cameFrom.set(gid, current.id);

				const h = heuristic(gatePos, endPos, jumpRangeMeters, mode);
				heap.push(gid, tentativeG + h);
			}
		}
	}

	// Reconstruct path
	if (!cameFrom.has(end) && start !== end) return null;

	const path: number[] = [];
	let node: number | undefined = end;
	while (node !== undefined) {
		path.unshift(node);
		node = cameFrom.get(node);
	}

	// Compute leg distances and gate jump count
	const legDistances: number[] = [];
	let totalDist = 0;
	let gateJumps = 0;
	for (let i = 1; i < path.length; i++) {
		const a = grid.getPos(path[i - 1])!;
		const b = grid.getPos(path[i])!;
		const d = distMeters(a, b) / METERS_PER_LY;
		legDistances.push(d);
		totalDist += d;

		if (gateEdges?.get(path[i - 1])?.includes(path[i])) {
			gateJumps++;
		}
	}

	return {
		path,
		jumps: path.length - 1,
		totalDistanceLY: totalDist,
		gateJumps,
		legDistances,
	};
}

// ── Cost & Heuristic functions ───────────────────────────────────────────────

function computeEdgeCost(distM: number, isGate: boolean, mode: RouteMode): number {
	switch (mode) {
		case "fewest_jumps":
			return 1;
		case "shortest":
			return distM;
		case "prefer_gates":
			return isGate ? 0.001 : distM;
	}
}

function heuristic(
	from: SystemPosition,
	to: SystemPosition,
	jumpRangeM: number,
	mode: RouteMode,
): number {
	const d = distMeters(from, to);
	switch (mode) {
		case "fewest_jumps":
			// Admissible: straight-line distance / max range = min possible hops
			return Math.ceil(d / jumpRangeM);
		case "shortest":
		case "prefer_gates":
			return d;
	}
}

// ── Prebuilt spatial index for reuse across calls ────────────────────────────

let cachedGrid: SpatialGrid | null = null;
let cachedSystemCount = 0;

/**
 * Build (or reuse) a spatial index from system positions.
 * Rebuilt only when system count changes (i.e., data reloaded).
 */
export function getOrBuildGrid(systems: SystemPosition[], avoidSystems?: Set<number>): SpatialGrid {
	if (cachedGrid && cachedSystemCount === systems.length && !avoidSystems?.size) {
		return cachedGrid;
	}
	const grid = new SpatialGrid(systems, avoidSystems);
	if (!avoidSystems?.size) {
		cachedGrid = grid;
		cachedSystemCount = systems.length;
	}
	return grid;
}

/**
 * Faster findRoute that reuses a prebuilt spatial index.
 */
export function findRouteWithGrid(
	grid: SpatialGrid,
	start: number,
	end: number,
	options: Omit<RouteOptions, "avoidSystems">,
	gateEdges?: Map<number, number[]>,
): RouteResult | null {
	if (start === end) {
		return { path: [start], jumps: 0, totalDistanceLY: 0, gateJumps: 0, legDistances: [] };
	}

	const { mode, jumpRangeLY } = options;
	const jumpRangeMeters = jumpRangeLY * METERS_PER_LY;

	const startPos = grid.getPos(start);
	const endPos = grid.getPos(end);
	if (!startPos || !endPos) return null;

	const gScore = new Map<number, number>();
	const cameFrom = new Map<number, number>();
	const closed = new Set<number>();
	const heap = new MinHeap();

	gScore.set(start, 0);
	heap.push(start, heuristic(startPos, endPos, jumpRangeMeters, mode));

	while (heap.size > 0) {
		const current = heap.pop()!;
		if (current.id === end) break;
		if (closed.has(current.id)) continue;
		closed.add(current.id);

		const currentPos = grid.getPos(current.id)!;
		const currentG = gScore.get(current.id)!;

		const spatialNeighbors = grid.getNeighbors(currentPos, jumpRangeMeters, closed);
		const gateNeighborIds = gateEdges?.get(current.id);

		for (const neighborPos of spatialNeighbors) {
			const edgeDist = distMeters(currentPos, neighborPos);
			const isGate = gateNeighborIds?.includes(neighborPos.id) ?? false;
			const edgeCost = computeEdgeCost(edgeDist, isGate, mode);
			const tentativeG = currentG + edgeCost;

			const prevG = gScore.get(neighborPos.id);
			if (prevG !== undefined && tentativeG >= prevG) continue;

			gScore.set(neighborPos.id, tentativeG);
			cameFrom.set(neighborPos.id, current.id);
			heap.push(neighborPos.id, tentativeG + heuristic(neighborPos, endPos, jumpRangeMeters, mode));
		}

		if (gateNeighborIds) {
			for (const gid of gateNeighborIds) {
				if (closed.has(gid)) continue;
				const gatePos = grid.getPos(gid);
				if (!gatePos) continue;
				const dSq = distSquared(currentPos, gatePos);
				if (dSq <= jumpRangeMeters * jumpRangeMeters) continue;

				const edgeDist = Math.sqrt(dSq);
				const edgeCost = computeEdgeCost(edgeDist, true, mode);
				const tentativeG = currentG + edgeCost;

				const prevG = gScore.get(gid);
				if (prevG !== undefined && tentativeG >= prevG) continue;

				gScore.set(gid, tentativeG);
				cameFrom.set(gid, current.id);
				heap.push(gid, tentativeG + heuristic(gatePos, endPos, jumpRangeMeters, mode));
			}
		}
	}

	if (!cameFrom.has(end)) return null;

	const path: number[] = [];
	let node: number | undefined = end;
	while (node !== undefined) {
		path.unshift(node);
		node = cameFrom.get(node);
	}

	const legDistances: number[] = [];
	let totalDist = 0;
	let gateJumps = 0;
	for (let i = 1; i < path.length; i++) {
		const a = grid.getPos(path[i - 1])!;
		const b = grid.getPos(path[i])!;
		const d = distMeters(a, b) / METERS_PER_LY;
		legDistances.push(d);
		totalDist += d;
		if (gateEdges?.get(path[i - 1])?.includes(path[i])) gateJumps++;
	}

	return { path, jumps: path.length - 1, totalDistanceLY: totalDist, gateJumps, legDistances };
}

// ── Legacy BFS (for static gate-only routing, used by StarMap) ───────────────

export interface PathResult {
	path: number[];
	jumps: number;
}

/** BFS shortest path on unweighted gate graph. */
export function dijkstra(
	adjacency: Map<number, number[]>,
	start: number,
	end: number,
): PathResult | null {
	if (start === end) return { path: [start], jumps: 0 };

	const prev = new Map<number, number>();
	const visited = new Set<number>([start]);
	const queue: number[] = [start];
	let head = 0;

	while (head < queue.length) {
		const current = queue[head++];
		if (current === end) {
			const path: number[] = [];
			let node: number | undefined = end;
			while (node !== undefined) {
				path.unshift(node);
				node = prev.get(node);
			}
			return { path, jumps: path.length - 1 };
		}
		const neighbors = adjacency.get(current) ?? [];
		for (const neighbor of neighbors) {
			if (visited.has(neighbor)) continue;
			visited.add(neighbor);
			prev.set(neighbor, current);
			queue.push(neighbor);
		}
	}
	return null;
}

/** Build adjacency list from static jump pairs (gate connections). */
export function buildAdjacency(
	jumps: { fromSystemId: number; toSystemId: number }[],
): Map<number, number[]> {
	const adj = new Map<number, number[]>();
	for (const j of jumps) {
		let fromList = adj.get(j.fromSystemId);
		if (!fromList) {
			fromList = [];
			adj.set(j.fromSystemId, fromList);
		}
		fromList.push(j.toSystemId);

		let toList = adj.get(j.toSystemId);
		if (!toList) {
			toList = [];
			adj.set(j.toSystemId, toList);
		}
		toList.push(j.fromSystemId);
	}
	return adj;
}

/** Build SystemPosition array from solar system data. */
export function buildPositions(
	systems: Array<{ id: number; center: [number, number, number] }>,
): SystemPosition[] {
	return systems.map((s) => ({
		id: s.id,
		x: s.center[0],
		y: s.center[1],
		z: s.center[2],
	}));
}
