import http from "http";

export function launchTelemetryServer(port: number = 8080) {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "healthy",
        service: "Colosseum UserLoop Attestation Pipeline",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    console.log(`[TELEMETRY] Healthcheck live at http://0.0.0.0:${port}/health`);
  });
}