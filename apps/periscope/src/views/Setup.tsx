import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppStore } from "@/stores/appStore";
import { AddCharacterDialog } from "@/components/AddCharacterDialog";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { Telescope, UserPlus } from "lucide-react";

export function Setup() {
	const navigate = useNavigate();
	const setProfileConfigured = useAppStore((s) => s.setProfileConfigured);
	const { allCharacters } = useActiveCharacter();
	const [dialogOpen, setDialogOpen] = useState(false);

	function handleContinue() {
		if (allCharacters.length > 0) {
			setProfileConfigured(true);
			navigate({ to: "/sonar" });
		}
	}

	function handleSkip() {
		setProfileConfigured(true);
		navigate({ to: "/sonar" });
	}

	return (
		<div className="flex h-full items-center justify-center">
			<div className="w-full max-w-md space-y-8 px-6">
				<div className="flex flex-col items-center gap-4 text-center">
					<Telescope className="h-16 w-16 text-cyan-500" />
					<h1 className="text-3xl font-bold text-zinc-100">Frontier Periscope</h1>
					<p className="text-sm text-zinc-400">
						Privacy-first intel management for EVE Frontier.
						<br />
						All data stays in your browser.
					</p>
				</div>

				{/* Add Character */}
				<div className="space-y-3">
					<button
						type="button"
						onClick={() => setDialogOpen(true)}
						className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 py-3 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
					>
						<UserPlus size={16} />
						Add Character
					</button>
					<p className="text-center text-xs text-zinc-600">
						Add characters via wallet, game logs, chain search, or manually
					</p>
				</div>

				{/* Show added characters */}
				{allCharacters.length > 0 && (
					<div className="space-y-2">
						<h3 className="text-sm font-medium text-zinc-400">
							{allCharacters.length} character{allCharacters.length > 1 ? "s" : ""} added
						</h3>
						{allCharacters.map((c) => (
							<div
								key={c.id}
								className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2"
							>
								<span className="text-sm text-zinc-200">{c.characterName}</span>
								<div className="flex items-center gap-2 text-xs text-zinc-600">
									{c.source && <span className="capitalize">{c.source}</span>}
									{c.characterId && <span>ID: {c.characterId}</span>}
								</div>
							</div>
						))}
						<div className="flex gap-3 pt-2">
							<button
								type="button"
								onClick={handleContinue}
								className="flex-1 rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
							>
								Continue to Dashboard
							</button>
							<button
								type="button"
								onClick={() => setDialogOpen(true)}
								className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
							>
								Add More
							</button>
						</div>
					</div>
				)}

				{allCharacters.length === 0 && (
					<button
						type="button"
						onClick={handleSkip}
						className="w-full rounded-lg py-2 text-sm text-zinc-600 transition-colors hover:text-zinc-400"
					>
						Skip for now
					</button>
				)}
			</div>

			<AddCharacterDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
		</div>
	);
}
