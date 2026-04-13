const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS writing_samples (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_writing_user ON writing_samples(user_id);
    CREATE TABLE IF NOT EXISTS survival_scores (
      id SERIAL PRIMARY KEY,
      player_names TEXT NOT NULL,
      turns INTEGER NOT NULL,
      mobs_defeated INTEGER NOT NULL DEFAULT 0,
      mode VARCHAR(10) NOT NULL CHECK (mode IN ('solo','duo')),
      played_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sv_mode ON survival_scores(mode, turns DESC);
    CREATE TABLE IF NOT EXISTS dnd_adventures (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      theme TEXT,
      adventure_json JSONB NOT NULL,
      play_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS dnd_sessions (
      id SERIAL PRIMARY KEY,
      adventure_id INTEGER REFERENCES dnd_adventures(id),
      player_names TEXT NOT NULL,
      outcome VARCHAR(20) DEFAULT 'ongoing',
      chapters_completed INTEGER DEFAULT 0,
      played_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('DB initialized');
}

async function saveSvScore(playerNames, turns, mobsDefeated, mode) {
  await pool.query(
    'INSERT INTO survival_scores (player_names, turns, mobs_defeated, mode) VALUES ($1,$2,$3,$4)',
    [playerNames, turns, mobsDefeated, mode]
  );
}

async function getSvLeaderboard(mode, limit=20) {
  const r = await pool.query(
    `SELECT player_names, turns, mobs_defeated, played_at
     FROM survival_scores
     WHERE mode=$1
     ORDER BY turns DESC, mobs_defeated DESC
     LIMIT $2`,
    [mode, limit]
  );
  return r.rows;
}

async function createUser(username, passwordHash, displayName) {
  const r = await pool.query(
    'INSERT INTO users (username, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id, username, display_name',
    [username.toLowerCase(), passwordHash, displayName || username]
  );
  return r.rows[0];
}

async function getUserByUsername(username) {
  const r = await pool.query('SELECT * FROM users WHERE username=$1', [username.toLowerCase()]);
  return r.rows[0] || null;
}

async function getUserById(id) {
  const r = await pool.query('SELECT id, username, display_name FROM users WHERE id=$1', [id]);
  return r.rows[0] || null;
}

async function saveWritingSample(userId, question, answer) {
  await pool.query(
    'INSERT INTO writing_samples (user_id, question, answer) VALUES ($1,$2,$3)',
    [userId, question, answer]
  );
}

async function getWritingSamples(userId, limit = 15) {
  const r = await pool.query(
    'SELECT question, answer FROM writing_samples WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return r.rows;
}

async function getHumanoLeaderboard(limit=20) {
  const r = await pool.query(
    `SELECT u.display_name AS name, COUNT(ws.id) AS score
     FROM users u
     LEFT JOIN writing_samples ws ON ws.user_id = u.id
     GROUP BY u.id, u.display_name
     HAVING COUNT(ws.id) > 0
     ORDER BY score DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows.map(row=>({name:row.name, score:Number(row.score)}));
}

// ── DND FUNCTIONS ──────────────────────────────────────────────
async function saveDndAdventure(title, summary, theme, adventureJson) {
  const r = await pool.query(
    'INSERT INTO dnd_adventures (title, summary, theme, adventure_json) VALUES ($1,$2,$3,$4) RETURNING id',
    [title, summary, theme, JSON.stringify(adventureJson)]
  );
  return r.rows[0].id;
}

async function getDndAdventures(limit=20) {
  const r = await pool.query(
    'SELECT id, title, summary, theme, play_count, created_at FROM dnd_adventures ORDER BY play_count DESC, created_at DESC LIMIT $1',
    [limit]
  );
  return r.rows;
}

async function getDndAdventureById(id) {
  const r = await pool.query('SELECT * FROM dnd_adventures WHERE id=$1', [id]);
  if(!r.rows[0]) return null;
  return {...r.rows[0], adventure_json: r.rows[0].adventure_json};
}

async function incrementDndPlayCount(id) {
  await pool.query('UPDATE dnd_adventures SET play_count=play_count+1 WHERE id=$1', [id]);
}

async function saveDndSession(adventureId, playerNames, outcome, chaptersCompleted) {
  await pool.query(
    'INSERT INTO dnd_sessions (adventure_id, player_names, outcome, chapters_completed) VALUES ($1,$2,$3,$4)',
    [adventureId, playerNames, outcome, chaptersCompleted]
  );
}

module.exports = {
  initDB, createUser, getUserByUsername, getUserById,
  saveWritingSample, getWritingSamples,
  saveSvScore, getSvLeaderboard, getHumanoLeaderboard,
  saveDndAdventure, getDndAdventures, getDndAdventureById,
  incrementDndPlayCount, saveDndSession
};
