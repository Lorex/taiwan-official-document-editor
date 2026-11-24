'use strict';

// Right-pane preview.
//   * showBlank()       — empty state (no 公文 open); the app boots into this
//   * showSample()      — render the reference 請款公文.docx via docx-preview
//   * renderLive(model) — render a live 公文(函) from the editor fields, laid out
//                         per the 文書處理手冊 format, with automatic A4 pagination:
//                         content that exceeds one page flows onto further A4
//                         pages; list numbering continues across pages and the
//                         footer page numbers ("第 X 頁，共 Y 頁") update.

(function () {
  const host = () => document.getElementById('preview-host');
  const nameEl = () => document.getElementById('preview-name');

  function setStatus(msg) {
    const h = host();
    h.replaceChildren();
    const el = document.createElement('div');
    el.className = 'preview-placeholder';
    el.textContent = msg;
    h.appendChild(el);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function minguoDate(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return '';
    const y = parseInt(m[1], 10) - 1911;
    return `中華民國${y}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`;
  }
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function mmToPx(mm) {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;visibility:hidden;height:' + mm + 'mm';
    document.body.appendChild(d);
    const px = d.offsetHeight;
    d.remove();
    return px;
  }

  // --- Blank (no letter open) ------------------------------------------------ //
  function showBlank() {
    nameEl().textContent = '公文預覽';
    setStatus('尚未開啟公文，預覽將顯示於此。');
  }

  // --- Sample (docx) -------------------------------------------------------- //
  async function showSample() {
    nameEl().textContent = '公文範本（請款公文.docx）';
    if (!window.docx || typeof window.docx.renderAsync !== 'function') {
      setStatus('docx-preview 尚未載入。'); return;
    }
    window.UI.center(host());
    let res;
    try { res = await window.editorAPI.getPreviewDocx(); }
    catch (err) { setStatus('讀取範本失敗：' + err.message); return; }
    if (!res || !res.ok) { setStatus((res && res.error) || '無法取得範本。'); return; }
    host().replaceChildren();
    const blob = new Blob([res.data], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    try {
      await window.docx.renderAsync(blob, host(), null, {
        className: 'docx', inWrapper: true, breakPages: true, experimental: false, useBase64URL: true,
      });
    } catch (err) { setStatus('渲染失敗：' + err.message); }
  }

  // --- Live 公文(函) builders ----------------------------------------------- //
  function infoLine(label, value) {
    return `<div class="gw-info"><span class="gw-k">${esc(label)}</span>${esc(value || '')}</div>`;
  }
  function contactLine(label, value) {
    return `<div class="gw-cline"><span class="gw-clabel">${esc(label)}</span>` +
           `<span class="gw-csep">：</span><span class="gw-cval">${esc(value)}</span></div>`;
  }

  // Parse the 說明 rich text. If it's a single Quill ordered/bullet list, return
  // its <li> items (so the list can be split across pages); otherwise a block.
  function parseExplanation(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    if (tmp.children.length === 1 && tmp.firstElementChild.tagName === 'OL'
        && tmp.firstElementChild.querySelector('li')) {
      const items = [];
      tmp.firstElementChild.querySelectorAll(':scope > li').forEach((li) => {
        const mm = /ql-indent-(\d)/.exec(li.className || '');
        items.push({ li, level: mm ? parseInt(mm[1], 10) : 0 });
      });
      return { type: 'list', items };
    }
    return { type: 'block', html: html || '' };
  }

  function renderLive(m) {
    nameEl().textContent = '公文預覽';
    const cfg = (window.LetterConfig && window.LetterConfig.companies) || [];
    const company = cfg.find((c) => c.name === m.company) || cfg[0] || { name: m.company || '' };

    const contact = [];
    if (company.address) contact.push(contactLine('地址', company.address));
    if (company.contact) contact.push(contactLine('聯絡人', company.contact));
    if (company.phone) contact.push(contactLine('電話', company.phone));
    if (company.email) contact.push(contactLine('電子郵件', company.email));

    const docNo = m.code && m.serial ? `${m.code}字第 ${m.serial} 號`
      : (m.code ? `${m.code}字第　號` : '');
    const attachments = (m.attachments || []).filter((s) => s && s.trim()).join('、');
    const originals = (m.originals || []).map((r) => r.name).filter(Boolean).join('、');
    const copies = (m.copies || []).map((r) => r.name).filter(Boolean).join('、');
    const recipient = m.recipient && m.recipient.name ? m.recipient.name : '';
    const security = m.security || '普通';

    // Ordered flow of blocks; the 說明 list contributes individual <li> items.
    const flow = [];
    const pushBlock = (htmlOrNode) => flow.push({
      kind: 'block',
      el: typeof htmlOrNode === 'string' ? el(htmlOrNode) : htmlOrNode,
    });

    pushBlock(`<div class="gw-title">${esc(company.name || '')}　函</div>`);
    if (contact.length) pushBlock(`<div class="gw-contact">${contact.join('')}</div>`);
    pushBlock('<div class="gw-spacer"></div>');
    pushBlock(`<div class="gw-main"><span class="gw-k">受文者：</span>${esc(recipient)}</div>`);
    pushBlock(infoLine('發文日期：', minguoDate(m.issueDate)));
    pushBlock(infoLine('發文字號：', docNo));
    pushBlock(infoLine('速別：', m.priority));
    pushBlock(infoLine('密等及解密條件或保密期限：', security));
    pushBlock(infoLine('附件：', attachments || '無'));
    pushBlock(`<div class="gw-subject"><span class="gw-k">主旨：</span>${esc(m.subject)}</div>`);
    pushBlock('<div class="gw-explain-label"><span class="gw-k">說明：</span></div>');

    const exp = parseExplanation(m.explanationHTML);
    if (exp.type === 'list') {
      for (const it of exp.items) flow.push({ kind: 'li', el: it.li, level: it.level });
    } else if ((exp.html || '').trim()) {
      pushBlock(`<div class="gw-rich ql-editor gw-explain-body">${exp.html}</div>`);
    }

    pushBlock(`<div class="gw-cc">${infoLine('正本：', originals)}${infoLine('副本：', copies)}</div>`);
    if (company.signature) pushBlock(`<img class="gw-sign-img" src="${esc(company.signature)}" alt="">`);

    // Render into paginated A4 pages.
    host().replaceChildren();
    const fit = el('<div class="gw-fit"><div class="gw-pages"></div></div>');
    const pages = fit.firstElementChild;
    host().appendChild(fit);
    distribute(flow, pages, company);
    addFooters(pages);
    applyFit();
  }

  // Distribute flow items across A4 pages, measuring natural height.
  function distribute(flow, pagesEl, company) {
    const printablePx = mmToPx(247); // A4 297mm − 上下邊界各 25mm
    let body = null;
    let wrap = null;   // current 說明 list wrapper (.gw-rich.ql-editor)
    let ol = null;
    const counters = new Array(10).fill(0);

    function addPage() {
      const paper = document.createElement('div');
      paper.className = 'gw-paper gw-page';
      if (company.logo) {
        const img = document.createElement('img');
        img.className = 'gw-logo'; img.src = company.logo; img.alt = '';
        paper.appendChild(img);
      }
      body = document.createElement('div');
      body.className = 'gw-page-body';
      paper.appendChild(body);
      pagesEl.appendChild(paper);
      ol = null; wrap = null;
    }
    function startOl(seed) {
      wrap = document.createElement('div');
      wrap.className = 'gw-rich ql-editor gw-explain-body';
      ol = document.createElement('ol');
      ol.style.counterReset = seed.map((v, i) => 'list-' + i + ' ' + v).join(' ');
      wrap.appendChild(ol);
      body.appendChild(wrap);
    }

    addPage();
    for (const item of flow) {
      if (item.kind === 'block') {
        ol = null; wrap = null;
        body.appendChild(item.el);
        if (body.offsetHeight > printablePx && body.children.length > 1) {
          body.removeChild(item.el);
          addPage();
          body.appendChild(item.el);
        }
      } else { // li
        if (!ol) startOl(counters.slice());
        const before = counters.slice();
        ol.appendChild(item.el);
        counters[item.level]++;
        for (let k = item.level + 1; k < 10; k++) counters[k] = 0;
        const onlyThing = ol.children.length === 1 && body.children.length === 1;
        if (body.offsetHeight > printablePx && !onlyThing) {
          ol.removeChild(item.el);
          if (ol.children.length === 0 && wrap.parentNode) body.removeChild(wrap);
          for (let k = 0; k < 10; k++) counters[k] = before[k];
          addPage();
          startOl(before.slice());
          ol.appendChild(item.el);
          counters[item.level]++;
          for (let k = item.level + 1; k < 10; k++) counters[k] = 0;
        }
      }
    }
  }

  function addFooters(pagesEl) {
    const n = pagesEl.children.length;
    Array.from(pagesEl.children).forEach((pg, i) => {
      const f = document.createElement('div');
      f.className = 'gw-footer';
      f.textContent = `第 ${i + 1} 頁，共 ${n} 頁`;
      pg.appendChild(f);
    });
  }

  // Scale all A4 pages to fit the preview pane width.
  function applyFit() {
    const fitEl = host().querySelector('.gw-fit');
    const pages = host().querySelector('.gw-pages');
    if (!fitEl || !pages) return;
    const avail = host().clientWidth;
    const pw = pages.offsetWidth || 1;
    const scale = Math.min(1, avail / pw);
    pages.style.transform = `scale(${scale})`;
    fitEl.style.width = pw * scale + 'px';
    fitEl.style.height = pages.offsetHeight * scale + 'px';
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (host().querySelector('.gw-pages')) applyFit(); });
  }
  let ro = null;
  function observe() {
    if (ro || typeof ResizeObserver === 'undefined') return;
    ro = new ResizeObserver(() => { if (host().querySelector('.gw-pages')) applyFit(); });
    ro.observe(host());
  }
  window.addEventListener('resize', () => { if (host().querySelector('.gw-pages')) applyFit(); });
  window.addEventListener('DOMContentLoaded', observe);

  window.Preview = { showBlank, showSample, renderLive, setStatus };
})();
