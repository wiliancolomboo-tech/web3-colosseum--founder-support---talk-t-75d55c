# 1. Build and verify Anchor smart contract
anchor build
anchor test

# 2. Deploy Anchor Program to Solana Devnet / Mainnet-Beta
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --program-name userloop

# 3. Initialize Gateway Container
cp .env.example .env
# Edit .env with your keys
docker compose up -d --build

# 4. Ingest an Interview Attestation (Simulating Cal.com webhook dispatch)
curl -X POST http://localhost:8080/api/interview-complete \
  -H "Content-Type: application/json" \
  -d '{
    "campaignPubkey": "Loop5X1111111111111111111111111111111111111",
    "sessionIdHex": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    "participantWallet": "7v9WBiuh5KWf72e3iuhkGg5hPnm9bYp12p4K",
    "participantEmail": "founder.user1@solana.org",
    "transcriptSummary": "User requested seamless wallet-less onboarding and gasless transactions for everyday micro-payments.",
    "keyTakeaway": "Onboarding UX is currently too technical for non-crypto users.",
    "sentimentScore": 8,
    "actionItem": "Integrate Solana Pay and TipLink SDK into checkout flow."
  }'