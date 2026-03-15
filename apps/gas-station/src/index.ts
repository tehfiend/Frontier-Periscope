import express from "express";
import cors from "cors";
import { PORT } from "./config";
import { buildAndPublishToken } from "./buildToken";
import { buildAndPublishTurret, buildGovernanceTurret } from "./buildTurret";
import { sponsorTransaction, getStationHealth } from "./sponsor";
import type { TurretPriorityConfig } from "@tehfrontier/chain-shared";

const app = express();
app.use(cors());
app.use(express.json());

// ── POST /build-turret ──────────────────────────────────────────────────────

app.post("/build-turret", async (req, res) => {
	try {
		const config = req.body as TurretPriorityConfig;

		// Basic validation
		if (typeof config.defaultWeight !== "number" || typeof config.kosWeight !== "number") {
			res.status(400).json({ error: "Invalid config: defaultWeight and kosWeight are required numbers" });
			return;
		}

		console.log("[build-turret] Building custom turret priority package...");
		const result = await buildAndPublishTurret(config);
		console.log(`[build-turret] Published package: ${result.packageId}`);

		res.json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("[build-turret] Error:", message);
		res.status(500).json({ error: message });
	}
});

// ── POST /build-governance-turret ────────────────────────────────────────────

app.post("/build-governance-turret", async (req, res) => {
	try {
		const { orgObjectId, mode, turretType, weightOverrides } = req.body as {
			orgObjectId: string;
			mode: "public" | "private";
			turretType?: string;
			weightOverrides?: Partial<TurretPriorityConfig>;
		};

		if (!orgObjectId || typeof orgObjectId !== "string") {
			res.status(400).json({ error: "orgObjectId is required" });
			return;
		}

		if (mode !== "public" && mode !== "private") {
			res.status(400).json({ error: "mode must be 'public' or 'private'" });
			return;
		}

		console.log(`[build-governance-turret] Building for org ${orgObjectId.slice(0, 10)}... (${mode} mode)`);
		const result = await buildGovernanceTurret(orgObjectId, mode, turretType, weightOverrides);
		console.log(`[build-governance-turret] Published package: ${result.packageId}`);

		res.json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("[build-governance-turret] Error:", message);
		res.status(500).json({ error: message });
	}
});

// ── POST /build-token ────────────────────────────────────────────────────

const SUI_ADDRESS_REGEX = /^0x[0-9a-fA-F]{64}$/;

app.post("/build-token", async (req, res) => {
	try {
		const { symbol, name, description, decimals, senderAddress } = req.body as {
			symbol: string;
			name: string;
			description: string;
			decimals: number;
			senderAddress: string;
		};

		// Validate symbol: 1-10 uppercase alphanumeric chars
		if (!symbol || typeof symbol !== "string" || !/^[A-Z0-9]+$/.test(symbol)) {
			res.status(400).json({
				error: "symbol must be 1-10 uppercase alphanumeric characters",
			});
			return;
		}
		if (symbol.length > 10) {
			res.status(400).json({
				error: "symbol must be 1-10 uppercase alphanumeric characters",
			});
			return;
		}

		// Validate name: 1-100 chars
		if (!name || typeof name !== "string" || name.length > 100) {
			res.status(400).json({ error: "name must be 1-100 characters" });
			return;
		}

		// Validate description
		if (typeof description !== "string") {
			res.status(400).json({ error: "description must be a string" });
			return;
		}

		// Validate decimals: 0-18
		if (typeof decimals !== "number" || !Number.isInteger(decimals)
			|| decimals < 0 || decimals > 18) {
			res.status(400).json({ error: "decimals must be an integer 0-18" });
			return;
		}

		// Validate senderAddress: 0x + 64 hex chars
		if (!senderAddress || !SUI_ADDRESS_REGEX.test(senderAddress)) {
			res.status(400).json({
				error: "senderAddress must be a valid Sui address (0x + 64 hex chars)",
			});
			return;
		}

		console.log(`[build-token] Building token ${symbol} for ${senderAddress.slice(0, 10)}...`);
		const result = await buildAndPublishToken({
			symbol,
			name,
			description,
			decimals,
			senderAddress,
		});
		console.log(`[build-token] Published package: ${result.packageId}`);

		res.json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("[build-token] Error:", message);
		res.status(500).json({ error: message });
	}
});

// ── POST /sponsor ───────────────────────────────────────────────────────────

app.post("/sponsor", async (req, res) => {
	try {
		const { txBytes } = req.body as { txBytes: string };

		if (!txBytes || typeof txBytes !== "string") {
			res.status(400).json({ error: "txBytes (base64 string) is required" });
			return;
		}

		console.log("[sponsor] Validating and co-signing transaction...");
		const result = await sponsorTransaction(txBytes);
		console.log("[sponsor] Transaction sponsored successfully");

		res.json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("[sponsor] Error:", message);
		res.status(403).json({ error: message });
	}
});

// ── GET /health ─────────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
	const health = await getStationHealth();
	res.json(health);
});

// ── Start Server ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
	console.log(`Gas Station listening on http://localhost:${PORT}`);
	console.log("Endpoints:");
	console.log("  POST /build-turret            — Build + publish custom turret priority");
	console.log("  POST /build-governance-turret  — Build turret from org membership data");
	console.log("  POST /build-token             — Build + publish custom token");
	console.log("  POST /sponsor                 — Co-sign sponsored transaction");
	console.log("  GET  /health                  — Station wallet balance & status");
});
