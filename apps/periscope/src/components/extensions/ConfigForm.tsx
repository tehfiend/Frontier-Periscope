export interface ConfigValues {
	allowedTribes?: number[];
	permitDurationMs?: number;
}

interface ConfigFormProps {
	templateId: string;
	values: ConfigValues;
	onChange: (values: ConfigValues) => void;
}

export function ConfigForm({ templateId, values, onChange }: ConfigFormProps) {
	if (templateId === "gate_tribe") {
		return <TribeGateConfig values={values} onChange={onChange} />;
	}

	return null;
}

function TribeGateConfig({
	values,
	onChange,
}: {
	values: ConfigValues;
	onChange: (v: ConfigValues) => void;
}) {
	const tribesText = (values.allowedTribes ?? []).join(", ");
	const durationMinutes = Math.round((values.permitDurationMs ?? 600_000) / 60_000);

	function handleTribesChange(text: string) {
		const tribes = text
			.split(/[,\s]+/)
			.map((s) => Number.parseInt(s.trim(), 10))
			.filter((n) => !Number.isNaN(n) && n > 0);
		onChange({ ...values, allowedTribes: tribes });
	}

	function handleDurationChange(minutes: number) {
		onChange({ ...values, permitDurationMs: minutes * 60_000 });
	}

	return (
		<div className="space-y-4">
			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">
					Allowed Tribe IDs
				</label>
				<input
					type="text"
					value={tribesText}
					onChange={(e) => handleTribesChange(e.target.value)}
					placeholder="e.g. 1, 2, 5"
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
				<p className="mt-1 text-xs text-zinc-600">
					Comma-separated tribe IDs that can use this gate
				</p>
			</div>

			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">
					Permit Duration: {durationMinutes} min
				</label>
				<input
					type="range"
					min={1}
					max={60}
					value={durationMinutes}
					onChange={(e) => handleDurationChange(Number(e.target.value))}
					className="w-full accent-cyan-500"
				/>
				<div className="mt-1 flex justify-between text-xs text-zinc-600">
					<span>1 min</span>
					<span>60 min</span>
				</div>
			</div>
		</div>
	);
}
