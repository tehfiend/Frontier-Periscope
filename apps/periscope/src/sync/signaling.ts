// Offer/answer blob codec for serverless WebRTC signaling
// Bundles SDP + ICE candidates into a single base64 string for copy-paste pairing

import type { TrustTier } from "./types";

const ICE_GATHER_TIMEOUT = 5000;

interface SignalingBlob {
	v: 1;
	type: "offer" | "answer";
	sdp: string;
	candidates: RTCIceCandidateInit[];
	instanceId: string;
	instanceName: string;
	trustTier: TrustTier;
	characterName?: string;
	timestamp: number;
}

function encode(blob: SignalingBlob): string {
	const json = JSON.stringify(blob);
	return btoa(unescape(encodeURIComponent(json)));
}

function decode(encoded: string): SignalingBlob {
	const json = decodeURIComponent(escape(atob(encoded)));
	const blob = JSON.parse(json) as SignalingBlob;
	if (blob.v !== 1) throw new Error(`Unsupported signaling version: ${blob.v}`);
	return blob;
}

/** Wait for ICE gathering to complete, collecting all candidates */
async function gatherCandidates(pc: RTCPeerConnection): Promise<RTCIceCandidateInit[]> {
	const candidates: RTCIceCandidateInit[] = [];

	if (pc.iceGatheringState === "complete") return candidates;

	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			pc.onicecandidate = null;
			resolve(candidates);
		}, ICE_GATHER_TIMEOUT);

		pc.onicecandidate = (event) => {
			if (event.candidate) {
				candidates.push(event.candidate.toJSON());
			} else {
				clearTimeout(timeout);
				pc.onicecandidate = null;
				resolve(candidates);
			}
		};
	});
}

/** Create an offer blob from an RTCPeerConnection */
export async function createOfferBlob(
	pc: RTCPeerConnection,
	meta: { instanceId: string; instanceName: string; trustTier: TrustTier; characterName?: string },
): Promise<string> {
	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);
	const candidates = await gatherCandidates(pc);

	return encode({
		v: 1,
		type: "offer",
		sdp: pc.localDescription!.sdp,
		candidates,
		instanceId: meta.instanceId,
		instanceName: meta.instanceName,
		trustTier: meta.trustTier,
		characterName: meta.characterName,
		timestamp: Date.now(),
	});
}

/** Parse an offer blob */
export async function parseOfferBlob(encoded: string): Promise<{
	sdp: string;
	candidates: RTCIceCandidateInit[];
	instanceId: string;
	instanceName: string;
	trustTier: TrustTier;
	characterName?: string;
}> {
	const blob = decode(encoded);
	if (blob.type !== "offer") throw new Error(`Expected offer, got ${blob.type}`);
	return blob;
}

/** Create an answer blob from an RTCPeerConnection */
export async function createAnswerBlob(
	pc: RTCPeerConnection,
	meta: { instanceId: string; instanceName: string; trustTier: TrustTier; characterName?: string },
): Promise<string> {
	const answer = await pc.createAnswer();
	await pc.setLocalDescription(answer);
	const candidates = await gatherCandidates(pc);

	return encode({
		v: 1,
		type: "answer",
		sdp: pc.localDescription!.sdp,
		candidates,
		instanceId: meta.instanceId,
		instanceName: meta.instanceName,
		trustTier: meta.trustTier,
		characterName: meta.characterName,
		timestamp: Date.now(),
	});
}

/** Parse an answer blob */
export async function parseAnswerBlob(encoded: string): Promise<{
	sdp: string;
	candidates: RTCIceCandidateInit[];
	instanceId: string;
	instanceName: string;
	trustTier: TrustTier;
	characterName?: string;
}> {
	const blob = decode(encoded);
	if (blob.type !== "answer") throw new Error(`Expected answer, got ${blob.type}`);
	return blob;
}
