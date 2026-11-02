import http from "http";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "HEALTHY",
        uptimeSeconds: process.uptime(),
        timestamp: new Date().toISOString(),
        solanaRpc: process.env.SOLANA_RPC_URL || "devnet",
        programId: "Co1osSEUM1111111111111111111111111111111111",
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, () => {
  console.log(`[+] Colosseum Founder Support Service listening on :${PORT}`);
  console.log(`[+] Healthcheck available at GET /health`);
});