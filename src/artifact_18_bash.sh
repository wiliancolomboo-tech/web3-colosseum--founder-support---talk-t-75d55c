# 1. Build and test Anchor smart contract locally
anchor build
anchor test

# 2. Deploy program to Solana Devnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --provider.cluster devnet

# 3. Initialize founder discovery campaign via CLI
npm install
npm run build
npx ts-node src/cli.ts init --name "VoiceLoop" --persona "DeFi Power Users"

# 4. Record 5 interviews to complete the requirement
npx ts-node src/cli.ts record -n "VoiceLoop" -u "User111111111111111111111111111111111111111" -e "alice@solana.org" -s 9 -c 1 -m "High priority on mobile UX and transaction simulation"
npx ts-node src/cli.ts record -n "VoiceLoop" -u "User222222222222222222222222222222222222222" -e "bob@solana.org" -s 8 -c 0 -m "Needs seamless email-based embedded wallet onboarding"
npx ts-node src/cli.ts record -n "VoiceLoop" -u "User333333333333333333333333333333333333333" -e "carol@solana.org" -s 10 -c 3 -m "Requires clearer Anchor documentation and IDL parsing guides"
npx ts-node src/cli.ts record -n "VoiceLoop" -u "User444444444444444444444444444444444444444" -e "dan@solana.org" -s 7 -c 2 -m "Deep liquidity aggregation on AMM pools requested"
npx ts-node src/cli.ts record -n "VoiceLoop" -u "User555555555555555555555555555555555555555" -e "elena@solana.org" -s 9 -c 4 -m "Audit coverage and open-source verification are prerequisites"

# 5. Launch turnkey containerized daemon
docker compose up -d --build