# 1. Build Solana Anchor Program
anchor build

# 2. Deploy to Solana Devnet
solana program deploy \
  --program-id target/deploy/userloop-keypair.json \
  target/deploy/userloop.so \
  --url devnet

# 3. Install Client Dependencies
npm install

# 4. Execute Full QA Test Suite
anchor test

# 5. Launch Enterprise Integration Agent via Docker
docker compose up -d --build

# 6. Verify Healthcheck Endpoint
curl http://localhost:8080/health
# {"status":"ok","network":"devnet","program":"Loopx5v111111111111111111111111111111111111","uptime":142.3}