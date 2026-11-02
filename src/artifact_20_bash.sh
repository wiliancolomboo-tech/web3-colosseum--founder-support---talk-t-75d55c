# 1. Clone repository & install dependencies
git clone https://github.com/colosseum-org/proof-of-user.git
cd proof-of-user
npm install
cd client && npm install && npm run build && cd ..

# 2. Build Anchor Smart Contract
anchor build

# 3. Synchronize program ID across source code
anchor keys sync

# 4. Run automated test suite against local validator
anchor test

# 5. Deploy to Solana Devnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --provider.cluster devnet