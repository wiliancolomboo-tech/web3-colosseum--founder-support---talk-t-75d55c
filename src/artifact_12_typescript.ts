// src/index.js (Express Health Endpoint)
import express from 'express';
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'colosseum-founder-pulse',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`FounderPulse Daemon listening on port ${PORT}`);
});