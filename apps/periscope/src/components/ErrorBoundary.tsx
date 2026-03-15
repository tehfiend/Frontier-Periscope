import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	override componentDidCatch(error: Error, info: React.ErrorInfo) {
		console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
	}

	override render() {
		if (this.state.hasError) {
			return (
				<div className="flex h-full items-center justify-center p-8">
					<div className="max-w-md text-center">
						<AlertTriangle size={48} className="mx-auto mb-4 text-red-500" />
						<h2 className="text-lg font-bold text-zinc-100">Something went wrong</h2>
						<p className="mt-2 text-sm text-zinc-400">
							{this.state.error?.message ?? "An unexpected error occurred."}
						</p>
						<button
							type="button"
							onClick={() => this.setState({ hasError: false, error: null })}
							className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
						>
							<RefreshCw size={14} />
							Try Again
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
