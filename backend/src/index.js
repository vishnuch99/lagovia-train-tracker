const express = require('express');
const cors = require('cors');
const departuresRouter = require('./routes/departures');
const { getStations, getCacheStatus } = require('./services/irail');

const app = express();
const PORT = process.env.PORT || 3001;

// Allow requests from the Vite dev server and its production preview
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }));
app.use(express.json());

app.use('/departures', departuresRouter);

app.get('/health', (_, res) => {
  const { stationsCached } = getCacheStatus();
  if (stationsCached) return res.json({ status: 'ok' });
  res.status(503).json({ status: 'degraded', reason: 'station cache not populated' });
});

app.listen(PORT, () => {
  console.log(`Lagovia backend running on http://localhost:${PORT}`);
  // Warm the station cache immediately so the first search doesn't pay the iRail round-trip
  getStations().catch((err) => console.warn('[startup] Station prefetch failed:', err.message));
});
