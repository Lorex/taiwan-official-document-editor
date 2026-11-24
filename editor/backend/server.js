'use strict';

// 公文 Editor — web backend (Express + SQLite).
// Serves the frontend, vendored libraries, the 標楷體 font and the reference
// docx, and exposes a REST API for 公文 / 發文字號 / 統編查詢.

const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const org = require('./org');

const PORT = process.env.PORT || 3000;

// Paths
const APP_ROOT = path.join(__dirname, '..');            // editor/
const REPO_ROOT = path.join(APP_ROOT, '..');            // official_letter_generator/
const FRONTEND = path.join(APP_ROOT, 'frontend');
const PUBLIC_DIR = path.join(FRONTEND, 'public');
const ASSETS_DIR = path.join(FRONTEND, 'assets');
const NODE_MODULES = path.join(APP_ROOT, 'node_modules');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'letters.db');

const OUTPUT_DOCX = path.join(REPO_ROOT, 'output', '請款公文.docx');
const PREVIEW_DIR = path.join(REPO_ROOT, 'preview');
const PREVIEW_DOCX = path.join(PREVIEW_DIR, '請款公文.docx');
const FONT_DEST = path.join(ASSETS_DIR, 'kaiu.ttf');
const WINDOWS_FONT_CANDIDATES = [
  '/mnt/c/Windows/Fonts/kaiu.ttf',
  '/mnt/d/Windows/Fonts/kaiu.ttf',
  '/mnt/e/Windows/Fonts/kaiu.ttf',
  'C:\\Windows\\Fonts\\kaiu.ttf',
];

// --- Startup prep ---------------------------------------------------------- //
function ensureKaiFont() {
  try {
    if (fs.existsSync(FONT_DEST)) return;
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
    for (const src of WINDOWS_FONT_CANDIDATES) {
      if (fs.existsSync(src)) { fs.copyFileSync(src, FONT_DEST); console.log('Bundled 標楷體 from', src); return; }
    }
    console.warn('標楷體 (kaiu.ttf) not found; preview will use a CJK serif fallback.');
  } catch (err) { console.error('Failed to bundle 標楷體:', err); }
}

function syncPreviewDoc() {
  try {
    fs.mkdirSync(PREVIEW_DIR, { recursive: true });
    if (fs.existsSync(OUTPUT_DOCX)) fs.copyFileSync(OUTPUT_DOCX, PREVIEW_DOCX);
  } catch (err) { console.error('Failed to sync preview document:', err); }
}

// --- App ------------------------------------------------------------------- //
const app = express();
app.use(express.json({ limit: '4mb' }));

// Dev-only browser hot reload. Enabled when LIVERELOAD=1 (set by `npm run dev`).
// A LiveReload server watches frontend/public; we serve index.html through a
// dedicated route that injects the LiveReload client and (dev only) relaxes the
// page CSP so the :35729 script + WebSocket are allowed. Production keeps the
// strict CSP in the static index.html.
const LR_PORT = 35729;
if (process.env.LIVERELOAD === '1') {
  try {
    const livereload = require('livereload');
    const lr = livereload.createServer({ exts: ['html', 'js', 'css'], delay: 120, port: LR_PORT });
    lr.watch(PUBLIC_DIR);

    const snippet = `<script src="http://localhost:${LR_PORT}/livereload.js?snipver=1"></script>`;
    const serveDevIndex = (_req, res) => {
      let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
      html = html
        .replace("script-src 'self'", `script-src 'self' http://localhost:${LR_PORT}`)
        .replace("connect-src 'self'", `connect-src 'self' http://localhost:${LR_PORT} ws://localhost:${LR_PORT}`)
        .replace('</body>', `  ${snippet}\n</body>`);
      res.type('html').send(html);
    };
    app.get(['/', '/index.html'], serveDevIndex);
    console.log('LiveReload enabled — watching', PUBLIC_DIR);
  } catch (err) {
    console.warn('LiveReload unavailable:', err.message);
  }
}

// Silence the browser's automatic favicon request.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// Static: frontend, font, vendored libs
app.use(express.static(PUBLIC_DIR));
app.use('/assets', express.static(ASSETS_DIR));
app.use('/vendor/quill', express.static(path.join(NODE_MODULES, 'quill', 'dist')));
app.use('/vendor/docx-preview', express.static(path.join(NODE_MODULES, 'docx-preview', 'dist')));
app.use('/vendor/jszip', express.static(path.join(NODE_MODULES, 'jszip', 'dist')));

// --- REST API: 公文 -------------------------------------------------------- //
const wrap = (fn) => (req, res) => {
  try { res.json(fn(req)); }
  catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
};

