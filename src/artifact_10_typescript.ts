import express, { Request, Response } from "express";
import { Connection } from "@solana/web3.js";

const app = express();
const PORT = process.env.PORT || 8080;
const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

let successfulAttestations = 0;

app.use(express.json());

app.get("/healthz", async (_req: Request, res: Response) => {
  try {
    const slot = await connection.getSlot();
    res.status(200).json({
      status: "HEALTHY",
      solanaSlot: slot,
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
      successfulAttestations,
    });
  } catch (err: any) {
    res.status(503).json({
      status: "UNHEALTHY",
      error: err.message,
    });
  }
});

app.get("/metrics", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/plain");
  res.send(`
# HELP founderpulse_attestations_total Total verified user interviews recorded
# TYPE founderpulse_attestations_total counter
founderpulse_attestations_total ${successfulAttestations}
# HELP founderpulse_uptime_seconds Process uptime in seconds
# TYPE founderpulse_uptime_seconds gauge
founderpulse_uptime_seconds ${process.uptime()}
  `);
});

app.listen(PORT, () => {
  console.log(`[FounderPulse Ops] Health & telemetry server live on port ${PORT}`);
});