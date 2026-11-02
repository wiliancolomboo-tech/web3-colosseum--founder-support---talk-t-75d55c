# Initialize campaign
   node dist/cli.js create-campaign -n "SolanaPay-V2" -t 5

   # Submit Interview #1
   node dist/cli.js submit-interview \
     -n "SolanaPay-V2" \
     -k ./tests/fixtures/user1-keypair.json \
     -s 9 \
     -d 30 \
     -t "Merchant noted gas fees are great, but Shopify plugin fails during checkout redirects." \
     -e "founder@colosseum.org"