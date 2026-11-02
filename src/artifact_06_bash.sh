# Set Solana CLI to Devnet
solana config set --url https://api.devnet.solana.com

# Build program binaries
anchor build

# Sync Program ID
anchor keys sync

# Deploy to Devnet
anchor deploy --program-name founder_support