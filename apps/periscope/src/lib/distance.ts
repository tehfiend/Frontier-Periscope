// Queue-to-container gate-jump distance -- plan 39 Phase 5 (decision 11).
//
// A thin wrapper over the static gate graph (lib/pathfinder.buildAdjacency over db.jumps) that ranks
// stock containers by how many gate jumps separate them from the queue's location. Same system = 0;
// a container with no structured system, or one unreachable from the queue, is "unknown" (sorted last).
//
// Distance here is PURELY about ordering the source list (decision 9, Option A -- informational): it
// never touches the optimizer math. It wraps pathfinder rather than editing it, so the A* route planner
// stays focused on ship-range routing while this module does unweighted gate-hop counting.

import type { Jump } from "@/db/types";
import type { ContainerRef } from "@/lib/buildQueueTypes";
import { buildAdjacency } from "@/lib/pathfinder";
import { containerRefKey } from "@/lib/queueResolver";

/** Undirected gate adjacency: systemId -> directly gate-connected systemIds. */
export type GateGraph = Map<number, number[]>;

/** Build the gate adjacency from the static jump pairs (db.jumps). */
export function buildGateGraph(jumps: Jump[]): GateGraph {
	return buildAdjacency(jumps);
}

/**
 * Single-source BFS over the gate graph: systemId -> gate-jump count from `origin` (origin itself = 0).
 * Only systems reachable through gates appear in the map; unreachable / isolated systems are absent.
 */
export function gateDistancesFrom(graph: GateGraph, origin: number): Map<number, number> {
	const dist = new Map<number, number>([[origin, 0]]);
	const queue: number[] = [origin];
	let head = 0;
	while (head < queue.length) {
		const current = queue[head++];
		const d = dist.get(current) ?? 0;
		for (const neighbour of graph.get(current) ?? []) {
			if (!dist.has(neighbour)) {
				dist.set(neighbour, d + 1);
				queue.push(neighbour);
			}
		}
	}
	return dist;
}

/**
 * Gate-jump count for a SINGLE depositing -> consuming pair (plan 41 B4 -- the costed haul readout).
 * Where `containerJumpDistances` runs one BFS from a fixed origin to every container, this answers one
 * "from A to B" leg: the gate jumps between a container's (depositing) system and a batch's (consuming)
 * system. Same system = 0; `undefined` when either end has no structured system or the two are not
 * gate-connected. The undirected BFS short-circuits the moment it settles `toSystemId`, so nearby legs
 * are cheap. Used per-batch so a batch with its own location re-anchors its haul; callers fall back to
 * the queue location when a batch sets none.
 */
export function gateJumpsBetween(
	graph: GateGraph,
	fromSystemId: number | null | undefined,
	toSystemId: number | null | undefined,
): number | undefined {
	if (fromSystemId == null || toSystemId == null) return undefined;
	if (fromSystemId === toSystemId) return 0;
	const dist = new Map<number, number>([[fromSystemId, 0]]);
	const queue: number[] = [fromSystemId];
	let head = 0;
	while (head < queue.length) {
		const current = queue[head++];
		const d = dist.get(current) ?? 0;
		for (const neighbour of graph.get(current) ?? []) {
			if (neighbour === toSystemId) return d + 1;
			if (!dist.has(neighbour)) {
				dist.set(neighbour, d + 1);
				queue.push(neighbour);
			}
		}
	}
	return undefined;
}

/** A stock container paired with its (optional) structured solar-system id. */
export interface ContainerSystem {
	ref: ContainerRef;
	/** The container's solar system; undefined when it has no structured location. */
	systemId?: number;
}

/**
 * Gate-jump distance from `originSystemId` to each container's system, keyed by `containerRefKey`.
 * A value is a finite jump count (same system = 0) when both ends have a structured, reachable system;
 * it is `undefined` when the queue has no location, the container has no system, or the two are not
 * gate-connected. Computed with ONE BFS from the origin (then O(1) lookups per container).
 */
export function containerJumpDistances(
	containers: ContainerSystem[],
	originSystemId: number | null | undefined,
	graph: GateGraph,
): Map<string, number | undefined> {
	const out = new Map<string, number | undefined>();
	const dist = originSystemId != null ? gateDistancesFrom(graph, originSystemId) : null;
	for (const c of containers) {
		const key = containerRefKey(c.ref);
		out.set(key, dist != null && c.systemId != null ? dist.get(c.systemId) : undefined);
	}
	return out;
}

/**
 * Stable-sort containers by gate distance: nearest first, with unknown distances (no queue location,
 * no container system, or unreachable) kept last in their original order. `jumps` is keyed by
 * `containerRefKey` (see containerJumpDistances).
 */
export function sortContainersByDistance<T extends { ref: ContainerRef }>(
	containers: T[],
	jumps: Map<string, number | undefined>,
): T[] {
	return containers
		.map((c, i) => ({ c, i, d: jumps.get(containerRefKey(c.ref)) }))
		.sort((a, b) => {
			if (a.d == null && b.d == null) return a.i - b.i;
			if (a.d == null) return 1;
			if (b.d == null) return -1;
			return a.d - b.d || a.i - b.i;
		})
		.map((x) => x.c);
}
