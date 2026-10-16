import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRouter from './routes/auth.js';
import eventsRouter from './routes/events.js';
import registrationsRouter from './routes/registrations.js';
import { initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(publicDir));

app.use('/api/auth', authRouter);
app.use('/api/events', eventsRouter);
app.use('/api', registrationsRouter);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

initDb();

app.listen(PORT, () => {
  console.log(`Event Registration System running at http://localhost:${PORT}`);
});
