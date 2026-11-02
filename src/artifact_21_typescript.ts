import http from "http";
import { Connection } from "@solana/web3.js";
import * as dotenv from "dotenv";

dotenv.config();

const port = process.env.PORT || 8080;
const connection = new Connection(
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  "confirmed"
);

const server = http.createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    try {
      const slot = await connection.getSlot();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          cluster: "solana",
          currentSlot: slot,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err: any) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "unhealthy",
          error: err.message,
        })
      );
    }
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

server.listen(port, () => {
  console.log(`[Healthcheck] Telemetry daemon running on port ${port}`);
});