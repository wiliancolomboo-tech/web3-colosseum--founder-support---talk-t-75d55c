# 1. Clone repository and install dependencies
git clone https://github.com/colosseum-org/founder-discovery-protocol.git
cd founder-discovery-protocol
npm install

# 2. Build and verify the Anchor program
anchor build
anchor test

# 3. Deploy the Anchor Smart Contract to Solana Devnet
solana config set --url devnet
solana airdrop 2 $(solana address)
anchor deploy --provider.cluster devnet

# 4. Initialize the Founder 5-User Campaign
npm run campaign:init -- \
  --founder ./wallets/founder.json \
  --name "MyColosseumStartup" \
  --bounty 0.05 \
  --deposit 0.3

# 5. Attest each user interview upon call completion
npm run interview:submit -- \
  --founder ./wallets/founder.json \
  --user ./wallets/user_1.json \
  --input ./data/sample_interview.json