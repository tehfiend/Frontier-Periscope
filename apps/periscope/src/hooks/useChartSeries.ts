import type { TimeSeriesPoint } from "@/components/TimeSeriesChart";
import { db } from "@/db";
import type { LogEventType } from "@/db/types";
import { tsMs } from "@/hooks/useLocalSonar";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

export interface ChartSeries {
	/** Zero-filled bins across the whole window, oldest first. */
	series: TimeSeriesPoint[];
	/** True when no events landed in the window (drives the empty-state). */
	isEmpty: boolean;
	/** Sum of the raw values (units mined / damage) across the window. */
	total: number;
	/** Highest binned value (handy for axis hints). */
	peak: number;
}

const EMPTY: ChartSeries = { series: [], isEmpty: true, total: 0, peak: 0 };

/**
 * Bin recent `db.logEvents` of a single type into a fixed wall-clock window time series
 * (across sessions). Mining sums `amount` and scales to units/min; combat sums `damage` and
 * divides to dmg/s. Every bin in [now - windowMs, now] is emitted, zero-filled, so idle gaps
 * render as zero instead of interpolated activity. Reactive via `useLiveQuery` -- recomputes as
 * events arrive, plus a coarse wall-clock tick so the window keeps sliding while idle.
 */
export function useChartSeries(type: LogEventType, binMs: number, windowMs: number): ChartSeries {
	// Dexie liveQuery only re-runs on a db.logEvents write, so during idle (no new log lines) the
	// rolling window would freeze and the "no recent ..." empty-state would never engage. A coarse
	// wall-clock tick forces the window to slide and isEmpty to update while idle.
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const period = Math.max(binMs, 10_000);
		const id = setInterval(() => setTick((t) => t + 1), period);
		return () => clearInterval(id);
	}, [binMs]);

	const result = useLiveQuery(async () => {
		const now = Date.now();
		const windowStart = now - windowMs;
		const cutoffIso = new Date(windowStart).toISOString();
		const events = await db.logEvents
			.where("timestamp")
			.aboveOrEqual(cutoffIso)
			.filter((e) => e.type === type)
			.toArray();

		const isMining = type === "mining";
		const sums = new Map<number, number>();
		let total = 0;
		for (const e of events) {
			const ms = tsMs(e.timestamp);
			if (ms < windowStart) continue;
			const value = isMining ? (e.amount ?? 0) : (e.damage ?? 0);
			const bin = Math.floor(ms / binMs);
			sums.set(bin, (sums.get(bin) ?? 0) + value);
			total += value;
		}

		const firstBin = Math.floor(windowStart / binMs);
		const lastBin = Math.floor(now / binMs);
		const series: TimeSeriesPoint[] = [];
		let peak = 0;
		for (let bin = firstBin; bin <= lastBin; bin++) {
			const sum = sums.get(bin) ?? 0;
			// Edge bins are partial: the trailing bin only covers [binStart, now] and the leading
			// bin is truncated at the window start. Divide by the actual covered duration (not the
			// full binMs) so the live edge reflects the real rate and matches the snapshot stat
			// cards instead of dipping toward zero.
			let durationMs = binMs;
			if (bin === lastBin) durationMs = Math.max(now - bin * binMs, 1_000);
			else if (bin === firstBin) durationMs = Math.max((bin + 1) * binMs - windowStart, 1_000);
			// Mining: units/min. Combat: dmg/s.
			const v = isMining ? (sum / durationMs) * 60_000 : sum / (durationMs / 1000);
			series.push({ t: bin * binMs, v });
			if (v > peak) peak = v;
		}

		return { series, isEmpty: total === 0, total, peak } satisfies ChartSeries;
	}, [type, binMs, windowMs, tick]);

	return result ?? EMPTY;
}
