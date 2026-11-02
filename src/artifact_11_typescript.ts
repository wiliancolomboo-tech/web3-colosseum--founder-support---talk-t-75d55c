import express from "express";

const app = express();
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const slot = await connection.getSlot();
    return res.status(200).json({
      status: "healthy",
      solana_slot: slot,
      program_id: PROGRAM_ID.toBase58(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      status: "unhealthy",
      reason: (error as Error).message,
    });
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log(`[HEALTH] Healthcheck server live on port ${process.env.PORT || 8080}`);
});