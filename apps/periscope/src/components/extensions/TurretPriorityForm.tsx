import {
	SHIP_CLASSES,
	TURRET_TYPES,
	DEFAULT_TURRET_PRIORITY_CONFIG,
	type TurretPriorityConfig,
} from "@tehfrontier/chain-shared";

interface TurretPriorityFormProps {
	config: TurretPriorityConfig;
	onChange: (config: TurretPriorityConfig) => void;
	turretTypeId?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseIdList(text: string): number[] {
	return text
		.split(/[,\s]+/)
		.map((s) => Number.parseInt(s.trim(), 10))
		.filter((n) => !Number.isNaN(n) && n > 0);
}

function idListToText(ids: number[]): string {
	return ids.filter((n) => n > 0).join(", ");
}

function getTurretTypeByTypeId(typeId: number) {
	return Object.values(TURRET_TYPES).find((t) => t.typeId === typeId);
}

// ── Component ───────────────────────────────────────────────────────────────

export function TurretPriorityForm({ config, onChange, turretTypeId }: TurretPriorityFormProps) {
	const turretType = turretTypeId ? getTurretTypeByTypeId(turretTypeId) : undefined;

	function update(partial: Partial<TurretPriorityConfig>) {
		onChange({ ...config, ...partial });
	}

	function toggleEffectiveClass(groupId: number) {
		const current = config.effectiveClasses;
		const next = current.includes(groupId)
			? current.filter((id) => id !== groupId)
			: [...current, groupId];
		update({ effectiveClasses: next });
	}

	return (
		<div className="space-y-6">
			{/* Targeting Weights */}
			<section>
				<h4 className="mb-3 text-sm font-medium text-zinc-300">Targeting Weights</h4>
				<div className="space-y-3">
					<WeightSlider
						label="Default Weight"
						value={config.defaultWeight}
						onChange={(v) => update({ defaultWeight: v })}
						max={200}
						help="Base priority for unlisted targets"
					/>
					<WeightSlider
						label="KOS Weight"
						value={config.kosWeight}
						onChange={(v) => update({ kosWeight: v })}
						max={200}
						help="Priority for kill-on-sight targets"
					/>
					<WeightSlider
						label="Aggressor Bonus"
						value={config.aggressorBonus}
						onChange={(v) => update({ aggressorBonus: v })}
						max={100}
						help="Added when target is actively attacking"
					/>
					<WeightSlider
						label="Betrayal Bonus"
						value={config.betrayalBonus}
						onChange={(v) => update({ betrayalBonus: v })}
						max={100}
						help="Added when a friendly is attacking (traitor)"
					/>
					<WeightSlider
						label="Low HP Bonus"
						value={config.lowHpBonus}
						onChange={(v) => update({ lowHpBonus: v })}
						max={100}
						help="Added when target HP is below threshold (disabled in v0.0.18)"
						disabled
					/>
					<WeightSlider
						label="Low HP Threshold"
						value={config.lowHpThreshold}
						onChange={(v) => update({ lowHpThreshold: v })}
						max={100}
						help="HP percentage threshold for low HP bonus"
						disabled
					/>
					<WeightSlider
						label="Class Bonus"
						value={config.classBonus}
						onChange={(v) => update({ classBonus: v })}
						max={100}
						help="Added for effective ship class match"
					/>
				</div>
			</section>

			{/* Friendly Lists */}
			<section>
				<h4 className="mb-3 text-sm font-medium text-zinc-300">Friendly Lists</h4>
				<p className="mb-3 text-xs text-zinc-500">
					Friendly targets get weight 0 (never shot) unless they attack, triggering betrayal priority.
				</p>
				<div className="space-y-3">
					<IdListInput
						label="Friendly Tribe IDs"
						value={idListToText(config.friendlyTribes)}
						onChange={(text) => update({ friendlyTribes: parseIdList(text) })}
						placeholder="e.g. 1, 2, 5"
						help="Up to 8 tribe IDs"
						maxItems={8}
					/>
					<IdListInput
						label="Friendly Character IDs"
						value={idListToText(config.friendlyCharacters)}
						onChange={(text) => update({ friendlyCharacters: parseIdList(text) })}
						placeholder="e.g. 2112077599"
						help="Up to 8 character IDs"
						maxItems={8}
					/>
				</div>
			</section>

			{/* KOS Lists */}
			<section>
				<h4 className="mb-3 text-sm font-medium text-zinc-300">Kill on Sight</h4>
				<p className="mb-3 text-xs text-zinc-500">
					KOS targets always receive high priority ({config.kosWeight} weight).
				</p>
				<div className="space-y-3">
					<IdListInput
						label="KOS Tribe IDs"
						value={idListToText(config.kosTribes)}
						onChange={(text) => update({ kosTribes: parseIdList(text) })}
						placeholder="e.g. 3, 7"
						help="Up to 4 tribe IDs"
						maxItems={4}
					/>
					<IdListInput
						label="KOS Character IDs"
						value={idListToText(config.kosCharacters)}
						onChange={(text) => update({ kosCharacters: parseIdList(text) })}
						placeholder="e.g. 2112000710"
						help="Up to 4 character IDs"
						maxItems={4}
					/>
				</div>
			</section>

			{/* Effective Ship Classes */}
			<section>
				<h4 className="mb-3 text-sm font-medium text-zinc-300">Effective Ship Classes</h4>
				{turretType && (
					<p className="mb-3 text-xs text-cyan-400">
						Auto-detected: {turretType.label} is effective vs {turretType.effective.join(", ")}
					</p>
				)}
				<div className="grid grid-cols-2 gap-2">
					{Object.entries(SHIP_CLASSES).map(([key, { groupId, label }]) => {
						const isEffective = (turretType?.effective as readonly string[] | undefined)?.includes(key);
						return (
							<label
								key={key}
								className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
									config.effectiveClasses.includes(groupId)
										? "border-cyan-700 bg-cyan-900/20 text-cyan-300"
										: "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600"
								}`}
							>
								<input
									type="checkbox"
									checked={config.effectiveClasses.includes(groupId)}
									onChange={() => toggleEffectiveClass(groupId)}
									className="accent-cyan-500"
								/>
								<span>{label}</span>
								{isEffective && (
									<span className="ml-auto text-xs text-cyan-500">recommended</span>
								)}
							</label>
						);
					})}
				</div>
			</section>

			{/* Preview */}
			<section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
				<h4 className="mb-2 text-sm font-medium text-zinc-300">Targeting Summary</h4>
				<ul className="space-y-1 text-xs text-zinc-400">
					<li>
						Friendly ({config.friendlyTribes.filter((n) => n > 0).length} tribes, {config.friendlyCharacters.filter((n) => n > 0).length} chars) &rarr; weight 0 (safe)
					</li>
					<li>
						Betrayal (friendly attacking) &rarr; weight {config.kosWeight + config.aggressorBonus + config.betrayalBonus} (max priority)
					</li>
					<li>
						KOS ({config.kosTribes.filter((n) => n > 0).length} tribes, {config.kosCharacters.filter((n) => n > 0).length} chars) &rarr; weight {config.kosWeight}
					</li>
					<li>Aggressor bonus &rarr; +{config.aggressorBonus}</li>
					<li>
						Effective class ({config.effectiveClasses.length} classes) &rarr; +{config.classBonus}
					</li>
					<li>Default &rarr; weight {config.defaultWeight}</li>
				</ul>
			</section>
		</div>
	);
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function WeightSlider({
	label,
	value,
	onChange,
	max,
	help,
	disabled,
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
	max: number;
	help: string;
	disabled?: boolean;
}) {
	return (
		<div className={disabled ? "opacity-50" : ""}>
			<div className="mb-1 flex items-center justify-between">
				<label className="text-xs font-medium text-zinc-400">{label}</label>
				<span className="font-mono text-xs text-zinc-500">{value}</span>
			</div>
			<input
				type="range"
				min={0}
				max={max}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="w-full accent-cyan-500"
				disabled={disabled}
			/>
			<p className="mt-0.5 text-xs text-zinc-600">{help}</p>
		</div>
	);
}

function IdListInput({
	label,
	value,
	onChange,
	placeholder,
	help,
	maxItems,
}: {
	label: string;
	value: string;
	onChange: (text: string) => void;
	placeholder: string;
	help: string;
	maxItems: number;
}) {
	const count = value ? parseIdList(value).length : 0;
	const overLimit = count > maxItems;

	return (
		<div>
			<div className="mb-1 flex items-center justify-between">
				<label className="text-xs font-medium text-zinc-400">{label}</label>
				<span className={`text-xs ${overLimit ? "text-red-400" : "text-zinc-600"}`}>
					{count}/{maxItems}
				</span>
			</div>
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className={`w-full rounded border bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${
					overLimit
						? "border-red-700 focus:border-red-500"
						: "border-zinc-700 focus:border-cyan-500"
				}`}
			/>
			<p className="mt-0.5 text-xs text-zinc-600">{help}</p>
		</div>
	);
}
