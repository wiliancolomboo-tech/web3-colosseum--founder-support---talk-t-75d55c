import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { EnterpriseNotifier } from './integrations.js';

dotenv.config();

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "ColoSupp11111111111111111111111111111111111");
const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');

export function computeFeedbackDigest(notes) {
  return crypto.createHash('sha256').update(notes, 'utf8').digest();
}

export function getFounderProfilePda(founderPubkey, programId = PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("founder_profile"), founderPubkey.toBuffer()],
    programId
  );
}

export function getInterviewRecordPda(founderPubkey, index, programId = PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("interview_record"), founderPubkey.toBuffer(), Buffer.from([index])],
    programId
  );
}

export async function runDiscoveryAgent() {
  console.log("=== Starting Colosseum Founder Support Discovery Listener ===");
  const connection = new Connection(RPC_URL, 'confirmed');

  const notifier = new EnterpriseNotifier(
    process.env.SLACK_WEBHOOK_URL,
    process.env.RESEND_API_KEY
  );

  console.log(`Subscribed to RPC: ${RPC_URL}`);
  console.log(`Monitoring Program: ${PROGRAM_ID.toBase58()}`);

  connection.onLogs(
    PROGRAM_ID,
    async (logs, ctx) => {
      for (const log of logs.logs) {
        if (log.includes("MilestoneAchievedEvent")) {
          console.log("\n⚡ [EVENT DETECTED] Founder Achieved 5-Interview Milestone!");
          const txSig = logs.signature;
          const explorerUrl = `https://explorer.solana.com/tx/${txSig}?cluster=devnet`;
          
          await notifier.notifySlackMilestone(
            "DetectedFounderPublicKey",
            "Infrastructure & Developer Tools",
            5,
            explorerUrl
          );
        }
      }
    },
    'confirmed'
  );
}

if (process.argv[1].endsWith('index.js')) {
  runDiscoveryAgent().catch(console.error);
}