import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FounderPulse } from "../target/types/founder_pulse";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert, expect } from "chai";
import * as crypto from "crypto";

describe("FounderPulse Anchor QA Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FounderPulse as Program<FounderPulse>;

  const founder = Keypair.generate();
  let rewardMint: PublicKey;
  let founderTokenAccount: PublicKey;
  let campaignPda: PublicKey;
  let vaultPda: PublicKey;

  const CAMPAIGN_NAME = "Colosseum_Cohort_1";
  const REWARD_PER_INTERVIEW = new anchor.BN(10_000_000); // 10 USDC (6 decimals)
  const TOTAL_DEPOSIT = REWARD_PER_INTERVIEW.muln(5);

  before(async () => {
    // Airdrop SOL to founder
    const airdropSig = await provider.connection.requestAirdrop(founder.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSig);

    // Create Mock USDC Mint
    rewardMint = await createMint(
      provider.connection,
      founder,
      founder.publicKey,
      null,
      6
    );

    // Create Founder Token Account
    founderTokenAccount = await createAccount(
      provider.connection,
      founder,
      rewardMint,
      founder.publicKey
    );

    // Mint 100 USDC to founder
    await mintTo(
      provider.connection,
      founder,
      rewardMint,
      founderTokenAccount,
      founder,
      100_000_000
    );

    // Derive Campaign PDA
    [campaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), founder.publicKey.toBuffer(), Buffer.from(CAMPAIGN_NAME)],
      program.programId
    );

    // Derive Vault PDA
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaignPda.toBuffer()],
      program.programId
    );
  });

  it("1. Initializes a 5-User Discovery Campaign with Escrow Deposit", async () => {
    await program.methods
      .initializeCampaign(CAMPAIGN_NAME, REWARD_PER_INTERVIEW)
      .accounts({
        campaign: campaignPda,
        rewardMint: rewardMint,
        vault: vaultPda,
        founderTokenAccount: founderTokenAccount,
        founder: founder.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([founder])
      .rpc();

    const campaignState = await program.account.campaign.fetch(campaignPda);
    assert.equal(campaignState.founder.toBase58(), founder.publicKey.toBase58());
    assert.equal(campaignState.targetInterviews, 5);
    assert.equal(campaignState.completedInterviews, 0);

    const vaultAccount = await getAccount(provider.connection, vaultPda);
    assert.equal(vaultAccount.amount.toString(), TOTAL_DEPOSIT.toString());
  });

  it("2. Fails when reserving an out-of-bounds slot index (Slot 6/5)", async () => {
    const interviewee = Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(interviewee.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSig);

    const [invalidSlotPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("interview"), campaignPda.toBuffer(), Buffer.from([6])],
      program.programId
    );

    try {
      await program.methods
        .reserveInterviewSlot(6)
        .accounts({
          campaign: campaignPda,
          interviewRecord: invalidSlotPda,
          interviewee: interviewee.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([interviewee])
        .rpc();
      assert.fail("Should have thrown InvalidSlotIndex");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidSlotIndex");
    }
  });

  it("3. Successfully runs 5 unique interview workflows to completion", async () => {
    for (let slot = 1; slot <= 5; slot++) {
      const interviewee = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(interviewee.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(airdropSig);

      // Create Interviewee Token Account
      const intervieweeTokenAccount = await createAccount(
        provider.connection,
        interviewee,
        rewardMint,
        interviewee.publicKey
      );

      const [interviewPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("interview"), campaignPda.toBuffer(), Buffer.from([slot])],
        program.programId
      );

      // 3a. Reserve Slot
      await program.methods
        .reserveInterviewSlot(slot)
        .accounts({
          campaign: campaignPda,
          interviewRecord: interviewPda,
          interviewee: interviewee.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([interviewee])
        .rpc();

      // 3b. Verify Interview Transcript Hash
      const transcript = `Verified Interview transcript #${slot} with user ${interviewee.publicKey.toBase58()}`;
      const transcriptHash = crypto.createHash("sha256").update(transcript).digest();
      const hashArray = Array.from(new Uint8Array(transcriptHash));

      await program.methods
        .submitAndVerifyInterview(hashArray)
        .accounts({
          campaign: campaignPda,
          interviewRecord: interviewPda,
          vault: vaultPda,
          intervieweeTokenAccount: intervieweeTokenAccount,
          founder: founder.publicKey,
          interviewee: interviewee.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([founder, interviewee])
        .rpc();

      // Assert payout received
      const tokenBal = await getAccount(provider.connection, intervieweeTokenAccount);
      assert.equal(tokenBal.amount.toString(), REWARD_PER_INTERVIEW.toString());

      const interviewState = await program.account.interviewRecord.fetch(interviewPda);
      assert.deepEqual(interviewState.status, { verified: {} });
    }

    // Final Check: Campaign milestone status
    const finalCampaignState = await program.account.campaign.fetch(campaignPda);
    assert.equal(finalCampaignState.completedInterviews, 5);

    // Vault should now be completely drained
    const vaultBal = await getAccount(provider.connection, vaultPda);
    assert.equal(vaultBal.amount.toString(), "0");
  });

  it("4. Fails when attempting to double-claim an already verified slot", async () => {
    const maliciousUser = Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(maliciousUser.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSig);

    const [slotOnePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("interview"), campaignPda.toBuffer(), Buffer.from([1])],
      program.programId
    );

    try {
      await program.methods
        .reserveInterviewSlot(1)
        .accounts({
          campaign: campaignPda,
          interviewRecord: slotOnePda,
          interviewee: maliciousUser.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([maliciousUser])
        .rpc();
      assert.fail("Should have failed duplicate account creation");
    } catch (err: any) {
      // Transaction will fail on initialization of an already allocated account
      expect(err).to.exist;
    }
  });

  it("5. Fails when unauthorized non-founder signs the verification", async () => {
    const fakeFounder = Keypair.generate();
    const interviewee = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(fakeFounder.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL)
    );

    const [slotOnePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("interview"), campaignPda.toBuffer(), Buffer.from([1])],
      program.programId
    );

    const dummyHash = Array.from(new Uint8Array(32));

    try {
      await program.methods
        .submitAndVerifyInterview(dummyHash)
        .accounts({
          campaign: campaignPda,
          interviewRecord: slotOnePda,
          vault: vaultPda,
          intervieweeTokenAccount: founderTokenAccount, // arbitrary dummy
          founder: fakeFounder.publicKey,
          interviewee: interviewee.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fakeFounder, interviewee])
        .rpc();
      assert.fail("Should have rejected unauthorized founder signature");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("FounderMismatch");
    }
  });
});