const express = require('express');
const cors = require('cors');
const departuresRouter = require('./routes/departures');
const { getStations, getCacheStatus } = require('./services/irail');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:4173',
    'https://vishnuch99.github.io',
  ],
}));
app.use(express.json());

app.use('/departures', departuresRouter);

app.get('/health', (_, res) => {
  const { stationsCached } = getCacheStatus();
  if (stationsCached) return res.json({ status: 'ok' });
  res.status(503).json({ status: 'degraded', reason: 'station cache not populated' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Lagovia backend running on http://localhost:${PORT}`);
    getStations().catch((err) => console.warn('[startup] Station prefetch failed:', err.message));
  });
}

module.exports = app;
