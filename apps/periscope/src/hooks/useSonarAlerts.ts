import { db } from "@/db";
import type { SonarEvent } from "@/db/types";
import { useLogStore } from "@/stores/logStore";
import { useSonarStore } from "@/stores/sonarStore";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef } from "react";

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
	// Initialize HWM to -1 (sentinel) synchronously so we never alert
	// on events that arrive before the async DB query resolves
	const hwmRef = useRef<number>(-1);

	// Initialize high-water-mark from the max existing sonarEvents.id on mount
	// so we don't alert on historical events
	useEffect(() => {
		db.sonarEvents
			.orderBy("id")
			.reverse()
			.first()
			.then((latest) => {
				// Only update if still at sentinel -- don't regress if events arrived
				if (hwmRef.current === -1) {
					hwmRef.current = latest?.id ?? 0;
				}
			});
	}, []);

	// Watch sonar events table for changes
	const latestEvents = useLiveQuery(
		() => db.sonarEvents.orderBy("id").reverse().limit(20).toArray(),
		[],
	);

	useEffect(() => {
		if (!latestEvents || latestEvents.length === 0) return;
		if (hwmRef.current === -1) return; // HWM not initialized from DB yet
		if (reimporting) {
			// Suppress alerts during log reimport -- just advance the HWM
			const maxId = latestEvents.reduce((max, e) => Math.max(max, e.id ?? 0), 0);
			if (maxId > hwmRef.current) hwmRef.current = maxId;
			return;
		}
		if (pingEventTypes.size === 0) return;
		if (!pingAudioEnabled && !pingNotifyEnabled) return;

		const typeSet = new Set<string>(pingEventTypes);
		const newPings = latestEvents.filter(
			(e) => (e.id ?? 0) > (hwmRef.current ?? 0) && typeSet.has(e.eventType),
		);

		if (newPings.length === 0) return;

		// Update high-water-mark
		const maxId = latestEvents.reduce((max, e) => Math.max(max, e.id ?? 0), 0);
		hwmRef.current = maxId;

		// Play audio alert -- pick the highest-priority event for the sound
		if (pingAudioEnabled) {
			const priority = newPings.find((e) =>
				e.eventType === "combat_started" && e.details?.startsWith("Under attack"),
			) ?? newPings.find((e) => e.eventType === "cargo_full") ?? newPings[0];
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
	}, [latestEvents, pingEventTypes, pingAudioEnabled, pingNotifyEnabled, reimporting]);
}
