import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FounderUserLoop } from "../target/types/founder_user_loop";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

describe("founder_user_loop integration tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FounderUserLoop as Program<FounderUserLoop>;

  const founder = Keypair.generate();
  const campaignId = new anchor.BN(42);
  const campaignName = "PerpDEX Discovery Sprint";

  // Derive Campaign PDA
  const [campaignPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("founder_campaign"), founder.publicKey.toBuffer(), campaignId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  // Five distinct mock users
  const users: Keypair[] = Array.from({ length: 6 }, () => Keypair.generate());

  function deriveInterviewPda(userWallet: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_interview"), campaignPda.toBuffer(), userWallet.toBuffer()],
      program.programId
    );
    return pda;
  }

  function generateMockHash(): number[] {
    return Array.from(crypto.randomBytes(32));
  }

  before(async () => {
    // Fund founder wallet
    const airdropSig = await provider.connection.requestAirdrop(
      founder.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: airdropSig,
      ...latestBlockhash,
    });

    // Fund user signers for gas fees
    for (const user of users) {
      const sig = await provider.connection.requestAirdrop(user.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);
      const lb = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({ signature: sig, ...lb });
    }
  });

  it("1. Successfully initializes a founder discovery campaign", async () => {
    await program.methods
      .initializeCampaign(campaignId, campaignName)
      .accounts({
        campaign: campaignPda,
        founder: founder.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([founder])
      .rpc();

    const campaignAccount = await program.account.campaign.fetch(campaignPda);
    expect(campaignAccount.founder.toBase58()).to.equal(founder.publicKey.toBase58());
    expect(campaignAccount.name).to.equal(campaignName);
    expect(campaignAccount.verifiedCount).to.equal(0);
    expect(campaignAccount.isCompleted).to.be.false;
  });

  it("2. Rejects campaign initialization if name exceeds 64 characters", async () => {
    const badCampaignId = new anchor.BN(999);
    const [badCampaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("founder_campaign"), founder.publicKey.toBuffer(), badCampaignId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const longName = "A".repeat(65);

    try {
      await program.methods
        .initializeCampaign(badCampaignId, longName)
        .accounts({
          campaign: badCampaignPda,
          founder: founder.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder])
        .rpc();
      expect.fail("Should have failed with CampaignNameTooLong");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("CampaignNameTooLong");
    }
  });

  it("3. Successfully records interview 1 of 5", async () => {
    const user = users[0];
    const interviewPda = deriveInterviewPda(user.publicKey);
    const mockHash = generateMockHash();

    await program.methods
      .recordInterview(mockHash, 9, "UX_ONBOARDING")
      .accounts({
        campaign: campaignPda,
        interviewRecord: interviewPda,
        userWallet: user.publicKey,
        founder: founder.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([founder, user])
      .rpc();

    const campaignAccount = await program.account.campaign.fetch(campaignPda);
    const interviewAccount = await program.account.interviewRecord.fetch(interviewPda);

    expect(campaignAccount.verifiedCount).to.equal(1);
    expect(campaignAccount.isCompleted).to.be.false;
    expect(interviewAccount.userWallet.toBase58()).to.equal(user.publicKey.toBase58());
    expect(interviewAccount.npsScore).to.equal(9);
    expect(interviewAccount.categoryTag).to.equal("UX_ONBOARDING");
    expect(interviewAccount.interviewIndex).to.equal(1);
  });

  it("4. Prevents duplicate interviews with the same user wallet (Anti-Sybil)", async () => {
    const user = users[0]; // Same user from test 3
    const interviewPda = deriveInterviewPda(user.publicKey);
    const mockHash = generateMockHash();

    try {
      await program.methods
        .recordInterview(mockHash, 8, "REPEAT_ATTEMPT")
        .accounts({
          campaign: campaignPda,
          interviewRecord: interviewPda,
          userWallet: user.publicKey,
          founder: founder.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder, user])
        .rpc();
      expect.fail("Should have failed because account already exists");
    } catch (err: any) {
      // Anchor/System program rejects re-initialization of initialized account
      expect(err.toString()).to.include("custom program error: 0x0");
    }
  });

  it("5. Rejects self-interview attempts by founder", async () => {
    const interviewPda = deriveInterviewPda(founder.publicKey);
    const mockHash = generateMockHash();

    try {
      await program.methods
        .recordInterview(mockHash, 10, "SELF_BIAS")
        .accounts({
          campaign: campaignPda,
          interviewRecord: interviewPda,
          userWallet: founder.publicKey,
          founder: founder.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder])
        .rpc();
      expect.fail("Founder should not be able to interview themselves");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("SelfInterviewNotPermitted");
    }
  });

  it("6. Rejects invalid NPS scores (< 1 or > 10)", async () => {
    const user = users[1];
    const interviewPda = deriveInterviewPda(user.publicKey);
    const mockHash = generateMockHash();

    try {
      await program.methods
        .recordInterview(mockHash, 11, "INVALID_NPS")
        .accounts({
          campaign: campaignPda,
          interviewRecord: interviewPda,
          userWallet: user.publicKey,
          founder: founder.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder, user])
        .rpc();
      expect.fail("Should have rejected NPS > 10");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidNpsScore");
    }
  });

  it("7. Sequentially completes interviews 2, 3, 4 and triggers milestone at 5", async () => {
    for (let i = 1; i <= 4; i++) {
      const currentUser = users[i];
      const interviewPda = deriveInterviewPda(currentUser.publicKey);
      const mockHash = generateMockHash();

      await program.methods
        .recordInterview(mockHash, 8 + (i % 3), `TAG_STEP_${i + 1}`)
        .accounts({
          campaign: campaignPda,
          interviewRecord: interviewPda,
          userWallet: currentUser.publicKey,
          founder: founder.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder, currentUser])
        .rpc();
    }

    const finalCampaignAccount = await program.account.campaign.fetch(campaignPda);
    expect(finalCampaignAccount.verifiedCount).to.equal(5);
    expect(finalCampaignAccount.isCompleted).to.be.true;
    expect(finalCampaignAccount.completedAt.toNumber()).to.be.greaterThan(0);
  });

  it("8. Rejects interview 6 when milestone quota (5 users) has been met", async () => {
    const extraUser = users[5];
    const interviewPda = deriveInterviewPda(extraUser.publicKey);
    const mockHash = generateMockHash();

    try {
      await program.methods
        .recordInterview(mockHash, 10, "OVER_QUOTA")
        .accounts({
          campaign: campaignPda,
          interviewRecord: interviewPda,
          userWallet: extraUser.publicKey,
          founder: founder.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder, extraUser])
        .rpc();
      expect.fail("Should have rejected 6th user interview");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("CampaignAlreadyCompleted");
    }
  });
});