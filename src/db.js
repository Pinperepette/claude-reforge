'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const DATA_DIR = path.join(os.homedir(), '.claude-reforge');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const DB_PATH = path.join(DATA_DIR, 'memory.db');
const ERROR_LOG = path.join(DATA_DIR, 'error.log');

function ensureDirs() {
  for (const dir of [DATA_DIR, SESSIONS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

let _db = null;

function getDb() {
  if (_db) return _db;
  ensureDirs();

  const Database = require('better-sqlite3');
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS episodes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task        TEXT    NOT NULL,
      context     TEXT,
      actions     TEXT    DEFAULT '[]',
      error       TEXT,
      solution    TEXT,
      outcome     TEXT    DEFAULT 'unknown',
      importance  REAL    DEFAULT 0.5,
      keywords    TEXT    DEFAULT '[]',
      project_id  TEXT,
      hit_count   INTEGER DEFAULT 0,
      created_at  INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS semantic_facts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      fact_key    TEXT    NOT NULL,
      fact_value  TEXT    NOT NULL,
      confidence  REAL    DEFAULT 1.0,
      project_id  TEXT,
      updated_at  INTEGER DEFAULT (unixepoch()),
      UNIQUE(fact_key, project_id)
    );
    CREATE TABLE IF NOT EXISTS rules (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      condition        TEXT    NOT NULL,
      action           TEXT    NOT NULL,
      confidence       REAL    DEFAULT 0.5,
      hit_count        INTEGER DEFAULT 1,
      source_episodes  TEXT    DEFAULT '[]',
      created_at       INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS injections (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT    NOT NULL,
      project_id      TEXT,
      episodes_hit    TEXT    DEFAULT '[]',
      rules_hit       TEXT    DEFAULT '[]',
      errors_in_eps   INTEGER DEFAULT 0,
      solutions_in_eps INTEGER DEFAULT 0,
      created_at      INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_ep_project    ON episodes(project_id);
    CREATE INDEX IF NOT EXISTS idx_ep_importance ON episodes(importance DESC);
    CREATE INDEX IF NOT EXISTS idx_facts_key     ON semantic_facts(fact_key);
    CREATE INDEX IF NOT EXISTS idx_inj_project   ON injections(project_id);
    CREATE INDEX IF NOT EXISTS idx_inj_time      ON injections(created_at);
  `);

  // Safe migrations for existing databases
  try { _db.exec('ALTER TABLE episodes ADD COLUMN hit_count INTEGER DEFAULT 0'); } catch (_) {}
  try { _db.exec("ALTER TABLE episodes ADD COLUMN tried_actions TEXT DEFAULT '[]'"); } catch (_) {}
  try {
    _db.exec('CREATE TABLE IF NOT EXISTS injections (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, project_id TEXT, episodes_hit TEXT DEFAULT "[]", rules_hit TEXT DEFAULT "[]", errors_in_eps INTEGER DEFAULT 0, solutions_in_eps INTEGER DEFAULT 0, created_at INTEGER DEFAULT (unixepoch()))');
  } catch (_) {}

  return _db;
}

function logError(err) {
  try {
    ensureDirs();
    const msg = `[${new Date().toISOString()}] ${err.stack || err.message || String(err)}\n`;
    fs.appendFileSync(ERROR_LOG, msg);
  } catch (_) {}
}

function getSessionPath(sessionId) {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

function loadSession(sessionId) {
  try {
    const p = getSessionPath(sessionId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveSession(session) {
  try {
    ensureDirs();
    fs.writeFileSync(getSessionPath(session.sessionId), JSON.stringify(session));
  } catch (e) {
    logError(e);
  }
}

function deleteSession(sessionId) {
  try {
    const p = getSessionPath(sessionId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
}

function createSession(sessionId, projectId, projectPath) {
  const session = {
    sessionId,
    projectId,
    projectPath,
    startTime: Date.now(),
    task: '',
    actions: [],
    fileChanges: [],
    commands: [],
    errors: [],
    injectedMemory: false
  };
  saveSession(session);
  return session;
}

module.exports = {
  getDb, logError,
  loadSession, saveSession, deleteSession, createSession,
  DATA_DIR, DB_PATH, SESSIONS_DIR, ERROR_LOG
};
