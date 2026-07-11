import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseActivity } from './src/parse.js';
import { evaluate, sportLabel, sportIcon, fmtDuration } from './src/coach.js';
import { aiEnabled, generateCoachComment } from './src/aiCoach.js';
import { initDb, dbBackend, addActivity, listActivities, deleteActivity } from './src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const genId = () => Date.now() + '-' + Math.random().toString(36).slice(2, 8);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Nahrání a vyhodnocení aktivity.
app.post('/api/upload', upload.single('activity'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Žádný soubor. Nahraj .FIT, .TCX nebo .GPX.' });
  try {
    const summary = await parseActivity(req.file.buffer, req.file.originalname);
    const coach = evaluate(summary);

    // Pokud je nastavený API klíč, nech text trenéra napsat Claude.
    const aiText = await generateCoachComment(summary, coach);
    if (aiText) {
      coach.headline = aiText;
      coach.aiGenerated = true;
    }

    const record = {
      id: genId(),
      ts: Date.now(),
      summary,
      coach,
      labels: {
        sport: sportLabel(summary.sport),
        sportIcon: sportIcon(summary.sport),
        duration: fmtDuration(summary.durationSec),
      },
    };

    // Ulož na server (best-effort — chyba DB nesmí shodit vyhodnocení).
    try {
      await addActivity(record);
    } catch (dbErr) {
      console.error('DB save error:', dbErr.message);
    }

    res.json(record);
  } catch (err) {
    console.error('parse error:', err.message);
    res.status(422).json({ error: err.message || 'Soubor se nepodařilo zpracovat.' });
  }
});

// Seznam uložených aktivit (nejnovější první).
app.get('/api/activities', async (_req, res) => {
  try {
    res.json(await listActivities());
  } catch (err) {
    console.error('DB list error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se načíst historii.' });
  }
});

// Smazání aktivity.
app.delete('/api/activities/:id', async (req, res) => {
  try {
    await deleteActivity(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB delete error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se smazat.' });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true, ai: aiEnabled(), db: dbBackend() }));

initDb().finally(() => {
  app.listen(PORT, () => {
    console.log(`TEMPO běží na portu ${PORT}`);
  });
});
