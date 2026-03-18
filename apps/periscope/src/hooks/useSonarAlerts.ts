import { useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { useSonarStore } from "@/stores/sonarStore";

/**
 * Watches for new sonar events matching the user's ping preferences and
 * fires audio alerts and/or desktop notifications.
 *
 * Should be called once at the Layout level so alerts work on all pages.
 * Uses a high-water-mark (max sonarEvents.id) to avoid alerting on
 * historical events loaded at startup.
 */
export function useSonarAlerts() {
	const pingEventTypes = useSonarStore((s) => s.pingEventTypes);
	const pingAudioEnabled = useSonarStore((s) => s.pingAudioEnabled);
	const pingNotifyEnabled = useSonarStore((s) => s.pingNotifyEnabled);
	const hwmRef = useRef<number | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);

	// Initialize high-water-mark from the max existing sonarEvents.id on mount
	// so we don't alert on historical events
	useEffect(() => {
		db.sonarEvents
			.orderBy("id")
			.reverse()
			.first()
			.then((latest) => {
				hwmRef.current = latest?.id ?? 0;
			});
	}, []);

	// Pre-load the audio element
	useEffect(() => {
		if (pingAudioEnabled && !audioRef.current) {
			audioRef.current = new Audio("/sounds/alert.mp3");
			audioRef.current.volume = 0.3;
		}
	}, [pingAudioEnabled]);

	// Watch sonar events table for changes
	const latestEvents = useLiveQuery(
		() => db.sonarEvents.orderBy("id").reverse().limit(20).toArray(),
		[],
	);

	useEffect(() => {
		if (!latestEvents || latestEvents.length === 0) return;
		if (hwmRef.current === null) return; // Not initialized yet
		if (pingEventTypes.length === 0) return;
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
				// Use Web Audio API fallback: generate a short beep.
				try {
					const ctx = new AudioContext();
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
					// Web Audio not available either -- silently fail
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
