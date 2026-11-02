import * as http from "http";
import { Connection } from "@solana/web3.js";
import { CONFIG } from "./config";

const connection = new Connection(CONFIG.solanaRpcUrl, "confirmed");

const server = http.createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    try {
      const slot = await connection.getSlot();
      const version = await connection.getVersion();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          clusterSlot: slot,
          solanaCoreVersion: version["solana-core"],
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err: any) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "unhealthy", error: err.message }));
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(8080, () => {
  console.log("[Healthcheck] Monitoring endpoint listening on :8080/health");
});