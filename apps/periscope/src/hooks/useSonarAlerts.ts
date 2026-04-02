import { db } from "@/db";
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

export function useSonarAlerts() {
	const pingEventTypes = useSonarStore((s) => s.pingEventTypes);
	const pingAudioEnabled = useSonarStore((s) => s.pingAudioEnabled);
	const pingNotifyEnabled = useSonarStore((s) => s.pingNotifyEnabled);
	// Initialize HWM to -1 (sentinel) synchronously so we never alert
	// on events that arrive before the async DB query resolves
	const hwmRef = useRef<number>(-1);
	const audioRef = useRef<HTMLAudioElement | null>(null);

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

	// Pre-load the audio element
	useEffect(() => {
		if (pingAudioEnabled && !audioRef.current) {
			audioRef.current = new Audio("/sounds/alert.mp3");
			audioRef.current.volume = 0.3;
		}

		return () => {
			if (audioRef.current) {
				audioRef.current.pause();
				audioRef.current.src = "";
				audioRef.current = null;
			}
		};
	}, [pingAudioEnabled]);

	// Watch sonar events table for changes
	const latestEvents = useLiveQuery(
		() => db.sonarEvents.orderBy("id").reverse().limit(20).toArray(),
		[],
	);

	useEffect(() => {
		if (!latestEvents || latestEvents.length === 0) return;
		if (hwmRef.current === -1) return; // HWM not initialized from DB yet
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

		// Play audio alert
		if (pingAudioEnabled && audioRef.current) {
			audioRef.current.currentTime = 0;
			audioRef.current.play().catch(() => {
				// Audio play may fail if user hasn't interacted with the page yet.
				// Use shared Web Audio API fallback: generate a short beep.
				const ctx = getAudioContext();
				if (!ctx) return;
				try {
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();
					osc.connect(gain);
					gain.connect(ctx.destination);
					osc.frequency.value = 880;
					gain.gain.value = 0.15;
					osc.start();
					gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
					osc.stop(ctx.currentTime + 0.3);
				} catch {
					// Web Audio not available -- silently fail
				}
			});
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
	}, [latestEvents, pingEventTypes, pingAudioEnabled, pingNotifyEnabled]);
}
