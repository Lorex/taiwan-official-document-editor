'use strict';

// SQLite storage layer (main-process only) for:
//   * doc_numbers — 發文字號 prefixes (e.g. 矽商、矽公) and their running serial
//   * letters     — 公文 records (id, 字號 code, 流水號 serial, + JSON data)
//
// 公文 fields other than 字號/流水號 are still being finalised, so they live in a
// single JSON `data` column; new fields need no migration.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let db = null;

function init(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate();
  seedDocNumbers();
  seedCompanies();
  return dbPath;
}

// --- Schema / migration ---------------------------------------------------- //
function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function migrate() {
  // 發文字號 table
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_numbers (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT NOT NULL UNIQUE,          -- 字號，例如「矽商」
      current_serial TEXT NOT NULL DEFAULT '',      -- 目前取號的號碼（最後發出的完整流水號 YYYMMDDXXX）
      description    TEXT NOT NULL DEFAULT '',
      enabled        INTEGER NOT NULL DEFAULT 1     -- 1=啟用, 0=停用
    );
  `);
  // 既有資料庫補上 enabled 欄位
  if (!tableColumns('doc_numbers').includes('enabled')) {
    db.exec('ALTER TABLE doc_numbers ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
  }
  // 字號可綁定發文公司（複選）；JSON 陣列存公司 id，空陣列 = 不限公司
  if (!tableColumns('doc_numbers').includes('company_ids')) {
    db.exec("ALTER TABLE doc_numbers ADD COLUMN company_ids TEXT NOT NULL DEFAULT '[]'");
  }

  // 機關單位 table（由外部來源更新，僅供檢視；資料量可能很大）
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_units (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      tax_id   TEXT NOT NULL DEFAULT '',
      name     TEXT NOT NULL DEFAULT '',
      city     TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_org_cat ON org_units(category);
    CREATE INDEX IF NOT EXISTS idx_org_cat_name ON org_units(category, name);
    CREATE TABLE IF NOT EXISTS org_meta (
      category   TEXT PRIMARY KEY,
      updated_at TEXT,
      count      INTEGER NOT NULL DEFAULT 0
    );
    -- 受文者置頂（使用者手動以 ★ 加入的常用單位）
    CREATE TABLE IF NOT EXISTS org_pins (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tax_id     TEXT NOT NULL DEFAULT '',
      name       TEXT NOT NULL DEFAULT '',
      city       TEXT NOT NULL DEFAULT '',
      category   TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      UNIQUE(tax_id, name)
    );
  `);

  // 發文公司 table
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL DEFAULT '',
      address   TEXT NOT NULL DEFAULT '',
      contact   TEXT NOT NULL DEFAULT '',
      phone     TEXT NOT NULL DEFAULT '',
      email     TEXT NOT NULL DEFAULT '',
      logo      TEXT NOT NULL DEFAULT '',   -- 頁首 logo 圖路徑
      signature TEXT NOT NULL DEFAULT '',   -- 簽名章圖路徑
      enabled   INTEGER NOT NULL DEFAULT 1
    );
  `);

  // 公文 table — id, 字號(code), 流水號(serial), data JSON. No title.
  const cols = tableColumns('letters');
  if (cols.length === 0) {
    db.exec(`
      CREATE TABLE letters (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        code       TEXT NOT NULL DEFAULT '',
        serial     TEXT NOT NULL DEFAULT '',
        data       TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } else if (cols.includes('title') && !cols.includes('code')) {
    // Migrate v1 (had title) → new schema (code/serial, no title).
    db.exec(`
      CREATE TABLE letters_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        code       TEXT NOT NULL DEFAULT '',
        serial     TEXT NOT NULL DEFAULT '',
        data       TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO letters_new (id, code, serial, data, created_at, updated_at)
        SELECT id, '', '', data, created_at, updated_at FROM letters;
      DROP TABLE letters;
      ALTER TABLE letters_new RENAME TO letters;
    `);
  } else {
    // Defensive: ensure required columns exist.
    if (!cols.includes('code')) db.exec("ALTER TABLE letters ADD COLUMN code TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('serial')) db.exec("ALTER TABLE letters ADD COLUMN serial TEXT NOT NULL DEFAULT ''");
  }
}

function seedDocNumbers() {
  const count = db.prepare('SELECT COUNT(*) c FROM doc_numbers').get().c;
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO doc_numbers (code, current_serial, description) VALUES (?, ?, ?)');
  insert.run('矽商', '', '矽塔資訊一般商務函');
  insert.run('矽公', '', '矽塔資訊公務函');
}

function seedCompanies() {
  const count = db.prepare('SELECT COUNT(*) c FROM companies').get().c;
  if (count > 0) return;
  const insert = db.prepare(
    'INSERT INTO companies (name, address, contact, phone, email, logo, signature) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  insert.run('矽塔資訊服務有限公司', '高雄市左營區大中二路262號23樓之2（北高辦公室）',
    '楊宇凡', '0975-334749', 'ceo@sita.tech', '/assets/sita-logo.png', '/assets/sita-chop.png');
  insert.run('光宙數位創意有限公司', '', '', '', '', '', '');
}

