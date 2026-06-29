import { db } from "@/db";
import type { SonarEvent } from "@/db/types";
import { useLogStore } from "@/stores/logStore";
import { useSonarStore } from "@/stores/sonarStore";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

/**
 * Watches for new sonar events matching the user's ping preferences and
 * fires audio alerts and/or desktop notifications.
 *
 * Should be called once at the Layout level so alerts work on all pages.
 * Uses a high-water-mark (max sonarEvents.id) to avoid alerting on
 * historical events loaded at startup.
 */
/** Module-level AudioContext reused across all alert beeps (ISSUE-07 fix). */
let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
	try {
		if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
			sharedAudioCtx = new AudioContext();
		}
		return sharedAudioCtx;
	} catch {
		return null;
	}
}

/** Play a synthesized alert tone matched to the event type. */
function playEventSound(event: SonarEvent): void {
	const ctx = getAudioContext();
	if (!ctx) return;

	try {
		if (event.eventType === "cargo_full") {
			// Urgent descending two-tone warning
			playTone(ctx, 1200, 0.18, 0.15);
			setTimeout(() => playTone(ctx, 800, 0.18, 0.25), 200);
			setTimeout(() => playTone(ctx, 1200, 0.18, 0.15), 450);
			setTimeout(() => playTone(ctx, 800, 0.18, 0.25), 650);
		} else if (
			event.eventType === "combat_started" &&
			event.details?.startsWith("Under attack")
		) {
			// Rapid threat pulse (3 fast high-pitched beeps + rising tone)
			playTone(ctx, 1400, 0.08, 0.2);
			setTimeout(() => playTone(ctx, 1400, 0.08, 0.2), 120);
			setTimeout(() => playTone(ctx, 1400, 0.08, 0.2), 240);
			setTimeout(() => playTone(ctx, 1800, 0.15, 0.2), 400);
		} else {
			// Default single beep
			playTone(ctx, 880, 0.15, 0.3);
		}
	} catch {
		// Web Audio not available
	}
}

function playTone(ctx: AudioContext, freq: number, vol: number, duration: number): void {
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.frequency.value = freq;
	gain.gain.value = vol;
	osc.start();
	gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
	osc.stop(ctx.currentTime + duration);
}

export function useSonarAlerts() {
	const pingEventTypes = useSonarStore((s) => s.pingEventTypes);
	const pingAudioEnabled = useSonarStore((s) => s.pingAudioEnabled);
	const pingNotifyEnabled = useSonarStore((s) => s.pingNotifyEnabled);
	const reimporting = useLogStore((s) => s.reimporting);
	// High-water mark: null until initialized from the DB, so we never alert on the historical
	// events present at mount.
	const [hwm, setHwm] = useState<number | null>(null);

	// Initialize the HWM from the max existing sonarEvents.id on mount.
	useEffect(() => {
		db.sonarEvents
			.orderBy("id")
			.reverse()
			.first()
			.then((latest) => setHwm((prev) => (prev == null ? (latest?.id ?? 0) : prev)));
	}, []);

	// All sonar events above the HWM. Mirrors useLocalSonar's above(hwm) rather than a fixed
	// limit(20): a burst poll that bulk-adds many events at once must not silently drop the older
	// pings. While hwm is null the query yields nothing; the [hwm] dependency re-subscribes once
	// it initializes and again each time the HWM advances.
	const newEvents = useLiveQuery(
		() =>
			hwm == null
				? Promise.resolve([] as SonarEvent[])
				: db.sonarEvents.where("id").above(hwm).toArray(),
		[hwm],
	);

	useEffect(() => {
		if (hwm == null || !newEvents || newEvents.length === 0) return;
		// Re-filter defensively: after we advance the HWM this effect re-runs once with the
		// still-stale newEvents before the query re-resolves -- dropping already-counted events
		// here prevents double-alerting.
		const fresh = newEvents.filter((e) => (e.id ?? 0) > hwm);
		if (fresh.length === 0) return;

		// Always advance the HWM so processed events are never reconsidered, even when alerting
		// is suppressed (reimport) or disabled.
		const maxId = fresh.reduce((max, e) => Math.max(max, e.id ?? 0), 0);
		setHwm(maxId);

		if (reimporting) return; // Suppress alerts during log reimport
		if (pingEventTypes.size === 0) return;
		if (!pingAudioEnabled && !pingNotifyEnabled) return;

		// Sort newest-first: above(hwm) returns ascending, but the audio-priority fallback and the
		// slice(0,3) notification cap should surface the most recent pings (the old limit(20) query
		// was newest-first).
		const newPings = fresh
			.filter((e) => pingEventTypes.has(e.eventType))
			.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
		if (newPings.length === 0) return;

		// Play audio alert -- pick the highest-priority event for the sound
		if (pingAudioEnabled) {
			const priority =
				newPings.find(
					(e) => e.eventType === "combat_started" && e.details?.startsWith("Under attack"),
				) ??
				newPings.find((e) => e.eventType === "cargo_full") ??
				newPings[0];
			playEventSound(priority);
		}

		// Desktop notification
		if (pingNotifyEnabled && Notification.permission === "granted") {
			for (const ping of newPings.slice(0, 3)) {
				const title = `Sonar: ${ping.eventType.replace(/_/g, " ")}`;
				const body = ping.details ?? ping.typeName ?? ping.systemName ?? "";
				new Notification(title, {
					body: body || undefined,
					icon: "/favicon.ico",
					tag: `sonar-${ping.id}`,
				});
			}
		}
	}, [newEvents, hwm, pingEventTypes, pingAudioEnabled, pingNotifyEnabled, reimporting]);
}
