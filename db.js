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
  `);
  console.log('DB initialized');
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

module.exports = { initDB, createUser, getUserByUsername, getUserById, saveWritingSample, getWritingSamples };
