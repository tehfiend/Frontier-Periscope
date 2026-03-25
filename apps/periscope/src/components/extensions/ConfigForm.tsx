export interface ConfigValues {
	// Standings-based gate config
	registryId?: string;
	minAccess?: number;
	freeAccess?: number;
	tollFee?: string;
	tollRecipient?: string;
	// Standings-based SSU config
	minDeposit?: number;
	minWithdraw?: number;
	marketId?: string;
	// Standings-based turret config
	standingWeights?: Record<number, number>;
	aggressorBonus?: number;
}

interface ConfigFormProps {
	templateId: string;
	values: ConfigValues;
	onChange: (values: ConfigValues) => void;
}

export function ConfigForm({ templateId, values: _values, onChange: _onChange }: ConfigFormProps) {
	// Standings-based configs are now handled by StandingsExtensionPanel
	// Show a hint for templates that use the new system
	if (
		templateId === "gate_standings" ||
		templateId === "ssu_unified" ||
		templateId === "turret_standings"
	) {
		return (
			<p className="text-xs text-zinc-500">
				Configuration is handled via the Standings Extension Panel after authorization.
			</p>
		);
	}

	return null;
}
