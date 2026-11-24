'use strict';

// REST client. Exposes the same window.editorAPI shape the UI used under
// Electron, so editor.js / preview.js work unchanged — only the transport
// (IPC -> fetch) differs.

(function () {
  async function jsonFetch(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const e = await res.json(); if (e && e.error) msg = e.error; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }
  const jget = (u) => jsonFetch(u);
  const jsend = (u, method, body) =>
    jsonFetch(u, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  window.editorAPI = {
    // Reference docx bytes for the sample preview.
    async getPreviewDocx() {
      try {
        const res = await fetch('/api/preview-docx');
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const buf = await res.arrayBuffer();
        return { ok: true, name: '請款公文.docx', data: new Uint8Array(buf) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    // 公文
    letters: {
      list: () => jget('/api/letters'),
      get: (id) => jget(`/api/letters/${id}`),
      create: (payload) => jsend('/api/letters', 'POST', payload),
      update: (id, patch) => jsend(`/api/letters/${id}`, 'PUT', patch),
      remove: (id) => jsend(`/api/letters/${id}`, 'DELETE'),
    },

    // 發文字號 + 取號
    docNumbers: {
      list: () => jget('/api/docnumbers'),
      create: (payload) => jsend('/api/docnumbers', 'POST', payload),
      update: (id, patch) => jsend(`/api/docnumbers/${id}`, 'PUT', patch),
      remove: (id) => jsend(`/api/docnumbers/${id}`, 'DELETE'),
      issue: (code) => jsend(`/api/docnumbers/${encodeURIComponent(code)}/issue`, 'POST'),
    },

    // 發文公司
    companies: {
      list: () => jget('/api/companies'),
      create: (payload) => jsend('/api/companies', 'POST', payload),
      update: (id, patch) => jsend(`/api/companies/${id}`, 'PUT', patch),
      remove: (id) => jsend(`/api/companies/${id}`, 'DELETE'),
    },

    // 機關單位（僅檢視 + 更新）
    orgUnits: {
      categories: () => jget('/api/orgunits/categories'),
      query: ({ category, q = '', page = 1, pageSize = 50 }) =>
        jget(`/api/orgunits?category=${encodeURIComponent(category)}&q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`),
      refresh: (category) => jsend(`/api/orgunits/${encodeURIComponent(category)}/refresh`, 'POST'),
      search: (q, limit = 20) => jget(`/api/orgunits/search?q=${encodeURIComponent(q)}&limit=${limit}`),
      // 受文者置頂
      pins: () => jget('/api/orgunits/pins'),
      pin: (item) => jsend('/api/orgunits/pins', 'POST', item),
      unpin: (item) => jsend('/api/orgunits/pins', 'DELETE', item),
    },

    // 受文者統編查詢
    lookupCompany: (taxId) => jget(`/api/company/lookup?taxId=${encodeURIComponent(taxId)}`),
  };
})();
