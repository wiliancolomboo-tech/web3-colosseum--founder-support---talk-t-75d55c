# 1. Build smart contract binaries
anchor build

# 2. Deploy to Solana Devnet
solana program deploy ./target/deploy/founder_support.so --program-id ColoSupp5Users111111111111111111111111111111 --url devnet

# 3. Install Client Dependencies
npm install @coral-xyz/anchor @solana/web3.js axios resend dotenv

# 4. Run automated test suite
anchor test