app.get('/api/letters', wrap(() => db.list()));
app.get('/api/letters/:id', wrap((req) => db.get(Number(req.params.id))));
app.post('/api/letters', wrap((req) => db.create(req.body || {})));
app.put('/api/letters/:id', wrap((req) => db.update(Number(req.params.id), req.body || {})));
app.delete('/api/letters/:id', wrap((req) => ({ ok: db.remove(Number(req.params.id)) })));

// --- REST API: 發文字號 ---------------------------------------------------- //
app.get('/api/docnumbers', wrap(() => db.docNumbers.list()));
app.post('/api/docnumbers', wrap((req) => db.docNumbers.create(req.body || {})));
app.put('/api/docnumbers/:id', wrap((req) => db.docNumbers.update(Number(req.params.id), req.body || {})));
app.delete('/api/docnumbers/:id', wrap((req) => ({ ok: db.docNumbers.remove(Number(req.params.id)) })));
app.post('/api/docnumbers/:code/issue', (req, res) => {
  try { res.json({ ok: true, ...db.docNumbers.issue(req.params.code) }); }
  catch (err) { res.json({ ok: false, error: err.message }); }
});

// --- REST API: 發文公司 ---------------------------------------------------- //
app.get('/api/companies', wrap(() => db.companies.list()));
app.post('/api/companies', wrap((req) => db.companies.create(req.body || {})));
app.put('/api/companies/:id', wrap((req) => db.companies.update(Number(req.params.id), req.body || {})));
app.delete('/api/companies/:id', wrap((req) => ({ ok: db.companies.remove(Number(req.params.id)) })));

// --- REST API: 機關單位 ---------------------------------------------------- //
app.get('/api/orgunits/categories', wrap(() => {
  const meta = db.org.allMeta();
  return Object.entries(org.ORG_CATEGORIES).map(([key, def]) => ({
    key, label: def.label,
    updatedAt: (meta[key] && meta[key].updatedAt) || null,
    count: (meta[key] && meta[key].count) || 0,
  }));
}));

app.get('/api/orgunits/search', wrap((req) => db.org.search(req.query.q, req.query.limit)));

// 受文者置頂（常用單位）
app.get('/api/orgunits/pins', wrap(() => db.org.pinsList()));
app.post('/api/orgunits/pins', wrap((req) => db.org.pinAdd(req.body || {})));
app.delete('/api/orgunits/pins', wrap((req) => ({ ok: db.org.pinRemove(req.body || {}) })));

app.get('/api/orgunits', wrap((req) => db.org.query({
  category: req.query.category,
  q: req.query.q || '',
  page: req.query.page,
  pageSize: req.query.pageSize,
})));

app.post('/api/orgunits/:category/refresh', async (req, res) => {
  const key = req.params.category;
  if (!org.ORG_CATEGORIES[key]) return res.status(404).json({ ok: false, error: '未知分類' });
  try {
    const r = await org.refresh(key);
    res.json({ ok: true, ...r });
  } catch (err) {
    console.error('orgunits refresh failed:', err);
    res.json({ ok: false, error: err.message });
  }
});

// --- REST API: 受文者統編查詢 (GCIS open data) ----------------------------- //
app.get('/api/company/lookup', async (req, res) => {
  const id = String(req.query.taxId || '').trim();
  if (!/^\d{8}$/.test(id)) return res.json({ ok: false, error: '統編需為 8 位數字' });
  try {
    const url =
      'https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6' +
      '?$format=json&$filter=' + encodeURIComponent(`Business_Accounting_NO eq ${id}`) + '&$skip=0&$top=1';
    const r = await fetch(url);
    if (!r.ok) return res.json({ ok: false, error: `查詢失敗 (HTTP ${r.status})` });
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length && rows[0].Company_Name) {
      return res.json({ ok: true, taxId: id, name: rows[0].Company_Name });
    }
    return res.json({ ok: false, error: '查無此統一編號' });
  } catch (err) {
    return res.json({ ok: false, error: '查詢失敗：' + err.message });
  }
});

// --- Reference docx (preview sample) --------------------------------------- //
app.get('/api/preview-docx', (req, res) => {
  if (!fs.existsSync(PREVIEW_DOCX)) return res.status(404).json({ error: '找不到預覽文件' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.sendFile(PREVIEW_DOCX);
});

// --- Boot ------------------------------------------------------------------ //
ensureKaiFont();
syncPreviewDoc();
db.init(DB_PATH);
console.log('SQLite ready at', DB_PATH);
app.listen(PORT, () => {
  console.log(`公文 Editor running at http://localhost:${PORT}`);
});
