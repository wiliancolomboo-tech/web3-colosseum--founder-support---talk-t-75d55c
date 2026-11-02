import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Userloop } from "../target/types/userloop";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

describe("UserLoop-Solana: 'Talk to 5 Users' Verification Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Userloop as Program<Userloop>;

  const founder = Keypair.generate();
  const interviewees = [
    Keypair.generate(),
    Keypair.generate(),
    Keypair.generate(),
    Keypair.generate(),
    Keypair.generate(),
  ];

  const rewardPerInterview = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
  const projectName = "Superteam Terminal";

  let campaignPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    // Airdrop SOL to founder and interviewees
    const sig1 = await provider.connection.requestAirdrop(founder.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig1, "confirmed");

    for (const user of interviewees) {
      const sig = await provider.connection.requestAirdrop(user.publicKey, 0.5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    [campaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), founder.publicKey.toBuffer()],
      program.programId
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), founder.publicKey.toBuffer()],
      program.programId
    );
  });

  it("1. Successfully initializes a 5-user discovery campaign with escrow funded", async () => {
    const initialVaultBalance = await provider.connection.getBalance(vaultPda).catch(() => 0);
    expect(initialVaultBalance).to.equal(0);

    await program.methods
      .initializeCampaign(projectName, rewardPerInterview)
      .accounts({
        campaign: campaignPda,
        vault: vaultPda,
        founder: founder.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([founder])
      .rpc();

    const campaignAccount = await program.account.campaignAccount.fetch(campaignPda);
    expect(campaignAccount.founder.toBase58()).to.equal(founder.publicKey.toBase58());
    expect(campaignAccount.projectName).to.equal(projectName);
    expect(campaignAccount.targetInterviews).to.equal(5);
    expect(campaignAccount.completedInterviews).to.equal(0);
    expect(campaignAccount.isFullyValidated).to.be.false;

    // Vault should hold exactly 5 * 0.1 SOL = 0.5 SOL
    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.equal(0.5 * LAMPORTS_PER_SOL);
  });

  it("2. Successfully books an interview slot (Slot #0)", async () => {
    const slotIndex = 0;
    const [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), campaignPda.toBuffer(), Buffer.from([slotIndex])],
      program.programId
    );

    await program.methods
      .bookInterview(slotIndex)
      .accounts({
        campaign: campaignPda,
        session: sessionPda,
        interviewee: interviewees[0].publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([interviewees[0]])
      .rpc();

    const sessionAccount = await program.account.sessionAccount.fetch(sessionPda);
    expect(sessionAccount.campaign.toBase58()).to.equal(campaignPda.toBase58());
    expect(sessionAccount.slotIndex).to.equal(0);
    expect(sessionAccount.interviewee.toBase58()).to.equal(interviewees[0].publicKey.toBase58());
    expect(sessionAccount.status).to.deep.equal({ booked: {} });
  });

  it("3. Prevents double-booking an already occupied interview slot", async () => {
    const slotIndex = 0;
    const [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), campaignPda.toBuffer(), Buffer.from([slotIndex])],
      program.programId
    );

    try {
      await program.methods
        .bookInterview(slotIndex)
        .accounts({
          campaign: campaignPda,
          session: sessionPda,
          interviewee: interviewees[1].publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([interviewees[1]])
        .rpc();
      expect.fail("Expected transaction to fail due to account already initialized!");
    } catch (err: any) {
      expect(err.toString()).to.include("already in use");
    }
  });

  it("4. Completes interview #0, attests transcript hash, and pays out escrow to user", async () => {
    const slotIndex = 0;
    const [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), campaignPda.toBuffer(), Buffer.from([slotIndex])],
      program.programId
    );

    const userInitialBal = await provider.connection.getBalance(interviewees[0].publicKey);

    const transcriptHash = Array.from(
      crypto.createHash("sha256").update("User feedback: Onboarding UX was clean!").digest()
    );
    const score = 9;

    await program.methods
      .completeInterview(transcriptHash, score)
      .accounts({
        campaign: campaignPda,
        session: sessionPda,
        interviewee: interviewees[0].publicKey,
        vault: vaultPda,
        founder: founder.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([founder])
      .rpc();

    const sessionAccount = await program.account.sessionAccount.fetch(sessionPda);
    expect(sessionAccount.status).to.deep.equal({ completed: {} });
    expect(sessionAccount.satisfactionScore).to.equal(9);
    expect(sessionAccount.transcriptHash).to.deep.equal(transcriptHash);

    const campaignAccount = await program.account.campaignAccount.fetch(campaignPda);
    expect(campaignAccount.completedInterviews).to.equal(1);

    // Verify user received exactly 0.1 SOL
    const userFinalBal = await provider.connection.getBalance(interviewees[0].publicKey);
    expect(userFinalBal - userInitialBal).to.equal(0.1 * LAMPORTS_PER_SOL);
  });

  it("5. Rejects completion attempt by unauthorized non-founder signer", async () => {
    const slotIndex = 1;
    const attacker = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(attacker.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");

    const [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), campaignPda.toBuffer(), Buffer.from([slotIndex])],
      program.programId
    );

    // Book slot 1 first
    await program.methods
      .bookInterview(slotIndex)
      .accounts({
        campaign: campaignPda,
        session: sessionPda,
        interviewee: interviewees[1].publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([interviewees[1]])
      .rpc();

    const dummyHash = Array.from(Buffer.alloc(32, 1));

    try {
      await program.methods
        .completeInterview(dummyHash, 7)
        .accounts({
          campaign: campaignPda,
          session: sessionPda,
          interviewee: interviewees[1].publicKey,
          vault: vaultPda,
          founder: attacker.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      expect.fail("Expected unauthorized completion to revert!");
    } catch (err: any) {
      expect(err.toString()).to.include("ConstraintHasOne");
    }
  });

  it("6. Reaches 5-user milestone and toggles is_fully_validated flag", async () => {
    // Complete slots 1 through 4
    for (let i = 1; i < 5; i++) {
      const slotIndex = i;
      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), campaignPda.toBuffer(), Buffer.from([slotIndex])],
        program.programId
      );

      // Slot 1 was booked in previous test; book 2, 3, 4
      if (i > 1) {
        await program.methods
          .bookInterview(slotIndex)
          .accounts({
            campaign: campaignPda,
            session: sessionPda,
            interviewee: interviewees[i].publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([interviewees[i]])
          .rpc();
      }

      const hash = Array.from(crypto.createHash("sha256").update(`Interview ${i}`).digest());
      await program.methods
        .completeInterview(hash, 8)
        .accounts({
          campaign: campaignPda,
          session: sessionPda,
          interviewee: interviewees[i].publicKey,
          vault: vaultPda,
          founder: founder.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder])
        .rpc();
    }

    const campaignAccount = await program.account.campaignAccount.fetch(campaignPda);
    expect(campaignAccount.completedInterviews).to.equal(5);
    expect(campaignAccount.isFullyValidated).to.be.true;

    // Vault balance should now be empty (all rewards distributed)
    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.equal(0);
  });
});