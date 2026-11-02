import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Userloop } from "../target/types/userloop";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import crypto from "crypto";

describe("UserLoop: Colosseum Founder Support - Talk to 5 Users", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Userloop as Program<Userloop>;

  let founder = Keypair.generate();
  let rewardMint: PublicKey;
  let founderTokenAccount: PublicKey;

  const campaignId = new anchor.BN(42);
  const rewardPerUser = new anchor.BN(25 * 10 ** 6); // 25 USDC
  const targetUsers = 5;

  let campaignPDA: PublicKey;
  let vaultPDA: PublicKey;
  let milestoneProofPDA: PublicKey;

  // Track 5 participants
  const participants = Array.from({ length: 5 }, () => Keypair.generate());
  const sessionIds = Array.from({ length: 5 }, () => crypto.randomBytes(16));

  before(async () => {
    // 1. Airdrop SOL to founder and participants
    const sig = await provider.connection.requestAirdrop(founder.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    for (const p of participants) {
      const airdropSig = await provider.connection.requestAirdrop(p.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(airdropSig);
    }

    // 2. Create Reward Mint (USDC simulation)
    rewardMint = await createMint(
      provider.connection,
      founder,
      founder.publicKey,
      null,
      6
    );

    // 3. Create ATA for Founder and mint 500 USDC
    founderTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      founder,
      rewardMint,
      founder.publicKey
    );

    await mintTo(
      provider.connection,
      founder,
      rewardMint,
      founderTokenAccount,
      founder,
      500 * 10 ** 6
    );

    // 4. Derive PDAs
    [campaignPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), founder.publicKey.toBuffer(), campaignId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaignPDA.toBuffer()],
      program.programId
    );

    [milestoneProofPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("milestone"), campaignPDA.toBuffer()],
      program.programId
    );
  });

  it("1. Initializes the campaign with minimum 5 users quota and seeds vault", async () => {
    await program.methods
      .initializeCampaign(campaignId, rewardPerUser, targetUsers, "ipfs://bafybeicustomerdiscovery")
      .accounts({
        founder: founder.publicKey,
        rewardMint: rewardMint,
        campaign: campaignPDA,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([founder])
      .rpc();

    // Founder deposits 125 USDC into vault (5 users * 25 USDC)
    await anchor.spl.token.transfer(
      provider.connection,
      founder,
      founderTokenAccount,
      vaultPDA,
      founder,
      125 * 10 ** 6
    );

    const campaignAccount = await program.account.campaign.fetch(campaignPDA);
    expect(campaignAccount.founder.toBase58()).to.equal(founder.publicKey.toBase58());
    expect(campaignAccount.targetUsers).to.equal(5);
    expect(campaignAccount.completedUsers).to.equal(0);

    const vaultBalance = await getAccount(provider.connection, vaultPDA);
    expect(Number(vaultBalance.amount)).to.equal(125 * 10 ** 6);
  });

  it("2. Fails to initialize campaign with quota < 5 (Accelerator Rule Enforcement)", async () => {
    const invalidCampaignId = new anchor.BN(999);
    const [invalidPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), founder.publicKey.toBuffer(), invalidCampaignId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [invalidVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), invalidPDA.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .initializeCampaign(invalidCampaignId, rewardPerUser, 4, "ipfs://invalid")
        .accounts({
          founder: founder.publicKey,
          rewardMint: rewardMint,
          campaign: invalidPDA,
          vault: invalidVaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([founder])
        .rpc();
      expect.fail("Should have failed with InsufficientTargetQuota");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InsufficientTargetQuota");
    }
  });

  it("3. Successfully books 5 user interview sessions", async () => {
    for (let i = 0; i < 5; i++) {
      const participant = participants[i];
      const sessionId = sessionIds[i];

      const [sessionPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), campaignPDA.toBuffer(), sessionId],
        program.programId
      );

      const timestamp = new anchor.BN(Math.floor(Date.now() / 1000) + i * 3600);

      await program.methods
        .bookSession([...sessionId], timestamp)
        .accounts({
          participant: participant.publicKey,
          campaign: campaignPDA,
          session: sessionPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([participant])
        .rpc();

      const sessionAccount = await program.account.interviewSession.fetch(sessionPDA);
      expect(sessionAccount.participant.toBase58()).to.equal(participant.publicKey.toBase58());
      expect(sessionAccount.status).to.deep.equal({ booked: {} });
    }
  });

  it("4. Completes 4 interviews: Escrow settled, but milestone proof NOT yet unlocked", async () => {
    for (let i = 0; i < 4; i++) {
      const participant = participants[i];
      const sessionId = sessionIds[i];

      const participantATA = await createAssociatedTokenAccount(
        provider.connection,
        founder,
        rewardMint,
        participant.publicKey
      );

      const [sessionPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), campaignPDA.toBuffer(), sessionId],
        program.programId
      );

      const digest = crypto.createHash("sha256").update(`Interview-${i}-Verified`).digest();

      await program.methods
        .attestAndSettle([...digest])
        .accounts({
          founder: founder.publicKey,
          participant: participant.publicKey,
          campaign: campaignPDA,
          vault: vaultPDA,
          participantTokenAccount: participantATA,
          session: sessionPDA,
          milestoneProof: null,
          systemProgram: SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([founder])
        .rpc();

      const pBalance = await getAccount(provider.connection, participantATA);
      expect(Number(pBalance.amount)).to.equal(25 * 10 ** 6);
    }

    const campaignState = await program.account.campaign.fetch(campaignPDA);
    expect(campaignState.completedUsers).to.equal(4);

    // Milestone proof must not exist yet
    const milestoneNull = await provider.connection.getAccountInfo(milestoneProofPDA);
    expect(milestoneNull).to.be.null;
  });

  it("5. Completes 5th interview: Triggers Proof-of-Feedback Colosseum Milestone Creation", async () => {
    const participant = participants[4];
    const sessionId = sessionIds[4];

    const participantATA = await createAssociatedTokenAccount(
      provider.connection,
      founder,
      rewardMint,
      participant.publicKey
    );

    const [sessionPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), campaignPDA.toBuffer(), sessionId],
      program.programId
    );

    const digest = crypto.createHash("sha256").update(`Interview-Final-Verified`).digest();

    await program.methods
      .attestAndSettle([...digest])
      .accounts({
        founder: founder.publicKey,
        participant: participant.publicKey,
        campaign: campaignPDA,
        vault: vaultPDA,
        participantTokenAccount: participantATA,
        session: sessionPDA,
        milestoneProof: milestoneProofPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([founder])
      .rpc();

    // Verify Milestone Proof PDA was minted
    const milestoneAccount = await program.account.milestoneProof.fetch(milestoneProofPDA);
    expect(milestoneAccount.founder.toBase58()).to.equal(founder.publicKey.toBase58());
    expect(milestoneAccount.totalVerifiedUsers).to.equal(5);

    const campaignState = await program.account.campaign.fetch(campaignPDA);
    expect(campaignState.completedUsers).to.equal(5);

    // Vault should now have 0 balance
    const vaultBal = await getAccount(provider.connection, vaultPDA);
    expect(Number(vaultBal.amount)).to.equal(0);
  });

  it("6. Prevents double-settlement on an already completed session", async () => {
    const participant = participants[0];
    const sessionId = sessionIds[0];
    const participantATA = await anchor.spl.token.getAssociatedTokenAddress(rewardMint, participant.publicKey);

    const [sessionPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), campaignPDA.toBuffer(), sessionId],
      program.programId
    );

    const digest = crypto.createHash("sha256").update(`Duplicate`).digest();

    try {
      await program.methods
        .attestAndSettle([...digest])
        .accounts({
          founder: founder.publicKey,
          participant: participant.publicKey,
          campaign: campaignPDA,
          vault: vaultPDA,
          participantTokenAccount: participantATA,
          session: sessionPDA,
          milestoneProof: null,
          systemProgram: SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([founder])
        .rpc();
      expect.fail("Double settle must fail");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidSessionStatus");
    }
  });

  it("7. Closes campaign and reclaims any leftover rent", async () => {
    await program.methods
      .closeCampaign()
      .accounts({
        founder: founder.publicKey,
        campaign: campaignPDA,
        vault: vaultPDA,
        founderTokenAccount: founderTokenAccount,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([founder])
      .rpc();

    const campaignInfo = await provider.connection.getAccountInfo(campaignPDA);
    expect(campaignInfo).to.be.null;
  });
});