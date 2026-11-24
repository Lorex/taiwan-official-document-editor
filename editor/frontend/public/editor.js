'use strict';

// Left-pane 公文 editor + custom top-menu actions, SQLite persistence, and live
// right-pane preview that updates on every field edit. Saving is manual: edits
// only touch the preview until 儲存公文 / 另存公文 is pressed.

(function () {
  const api = window.editorAPI;

  const $ = (id) => document.getElementById(id);
  const el = {
    new: $('menu-new'), open: $('menu-open'), del: $('menu-delete'),
    save: $('menu-save'), saveAs: $('menu-saveas'),
    empty: $('editor-empty'), form: $('editor-form'),
    id: $('editor-id'), saveState: $('save-state'),
    code: $('f-code'), serial: $('f-serial'), issue: $('btn-issue'),
    recTax: $('f-recipient-tax'), recName: $('f-recipient-name'), recDd: $('f-recipient-dd'),
    company: $('f-company'), date: $('f-date'), priority: $('f-priority'),
    attachAdd: $('btn-attach-add'), attachList: $('attach-list'),
    subject: $('f-subject'),
    originalAdd: $('btn-original-add'), originalsList: $('originals-list'),
    copyAdd: $('btn-copy-add'), copiesList: $('copies-list'),
    reload: $('reload-btn'),
  };

  let current = null;        // open record, or null
  let quill = null;
  let dirty = false;         // unsaved edits on the open record
  let loading = false;       // suppress dirty-tracking while populating the form
  let attachments = [];      // string[]
  let originals = [];        // {taxId,name}[]
  let originalsAuto = false;  // 正本是否自動跟隨受文者（使用者手動編輯正本後關閉）
  let copies = [];           // {taxId,name}[]

  // --- Helpers ----------------------------------------------------------- //
  function todayISO() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function setSaveState(text, saving) {
    el.saveState.textContent = text;
    el.saveState.classList.toggle('saving', !!saving);
  }

  function showEmpty() {
    el.empty.hidden = false;
    el.form.hidden = true;
    el.del.disabled = true;
    el.save.disabled = true;
    el.saveAs.disabled = true;
  }
  function showForm() {
    el.empty.hidden = true;
    el.form.hidden = false;
    el.del.disabled = false;
    el.save.disabled = false;
    el.saveAs.disabled = false;
  }

  // 有未儲存變更時先徵詢；回傳 true 表示可以繼續。
  function confirmDiscard() {
    if (!current || !dirty) return true;
    return window.confirm('目前公文尚有未儲存的變更，確定捨棄變更並繼續？');
  }

  // --- Model collection + preview --------------------------------------- //
  function collect() {
    return {
      code: el.code.value,
      serial: el.serial.value,
      data: {
        recipient: { taxId: el.recTax.value, name: el.recName.value },
        company: el.company.value,
        issueDate: el.date.value,
        priority: el.priority.value,
        attachments: attachments.slice(),
        subject: el.subject.value,
        explanationHTML: quill ? quill.root.innerHTML : '',
        originals: originals.map((r) => ({ ...r })),
        copies: copies.map((r) => ({ ...r })),
      },
    };
  }

  function renderPreview() {
    const c = collect();
    window.Preview.renderLive({ code: c.code, serial: c.serial, ...c.data });
  }

  // 受文者變動時：若正本尚未被手動編輯（或為空），預設帶入受文者單位為正本。
  function onRecipientChange() {
    if (loading) return;
    const name = el.recName.value.trim();
    const tax = el.recTax.value.trim();
    if (originalsAuto || originals.length === 0) {
      originals = name ? [{ taxId: tax, name }] : [];
      originalsAuto = true;
      renderRecipientList(el.originalsList, originals);
    }
    onEdit();
  }

  // --- Persistence（手動儲存） -------------------------------------------- //
  function onEdit() {
    if (loading) return;
    renderPreview();
    if (current) {
      dirty = true;
      setSaveState('未儲存的變更', true);
    }
  }

  async function saveNow() {
    if (!current) return;
    try {
      const updated = await api.letters.update(current.id, collect());
      if (updated) current = updated;
      dirty = false;
      setSaveState('已儲存');
    } catch (err) {
      setSaveState('儲存失敗');
      console.error(err);
    }
  }

  // 另存公文：以目前內容建立一筆新公文並切換過去。流水號屬於原公文，
  // 另存後清空，需重新取號。
  async function saveAsLetter() {
    if (!current) return;
    const payload = collect();
    payload.serial = '';
    const hide = window.UI.overlay(document.getElementById('design-pane'));
    try {
      const rec = await api.letters.create(payload);
      await fillForm(rec);
      setSaveState('已另存為 #' + rec.id);
    } catch (err) {
      window.alert('另存失敗：' + err.message);
    } finally { hide(); }
  }

  // --- Dynamic lists ----------------------------------------------------- //
  function renderAttachments() {
    el.attachList.replaceChildren();
    attachments.forEach((val, i) => {
      const row = document.createElement('div');
      row.className = 'multi-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'grow';
      input.placeholder = '附件項目，例：三聯式統一發票1份';
      input.value = val;
      input.addEventListener('input', () => { attachments[i] = input.value; onEdit(); });
      const rm = mkIconBtn('－', '移除', () => { attachments.splice(i, 1); renderAttachments(); onEdit(); });
      row.append(input, rm);
      el.attachList.appendChild(row);
    });
  }

  function renderRecipientList(listEl, arr) {
    const isOriginals = arr === originals;
    const markManual = () => { if (isOriginals) originalsAuto = false; };
    listEl.replaceChildren();
    arr.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'multi-row';

      // 統編／單位名稱整合搜尋（統編存於 hidden 欄位，名稱欄為唯一輸入框）
      const search = document.createElement('span');
      search.className = 'unit-search grow';
      const tax = document.createElement('input');
      tax.type = 'hidden'; tax.value = r.taxId || '';
      const name = document.createElement('input');
      name.type = 'text'; name.placeholder = '輸入統一編號或單位名稱搜尋…'; name.autocomplete = 'off';
      name.value = r.name || '';
      name.addEventListener('input', () => { r.name = name.value; r.taxId = ''; tax.value = ''; markManual(); onEdit(); });
      const dd = document.createElement('div');
      dd.className = 'unit-dd'; dd.hidden = true;
      search.append(tax, name, dd);
      attachUnitSearch(name, tax, dd, () => { r.name = name.value; r.taxId = tax.value; markManual(); onEdit(); });

      const rm = mkIconBtn('－', '移除', () => {
        arr.splice(i, 1);
        markManual();
        renderRecipientList(listEl, arr);
        onEdit();
      });
      row.append(search, rm);
      listEl.appendChild(row);
    });
  }

  // --- 受文者置頂（常用單位）快取 --------------------------------------- //
  let pinsCache = null;
  const ORG_CAT_LABELS = (window.LetterConfig && window.LetterConfig.orgCategoryLabels) || {};
  const categoryLabel = (c) => ORG_CAT_LABELS[c] || c || '';
  const pinKey = (it) => `${(it.tax_id || it.taxId || '')}||${it.name || ''}`;
  const isPinned = (it) => (pinsCache || []).some((p) => pinKey(p) === pinKey(it));
  async function loadPins(force) {
    if (pinsCache && !force) return pinsCache;
    try { pinsCache = await api.orgUnits.pins(); } catch { pinsCache = []; }
    return pinsCache;
  }
  async function togglePin(it) {
    const item = { tax_id: it.tax_id || it.taxId || '', name: it.name || '', city: it.city || '', category: it.category || '' };
    try {
      if (isPinned(it)) await api.orgUnits.unpin({ tax_id: item.tax_id, name: item.name });
      else await api.orgUnits.pin(item);
      await loadPins(true);
    } catch { /* 忽略置頂失敗，不影響輸入 */ }
  }

  // Typeahead over 機關單位 (org_units)：單一輸入框可用統編或名稱搜尋。下拉顯示
  // 統編、單位名稱、單位類別，並可按 ★ 置頂常用單位（聚焦空白時優先顯示置頂）。
  function attachUnitSearch(nameInput, taxInput, dd, onChange) {
    let timer = null;
    let items = [];          // 目前顯示（已排序）的清單，供鍵盤操作
    let baseItems = [];      // 搜尋結果原始清單
    let mode = 'search';     // 'search' | 'pins'
    let active = -1;

    function close() { dd.hidden = true; dd.replaceChildren(); active = -1; }

    const sortPinnedFirst = (list) =>
      list.map((it, idx) => ({ it, idx })).sort((a, b) =>
        (isPinned(b.it) ? 1 : 0) - (isPinned(a.it) ? 1 : 0) || a.idx - b.idx,
      ).map((x) => x.it);

    function render() {
      let list = mode === 'pins' ? (pinsCache || []) : sortPinnedFirst(baseItems);
      items = list;
      if (active >= list.length) active = list.length - 1;
      dd.replaceChildren();

      if (mode === 'pins') {
        const head = document.createElement('div');
        head.className = 'unit-dd-head';
        head.textContent = '★ 置頂單位';
        dd.appendChild(head);
      }
      if (!list.length) {
        const e = document.createElement('div');
        e.className = 'unit-dd-empty';
        e.textContent = mode === 'pins'
          ? '尚無置頂單位 — 搜尋後按 ★ 加入常用'
          : '查無機關單位（如尚未匯入，請至「系統管理 → 機關單位維護」更新）';
        dd.appendChild(e);
        dd.hidden = false;
        return;
      }

      list.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'unit-dd-item' + (i === active ? ' active' : '');

        const star = document.createElement('button');
        star.type = 'button';
        const pinned = isPinned(it);
        star.className = 'ud-star' + (pinned ? ' is-pinned' : '');
        star.textContent = pinned ? '★' : '☆';
        star.title = pinned ? '取消置頂' : '加入置頂';
        // mousedown + preventDefault 保留輸入框焦點，避免觸發 blur 關閉下拉
        star.addEventListener('mousedown', async (e) => {
          e.preventDefault(); e.stopPropagation();
          await togglePin(it);
          render();
        });

        const body = document.createElement('div');
        body.className = 'ud-body';
        const nm = document.createElement('div');
        nm.className = 'ud-name'; nm.textContent = it.name || '(未命名)';
        const meta = document.createElement('div');
        meta.className = 'ud-meta';
        const parts = [];
        if (it.tax_id) parts.push('統編 ' + it.tax_id);
        if (categoryLabel(it.category)) parts.push(categoryLabel(it.category));
        if (it.city) parts.push(it.city);
        meta.textContent = parts.join(' · ');
        body.append(nm, meta);
        body.addEventListener('mousedown', (e) => { e.preventDefault(); pick(it); });

        row.append(star, body);
        dd.appendChild(row);
      });
      dd.hidden = false;
    }

    function pick(it) {
      nameInput.value = it.name || '';
      if (taxInput) taxInput.value = it.tax_id || '';
      close();
      if (onChange) onChange();
    }

    async function run(q) {
      q = (q || '').trim();
      if (!q) { mode = 'pins'; active = -1; await loadPins(); render(); return; }
      try { baseItems = await api.orgUnits.search(q, 20); mode = 'search'; active = -1; render(); }
      catch { close(); }
    }
    const schedule = (getVal) => { clearTimeout(timer); timer = setTimeout(() => run(getVal()), 250); };

    nameInput.addEventListener('input', () => schedule(() => nameInput.value));
    nameInput.addEventListener('focus', async () => {
      if (nameInput.value.trim()) { schedule(() => nameInput.value); return; }
      mode = 'pins'; active = -1; await loadPins(); render();
    });

    nameInput.addEventListener('keydown', (e) => {
      if (dd.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (active >= 0) { pick(items[active]); e.preventDefault(); } }
      else if (e.key === 'Escape') { close(); }
    });
    nameInput.addEventListener('blur', () => { setTimeout(close, 150); });
  }

  function mkIconBtn(text, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.title = title;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  // --- Form population --------------------------------------------------- //
  async function fillForm(rec) {
    loading = true;
    current = rec;
    const d = rec.data || {};
    el.id.textContent = '#' + rec.id;
    el.serial.value = rec.serial || '';
    el.recTax.value = (d.recipient && d.recipient.taxId) || '';
    el.recName.value = (d.recipient && d.recipient.name) || '';
    el.company.value = d.company || (el.company.options[0] && el.company.options[0].value) || '';
    // 字號選項依發文公司過濾；公司決定後再重建選項並帶入此公文的字號。
    await populateCodes(rec.code || '');
    el.code.value = rec.code || '';
    el.date.value = d.issueDate || todayISO();
    el.priority.value = d.priority || '普通件';
    attachments = Array.isArray(d.attachments) ? d.attachments.slice() : [];
    originals = Array.isArray(d.originals) ? d.originals.map((r) => ({ ...r })) : [];
    originalsAuto = false; // 既有資料視為手動設定，不自動覆寫
    copies = Array.isArray(d.copies) ? d.copies.map((r) => ({ ...r })) : [];
    el.subject.value = d.subject || '';
    // 用 Quill API 載入內容：直接改 root.innerHTML 會讓 MutationObserver
    // 在 loading 解除後才發出 text-change，把剛載入的公文標成未儲存。
    if (quill) quill.setContents(quill.clipboard.convert({ html: d.explanationHTML || '' }), 'silent');
    renderAttachments();
    renderRecipientList(el.originalsList, originals);
    renderRecipientList(el.copiesList, copies);
    dirty = false;
    setSaveState('已儲存');
    loading = false;
    renderPreview();
  }

  // --- Menu actions ------------------------------------------------------ //
  async function newLetter() {
    if (!confirmDiscard()) return;
    const hide = window.UI.overlay(document.getElementById('design-pane'));
    try {
      const rec = await api.letters.create({
        code: '', serial: '',
        data: {
          recipient: { taxId: '', name: '' },
          company: (el.company.options[0] && el.company.options[0].value) || '',
          issueDate: todayISO(), priority: '普通件',
          attachments: [], subject: '', explanationHTML: '',
          originals: [], copies: [],
        },
      });
      showForm();
      await fillForm(rec);
      originalsAuto = true; // 新公文：受文者填寫後自動帶入正本
    } finally { hide(); }
  }

  // 讀取公文：跳框顯示公文清單（左）與內容摘要（右），確認後載入。
  function letterLabel(row) {
    return row.code && row.serial ? `${row.code}字第${row.serial}號`
      : (row.code ? `${row.code}（未取號）` : '（未取號）');
  }

  async function openLetterPicker() {
    const body = window.UI.openModal('讀取公文');

    const wrap = document.createElement('div');
    const listEl = document.createElement('div');
    listEl.className = 'lp-list';
    const detailEl = document.createElement('div');
    detailEl.className = 'lp-detail';
    wrap.className = 'lp';
    wrap.append(listEl, detailEl);

    const foot = document.createElement('div');
    foot.className = 'lp-foot';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = '取消';
    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn';
    loadBtn.textContent = '載入公文';
    loadBtn.disabled = true;
    foot.append(cancelBtn, loadBtn);

    body.append(wrap, foot);

    let selected = null;     // full record of the highlighted row
    let activeItem = null;

    function detailEmpty(msg) {
      detailEl.replaceChildren();
      const e = document.createElement('div');
      e.className = 'lp-detail-empty';
      e.textContent = msg;
      detailEl.appendChild(e);
    }

    function detailField(label, value) {
      const f = document.createElement('div');
      f.className = 'lp-field';
      const k = document.createElement('span');
      k.className = 'lp-k';
      k.textContent = label;
      const v = document.createElement('div');
      v.className = 'lp-v';
      v.textContent = value || '—';
      f.append(k, v);
      return f;
    }

    function renderDetail(rec) {
      const d = rec.data || {};
      detailEl.replaceChildren();
      const names = (arr) => (arr || []).map((r) => r.name).filter(Boolean).join('、');
      // DOMParser 為惰性解析：只取純文字，不執行 script、不載入資源。
      const parsed = new DOMParser().parseFromString(d.explanationHTML || '', 'text/html');
      const explain = (parsed.body.textContent || '').trim();
      detailEl.append(
        detailField('發文字號', letterLabel(rec)),
        detailField('主旨', d.subject),
        detailField('受文者', d.recipient && d.recipient.name),
        detailField('發文公司', d.company),
        detailField('發文日期', d.issueDate),
        detailField('正本', names(d.originals)),
        detailField('副本', names(d.copies)),
        detailField('說明', explain.length > 300 ? explain.slice(0, 300) + '…' : explain),
        detailField('最後更新', formatTime(rec.updated_at)),
      );
    }

    async function selectRow(row, item) {
      if (activeItem) activeItem.classList.remove('is-active');
      activeItem = item;
      item.classList.add('is-active');
      selected = null;
      loadBtn.disabled = true;
      const hideDetail = window.UI.overlay(detailEl);
      try {
        const rec = await api.letters.get(row.id);
        if (item !== activeItem) return;   // 已切換選取，放棄舊結果
        if (!rec) { detailEmpty('讀取失敗：公文不存在'); return; }
        selected = rec;
        renderDetail(rec);
        loadBtn.disabled = false;
      } catch (err) {
        detailEmpty('讀取失敗：' + err.message);
      } finally { hideDetail(); }
    }

    async function doLoad() {
      if (!selected) return;
      if (!confirmDiscard()) return;
      window.UI.closeModal();
      showForm();
      await fillForm(selected);
    }

    cancelBtn.addEventListener('click', window.UI.closeModal);
    loadBtn.addEventListener('click', doLoad);

    detailEmpty('點選左側公文以檢視內容。');
    const hide = window.UI.overlay(listEl);
    try {
      const rows = await api.letters.list();
      if (!rows.length) {
        const e = document.createElement('div');
        e.className = 'lp-empty';
        e.textContent = '尚無公文，請先新增。';
        listEl.appendChild(e);
      }
      for (const row of rows) {
        const item = document.createElement('div');
        item.className = 'lp-item';
        const title = document.createElement('span');
        title.className = 'lp-title' + (row.serial ? '' : ' is-untitled');
        title.textContent = letterLabel(row);
        const meta = document.createElement('span');
        meta.className = 'lp-meta';
        meta.textContent = '#' + row.id + ' · 更新於 ' + formatTime(row.updated_at);
        item.append(title, meta);
        item.addEventListener('click', () => selectRow(row, item));
        item.addEventListener('dblclick', async () => {
          if (!selected || selected.id !== row.id) await selectRow(row, item);
          doLoad();
        });
        listEl.appendChild(item);
      }
    } catch (err) {
      const e = document.createElement('div');
      e.className = 'lp-empty';
      e.textContent = '載入失敗：' + err.message;
      listEl.appendChild(e);
    } finally { hide(); }
  }

  async function deleteLetter() {
    if (!current) return;
    const label = (current.code && current.serial) ? `${current.code}字第${current.serial}號` : '#' + current.id;
    if (!window.confirm('確定要刪除公文「' + label + '」嗎？此動作無法復原。')) return;
    await api.letters.remove(current.id);
    current = null;
    dirty = false;
    showEmpty();
    window.Preview.showBlank();
  }

  function formatTime(iso) {
    try {
      const d = new Date(iso);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch { return iso; }
  }

  // --- Populate static selects + Quill ----------------------------------- //
  // 字號 select — re-runnable so 文號維護 changes reflect immediately. Keeps the
  // current selection (or the given `keep` code) even if it no longer matches.
  // 字號可綁定發文公司（複選）：僅列出未綁定（不限公司）或綁定了目前發文公司的
  // 字號；已停用或非本公司的既有選取仍保留以免遺失。
  async function populateCodes(keep) {
    const prev = keep !== undefined ? keep : el.code.value;
    const companies = (window.LetterConfig && window.LetterConfig.companies) || [];
    const selCo = companies.find((c) => c.name === el.company.value);
    const selId = selCo ? selCo.id : null;
    el.code.replaceChildren();
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = '（未選字號）';
    el.code.appendChild(blank);
    const dns = await api.docNumbers.list();
    for (const dn of dns) {
      const bound = Array.isArray(dn.company_ids) ? dn.company_ids : [];
      const matchCo = bound.length === 0 || (selId != null && bound.includes(selId));
      if ((dn.enabled === 0 || !matchCo) && dn.code !== prev) continue;
      const o = document.createElement('option');
      o.value = dn.code;
      o.textContent = (dn.description ? `${dn.code}（${dn.description}）` : dn.code)
        + (dn.enabled === 0 ? '（已停用）' : (!matchCo ? '（非本公司字號）' : ''));
      el.code.appendChild(o);
    }
    if (prev && dns.some((d) => d.code === prev)) el.code.value = prev;
  }

  // 發文公司 select — 從 API 載入並快取到 window.LetterConfig.companies（供預覽查詢）。
  // 僅列出啟用中的公司；若目前選取的公司已停用仍保留該選項。
  async function populateCompanies() {
    const prev = el.company.value;
    let companies = [];
    try { companies = await api.companies.list(); } catch (err) { console.error(err); }
    window.LetterConfig.companies = companies;
    el.company.replaceChildren();
    for (const c of companies) {
      if (c.enabled === 0 && c.name !== prev) continue;
      const o = document.createElement('option');
      o.value = c.name;
      o.textContent = c.name + (c.enabled === 0 ? '（已停用）' : '');
      el.company.appendChild(o);
    }
    if (prev && companies.some((c) => c.name === prev)) el.company.value = prev;
  }

  async function populateSelects() {
    // 先載入公司（字號選項依所選公司過濾），再建字號下拉。
    await populateCompanies();
    await populateCodes();
    // 速別
    el.priority.replaceChildren();
    const prios = (window.LetterConfig && window.LetterConfig.priorities) || ['普通'];
    for (const p of prios) {
      const o = document.createElement('option');
      o.value = p; o.textContent = p;
      el.priority.appendChild(o);
    }
  }

  function initQuill() {
    quill = new window.Quill('#quill-explanation', {
      theme: 'snow',
      placeholder: '公文說明（可分項、套用格式）',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          [{ indent: '-1' }, { indent: '+1' }],
          ['clean'],
        ],
      },
    });
    quill.on('text-change', onEdit);
  }

  // --- Wiring ------------------------------------------------------------ //
  async function init() {
    if (!api) { console.error('editorAPI unavailable — preload not loaded?'); return; }

    showEmpty();
    window.Preview.showBlank();    // 開啟時不顯示任何預覽內容

    await populateSelects();
    initQuill();

    el.new.addEventListener('click', newLetter);
    el.open.addEventListener('click', openLetterPicker);
    el.save.addEventListener('click', saveNow);
    el.saveAs.addEventListener('click', saveAsLetter);
    el.del.addEventListener('click', deleteLetter);

    el.issue.addEventListener('click', async () => {
      const code = el.code.value;
      if (!code) { window.alert('請先選擇字號'); return; }
      window.UI.button(el.issue, true);
      try {
        const res = await api.docNumbers.issue(code);
        if (!res.ok) { window.alert(res.error); return; }
        el.serial.value = res.serial;
        await saveNow();
        renderPreview();
      } finally { window.UI.button(el.issue, false); }
    });

    // 受文者：機關單位搜尋（SQLite）；變動時連動正本預設值
    attachUnitSearch(el.recName, el.recTax, el.recDd, onRecipientChange);

    // Field edits → live preview + 未儲存標記（按「儲存公文」才寫入）。
    el.code.addEventListener('change', onEdit);
    // 手動修改名稱即清掉先前選取的統編（避免名稱與統編不一致）
    el.recName.addEventListener('input', () => { el.recTax.value = ''; onRecipientChange(); });
    // 發文公司變更 → 依綁定重建字號下拉（保留目前選取的字號）
    el.company.addEventListener('change', async () => { await populateCodes(); onEdit(); });
    el.date.addEventListener('change', onEdit);
    el.priority.addEventListener('change', onEdit);
    el.subject.addEventListener('input', onEdit);

    el.attachAdd.addEventListener('click', () => { attachments.push(''); renderAttachments(); onEdit(); });
    el.originalAdd.addEventListener('click', () => { originalsAuto = false; originals.push({ taxId: '', name: '' }); renderRecipientList(el.originalsList, originals); onEdit(); });
    el.copyAdd.addEventListener('click', () => { copies.push({ taxId: '', name: '' }); renderRecipientList(el.copiesList, copies); onEdit(); });

    el.reload.addEventListener('click', () => {
      if (current) renderPreview(); else window.Preview.showBlank();
    });

    // 文號維護 (admin.js) 變更字號後，即時更新字號下拉。
    window.addEventListener('docnumbers-changed', () => { populateCodes(); });

    // 公司資料維護 (admin.js) 變更後，更新發文公司與字號下拉並重繪預覽。
    window.addEventListener('companies-changed', async () => {
      await populateCompanies();
      await populateCodes();
      if (current) renderPreview();
    });

    // 有未儲存變更時，關閉頁面前提醒。
    window.addEventListener('beforeunload', (e) => {
      if (current && dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
