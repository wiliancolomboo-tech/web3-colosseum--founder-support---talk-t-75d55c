# Initialize Campaign
   npx ts-node cli/src/index.ts init-campaign -n "Colosseum-ProjectX"

   # Record 5 user interviews consecutively with authentic feedback
   npx ts-node cli/src/index.ts record-interview \
     -c "Colosseum-ProjectX" \
     -u "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" \
     -e "trader1@solana.org" \
     -t "User wants 1-click delta neutral vault rebalancing" \
     -i "Needs sub-400ms transaction execution and clear liquidation alarms" \
     -n 9 -d 45