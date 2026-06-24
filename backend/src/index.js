const express = require('express');
const cors = require('cors');
const departuresRouter = require('./routes/departures');

const app = express();
const PORT = process.env.PORT || 3001;

// Allow requests from the Vite dev server and its production preview
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }));
app.use(express.json());

app.use('/departures', departuresRouter);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Lagovia backend running on http://localhost:${PORT}`);
});
