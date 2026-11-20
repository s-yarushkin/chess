import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDb(file = process.env.DB_PATH || './storage/chess.sqlite') {
  if (file !== ':memory:') mkdirSync(dirname(resolve(file)), {recursive:true});
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, telegram_id TEXT UNIQUE, display_name TEXT NOT NULL DEFAULT '',
      leaderboard_opt_in INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0 CHECK(points>=0),
      solved_count INTEGER NOT NULL DEFAULT 0 CHECK(solved_count>=0),
      skill_rating INTEGER NOT NULL DEFAULT 800,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS puzzles (
      id TEXT PRIMARY KEY, fen TEXT NOT NULL, category TEXT NOT NULL,
      rating INTEGER NOT NULL, line_json TEXT NOT NULL, source TEXT NOT NULL,
      source_url TEXT NOT NULL DEFAULT '', quality TEXT NOT NULL DEFAULT 'verified',
      theme TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_puzzles_category_rating ON puzzles(category,rating);
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      puzzle_id TEXT NOT NULL REFERENCES puzzles(id), current_fen TEXT NOT NULL,
      cursor INTEGER NOT NULL DEFAULT 0, hints INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
      started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id,status);
    CREATE TABLE IF NOT EXISTS completions (
      user_id TEXT NOT NULL REFERENCES users(id), puzzle_id TEXT NOT NULL REFERENCES puzzles(id),
      points INTEGER NOT NULL, solved_at INTEGER NOT NULL,
      PRIMARY KEY(user_id,puzzle_id)
    );
    CREATE INDEX IF NOT EXISTS idx_completions_recent ON completions(solved_at);
  `);
  return db;
}

export function transaction(db, cb) {
  db.exec('BEGIN IMMEDIATE');
  try { const out=cb(); db.exec('COMMIT');return out; }
  catch(e){db.exec('ROLLBACK');throw e;}
}
