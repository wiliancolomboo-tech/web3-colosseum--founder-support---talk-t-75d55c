import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, Idl, BN } from "@coral-xyz/anchor";
import * as crypto from "crypto";
import axios from "axios";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

// Configuration & Environment Variables
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "Loopx5v111111111111111111111111111111111111");
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MENTOR_RECIPIENT_EMAIL = process.env.MENTOR_RECIPIENT_EMAIL || "mentors@colosseum.org";

const resend = new Resend(RESEND_API_KEY);

export interface InterviewSubmissionPayload {
  projectName: string;
  slotIndex: number;
  founderSecretKey: Uint8Array;
  intervieweePublicKey: string;
  transcriptRawText: string;
  satisfactionScore: number;
  topFeedbackPoints: string[];
}

export class UserLoopEnterpriseEngine {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(SOLANA_RPC_URL, "confirmed");
  }

  /**
   * Calculates deterministic SHA-256 digest buffer from raw interview transcript
   */
  public hashTranscript(transcript: string): Buffer {
    return crypto.createHash("sha256").update(transcript, "utf8").digest();
  }

  /**
   * Executes Anchor On-chain Attestation and Escrow Disbursement
   */
  public async attestSessionOnChain(payload: InterviewSubmissionPayload): Promise<string> {
    const founderKeypair = Keypair.fromSecretKey(payload.founderSecretKey);
    const wallet = new Wallet(founderKeypair);
    const provider = new AnchorProvider(this.connection, wallet, { commitment: "confirmed" });

    // Derive PDAs
    const [campaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), founderKeypair.publicKey.toBuffer()],
      PROGRAM_ID
    );

    const [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), campaignPda.toBuffer(), Buffer.from([payload.slotIndex])],
      PROGRAM_ID
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), founderKeypair.publicKey.toBuffer()],
      PROGRAM_ID
    );

    const transcriptHash = this.hashTranscript(payload.transcriptRawText);
    const intervieweePubkey = new PublicKey(payload.intervieweePublicKey);

    console.log(`[Attestation] Processing Slot ${payload.slotIndex} for Campaign ${campaignPda.toBase58()}`);

    // Build Instruction dynamically using Anchor IDL serialization
    // In production, instantiate `new Program(idl, provider)`
    const instructionData = Buffer.concat([
      // Anchor discriminator for "complete_interview": [93, 204, 18, 12, 191, 153, 111, 235]
      Buffer.from([93, 204, 18, 12, 191, 153, 111, 235]),
      transcriptHash,
      Buffer.from([payload.satisfactionScore]),
    ]);

    const tx = new Transaction().add({
      keys: [
        { pubkey: campaignPda, isSigner: false, isWritable: true },
        { pubkey: sessionPda, isSigner: false, isWritable: true },
        { pubkey: intervieweePubkey, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: founderKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // SystemProgram
      ],
      programId: PROGRAM_ID,
      data: instructionData,
    });

    const txSignature = await sendAndConfirmTransaction(this.connection, tx, [founderKeypair]);
    console.log(`[Attestation Complete] Tx Hash: ${txSignature}`);
    return txSignature;
  }

  /**
   * Broadcasts structured notification to Enterprise Slack Channel
   */
  public async notifySlack(
    payload: InterviewSubmissionPayload,
    txSignature: string
  ): Promise<void> {
    if (!SLACK_WEBHOOK_URL) {
      console.warn("[Slack] Skipping notification: No SLACK_WEBHOOK_URL specified.");
      return;
    }

    const payloadBlock = {
      text: `🚀 *New User Interview Attested on Solana!* (${payload.projectName})`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🎯 Colosseum Founder Support: Interview #${payload.slotIndex + 1}/5 Complete`,
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Project:*\n${payload.projectName}` },
            { type: "mrkdwn", text: `*User Wallet:*\n\`${payload.intervieweePublicKey.slice(0, 8)}...${payload.intervieweePublicKey.slice(-6)}\`` },
            { type: "mrkdwn", text: `*CSAT Score:*\n${payload.satisfactionScore} / 10 ⭐` },
            { type: "mrkdwn", text: `*Solana Explorer:*\n<https://explorer.solana.com/tx/${txSignature}?cluster=devnet|View On-Chain Tx>` },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Key Friction Points Identified:*\n${payload.topFeedbackPoints.map(p => `• ${p}`).join("\n")}`,
          },
        },
        { type: "divider" },
      ],
    };

    await axios.post(SLACK_WEBHOOK_URL, payloadBlock);
    console.log("[Slack] Successfully posted interview insight to channel.");
  }

  /**
   * Dispatches executive briefing via Resend API to Colosseum mentors
   */
  public async sendMentorDigest(
    payload: InterviewSubmissionPayload,
    txSignature: string
  ): Promise<void> {
    if (!RESEND_API_KEY) {
      console.warn("[Resend] Skipping email: No RESEND_API_KEY configured.");
      return;
    }

    const subject = `[Colosseum Discovery] ${payload.projectName} completed Interview #${payload.slotIndex + 1}/5`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #4f46e5;">Colosseum Founder Support: User Discovery Attested</h2>
        <p>Founder has completed interview <strong>#${payload.slotIndex + 1} of 5</strong> under the UserLoop Protocol.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Project Name:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${payload.projectName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Interviewee:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><code>${payload.intervieweePublicKey}</code></td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Satisfaction / Usability:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${payload.satisfactionScore} / 10</strong></td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Solana Tx Attestation:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="https://explorer.solana.com/tx/${txSignature}?cluster=devnet">View Signature</a></td>
          </tr>
        </table>

        <h3>Critical User Insights:</h3>
        <ul>
          ${payload.topFeedbackPoints.map((f) => `<li>${f}</li>`).join("")}
        </ul>

        <div style="margin-top: 30px; font-size: 12px; color: #64748b;">
          Cryptographic Transcript Hash: <code>${this.hashTranscript(payload.transcriptRawText).toString("hex")}</code>
        </div>
      </div>
    `;

    await resend.emails.send({
      from: "discovery@userloop.colosseum.dev",
      to: MENTOR_RECIPIENT_EMAIL,
      subject,
      html: htmlContent,
    });

    console.log(`[Resend] Successfully dispatched mentor briefing email to ${MENTOR_RECIPIENT_EMAIL}`);
  }

  /**
   * Unified Pipeline Execution
   */
  public async processCompleteInterviewFlow(payload: InterviewSubmissionPayload): Promise<string> {
    console.log(`Starting discovery attestation pipeline for slot ${payload.slotIndex}...`);
    const txSig = await this.attestSessionOnChain(payload);
    await Promise.all([
      this.notifySlack(payload, txSig),
      this.sendMentorDigest(payload, txSig),
    ]);
    return txSig;
  }
}

// -----------------------------------------------------------------------------
// Interactive Automation CLI Entrypoint
// -----------------------------------------------------------------------------
async function runCli() {
  const engine = new UserLoopEnterpriseEngine();
  const mockFounder = Keypair.generate();
  const mockUser = Keypair.generate();

  const dummyPayload: InterviewSubmissionPayload = {
    projectName: "Solana zkDEX",
    slotIndex: 0,
    founderSecretKey: mockFounder.secretKey,
    intervieweePublicKey: mockUser.publicKey.toBase58(),
    transcriptRawText: "The user had trouble finding the slip threshold setting in mobile view. Loved the RPC speed.",
    satisfactionScore: 8,
    topFeedbackPoints: [
      "Slippage setting buried in secondary nested settings modal",
      "Sub-second settlement on Devnet blew expectations away",
      "Requests Ledger hardware wallet support before mainnet launch",
    ],
  };

  console.log("=== UserLoop Enterprise Attestation Client Initialized ===");
  console.log("Calculated Transcript SHA256:", engine.hashTranscript(dummyPayload.transcriptRawText).toString("hex"));
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error("Execution error:", err);
    process.exit(1);
  });
}