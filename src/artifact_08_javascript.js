import { Command } from 'commander';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import fs from 'fs';
import dotenv from 'dotenv';
import { computeFeedbackDigest, getFounderProfilePda, getInterviewRecordPda } from './index.js';
import { EnterpriseNotifier } from './integrations.js';

dotenv.config();

const program = new Command();
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "ColoSupp11111111111111111111111111111111111");

function loadKeypair(path) {
  const secret = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

program
  .name('colosseum-pod')
  .description('Colosseum Founder Support Proof-of-Discovery Orchestration CLI')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize a new Founder Profile for the accelerator track')
  .requiredOption('-k, --keypair <path>', 'Path to founder keypair JSON')
  .requiredOption('-t, --track <track>', 'Hackathon track (e.g., DeFi, Infra, Gaming)')
  .action(async (opts) => {
    const founderKeypair = loadKeypair(opts.keypair);
    const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'confirmed');
    const provider = new AnchorProvider(connection, new Wallet(founderKeypair), {});
    
    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (!idl) throw new Error("IDL not found on-chain");
    const anchorProgram = new Program(idl, provider);

    const [profilePda] = getFounderProfilePda(founderKeypair.publicKey, PROGRAM_ID);
    console.log(`Initializing Founder Profile PDA: ${profilePda.toBase58()}`);

    const tx = await anchorProgram.methods
      .initializeFounder(opts.track)
      .accounts({
        founderProfile: profilePda,
        founder: founderKeypair.publicKey,
      })
      .signers([founderKeypair])
      .rpc();

    console.log(`✅ Founder profile successfully initialized! Tx: ${tx}`);
  });

program
  .command('record-interview')
  .description('Record a customer discovery interview co-signed by founder and user')
  .requiredOption('-f, --founder-keypair <path>', 'Founder keypair JSON')
  .requiredOption('-u, --user-keypair <path>', 'User keypair JSON')
  .requiredOption('-s, --sentiment <number>', 'Sentiment score from 1 to 10', parseInt)
  .requiredOption('-p, --wtp <lamports>', 'Willingness to pay in Lamports', parseInt)
  .requiredOption('-d, --duration <minutes>', 'Session duration in minutes', parseInt)
  .requiredOption('-n, --notes <string>', 'Raw feedback or meeting summary text')
  .option('-e, --user-email <email>', 'User email for automated reward follow-up')
  .action(async (opts) => {
    const founderKeypair = loadKeypair(opts.founderKeypair);
    const userKeypair = loadKeypair(opts.userKeypair);

    const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'confirmed');
    const provider = new AnchorProvider(connection, new Wallet(founderKeypair), {});
    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    const anchorProgram = new Program(idl, provider);

    const [profilePda] = getFounderProfilePda(founderKeypair.publicKey, PROGRAM_ID);
    const profileAccount = await anchorProgram.account.founderProfile.fetch(profilePda);
    const currentIndex = profileAccount.interviewCount;

    const [interviewPda] = getInterviewRecordPda(founderKeypair.publicKey, currentIndex, PROGRAM_ID);
    const digest = computeFeedbackDigest(opts.notes);

    console.log(`Recording Interview #${currentIndex + 1} of 5 for founder ${founderKeypair.publicKey.toBase58()}`);
    console.log(`Feedback SHA-256 Digest: ${digest.toString('hex')}`);

    const tx = await anchorProgram.methods
      .recordInterview(
        opts.sentiment,
        new anchorProgram.bn(opts.wtp),
        Array.from(digest),
        opts.duration
      )
      .accounts({
        founderProfile: profilePda,
        interviewRecord: interviewPda,
        founder: founderKeypair.publicKey,
        user: userKeypair.publicKey,
      })
      .signers([founderKeypair, userKeypair])
      .rpc();

    console.log(`✅ Interview #${currentIndex + 1} successfully anchored on-chain! Tx: ${tx}`);

    if (opts.userEmail) {
      const notifier = new EnterpriseNotifier(process.env.SLACK_WEBHOOK_URL, process.env.RESEND_API_KEY);
      await notifier.sendUserInterviewPerk(
        opts.userEmail,
        userKeypair.publicKey.toBase58(),
        founderKeypair.publicKey.toBase58(),
        currentIndex
      );
    }
  });

program.parse(process.argv);