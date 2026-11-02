const [projectPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pulse_project"), founderPubkey.toBuffer(), Buffer.from(cohortId)],
    PROGRAM_ID
  );
  const account = await program.account.projectAccount.fetch(projectPda);
  console.log(`Interviews verified: ${account.interviewCount}/5. Complete: ${account.isMilestoneCompleted}`);