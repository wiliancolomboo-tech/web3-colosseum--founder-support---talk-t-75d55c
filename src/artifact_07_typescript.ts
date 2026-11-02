import fastify from "fastify";
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import { UserLoopEnterpriseClient } from "./userloop-client";

const server = fastify({ logger: true });

const RPC_URL = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const FOUNDER_KEYPAIR_PATH = process.env.FOUNDER_KEYPAIR_PATH || "./founder-keypair.json";

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

// Health check endpoint
server.get("/health", async (request, reply) => {
  return { status: "HEALTHY", uptime: process.uptime(), timestamp: Date.now() };
});

// Cal.com / Booking Completed Webhook
server.post("/api/v1/webhook/interview-completed", async (request, reply) => {
  try {
    const body = request.body as any;
    const { userPubkeySecret, transcript, npsScore, durationMinutes, userEmail } = body;

    if (!userPubkeySecret || !transcript || !npsScore) {
      return reply.code(400).send({ error: "Missing required fields in payload." });
    }

    const founderKeypair = loadKeypair(FOUNDER_KEYPAIR_PATH);
    const userKeypair = Keypair.fromSecretKey(Uint8Array.from(userPubkeySecret));

    const client = new UserLoopEnterpriseClient(RPC_URL, RESEND_API_KEY, SLACK_WEBHOOK_URL);
    const receipt = await client.recordInterview(
      founderKeypair,
      userKeypair,
      transcript,
      Number(npsScore),
      Number(durationMinutes || 30),
      userEmail || "user@colosseum.org"
    );

    return reply.code(200).send({
      success: true,
      data: receipt,
    });
  } catch (error: any) {
    server.log.error(error);
    return reply.code(500).send({ success: false, error: error.message });
  }
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 8080;
    await server.listen({ port, host: "0.0.0.0" });
    console.log(`[UserLoop Worker] Service listening on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();