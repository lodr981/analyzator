// Úložiště aktivit. Když je nastavená DATABASE_URL (Railway Postgres), používá
// Postgres; jinak spadne na jednoduchý JSON soubor (pro lokální vývoj).
// Díky tomu appka běží i bez databáze.

import fs from 'node:fs';
import path from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL;
const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'activities.json');

let pool = null;
let backend = 'file';

export function dbBackend() {
  return backend;
}

async function initPostgres() {
  const { default: pg } = await import('pg');
  const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;
  pool = new pg.Pool({ connectionString: DATABASE_URL, ssl });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activities (
      id            TEXT PRIMARY KEY,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      activity_date TIMESTAMPTZ,
      sport         TEXT,
      distance_km   REAL,
      duration_sec  INTEGER,
      avg_hr        INTEGER,
      rating        INTEGER,
      ai_generated  BOOLEAN DEFAULT false,
      payload       JSONB NOT NULL
    );
  `);
  backend = 'postgres';
}

export async function initDb() {
  if (DATABASE_URL) {
    try {
      await initPostgres();
      console.log('DB: postgres');
      return;
    } catch (err) {
      console.error('Postgres init selhal, používám souborové úložiště:', err.message);
    }
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]');
  backend = 'file';
  console.log('DB: souborové úložiště (' + FILE + ')');
}

// ---- souborový fallback ----
function readFile() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}
function writeFile(list) {
  fs.writeFileSync(FILE, JSON.stringify(list));
}

// ---- veřejné API ----

// Uloží jednu aktivitu (record = { id, ts, summary, coach, labels }).
export async function addActivity(record) {
  if (backend === 'postgres') {
    const s = record.summary || {};
    const c = record.coach || {};
    await pool.query(
      `INSERT INTO activities
         (id, activity_date, sport, distance_km, duration_sec, avg_hr, rating, ai_generated, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        record.id,
        s.startTime || null,
        s.sport || null,
        s.distanceKm ?? null,
        s.durationSec ?? null,
        s.avgHr ?? null,
        c.rating ?? null,
        Boolean(c.aiGenerated),
        record,
      ]
    );
  } else {
    const list = readFile();
    list.unshift(record);
    writeFile(list.slice(0, 500));
  }
  return record;
}

// Vrátí aktivity (nejnovější první).
export async function listActivities() {
  if (backend === 'postgres') {
    const { rows } = await pool.query(
      `SELECT payload FROM activities
       ORDER BY COALESCE(activity_date, created_at) DESC
       LIMIT 500`
    );
    return rows.map((r) => r.payload);
  }
  return readFile();
}

// Smaže aktivitu podle id.
export async function deleteActivity(id) {
  if (backend === 'postgres') {
    await pool.query('DELETE FROM activities WHERE id = $1', [id]);
  } else {
    writeFile(readFile().filter((a) => a.id !== id));
  }
}
