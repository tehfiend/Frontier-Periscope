export default function HomePage() {
	return (
		<div className="space-y-6">
			<h1 className="text-3xl font-bold">TehFrontier</h1>
			<p className="text-muted-foreground">
				Governance, trading, and claims management for EVE Frontier.
			</p>
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
				<DashboardCard title="Governance" description="Organizations & proposals" href="/governance" />
				<DashboardCard title="Trading" description="Contracts & market data" href="/trading" />
				<DashboardCard title="Claims" description="Territory claims" href="/claims" />
				<DashboardCard title="Alliances" description="Agreements & diplomacy" href="/alliances" />
			</div>
		</div>
	);
}

function DashboardCard({
	title,
	description,
	href,
}: {
	title: string;
	description: string;
	href: string;
}) {
	return (
		<a
			href={href}
			className="rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary"
		>
			<h2 className="text-lg font-semibold">{title}</h2>
			<p className="mt-1 text-sm text-muted-foreground">{description}</p>
		</a>
	);
}
