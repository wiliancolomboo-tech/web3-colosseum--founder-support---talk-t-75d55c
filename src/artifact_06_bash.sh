# 1. Build smart contract in release mode
anchor build

# 2. Deploy to Solana Devnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --provider.cluster devnet

# 3. Synchronize TypeScript program ID
export PROGRAM_ID="<DEPLOYED_PROGRAM_ADDRESS>"

# 4. Execute the "Talk to 5 Users" Automated Orchestration
ts-node scripts/orchestrate-interviews.ts