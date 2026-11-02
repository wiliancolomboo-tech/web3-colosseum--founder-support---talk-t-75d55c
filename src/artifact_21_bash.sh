# 1. Build smart contract binaries
anchor build

# 2. Synchronize Program ID
solana address -k target/deploy/pulse_discovery-keypair.json
# (Update declare_id!() in lib.rs & Anchor.toml with the printed pubkey)

# 3. Deploy to Solana Devnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --provider.cluster devnet

# 4. Generate client configuration
cd client
cp .env.example .env
npm install
npm run build