function now() {
  return new Date().toISOString();
}
function ensure() {
  if (!db) throw new Error('Database not initialised. Call init() first.');
}

// --- 發文字號 (doc_numbers) ------------------------------------------------ //
function parseCompanyIds(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
}
function dnRow(row) {
  return row ? { ...row, company_ids: parseCompanyIds(row.company_ids) } : row;
}

function dnList() {
  ensure();
  return db
    .prepare('SELECT id, code, current_serial, description, enabled, company_ids FROM doc_numbers ORDER BY id')
    .all()
    .map(dnRow);
}

function dnCreate({ code, description = '', current_serial = '', company_ids = [] }) {
  ensure();
  const info = db
    .prepare('INSERT INTO doc_numbers (code, current_serial, description, company_ids) VALUES (?, ?, ?, ?)')
    .run(code, current_serial, description, JSON.stringify(Array.isArray(company_ids) ? company_ids : []));
  return dnRow(db.prepare('SELECT * FROM doc_numbers WHERE id = ?').get(Number(info.lastInsertRowid)));
}

function dnUpdate(id, { code, description, current_serial, enabled, company_ids }) {
  ensure();
  const row = db.prepare('SELECT * FROM doc_numbers WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('UPDATE doc_numbers SET code = ?, description = ?, current_serial = ?, enabled = ?, company_ids = ? WHERE id = ?')
    .run(
      code !== undefined ? code : row.code,
      description !== undefined ? description : row.description,
      current_serial !== undefined ? current_serial : row.current_serial,
      enabled !== undefined ? (enabled ? 1 : 0) : row.enabled,
      company_ids !== undefined ? JSON.stringify(Array.isArray(company_ids) ? company_ids : []) : row.company_ids,
      id,
    );
  return dnRow(db.prepare('SELECT * FROM doc_numbers WHERE id = ?').get(id));
}

function dnRemove(id) {
  ensure();
  return db.prepare('DELETE FROM doc_numbers WHERE id = ?').run(id).changes > 0;
}

/**
 * Issue the next 流水號 for a 字號. Format: YYYMMDDXXX
 *   YYY  民國年 (year - 1911, 3 digits)
 *   MM   月 (2 digits)
 *   DD   日 (2 digits)
 *   XXX  每日流水號 (resets to 001 each day, per 字號)
 * Updates the 字號's current_serial atomically.
 * @param {string} code 字號
 * @returns {{code:string, serial:string}}
 */
const issueSerial = (code) => {
  ensure();
  const tx = db.transaction((c) => {
    const row = db.prepare('SELECT * FROM doc_numbers WHERE code = ?').get(c);
    if (!row) throw new Error('字號不存在：' + c);
    if (row.enabled === 0) throw new Error('字號已停用：' + c);
    const d = new Date();
    const minguo = String(d.getFullYear() - 1911).padStart(3, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const prefix = `${minguo}${mm}${dd}`; // 7 chars
    let daily = 1;
    const cur = row.current_serial || '';
    if (cur.length >= 10 && cur.slice(0, 7) === prefix) {
      daily = parseInt(cur.slice(7), 10) + 1;
    }
    const serial = prefix + String(daily).padStart(3, '0'); // 10 chars
    db.prepare('UPDATE doc_numbers SET current_serial = ? WHERE code = ?').run(serial, c);
    return { code: c, serial };
  });
  return tx(code);
};

// --- 發文公司 (companies) -------------------------------------------------- //
const CO_FIELDS = ['name', 'address', 'contact', 'phone', 'email', 'logo', 'signature'];

function coList() {
  ensure();
  return db.prepare('SELECT * FROM companies ORDER BY id').all();
}

function coCreate(payload = {}) {
  ensure();
  const vals = CO_FIELDS.map((f) => payload[f] || '');
  const info = db
    .prepare(`INSERT INTO companies (${CO_FIELDS.join(', ')}) VALUES (${CO_FIELDS.map(() => '?').join(', ')})`)
    .run(...vals);
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(Number(info.lastInsertRowid));
}

function coUpdate(id, patch = {}) {
  ensure();
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
  if (!row) return null;
  const next = {};
  for (const f of CO_FIELDS) next[f] = patch[f] !== undefined ? patch[f] : row[f];
  const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : row.enabled;
  db.prepare(
    `UPDATE companies SET ${CO_FIELDS.map((f) => `${f} = ?`).join(', ')}, enabled = ? WHERE id = ?`,
  ).run(...CO_FIELDS.map((f) => next[f]), enabled, id);
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
}

function coRemove(id) {
  ensure();
  return db.prepare('DELETE FROM companies WHERE id = ?').run(id).changes > 0;
}

// --- 機關單位 (org_units) -------------------------------------------------- //
function orgClear(category) {
  ensure();
  db.prepare('DELETE FROM org_units WHERE category = ?').run(category);
}

let _orgInsert = null;
function orgInsertBatch(category, rows) {
  ensure();
  if (!_orgInsert) {
    _orgInsert = db.prepare('INSERT INTO org_units (category, tax_id, name, city) VALUES (?, ?, ?, ?)');
  }
  const tx = db.transaction((rs) => {
    for (const r of rs) _orgInsert.run(category, r[0], r[1], r[2]);
  });
  tx(rows);
}

function orgSetMeta(category, count, updatedAt) {
  ensure();
  db.prepare(
    'INSERT INTO org_meta (category, updated_at, count) VALUES (?, ?, ?) ' +
    'ON CONFLICT(category) DO UPDATE SET updated_at = excluded.updated_at, count = excluded.count',
  ).run(category, updatedAt, count);
}

function orgAllMeta() {
  ensure();
  const out = {};
  for (const r of db.prepare('SELECT category, updated_at, count FROM org_meta').all()) {
    out[r.category] = { updatedAt: r.updated_at, count: r.count };
  }
  return out;
}

// 跨分類搜尋（供受文者/正本/副本單位查詢用）
function orgSearch(q, limit = 20) {
  ensure();
  q = (q || '').trim();
  if (!q) return [];
  limit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const like = '%' + q + '%';
  return db
    .prepare('SELECT tax_id, name, city, category FROM org_units WHERE name LIKE ? OR tax_id LIKE ? ORDER BY name LIMIT ?')
    .all(like, like, limit);
}

// --- 受文者置頂 (org_pins) ----------------------------------------------- //
function orgPinsList() {
  ensure();
  return db.prepare('SELECT tax_id, name, city, category FROM org_pins ORDER BY created_at DESC, name').all();
}

function orgPinAdd({ tax_id = '', name = '', city = '', category = '' } = {}) {
  ensure();
  if (!String(name).trim() && !String(tax_id).trim()) return orgPinsList();
  db.prepare(
    'INSERT OR IGNORE INTO org_pins (tax_id, name, city, category, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(tax_id, name, city, category, now());
  return orgPinsList();
}

function orgPinRemove({ tax_id = '', name = '' } = {}) {
  ensure();
  return db.prepare('DELETE FROM org_pins WHERE tax_id = ? AND name = ?').run(tax_id, name).changes > 0;
}

function orgQuery({ category, q = '', page = 1, pageSize = 50 }) {
  ensure();
  page = Math.max(1, parseInt(page, 10) || 1);
  pageSize = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 50));
  const params = [category];
  let where = 'category = ?';
  if (q) {
    where += ' AND (name LIKE ? OR tax_id LIKE ?)';
    const like = '%' + q + '%';
    params.push(like, like);
  }
  const total = db.prepare(`SELECT COUNT(*) c FROM org_units WHERE ${where}`).get(...params).c;
  const rows = db
    .prepare(`SELECT tax_id, name, city FROM org_units WHERE ${where} ORDER BY name LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);
  const meta = db.prepare('SELECT updated_at, count FROM org_meta WHERE category = ?').get(category) || {};
  return { rows, total, page, pageSize, updatedAt: meta.updated_at || null };
}

// --- 公文 (letters) -------------------------------------------------------- //
function list() {
  ensure();
  return db
    .prepare('SELECT id, code, serial, created_at, updated_at FROM letters ORDER BY updated_at DESC')
    .all();
}

function get(id) {
  ensure();
  const row = db.prepare('SELECT * FROM letters WHERE id = ?').get(id);
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data); } catch { data = {}; }
  return { ...row, data };
}

function create(payload = {}) {
  ensure();
  const ts = now();
  const info = db
    .prepare('INSERT INTO letters (code, serial, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(payload.code || '', payload.serial || '', JSON.stringify(payload.data || {}), ts, ts);
  return get(Number(info.lastInsertRowid));
}

function update(id, patch = {}) {
  ensure();
  const existing = get(id);
  if (!existing) return null;
  const code = patch.code !== undefined ? patch.code : existing.code;
  const serial = patch.serial !== undefined ? patch.serial : existing.serial;
  const data = JSON.stringify(patch.data !== undefined ? patch.data : existing.data);
  db.prepare('UPDATE letters SET code = ?, serial = ?, data = ?, updated_at = ? WHERE id = ?')
    .run(code, serial, data, now(), id);
  return get(id);
}

function remove(id) {
  ensure();
  return db.prepare('DELETE FROM letters WHERE id = ?').run(id).changes > 0;
}

module.exports = {
  init,
  // 公文
  list, get, create, update, remove,
  // 發文字號
  docNumbers: { list: dnList, create: dnCreate, update: dnUpdate, remove: dnRemove, issue: issueSerial },
  // 發文公司
  companies: { list: coList, create: coCreate, update: coUpdate, remove: coRemove },
  // 機關單位
  org: {
    clear: orgClear, insertBatch: orgInsertBatch, setMeta: orgSetMeta, allMeta: orgAllMeta,
    query: orgQuery, search: orgSearch,
    pinsList: orgPinsList, pinAdd: orgPinAdd, pinRemove: orgPinRemove,
  },
};
