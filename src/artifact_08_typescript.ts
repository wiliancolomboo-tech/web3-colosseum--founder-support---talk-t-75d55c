// File: src/server.ts
import http from "http";
import { Connection } from "@solana/web3.js";

const PORT = process.env.PORT || 8080;
const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com");

const server = http.createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    try {
      const version = await connection.getVersion();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "HEALTHY",
        solanaCore: version["solana-core"],
        timestamp: new Date().toISOString()
      }));
    } catch (e: any) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "UNHEALTHY", error: e.message }));
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[DAEMON] Discovery telemetry listening on port ${PORT}`);
});