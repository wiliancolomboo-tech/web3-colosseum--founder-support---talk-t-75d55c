import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

describe("pulse_discovery Invariant Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PulseDiscovery as Program<any>;
  const founder = Keypair.generate();
  const campaignId = new anchor.BN(42);
  const rewardPerUser = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

  // 5 distinct user keypairs
  const users = [
    Keypair.generate(),
    Keypair.generate(),
    Keypair.generate(),
    Keypair.generate(),
    Keypair.generate(),
  ];

  let campaignPda: PublicKey;
  let escrowVaultPda: PublicKey;

  before(async () => {
    // Airdrop SOL to founder
    const airdropSig = await provider.connection.requestAirdrop(
      founder.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    [campaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), founder.publicKey.toBuffer(), campaignId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [escrowVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow_vault"), campaignPda.toBuffer()],
      program.programId
    );
  });

  it("1. Successfully initializes a 5-user campaign with escrowed SOL", async () => {
    const totalExpectedEscrow = rewardPerUser.muln(5);

    await program.methods
      .initializeCampaign(campaignId, rewardPerUser)
      .accounts({
        founder: founder.publicKey,
        campaign: campaignPda,
        escrowVault: escrowVaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([founder])
      .rpc();

    const campaignState = await program.account.campaign.fetch(campaignPda);
    expect(campaignState.founder.toBase58()).to.equal(founder.publicKey.toBase58());
    expect(campaignState.completedInterviews).to.equal(0);
    expect(campaignState.isActive).to.be.true;

    const vaultBalance = await provider.connection.getBalance(escrowVaultPda);
    expect(vaultBalance).to.equal(totalExpectedEscrow.toNumber());
  });

  it("2. Sequentially records 5 unique user discovery sessions and disburses escrow", async () => {
    for (let i = 0; i < 5; i++) {
      const user = users[i];
      const initialUserBal = await provider.connection.getBalance(user.publicKey);
      const fakeTranscript = `User ${i} feedback: Loved the UX, but needs faster slippage tolerance controls.`;
      const hash = crypto.createHash("sha256").update(fakeTranscript).digest();

      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), campaignPda.toBuffer(), user.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .recordInterview(Array.from(hash))
        .accounts({
          founder: founder.publicKey,
          user: user.publicKey,
          campaign: campaignPda,
          interviewSession: sessionPda,
          escrowVault: escrowVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder])
        .rpc();

      // Check session account
      const sessionAccount = await program.account.interviewSession.fetch(sessionPda);
      expect(sessionAccount.slotIndex).to.equal(i);
      expect(sessionAccount.user.toBase58()).to.equal(user.publicKey.toBase58());

      // Check user escrow payout
      const finalUserBal = await provider.connection.getBalance(user.publicKey);
      expect(finalUserBal - initialUserBal).to.equal(rewardPerUser.toNumber());
    }

    const campaignState = await program.account.campaign.fetch(campaignPda);
    expect(campaignState.completedInterviews).to.equal(5);
  });

  it("3. Fails when attempting to record a duplicate interview with the same user", async () => {
    const duplicateUser = users[0];
    const hash = crypto.createHash("sha256").update("Duplicate interview attempt").digest();

    const [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), campaignPda.toBuffer(), duplicateUser.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .recordInterview(Array.from(hash))
        .accounts({
          founder: founder.publicKey,
          user: duplicateUser.publicKey,
          campaign: campaignPda,
          interviewSession: sessionPda,
          escrowVault: escrowVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder])
        .rpc();
      expect.fail("Should have failed due to account already initialized");
    } catch (err: any) {
      expect(err.toString()).to.include("already in use");
    }
  });

  it("4. Fails when attempting to record a 6th user into a 5-user campaign", async () => {
    const extraUser = Keypair.generate();
    const hash = crypto.createHash("sha256").update("6th user attempt").digest();

    const [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), campaignPda.toBuffer(), extraUser.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .recordInterview(Array.from(hash))
        .accounts({
          founder: founder.publicKey,
          user: extraUser.publicKey,
          campaign: campaignPda,
          interviewSession: sessionPda,
          escrowVault: escrowVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder])
        .rpc();
      expect.fail("Should have failed because campaign is full");
    } catch (err: any) {
      expect(err.toString()).to.include("CampaignFull");
    }
  });

  it("5. Completes the campaign milestone once 5 users are verified", async () => {
    await program.methods
      .completeCampaign()
      .accounts({
        founder: founder.publicKey,
        campaign: campaignPda,
      })
      .signers([founder])
      .rpc();

    const campaignState = await program.account.campaign.fetch(campaignPda);
    expect(campaignState.isActive).to.be.false;
  });
});