// Úložiště aktivit. Když je nastavená DATABASE_URL (Railway Postgres), používá
// Postgres; jinak spadne na jednoduchý JSON soubor (pro lokální vývoj).
// Díky tomu appka běží i bez databáze.

import fs from 'node:fs';
import path from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_PUBLIC_URL = process.env.DATABASE_PUBLIC_URL; // Railway: veřejná adresa jako fallback
const HAS_DB = Boolean(DATABASE_URL || DATABASE_PUBLIC_URL);
const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'activities.json');

let pool = null;
let backend = 'file';
let lastError = null;

export function dbBackend() {
  return backend;
}

// Diagnostika pro /healthz — proč nejede Postgres.
export function dbInfo() {
  return {
    db: backend,
    hasDbUrl: HAS_DB,
    hasPublicUrl: Boolean(DATABASE_PUBLIC_URL),
    dbSsl: process.env.DATABASE_SSL === 'true',
    dbError: lastError,
  };
}

// Vytvoří/aktualizuje schéma. Kritická je tabulka activities; zbytek nesmí
// shodit Postgres (jinak bychom spadli na soubor a přišli o data v DB).
async function ensureSchema() {
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
  try {
    await pool.query('ALTER TABLE activities ADD COLUMN IF NOT EXISTS fp TEXT;');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_activities_fp ON activities(fp);');
    await pool.query(`CREATE TABLE IF NOT EXISTS plan_state (id INT PRIMARY KEY, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), state JSONB NOT NULL);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS chat_state (id INT PRIMARY KEY, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), state JSONB NOT NULL);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS measurements (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), date DATE, weight_kg REAL, height_cm REAL);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS nutrition (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), date DATE, text TEXT);`);
  } catch (e) {
    console.error('DDL rozšíření selhalo (pokračuji na Postgresu):', e.message);
  }
}

// Odolné připojení: zkusí bez SSL i s SSL a několikrát to zopakuje
// (Railway DB nemusí být hned po startu ready). Když opravdu nejde, hodí chybu.
async function connectPostgres() {
  const { default: pg } = await import('pg');
  const sslModes = process.env.DATABASE_SSL === 'true'
    ? [{ rejectUnauthorized: false }]
    : [false, { rejectUnauthorized: false }];
  // zkus interní i veřejnou adresu (interní se občas nepřipojí)
  const urls = [DATABASE_URL, DATABASE_PUBLIC_URL].filter(Boolean).filter((u, i, a) => a.indexOf(u) === i);

  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    for (const url of urls) {
      for (const ssl of sslModes) {
        try {
          const p = new pg.Pool({ connectionString: url, ssl, connectionTimeoutMillis: 6000, keepAlive: true, idleTimeoutMillis: 30000 });
          p.on('error', (e) => console.error('pg pool error (idle):', e.message)); // ať odpojení nezhodí proces
          await p.query('SELECT 1');
          pool = p;
          await ensureSchema();
          backend = 'postgres';
          console.log(`DB: postgres (ssl=${ssl ? 'ano' : 'ne'}, pokus ${attempt})`);
          return;
        } catch (err) {
          lastErr = err;
          try { await pool?.end(); } catch {}
          pool = null;
        }
      }
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 1000 * attempt)); // narůstající prodleva
  }
  throw lastErr;
}

export async function initDb() {
  if (HAS_DB) {
    try {
      await connectPostgres();
      return;
    } catch (err) {
      lastError = err?.message || 'neznámá chyba';
      console.error('Postgres se nepřipojil ani po opakování, používám soubor:', lastError);
    }
  } else {
    lastError = 'DATABASE_URL není nastavená';
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]');
  backend = 'file';
  console.log('DB: souborové úložiště (' + FILE + ') — POZOR: na Railway se maže při deployi!');
}

// ---- souborový fallback ----
function readFile() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}
function writeFile(list) {
  fs.writeFileSync(FILE, JSON.stringify(list));
}

// ---- veřejné API ----

// Bezpečně převede vstup na validní ISO datum, jinak null (ochrana INSERTu).
function validDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Ochrana INSERTu do číselných sloupců: celé číslo (INTEGER) / číslo (REAL) / null.
// Reálná data z Garminu mají desetinné trvání i tep, INTEGER by je odmítl.
const asInt = (v) => (v == null || isNaN(Number(v)) ? null : Math.round(Number(v)));
const asNum = (v) => (v == null || isNaN(Number(v)) ? null : Number(v));

