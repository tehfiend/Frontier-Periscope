import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

export interface TimeSeriesPoint {
	/** Bin start time, epoch ms. */
	t: number;
	/** Value for the bin (already scaled to the chart's unit). */
	v: number;
}

function formatClock(t: number, showSeconds = false): string {
	const d = new Date(t);
	const h = String(d.getHours()).padStart(2, "0");
	const m = String(d.getMinutes()).padStart(2, "0");
	if (!showSeconds) return `${h}:${m}`;
	const s = String(d.getSeconds()).padStart(2, "0");
	return `${h}:${m}:${s}`;
}

/** Dark-themed line chart for a single time series. Bins are zero-filled by the caller and
 * rendered as zeros (no gap-filling), so idle periods read as zero rather than implied
 * activity. */
export function TimeSeriesChart({
	data,
	label,
	color,
	unit,
	height = 120,
	showSeconds = false,
}: {
	data: TimeSeriesPoint[];
	label: string;
	color: string;
	unit: string;
	height?: number;
	showSeconds?: boolean;
}) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
			<p className="mb-2 text-xs text-zinc-500">{label}</p>
			<ResponsiveContainer width="100%" height={height}>
				<LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
					<CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
					<XAxis
						dataKey="t"
						type="number"
						scale="time"
						domain={["dataMin", "dataMax"]}
						tickFormatter={(t) => formatClock(Number(t), showSeconds)}
						tick={{ fill: "#71717a", fontSize: 10 }}
						stroke="#3f3f46"
						minTickGap={40}
					/>
					<YAxis
						tick={{ fill: "#71717a", fontSize: 10 }}
						stroke="#3f3f46"
						width={44}
						allowDecimals={false}
					/>
					<Tooltip
						contentStyle={{
							backgroundColor: "#18181b",
							border: "1px solid #3f3f46",
							borderRadius: "0.5rem",
							fontSize: "0.75rem",
						}}
						labelStyle={{ color: "#a1a1aa" }}
						itemStyle={{ color }}
						labelFormatter={(t) => formatClock(Number(t), showSeconds)}
						formatter={(value) => {
							const n = typeof value === "number" ? value : Number(value ?? 0);
							return [`${Math.round(n).toLocaleString()} ${unit}`, label];
						}}
					/>
					<Line
						type="monotone"
						dataKey="v"
						stroke={color}
						strokeWidth={2}
						dot={false}
						isAnimationActive={false}
						connectNulls={false}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
