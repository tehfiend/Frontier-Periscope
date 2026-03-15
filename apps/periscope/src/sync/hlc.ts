// Hybrid Logical Clock for causal ordering in CRDT sync
// Format: {wallMs_base36_11}:{counter_hex_4}:{nodeId_8}
// Lexicographic sort gives causal + wall-clock ordering

let _nodeId = "";
let _lastWallMs = 0;
let _counter = 0;

export interface HLCTimestamp {
	wallMs: number;
	counter: number;
	nodeId: string;
}

/** Initialize HLC with this instance's node ID */
export function init(nodeId: string): void {
	_nodeId = nodeId;
}

/** Get the current node ID */
export function nodeId(): string {
	return _nodeId;
}

/** Generate a new HLC timestamp for a local event */
export function now(): string {
	const wall = Date.now();
	if (wall > _lastWallMs) {
		_lastWallMs = wall;
		_counter = 0;
	} else {
		_counter++;
	}
	return format({ wallMs: _lastWallMs, counter: _counter, nodeId: _nodeId });
}

/** Advance HLC on send (same as now() but explicit intent) */
export function send(): string {
	return now();
}

/** Merge with a received HLC timestamp, advance local clock */
export function receive(remote: string): string {
	const r = parse(remote);
	const wall = Date.now();

	if (wall > _lastWallMs && wall > r.wallMs) {
		_lastWallMs = wall;
		_counter = 0;
	} else if (r.wallMs > _lastWallMs) {
		_lastWallMs = r.wallMs;
		_counter = r.counter + 1;
	} else if (_lastWallMs === r.wallMs) {
		_counter = Math.max(_counter, r.counter) + 1;
	} else {
		_counter++;
	}

	return format({ wallMs: _lastWallMs, counter: _counter, nodeId: _nodeId });
}

/** Compare two HLC strings lexicographically */
export function compare(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

/** Parse an HLC string into its components */
export function parse(hlc: string): HLCTimestamp {
	const [wallStr, counterStr, nid] = hlc.split(":");
	return {
		wallMs: Number.parseInt(wallStr, 36),
		counter: Number.parseInt(counterStr, 16),
		nodeId: nid,
	};
}

/** Format an HLC timestamp as a string */
export function format(ts: HLCTimestamp): string {
	const wall = ts.wallMs.toString(36).padStart(11, "0");
	const counter = ts.counter.toString(16).padStart(4, "0");
	return `${wall}:${counter}:${ts.nodeId}`;
}
