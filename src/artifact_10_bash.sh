curl -X POST http://localhost:8080/api/v1/interviews/complete \
    -H "Content-Type: application/json" \
    -d '{
      "campaignId": 42,
      "userPublicKey": "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
      "notes": "User requested sub-second finality and native token swap UI.",
      "feedbackScore": 9,
      "founderEmail": "founder@solanaproject.io"
    }'