// Uloží jednu aktivitu (record = { id, ts, summary, coach, labels }).
export async function addActivity(record) {
  if (backend === 'postgres') {
    const s = record.summary || {};
    const c = record.coach || {};
    await pool.query(
      `INSERT INTO activities
         (id, activity_date, sport, distance_km, duration_sec, avg_hr, rating, ai_generated, fp, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        record.id,
        validDate(s.startTime),
        s.sport || null,
        asNum(s.distanceKm),
        asInt(s.durationSec),
        asInt(s.avgHr),
        asInt(c.rating),
        Boolean(c.aiGenerated),
        record.fp || null,
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

// Najde aktivitu podle otisku (duplicita), nebo null.
export async function findByFingerprint(fp) {
  if (!fp) return null;
  if (backend === 'postgres') {
    const { rows } = await pool.query('SELECT payload FROM activities WHERE fp = $1 LIMIT 1', [fp]);
    return rows[0]?.payload || null;
  }
  return readFile().find((a) => a.fp === fp) || null;
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

// ---- plán týdne (jeden aktuální stav: plan + chat) ----
const PLAN_FILE = path.join(DATA_DIR, 'plan.json');

export async function getPlan() {
  if (backend === 'postgres') {
    const { rows } = await pool.query('SELECT state FROM plan_state WHERE id = 1');
    return rows[0]?.state || null;
  }
  try { return JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8')); } catch { return null; }
}

export async function savePlan(state) {
  if (backend === 'postgres') {
    await pool.query(
      `INSERT INTO plan_state (id, state, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET state = $1, updated_at = now()`,
      [state]
    );
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PLAN_FILE, JSON.stringify(state));
  }
  return state;
}

// ---- chat parťáka (jeden stav: messages) ----
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');

export async function getChat() {
  if (backend === 'postgres') {
    const { rows } = await pool.query('SELECT state FROM chat_state WHERE id = 1');
    return rows[0]?.state || null;
  }
  try { return JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')); } catch { return null; }
}
export async function saveChat(state) {
  if (backend === 'postgres') {
    await pool.query(
      `INSERT INTO chat_state (id, state, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET state = $1, updated_at = now()`,
      [state]
    );
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CHAT_FILE, JSON.stringify(state));
  }
  return state;
}

// ---- váha & míry ----
const MEAS_FILE = path.join(DATA_DIR, 'measurements.json');
const newId = () => Date.now() + '-' + Math.random().toString(36).slice(2, 7);
const mFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
const mWrite = (f, list) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(list)); };

export async function addMeasurement({ weight_kg = null, height_cm = null, date = null }) {
  const rec = { id: newId(), date: validDate(date) || new Date().toISOString(), weight_kg, height_cm };
  if (backend === 'postgres') {
    await pool.query(
      'INSERT INTO measurements (id, date, weight_kg, height_cm) VALUES ($1,$2,$3,$4)',
      [rec.id, rec.date, weight_kg, height_cm]
    );
  } else {
    const list = mFile(MEAS_FILE); list.unshift(rec); mWrite(MEAS_FILE, list.slice(0, 500));
  }
  return rec;
}
export async function listMeasurements() {
  if (backend === 'postgres') {
    const { rows } = await pool.query('SELECT id, date, weight_kg, height_cm FROM measurements ORDER BY date DESC NULLS LAST LIMIT 200');
    return rows.map((r) => ({ ...r, date: r.date ? new Date(r.date).toISOString() : null }));
  }
  return mFile(MEAS_FILE);
}

// ---- výživa ----
const NUTR_FILE = path.join(DATA_DIR, 'nutrition.json');

export async function addNutrition({ text, date = null }) {
  const rec = { id: newId(), date: validDate(date) || new Date().toISOString(), text: String(text || '') };
  if (backend === 'postgres') {
    await pool.query('INSERT INTO nutrition (id, date, text) VALUES ($1,$2,$3)', [rec.id, rec.date, rec.text]);
  } else {
    const list = mFile(NUTR_FILE); list.unshift(rec); mWrite(NUTR_FILE, list.slice(0, 500));
  }
  return rec;
}
export async function listNutrition() {
  if (backend === 'postgres') {
    const { rows } = await pool.query('SELECT id, date, text FROM nutrition ORDER BY date DESC NULLS LAST LIMIT 200');
    return rows.map((r) => ({ ...r, date: r.date ? new Date(r.date).toISOString() : null }));
  }
  return mFile(NUTR_FILE);
}

// ---- úprava aktivity (tag „závod", poznámka) ----
export async function updateActivity(id, patch) {
  if (backend === 'postgres') {
    const { rows } = await pool.query('SELECT payload FROM activities WHERE id = $1', [id]);
    if (!rows[0]) return null;
    const merged = { ...rows[0].payload, ...patch };
    await pool.query('UPDATE activities SET payload = $2 WHERE id = $1', [id, merged]);
    return merged;
  }
  const list = readFile();
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch };
  writeFile(list);
  return list[i];
}
