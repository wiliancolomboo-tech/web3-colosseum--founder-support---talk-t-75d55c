// File: src/agent.ts

import * as anchor from "@coral-xyz/anchor";
import { Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as crypto from "crypto";
import axios from "axios";
import { Resend } from "resend";

export interface InterviewInput {
  intervieweeKeypair: Keypair;
  userEmail: string;
  notesTranscript: string;
  rating: number; // 1 - 10
  storageUri: string;
}

export class ColosseumDiscoveryAgent {
  private program: Program;
  private connection: Connection;
  private founderWallet: Wallet;
  private resend: Resend | null;
  private webhookUrl: string | null;

  constructor(
    rpcUrl: string,
    founderKeypair: Keypair,
    programId: PublicKey,
    idl: anchor.Idl,
    resendApiKey?: string,
    webhookUrl?: string
  ) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.founderWallet = new Wallet(founderKeypair);
    const provider = new anchor.AnchorProvider(
      this.connection,
      this.founderWallet,
      { commitment: "confirmed", preflightCommitment: "confirmed" }
    );
    this.program = new Program(idl, programId, provider);
    this.resend = resendApiKey ? new Resend(resendApiKey) : null;
    this.webhookUrl = webhookUrl || null;
  }

  public getCampaignPda(campaignId: anchor.BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        this.founderWallet.publicKey.toBuffer(),
        campaignId.toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );
  }

  public getRecordPda(campaignPda: PublicKey, userPubkey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("record"),
        campaignPda.toBuffer(),
        userPubkey.toBuffer(),
      ],
      this.program.programId
    );
  }

  public async initializeCampaign(campaignId: number, tag: string, targetQuota = 5): Promise<string> {
    const cid = new anchor.BN(campaignId);
    const [campaignPda] = this.getCampaignPda(cid);

    console.log(`[INFO] Initializing Discovery Campaign #${campaignId} PDA: ${campaignPda.toBase58()}`);

    const tx = await this.program.methods
      .initializeCampaign(cid, targetQuota, tag)
      .accounts({
        campaign: campaignPda,
        founder: this.founderWallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`[SUCCESS] Campaign initialized. Signature: ${tx}`);
    return tx;
  }

  public async recordInterview(campaignId: number, input: InterviewInput): Promise<string> {
    const cid = new anchor.BN(campaignId);
    const [campaignPda] = this.getCampaignPda(cid);
    const [recordPda] = this.getRecordPda(campaignPda, input.intervieweeKeypair.publicKey);

    // Compute cryptographic SHA-256 digest of interview transcript
    const hash = crypto.createHash("sha256").update(input.notesTranscript).digest();
    const transcriptHashArray = Array.from(new Uint8Array(hash));

    console.log(`[INFO] Submitting interview for user: ${input.intervieweeKeypair.publicKey.toBase58()}`);
    console.log(`[INFO] Transcript Digest: ${hash.toString("hex")}`);

    const tx = await this.program.methods
      .submitUserInterview(transcriptHashArray, input.rating, input.storageUri)
      .accounts({
        campaign: campaignPda,
        interviewrecord: recordPda,
        founder: this.founderWallet.publicKey,
        interviewee: input.intervieweeKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([input.intervieweeKeypair])
      .rpc();

    console.log(`[SUCCESS] Interview committed to Solana. Tx: ${tx}`);

    // Off-chain Trigger: Slack/Discord Notification
    await this.notifyWebhook(campaignId, input, tx);

    // Off-chain Trigger: Resend Email Dispatch
    await this.sendEmailAttestation(input, tx, hash.toString("hex"));

    return tx;
  }

  private async notifyWebhook(campaignId: number, input: InterviewInput, txSig: string) {
    if (!this.webhookUrl) return;

    try {
      await axios.post(this.webhookUrl, {
        embeds: [
          {
            title: `Colosseum Discovery: User Interview Verified`,
            color: 0x14f195, // Solana Green
            fields: [
              { name: "Campaign ID", value: `${campaignId}`, inline: true },
              { name: "Rating", value: `${input.rating}/10`, inline: true },
              { name: "Interviewee", value: `\`${input.intervieweeKeypair.publicKey.toBase58()}\``, inline: false },
              { name: "Solana Explorer", value: `[View Transaction](https://explorer.solana.com/tx/${txSig}?cluster=devnet)`, inline: false },
            ],
            footer: { text: "Colosseum Founder Support • Proof of Discovery" },
            timestamp: new Date().toISOString(),
          },
        ],
      });
      console.log(`[INTEGRATION] Webhook dispatch acknowledged.`);
    } catch (err: any) {
      console.error(`[WARN] Webhook dispatch failed: ${err.message}`);
    }
  }

  private async sendEmailAttestation(input: InterviewInput, txSig: string, transcriptDigest: string) {
    if (!this.resend || !input.userEmail) return;

    try {
      await this.resend.emails.send({
        from: "Colosseum Discovery <onboarding@resend.dev>",
        to: input.userEmail,
        subject: "Verified Interview Attestation: Colosseum Founder Support",
        html: `
          <div style="font-family: Arial, sans-serif; background: #0b0e14; color: #ffffff; padding: 24px; border-radius: 8px;">
            <h2 style="color: #14F195;">Colosseum Founder Support Attestation</h2>
            <p>Thank you for participating in our early user discovery cycle. Your interview has been recorded on the Solana ledger.</p>
            <hr style="border-color: #2a2e39;"/>
            <p><strong>Your Public Key:</strong> ${input.intervieweeKeypair.publicKey.toBase58()}</p>
            <p><strong>Feedback Score:</strong> ${input.rating} / 10</p>
            <p><strong>Transcript SHA-256 Digest:</strong> <code>${transcriptDigest}</code></p>
            <p><strong>Solana Transaction:</strong> <a href="https://explorer.solana.com/tx/${txSig}?cluster=devnet" style="color: #9945FF;">Verify on Solana Explorer</a></p>
            <br/>
            <p style="font-size: 12px; color: #888;">Cryptographically authenticated via Colosseum Founder Support Engine.</p>
          </div>
        `,
      });
      console.log(`[INTEGRATION] Email receipt dispatched via Resend to ${input.userEmail}`);
    } catch (err: any) {
      console.error(`[WARN] Resend API dispatch failed: ${err.message}`);
    }
  }
}