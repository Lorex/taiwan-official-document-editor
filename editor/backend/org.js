'use strict';

// 機關單位資料來源更新：串流下載 CSV、解析、批次寫入 SQLite。
// 資料量可能很大（公司團體為全國資料），故以 readline 串流逐行處理，避免一次
// 載入整個檔案至記憶體。

const { Readable } = require('stream');
const readline = require('readline');
const iconv = require('iconv-lite');
const db = require('./db');

// 四個分類來源。encoding 預設 utf8；若來源為 Big5，改成 'big5' 即可。
const ORG_CATEGORIES = {
  company: { label: '公司團體', url: 'https://eip.fia.gov.tw/data/BGMOPEN1.csv', encoding: 'utf8' },
  nonprofit: { label: '非營利團體', url: 'https://eip.fia.gov.tw/data/BGMOPEN99.csv', encoding: 'utf8' },
  school: { label: '學校團體', url: 'https://eip.fia.gov.tw/data/BGMOPEN99X.csv', encoding: 'utf8' },
  government: { label: '政府機關', url: 'https://www.fia.gov.tw/download/9bc4de1485014443b518beb37d8f35fe', encoding: 'utf8' },
};

const CITY_RE = /(臺北市|台北市|新北市|桃園市|臺中市|台中市|臺南市|台南市|高雄市|基隆市|新竹市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)/;

function extractCity(addr) {
  if (!addr) return '';
  const m = CITY_RE.exec(addr);
  return m ? m[1] : '';
}

// Minimal CSV line parser (handles "" escaping). Embedded newlines inside quoted
// fields are handled by the caller via quote-balance carry.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function countQuotes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === '"') n++;
  return n;
}

// Map a header row to column indexes by fuzzy name matching.
function detectColumns(header) {
  const norm = header.map((h) => (h || '').replace(/\s|"/g, ''));
  const find = (keys) => norm.findIndex((h) => keys.some((k) => h.includes(k)));
  return {
    tax: find(['統一編號', '統一編', '統編', '編號']),
    name: find(['機關名稱', '團體名稱', '公司名稱', '單位名稱', '名稱']),
    city: find(['所在縣市', '縣市']),
    addr: find(['地址', '會址', '所在地', '住址']),
  };
}

function rowFrom(cols, idx) {
  const at = (i) => (i >= 0 && i < cols.length ? (cols[i] || '').trim() : '');
  const tax = at(idx.tax);
  const name = at(idx.name);
  let city = at(idx.city);
  if (!city && idx.addr >= 0) city = extractCity(cols[idx.addr] || '');
  return [tax, name, city];
}

/**
 * Download a category's source and replace its rows in the DB.
 * @param {string} key category key
 * @param {object} [defOverride] optional source def (for tests)
 * @returns {Promise<{count:number, updatedAt:string}>}
 */
async function refresh(key, defOverride) {
  const def = defOverride || ORG_CATEGORIES[key];
  if (!def) throw new Error('未知分類：' + key);

  // Abort if the source doesn't respond within 30s (avoids hanging forever).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(def.url, { redirect: 'follow', signal: ctrl.signal });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? '連線逾時，無法連到來源' : '無法連線：' + err.message);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`下載失敗 (HTTP ${res.status})`);
  if (!res.body) throw new Error('來源無回應內容');

  const input = Readable.fromWeb(res.body).pipe(iconv.decodeStream(def.encoding || 'utf8'));
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let header = null;
  let idx = null;
  let pending = '';
  let batch = [];
  let total = 0;

  db.org.clear(key);
  try {
    for await (const raw of rl) {
      let line = pending ? pending + '\n' + raw : raw;
      // A quoted field may span lines — carry until quotes balance.
      if (countQuotes(line) % 2 !== 0) { pending = line; continue; }
      pending = '';

      if (header === null) {
        line = line.replace(/^﻿/, '');           // strip BOM
        header = parseCsvLine(line);
        idx = detectColumns(header);
        if (idx.name < 0 && idx.tax < 0) {
          throw new Error('無法辨識欄位（找不到名稱或統一編號）');
        }
        continue;
      }

      const cols = parseCsvLine(line);
      if (cols.length === 1 && cols[0] === '') continue;
      const row = rowFrom(cols, idx);
      if (!row[0] && !row[1]) continue;
      batch.push(row);
      if (batch.length >= 2000) { db.org.insertBatch(key, batch); total += batch.length; batch = []; }
    }
    if (batch.length) { db.org.insertBatch(key, batch); total += batch.length; }
  } finally {
    rl.close();
  }

  const updatedAt = new Date().toISOString();
  db.org.setMeta(key, total, updatedAt);
  return { count: total, updatedAt };
}

module.exports = {
  ORG_CATEGORIES,
  refresh,
  // exported for tests
  _parseCsvLine: parseCsvLine,
  _detectColumns: detectColumns,
  _extractCity: extractCity,
};
