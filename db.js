// db.js — SQLite database setup and helpers
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'readyproof.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,
    client_name     TEXT NOT NULL,
    client_email    TEXT NOT NULL,
    dropbox_link    TEXT NOT NULL,
    magic_token     TEXT UNIQUE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    package_name    TEXT,
    num_included    INTEGER DEFAULT 0,
    notes           TEXT,
    payment_status  TEXT NOT NULL DEFAULT 'unpaid',
    balance_owed    REAL DEFAULT 0,
    payment_notes   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    submitted_at    TEXT,
    editor_sent_at  TEXT
  );
  CREATE TABLE IF NOT EXISTS selections (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    is_favorite  INTEGER NOT NULL DEFAULT 0,
    is_selected  INTEGER NOT NULL DEFAULT 0,
    client_note  TEXT,
    sort_order   INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, filename)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    order_type   TEXT NOT NULL,
    quantity     INTEGER DEFAULT 1,
    details      TEXT,
    price        REAL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migrate existing databases safely
try { db.exec(`ALTER TABLE sessions ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'`); } catch(e) {}
try { db.exec(`ALTER TABLE sessions ADD COLUMN balance_owed REAL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE sessions ADD COLUMN payment_notes TEXT`); } catch(e) {}

const getSessions = db.prepare(`
  SELECT s.*,
    (SELECT COUNT(*) FROM selections WHERE session_id = s.id AND is_selected = 1) AS selected_count,
    (SELECT COUNT(*) FROM selections WHERE session_id = s.id AND is_favorite = 1) AS favorite_count,
    (SELECT COUNT(*) FROM orders WHERE session_id = s.id) AS order_count
  FROM sessions s ORDER BY created_at DESC
`);

const getSessionByToken = db.prepare(`SELECT * FROM sessions WHERE magic_token = ?`);
const getSessionById    = db.prepare(`SELECT * FROM sessions WHERE id = ?`);

const createSession = db.prepare(`
  INSERT INTO sessions (id, client_name, client_email, dropbox_link, magic_token, package_name, num_included, notes, balance_owed, payment_notes)
  VALUES (@id, @client_name, @client_email, @dropbox_link, @magic_token, @package_name, @num_included, @notes, @balance_owed, @payment_notes)
`);

const updateSession = db.prepare(`
  UPDATE sessions SET
    client_name    = @client_name,
    client_email   = @client_email,
    dropbox_link   = @dropbox_link,
    package_name   = @package_name,
    num_included   = @num_included,
    notes          = @notes,
    payment_status = @payment_status,
    balance_owed   = @balance_owed,
    payment_notes  = @payment_notes
  WHERE id = @id
`);

const updateSessionStatus = db.prepare(`
  UPDATE sessions SET status = ?, submitted_at = CASE WHEN ? = 'submitted' THEN datetime('now') ELSE submitted_at END
  WHERE id = ?
`);

const markEditorSent  = db.prepare(`UPDATE sessions SET editor_sent_at = datetime('now'), status = 'editing' WHERE id = ?`);
const deleteSession   = db.prepare(`DELETE FROM sessions WHERE id = ?`);
const getSelections   = db.prepare(`SELECT * FROM selections WHERE session_id = ? ORDER BY sort_order, filename`);
const getSubmittedSelections = db.prepare(`SELECT * FROM selections WHERE session_id = ? AND is_selected = 1 ORDER BY filename`);

const upsertSelection = db.prepare(`
  INSERT INTO selections (id, session_id, filename, is_favorite, is_selected, client_note)
  VALUES (@id, @session_id, @filename, @is_favorite, @is_selected, @client_note)
  ON CONFLICT(session_id, filename) DO UPDATE SET
    is_favorite = excluded.is_favorite,
    is_selected = excluded.is_selected,
    client_note = excluded.client_note
`);

const clearSelections  = db.prepare(`DELETE FROM selections WHERE session_id = ?`);
const getOrders        = db.prepare(`SELECT * FROM orders WHERE session_id = ? ORDER BY created_at`);
const createOrder      = db.prepare(`INSERT INTO orders (id, session_id, order_type, quantity, details, price, status) VALUES (@id, @session_id, @order_type, @quantity, @details, @price, @status)`);
const updateOrderStatus = db.prepare(`UPDATE orders SET status = ? WHERE id = ?`);
const deleteOrder      = db.prepare(`DELETE FROM orders WHERE id = ?`);
const getSetting       = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const setSetting       = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

module.exports = {
  getSessions, getSessionByToken, getSessionById,
  createSession, updateSession, updateSessionStatus, markEditorSent, deleteSession,
  getSelections, getSubmittedSelections, upsertSelection, clearSelections,
  getOrders, createOrder, updateOrderStatus, deleteOrder,
  getSetting, setSetting,
};
