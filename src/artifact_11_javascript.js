#!/usr/bin/env node
const axios = require("axios");

const [,, wallet, email, index, rating, duration, ...notesArr] = process.argv;
const notes = notesArr.join(" ");

if (!wallet || !index || !rating || !notes) {
  console.log("Usage: node cli.js <WALLET> <EMAIL> <INDEX_0_TO_4> <RATING_1_TO_5> <MINUTES> <NOTES...>");
  process.exit(1);
}

(async () => {
  try {
    const res = await axios.post("http://localhost:3000/api/complete-interview", {
      userWallet: wallet,
      userEmail: email,
      interviewIndex: parseInt(index),
      rating: parseInt(rating),
      durationMinutes: parseInt(duration || "30"),
      notes
    });
    console.log("✅ Attested to Solana!", res.data);
  } catch (err) {
    console.error("❌ Error:", err.response ? err.response.data : err.message);
  }
})();