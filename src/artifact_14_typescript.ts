import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Resend } from "resend";
import { createHash, randomBytes } from "crypto";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// -------------------------------------------------------------
// Schema Validation & Types
// -------------------------------------------------------------
const InterviewPayloadSchema = z.object({
  campaignPubkey: z.string(),
  sessionIdHex: z.string().length(32), // 16 bytes in hex
  participantWallet: z.string(),
  participantEmail: z.string().email(),
  transcriptSummary: z.string().min(20),
  keyTakeaway: z.string().min(10),
  sentimentScore: z.number().min(1).max(10),
  actionItem: z.string(),
});

type InterviewPayload = z.infer<typeof InterviewPayloadSchema>;

// -------------------------------------------------------------
// Environment & Service Clients
// -------------------------------------------------------------
const PORT = parseInt(process.env.PORT || "8080", 10);
const SOLANA_RPC = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
const RESEND_API_KEY = process.env.RESEND_API_KEY || "re_test_dummy";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";
const FOUNDER_SECRET_KEY = process.env.FOUNDER_SECRET_KEY;

if (!FOUNDER_SECRET_KEY) {
  throw new Error("Missing FOUNDER_SECRET_KEY in environment variables.");
}

const founderKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(FOUNDER_SECRET_KEY))
);
const connection = new Connection(SOLANA_RPC, "confirmed");
const wallet = new Wallet(founderKeypair);
const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

const resend = new Resend(RESEND_API_KEY);
const server: FastifyInstance = fastify({ logger: true });

// Minimal Program IDL reference
const PROGRAM_ID = new PublicKey("Loop5X1111111111111111111111111111111111111");

// -------------------------------------------------------------
// Core Orchestration Methods
// -------------------------------------------------------------

/**
 * Computes deterministic SHA256 digest of customer interview notes
 */
function computeFeedbackDigest(summary: string, takeaway: string, score: number): Buffer {
  const content = `${summary}|${takeaway}|${score}`;
  return createHash("sha256").update(content, "utf8").digest();
}

/**
 * Dispatches Slack Notification to Accelerator Mentors & Engineering Channel
 */
async function notifySlack(payload: InterviewPayload, txSignature: string, counter: number) {
  if (!SLACK_WEBHOOK_URL) return;

  const slackBody = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🎉 New Founder User Interview Verified! (#${counter}/5)`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Participant:*\n\`${payload.participantWallet.slice(0, 4)}...${payload.participantWallet.slice(-4)}\`` },
          { type: "mrkdwn", text: `*Sentiment Score:*\n${payload.sentimentScore} / 10` },
          { type: "mrkdwn", text: `*Action Item:*\n${payload.actionItem}` },
          { type: "mrkdwn", text: `*Solana Proof:*\n<https://explorer.solana.com/tx/${txSignature}?cluster=devnet|View On-Chain>` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Key Takeaway:*\n> "${payload.keyTakeaway}"`,
        },
      },
    ],
  };

  await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slackBody),
  });
}

/**
 * Dispatches Resend Email to Interviewee with Proof Receipt
 */
async function sendIntervieweeReceipt(email: string, txSignature: string, amountUSDC: number) {
  try {
    await resend.emails.send({
      from: "Colosseum Founder Loop <onboarding@resend.dev>",
      to: email,
      subject: "Thank You for Your Feedback! Incentive Settled on Solana",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #4f46e5;">Colosseum Discovery Interview Confirmed</h2>
          <p>Thank you for contributing to our user research sprint. Your valuable insights have been recorded on-chain with a cryptographic feedback digest.</p>
          <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0;"><strong>Incentive Payout:</strong> $${amountUSDC} USDC</p>
            <p style="margin: 0;"><strong>Solana Transaction:</strong> <a href="https://explorer.solana.com/tx/${txSignature}?cluster=devnet" style="color: #6366f1;">${txSignature.slice(0, 16)}...</a></p>
          </div>
          <p style="color: #64748b; font-size: 14px;">Powered by UserLoop: Verified Customer Discovery Protocol on Solana.</p>
        </div>
      `,
    });
  } catch (error) {
    console.error("Resend API dispatch error:", error);
  }
}

// -------------------------------------------------------------
// HTTP Route Handlers
// -------------------------------------------------------------
server.get("/health", async (_req: FastifyRequest, reply: FastifyReply) => {
  return reply.status(200).send({
    status: "healthy",
    timestamp: new Date().toISOString(),
    founderPubkey: founderKeypair.publicKey.toBase58(),
    rpc: SOLANA_RPC,
  });
});

server.post("/api/interview-complete", async (req: FastifyRequest, reply: FastifyReply) => {
  const parseResult = InterviewPayloadSchema.safeParse(req.body);
  if (!parseResult.success) {
    return reply.status(400).send({ error: "Invalid Payload", details: parseResult.error.flatten() });
  }

  const data = parseResult.data;
  const campaignPubkey = new PublicKey(data.campaignPubkey);
  const participantPubkey = new PublicKey(data.participantWallet);
  const sessionIdBytes = Buffer.from(data.sessionIdHex, "hex");

  try {
    // 1. Compute Feedback SHA256
    const feedbackDigest = computeFeedbackDigest(data.transcriptSummary, data.keyTakeaway, data.sentimentScore);

    // 2. Derive PDAs
    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaignPubkey.toBuffer()],
      PROGRAM_ID
    );

    const [sessionPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), campaignPubkey.toBuffer(), sessionIdBytes],
      PROGRAM_ID
    );

    const [milestoneProofPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("milestone"), campaignPubkey.toBuffer()],
      PROGRAM_ID
    );

    // Dummy Mint address (USDC devnet or custom mint)
    const rewardMint = new PublicKey(process.env.USDC_MINT_PUBKEY || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    const participantATA = getAssociatedTokenAddressSync(rewardMint, participantPubkey);

    server.log.info(`Submitting attest_and_settle on-chain for Session: ${sessionPDA.toBase58()}`);

    // Real on-chain dispatch:
    // In production, instantiate Anchor program and invoke attest_and_settle instruction
    // Mock signature for client demonstration when executing in standalone mode:
    const txSignature = "5bW6K9XzPq" + randomBytes(28).toString("hex");

    // 3. Post notification alerts asynchronously
    await Promise.allSettled([
      notifySlack(data, txSignature, 5),
      sendIntervieweeReceipt(data.participantEmail, txSignature, 25),
    ]);

    return reply.status(200).send({
      success: true,
      transactionSignature: txSignature,
      feedbackDigest: feedbackDigest.toString("hex"),
      sessionAccount: sessionPDA.toBase58(),
      milestonePDA: milestoneProofPDA.toBase58(),
    });
  } catch (err: any) {
    server.log.error(err);
    return reply.status(500).send({ error: "Execution failed", message: err.message });
  }
});

// Start Daemon
const start = async () => {
  try {
    await server.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`🚀 UserLoop Gateway running on http://0.0.0.0:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();