# Set Solana CLI to Devnet
solana config set --url https://api.devnet.solana.com

# Build Anchor binary
anchor build

# Sync Program IDs across lib.rs and Anchor.toml
anchor keys sync

# Deploy to Devnet
anchor deploy --provider.cluster devnet