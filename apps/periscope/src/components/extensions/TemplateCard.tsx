import type { ExtensionTemplate, TenantId } from "@/chain/config";
import { Box, CheckCircle2, Crosshair, DoorOpen } from "lucide-react";

interface TemplateCardProps {
	template: ExtensionTemplate;
	tenant: TenantId;
	onClick?: () => void;
}

const typeIcons = {
	turret: Crosshair,
	gate: DoorOpen,
	storage_unit: Box,
	smart_storage_unit: Box,
	protocol_depot: Box,
};

export function TemplateCard({ template, tenant, onClick }: TemplateCardProps) {
	const isPublished = !!template.packageIds[tenant];
	const primaryType = template.assemblyTypes[0];
	const Icon = typeIcons[primaryType as keyof typeof typeIcons];

	return (
		<div
			className={`rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 ${
				onClick ? "cursor-pointer transition-colors hover:border-zinc-700 hover:bg-zinc-900" : ""
			}`}
			onClick={onClick}
		>
			<div className="flex items-start gap-3">
				{Icon && (
					<div className="rounded-lg bg-zinc-800 p-2">
						<Icon size={18} className="text-cyan-500" />
					</div>
				)}
				<div className="flex-1">
					<div className="flex items-center gap-2">
						<h4 className="text-sm font-medium text-zinc-200">{template.name}</h4>
						{isPublished && <CheckCircle2 size={12} className="text-green-500" />}
						{!isPublished && (
							<span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-400">
								Not published
							</span>
						)}
					</div>
					<p className="mt-1 text-xs text-zinc-500">{template.description}</p>
					{template.hasConfig && (
						<p className="mt-1.5 text-xs text-zinc-600">Requires configuration after deployment</p>
					)}
				</div>
			</div>
		</div>
	);
}
