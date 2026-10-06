import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FounderSupport } from "../target/types/founder_support";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

describe("colosseum_founder_support", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FounderSupport as Program<FounderSupport>;
  const founder = (provider.wallet as anchor.Wallet).payer;

  const projectName = "DeFi-Lending-V2";
  const targetInterviews = 5;

  let campaignPda: PublicKey;
  let campaignBump: number;

  before(async () => {
    [campaignPda, campaignBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        founder.publicKey.toBuffer(),
        Buffer.from(projectName),
      ],
      program.programId
    );
  });

  it("1. Successfully initializes a Founder Customer Discovery Campaign", async () => {
    await program.methods
      .initializeCampaign(projectName, targetInterviews)
      .accounts({
        campaign: campaignPda,
        founder: founder.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const campaignAccount = await program.account.campaign.fetch(campaignPda);
    expect(campaignAccount.founder.toBase58()).to.equal(founder.publicKey.toBase58());
    expect(campaignAccount.projectName).to.equal(projectName);
    expect(campaignAccount.targetInterviews).to.equal(5);
    expect(campaignAccount.completedInterviews).to.equal(0);
    expect(campaignAccount.bump).to.equal(campaignBump);
  });

  it("2. Records 5 consecutive user interviews with valid cryptographic signatures", async () => {
    for (let i = 0; i < 5; i++) {
      const userKeypair = Keypair.generate();

      // Fund user wallet for transaction fee isolation if needed
      const [attestationPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("interview"),
          campaignPda.toBuffer(),
          Buffer.from([i]),
        ],
        program.programId
      );

      const transcriptContent = `Founder discovery session #${i + 1} with feedback notes and validation`;
      const hash = crypto.createHash("sha256").update(transcriptContent).digest();
      const transcriptHash = Array.from(new Uint8Array(hash));
      const npsScore = 8 + (i % 3); // 8, 9, 10
      const willingToPay = new anchor.BN((i + 1) * 1_000_000_000); // 1-5 SOL
      const painPointCategory = i % 4;

      await program.methods
        .recordInterview(
          i,
          transcriptHash,
          npsScore,
          willingToPay,
          painPointCategory
        )
        .accounts({
          campaign: campaignPda,
          interviewAttestation: attestationPda,
          founder: founder.publicKey,
          userWallet: userKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([userKeypair])
        .rpc();

      const attestationAccount = await program.account.interviewAttestation.fetch(attestationPda);
      expect(attestationAccount.campaign.toBase58()).to.equal(campaignPda.toBase58());
      expect(attestationAccount.founder.toBase58()).to.equal(founder.publicKey.toBase58());
      expect(attestationAccount.userWallet.toBase58()).to.equal(userKeypair.publicKey.toBase58());
      expect(attestationAccount.interviewIndex).to.equal(i);
      expect(attestationAccount.npsScore).to.equal(npsScore);
      expect(attestationAccount.willingToPayLamports.toString()).to.equal(willingToPay.toString());
      expect(attestationAccount.transcriptHash).to.deep.equal(transcriptHash);
    }

    const campaignAccount = await program.account.campaign.fetch(campaignPda);
    expect(campaignAccount.completedInterviews).to.equal(5);
  });

  it("3. Rejects 6th interview attempt when target of 5 is already reached", async () => {
    const sixthUser = Keypair.generate();
    const [attestationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("interview"), campaignPda.toBuffer(), Buffer.from([5])],
      program.programId
    );

    const dummyHash = Array.from(new Uint8Array(32).fill(1));

    try {
      await program.methods
        .recordInterview(5, dummyHash, 10, new anchor.BN(1000), 0)
        .accounts({
          campaign: campaignPda,
          interviewAttestation: attestationPda,
          founder: founder.publicKey,
          userWallet: sixthUser.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([sixthUser])
        .rpc();
      expect.fail("Should have failed with CampaignTargetExceeded");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("CampaignTargetExceeded");
    }
  });

  it("4. Rejects out-of-order sequence indexing", async () => {
    const separateProject = "Out-Of-Order-Test";
    const [altCampaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), founder.publicKey.toBuffer(), Buffer.from(separateProject)],
      program.programId
    );

    await program.methods
      .initializeCampaign(separateProject, 5)
      .accounts({
        campaign: altCampaignPda,
        founder: founder.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const rogueUser = Keypair.generate();
    const [invalidIndexPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("interview"), altCampaignPda.toBuffer(), Buffer.from([2])], // Index 2 instead of 0
      program.programId
    );

    const dummyHash = Array.from(new Uint8Array(32).fill(9));

    try {
      await program.methods
        .recordInterview(2, dummyHash, 9, new anchor.BN(1000), 0)
        .accounts({
          campaign: altCampaignPda,
          interviewAttestation: invalidIndexPda,
          founder: founder.publicKey,
          userWallet: rogueUser.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([rogueUser])
        .rpc();
      expect.fail("Should have failed with SequenceOutOfOrder");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("SequenceOutOfOrder");
    }
  });

  it("5. Rejects invalid NPS score exceeding 10", async () => {
    const invalidNpsUser = Keypair.generate();
    const separateProject = "NPS-Test";
    const [npsCampaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), founder.publicKey.toBuffer(), Buffer.from(separateProject)],
      program.programId
    );

    await program.methods
      .initializeCampaign(separateProject, 5)
      .accounts({
        campaign: npsCampaignPda,
        founder: founder.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const [firstAttestationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("interview"), npsCampaignPda.toBuffer(), Buffer.from([0])],
      program.programId
    );

    const dummyHash = Array.from(new Uint8Array(32).fill(5));

    try {
      await program.methods
        .recordInterview(0, dummyHash, 11, new anchor.BN(1000), 0) // Invalid NPS 11
        .accounts({
          campaign: npsCampaignPda,
          interviewAttestation: firstAttestationPda,
          founder: founder.publicKey,
          userWallet: invalidNpsUser.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([invalidNpsUser])
        .rpc();
      expect.fail("Should have failed with InvalidNpsScore");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidNpsScore");
    }
  });
});