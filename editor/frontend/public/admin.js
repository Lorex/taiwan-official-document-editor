'use strict';

// 系統管理：右上「系統管理」下拉（公司資料維護／文號維護／機關單位維護）。
// 目前實作「文號維護」modal（字號增刪改 + 編輯流水號）；另兩項先以佔位畫面呈現。

(function () {
  const api = window.editorAPI;
  const $ = (id) => document.getElementById(id);

  // Small operation button used in maintenance rows/cards.
  function mkOp(text, extra) {
    const b = document.createElement('button');
    b.className = 'btn btn-sm' + (extra ? ' ' + extra : '');
    b.textContent = text;
    return b;
  }

  const menuBtn = $('menu-admin');
  const menu = $('admin-dropdown');
  const modalBody = $('modal-body');

  // --- Dropdown ---------------------------------------------------------- //
  function toggleMenu() {
    const open = menu.hidden;
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  }
  function closeMenu() {
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  // Modal shell 由 ui.js 提供（UI.openModal / UI.closeModal）。
  const openModal = (title) => window.UI.openModal(title);

  // --- 文號維護 ---------------------------------------------------------- //
  async function openDocNumberAdmin() {
    openModal('文號維護');

    const wrap = document.createElement('div');
    wrap.className = 'admin';

    const table = document.createElement('table');
    table.className = 'admin-table';
    table.innerHTML =
      '<thead><tr>' +
      '<th style="width:13%">字號</th>' +
      '<th style="width:24%">發文公司</th>' +
      '<th style="width:20%">目前流水號</th>' +
      '<th>說明</th>' +
      '<th style="width:190px">操作</th>' +
      '</tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');

    let allCompanies = [];   // 供「發文公司」綁定選項與名稱顯示
    const companyName = (id) => {
      const c = allCompanies.find((x) => x.id === id);
      return c ? c.name : '#' + id;
    };

    const footer = document.createElement('div');
    footer.className = 'admin-foot';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.textContent = '＋ 新增字號';
    footer.appendChild(addBtn);

    wrap.append(table, footer);
    modalBody.appendChild(wrap);

    function makeInput(value, placeholder) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'admin-input';
      input.value = value || '';
      if (placeholder) input.placeholder = placeholder;
      return input;
    }

    // `row` is null for a brand-new (unsaved) entry; new rows open in edit mode.
    function addRow(row) {
      const state = {
        id: row ? row.id : null,
        code: row ? row.code : '',
        current_serial: row ? row.current_serial : '',
        description: row ? row.description : '',
        enabled: row ? row.enabled !== 0 : true,
        company_ids: row && Array.isArray(row.company_ids) ? row.company_ids.slice() : [],
      };
      const tr = document.createElement('tr');
      tbody.appendChild(tr);
      renderRow(tr, state, state.id == null);
    }

    function renderRow(tr, state, editing) {
      tr.replaceChildren();
      tr.classList.toggle('admin-row-disabled', !state.enabled);

      const codeTd = document.createElement('td');
      const coTd = document.createElement('td');  // 綁定的發文公司（可複選）
      const serialTd = document.createElement('td');
      serialTd.className = 'admin-serial';        // 目前流水號：一律唯讀顯示
      serialTd.textContent = state.current_serial || '—';
      const descTd = document.createElement('td');
      const ops = document.createElement('td');
      ops.className = 'admin-ops';

      if (editing) {
        const codeInput = makeInput(state.code, '如：矽商');
        const descInput = makeInput(state.description, '說明');
        codeTd.appendChild(codeInput);
        descTd.appendChild(descInput);

        // 發文公司複選框：列出啟用中的公司，另保留已綁定但停用者以免遺失。
        const picked = new Set(state.company_ids);
        const coBox = document.createElement('div');
        coBox.className = 'dn-cos';
        for (const c of allCompanies) {
          if (c.enabled === 0 && !picked.has(c.id)) continue;
          const lab = document.createElement('label');
          lab.className = 'dn-co';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = picked.has(c.id);
          cb.addEventListener('change', () => { if (cb.checked) picked.add(c.id); else picked.delete(c.id); });
          const txt = document.createElement('span');
          txt.textContent = c.name + (c.enabled === 0 ? '（已停用）' : '');
          lab.append(cb, txt);
          coBox.appendChild(lab);
        }
        const hint = document.createElement('div');
        hint.className = 'dn-co-hint';
        hint.textContent = '皆不勾選＝不限公司';
        coTd.append(coBox, hint);

        const save = mkOp('儲存');
        const cancel = mkOp('取消', 'btn-ghost');
        ops.append(save, cancel);

        save.addEventListener('click', async () => {
          const payload = {
            code: codeInput.value.trim(),
            description: descInput.value.trim(),
            company_ids: [...picked],
          };
          if (!payload.code) { window.alert('請輸入字號'); return; }
          window.UI.button(save, true);
          try {
            if (state.id == null) {
              const created = await api.docNumbers.create(payload);
              state.id = created.id;
              state.current_serial = created.current_serial;
            } else {
              await api.docNumbers.update(state.id, payload);
            }
            state.code = payload.code;
            state.description = payload.description;
            state.company_ids = payload.company_ids;
            notifyChanged();
            renderRow(tr, state, false);
          } catch (err) {
            window.UI.button(save, false);
            window.alert('儲存失敗：' + err.message);
          }
        });
        cancel.addEventListener('click', () => {
          if (state.id == null) tr.remove();
          else renderRow(tr, state, false);
        });
      } else {
        codeTd.textContent = state.code;
        coTd.className = 'dn-cos-view';
        coTd.textContent = state.company_ids.length
          ? state.company_ids.map(companyName).join('、')
          : '（不限）';
        descTd.textContent = state.description || '—';

        const edit = mkOp('編輯');
        const toggle = mkOp(state.enabled ? '停用' : '啟用', 'btn-ghost');
        const del = mkOp('刪除', 'btn-ghost');
        ops.append(edit, toggle, del);

        edit.addEventListener('click', () => renderRow(tr, state, true));

        toggle.addEventListener('click', async () => {
          window.UI.button(toggle, true);
          try {
            await api.docNumbers.update(state.id, { enabled: state.enabled ? 0 : 1 });
            state.enabled = !state.enabled;
            notifyChanged();
            renderRow(tr, state, false);
          } catch (err) {
            window.UI.button(toggle, false);
            window.alert('操作失敗：' + err.message);
          }
        });

        del.addEventListener('click', async () => {
          const label = state.code || '#' + state.id;
          if (!window.confirm(`確定刪除字號「${label}」？`)) return;
          window.UI.button(del, true);
          try {
            await api.docNumbers.remove(state.id);
            tr.remove();
            notifyChanged();
          } catch (err) {
            window.UI.button(del, false);
            window.alert('刪除失敗：' + err.message);
          }
        });
      }

      tr.append(codeTd, coTd, serialTd, descTd, ops);
    }

    addBtn.addEventListener('click', () => addRow(null));

    const hide = window.UI.overlay(modalBody);
    try {
      const [rows, cos] = await Promise.all([api.docNumbers.list(), api.companies.list()]);
      allCompanies = cos;
      if (!rows.length) addRow(null);
      else rows.forEach(addRow);
    } catch (err) {
      const p = document.createElement('p');
      p.className = 'admin-error';
      p.textContent = '載入失敗：' + err.message;
      modalBody.appendChild(p);
    } finally {
      hide();
    }
  }

  // Tell the editor to refresh its 字號 dropdown.
  function notifyChanged() {
    window.dispatchEvent(new CustomEvent('docnumbers-changed'));
  }
  function notifyCompaniesChanged() {
    window.dispatchEvent(new CustomEvent('companies-changed'));
  }

  // --- 公司資料維護 ------------------------------------------------------ //
  const CO_FIELDS = [
    { key: 'name', label: '公司名稱', placeholder: '公司全銜' },
    { key: 'address', label: '地址', placeholder: '公司地址' },
    { key: 'contact', label: '聯絡人', placeholder: '聯絡人姓名' },
    { key: 'phone', label: '電話', placeholder: '聯絡電話' },
    { key: 'email', label: '電子郵件', placeholder: 'name@example.com' },
  ];

  async function openCompanyAdmin() {
    openModal('公司資料維護');
    const wrap = document.createElement('div');
    wrap.className = 'admin';
    const list = document.createElement('div');
    list.className = 'co-list';
    const footer = document.createElement('div');
    footer.className = 'admin-foot';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.textContent = '＋ 新增公司';
    footer.appendChild(addBtn);
    wrap.append(list, footer);
    modalBody.appendChild(wrap);

    function addCard(co) {
      const state = {
        id: co ? co.id : null,
        enabled: co ? co.enabled !== 0 : true,
        logo: co ? (co.logo || '') : '',
        signature: co ? (co.signature || '') : '',
      };
      for (const f of CO_FIELDS) state[f.key] = co ? (co[f.key] || '') : '';
      const card = document.createElement('div');
      card.className = 'co-card';
      list.appendChild(card);
      renderCard(card, state, state.id == null);
    }

    // 圖片上傳區（頁首圖片 / 簽字章）。讀為 data URL 存入該公司欄位。
    function makeUpload(labelText, hint, getVal, setVal) {
      const box = document.createElement('div');
      box.className = 'co-upload co-col-2';
      const lab = document.createElement('span');
      lab.className = 'field-label';
      lab.textContent = labelText;
      const area = document.createElement('div');
      area.className = 'co-upbox';
      const thumb = document.createElement('div');
      thumb.className = 'co-thumb';
      function renderThumb() {
        thumb.replaceChildren();
        if (getVal()) {
          const img = document.createElement('img');
          img.src = getVal();
          thumb.appendChild(img);
        } else {
          const e = document.createElement('span');
          e.className = 'co-thumb-empty';
          e.textContent = '未設定';
          thumb.appendChild(e);
        }
      }
      renderThumb();
      const ctrls = document.createElement('div');
      ctrls.className = 'co-upctrls';
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.className = 'co-file';
      file.addEventListener('change', () => {
        const f = file.files && file.files[0];
        if (!f) return;
        if (!f.type.startsWith('image/')) { window.alert('請選擇圖片檔'); file.value = ''; return; }
        if (f.size > 2 * 1024 * 1024) { window.alert('圖片請小於 2MB'); file.value = ''; return; }
        const r = new FileReader();
        r.onload = () => { setVal(r.result); renderThumb(); };
        r.readAsDataURL(f);
      });
      const clear = mkOp('移除', 'btn-ghost');
      clear.addEventListener('click', () => { setVal(''); file.value = ''; renderThumb(); });
      const hintEl = document.createElement('span');
      hintEl.className = 'co-uphint';
      hintEl.textContent = hint;
      ctrls.append(file, clear);
      area.append(thumb, ctrls);
      box.append(lab, area, hintEl);
      return box;
    }

    function renderCard(card, state, editing) {
      card.replaceChildren();
      card.classList.toggle('co-card-disabled', !state.enabled);

      if (editing) {
        const form = document.createElement('div');
        form.className = 'co-form';
        const inputs = {};
        for (const f of CO_FIELDS) {
          const field = document.createElement('label');
          field.className = 'field' + (f.key === 'name' || f.key === 'address' || f.key === 'email' ? ' co-col-2' : '');
          const lab = document.createElement('span');
          lab.className = 'field-label';
          lab.textContent = f.label;
          const input = document.createElement('input');
          input.type = 'text';
          input.value = state[f.key];
          input.placeholder = f.placeholder;
          inputs[f.key] = input;
          field.append(lab, input);
          form.appendChild(field);
        }
        // 圖片上傳：頁首圖片 / 首長職銜簽字章
        form.appendChild(makeUpload('頁首圖片', '建議透明背景 PNG，顯示於公文左上角',
          () => state.logo, (v) => { state.logo = v; }));
        form.appendChild(makeUpload('首長職銜簽字章', '顯示於副本下方，呈現上傳原圖',
          () => state.signature, (v) => { state.signature = v; }));

        const ops = document.createElement('div');
        ops.className = 'co-ops';
        const save = mkOp('儲存');
        const cancel = mkOp('取消', 'btn-ghost');
        ops.append(save, cancel);
        card.append(form, ops);

        save.addEventListener('click', async () => {
          const payload = {};
          for (const f of CO_FIELDS) payload[f.key] = inputs[f.key].value.trim();
          payload.logo = state.logo;
          payload.signature = state.signature;
          if (!payload.name) { window.alert('請輸入公司名稱'); return; }
          window.UI.button(save, true);
          try {
            if (state.id == null) {
              const created = await api.companies.create(payload);
              state.id = created.id;
            } else {
              await api.companies.update(state.id, payload);
            }
            Object.assign(state, payload);
            notifyCompaniesChanged();
            renderCard(card, state, false);
          } catch (err) {
            window.UI.button(save, false);
            window.alert('儲存失敗：' + err.message);
          }
        });
        cancel.addEventListener('click', () => {
          if (state.id == null) card.remove();
          else renderCard(card, state, false);
        });
      } else {
        const head = document.createElement('div');
        head.className = 'co-head';
        const name = document.createElement('span');
        name.className = 'co-name';
        name.textContent = state.name || '（未命名公司）';
        const ops = document.createElement('div');
        ops.className = 'co-ops';
        const edit = mkOp('編輯');
        const toggle = mkOp(state.enabled ? '停用' : '啟用', 'btn-ghost');
        const del = mkOp('刪除', 'btn-ghost');
        ops.append(edit, toggle, del);
        head.append(name, ops);

        const meta = document.createElement('div');
        meta.className = 'co-meta';
        const parts = [
          ['地址', state.address], ['聯絡人', state.contact],
          ['電話', state.phone], ['電子郵件', state.email],
        ].filter(([, v]) => v);
        meta.textContent = parts.length
          ? parts.map(([k, v]) => `${k}：${v}`).join('　|　')
          : '（尚未填寫聯絡資訊）';

        card.append(head, meta);

        if (state.logo || state.signature) {
          const imgs = document.createElement('div');
          imgs.className = 'co-view-imgs';
          const add = (label, src) => {
            const cell = document.createElement('div');
            cell.className = 'co-view-cell';
            const cap = document.createElement('span');
            cap.className = 'co-view-cap';
            cap.textContent = label;
            const img = document.createElement('img');
            img.className = 'co-view-thumb';
            img.src = src;
            cell.append(cap, img);
            imgs.appendChild(cell);
          };
          if (state.logo) add('頁首圖片', state.logo);
          if (state.signature) add('簽字章', state.signature);
          card.appendChild(imgs);
        }

        edit.addEventListener('click', () => renderCard(card, state, true));
        toggle.addEventListener('click', async () => {
          window.UI.button(toggle, true);
          try {
            await api.companies.update(state.id, { enabled: state.enabled ? 0 : 1 });
            state.enabled = !state.enabled;
            notifyCompaniesChanged();
            renderCard(card, state, false);
          } catch (err) {
            window.UI.button(toggle, false);
            window.alert('操作失敗：' + err.message);
          }
        });
        del.addEventListener('click', async () => {
          if (!window.confirm(`確定刪除公司「${state.name || '#' + state.id}」？`)) return;
          window.UI.button(del, true);
          try {
            await api.companies.remove(state.id);
            card.remove();
            notifyCompaniesChanged();
          } catch (err) {
            window.UI.button(del, false);
            window.alert('刪除失敗：' + err.message);
          }
        });
      }
    }

    addBtn.addEventListener('click', () => addCard(null));

    const hide = window.UI.overlay(modalBody);
    try {
      const rows = await api.companies.list();
      if (!rows.length) addCard(null);
      else rows.forEach(addCard);
    } catch (err) {
      const p = document.createElement('p');
      p.className = 'admin-error';
      p.textContent = '載入失敗：' + err.message;
      modalBody.appendChild(p);
    } finally {
      hide();
    }
  }

  // --- 機關單位維護 ------------------------------------------------------ //
  async function openOrgAdmin() {
    openModal('機關單位維護');
    const wrap = document.createElement('div');
    wrap.className = 'org';

    // Tabs
    const tabsEl = document.createElement('div');
    tabsEl.className = 'org-tabs';

    // Toolbar: 搜尋 + 更新 + meta
    const toolbar = document.createElement('div');
    toolbar.className = 'org-toolbar';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'org-search';
    searchInput.placeholder = '搜尋機關名稱或統一編號';
    const searchBtn = mkOp('搜尋');
    const meta = document.createElement('span');
    meta.className = 'org-meta';
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-sm';
    refreshBtn.textContent = '更新';
    toolbar.append(searchInput, searchBtn, meta, refreshBtn);

    // Table + pager
    const tableWrap = document.createElement('div');
    tableWrap.className = 'org-table-wrap';
    const pager = document.createElement('div');
    pager.className = 'org-pager';

    wrap.append(tabsEl, toolbar, tableWrap, pager);
    modalBody.appendChild(wrap);

    const state = { category: null, q: '', page: 1, pageSize: 50, total: 0 };
    let cats = [];

    function renderTabs() {
      tabsEl.replaceChildren();
      for (const c of cats) {
        const b = document.createElement('button');
        b.className = 'org-tab' + (c.key === state.category ? ' is-active' : '');
        b.textContent = c.label;
        b.addEventListener('click', () => {
          if (state.category === c.key) return;
          state.category = c.key; state.q = ''; state.page = 1;
          searchInput.value = '';
          renderTabs(); load();
        });
        tabsEl.appendChild(b);
      }
    }

    function renderMeta() {
      const c = cats.find((x) => x.key === state.category);
      if (c && c.updatedAt) {
        const d = new Date(c.updatedAt);
        const p = (n) => String(n).padStart(2, '0');
        meta.textContent = `更新時間：${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ` +
          `${p(d.getHours())}:${p(d.getMinutes())}　共 ${c.count.toLocaleString()} 筆`;
      } else {
        meta.textContent = '尚未更新';
      }
    }

    function renderTable(rows) {
      tableWrap.replaceChildren();
      const table = document.createElement('table');
      table.className = 'admin-table org-table';
      table.innerHTML =
        '<thead><tr><th style="width:24%">統一編號</th><th>機關名稱</th>' +
        '<th style="width:22%">所在縣市</th></tr></thead><tbody></tbody>';
      const tb = table.querySelector('tbody');
      if (!rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.className = 'org-empty';
        td.textContent = state.q ? '查無符合資料。' : '尚無資料，請點「更新」從來源下載。';
        tr.appendChild(td);
        tb.appendChild(tr);
      } else {
        for (const r of rows) {
          const tr = document.createElement('tr');
          const c1 = document.createElement('td'); c1.className = 'admin-serial'; c1.textContent = r.tax_id || '—';
          const c2 = document.createElement('td'); c2.textContent = r.name || '';
          const c3 = document.createElement('td'); c3.textContent = r.city || '—';
          tr.append(c1, c2, c3);
          tb.appendChild(tr);
        }
      }
      tableWrap.appendChild(table);
    }

    function renderPager() {
      pager.replaceChildren();
      const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
      const prev = mkOp('上一頁', 'btn-ghost');
      const next = mkOp('下一頁', 'btn-ghost');
      prev.disabled = state.page <= 1;
      next.disabled = state.page >= totalPages;
      const info = document.createElement('span');
      info.className = 'org-pageinfo';
      info.textContent = `第 ${state.page} / ${totalPages} 頁　共 ${state.total.toLocaleString()} 筆`;
      prev.addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
      next.addEventListener('click', () => { if (state.page < totalPages) { state.page++; load(); } });
      pager.append(prev, info, next);
    }

    async function load() {
      const hide = window.UI.overlay(tableWrap);
      try {
        const res = await api.orgUnits.query(state);
        state.total = res.total;
        renderTable(res.rows);
        renderPager();
        renderMeta();
      } catch (err) {
        renderTable([]);
        meta.textContent = '載入失敗：' + err.message;
      } finally {
        hide();
      }
    }

    searchBtn.addEventListener('click', () => { state.q = searchInput.value.trim(); state.page = 1; load(); });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { state.q = searchInput.value.trim(); state.page = 1; load(); }
    });

    refreshBtn.addEventListener('click', async () => {
      if (!state.category) return;
      window.UI.button(refreshBtn, true);
      meta.textContent = '更新中…（資料量大時可能需要數分鐘）';
      try {
        const res = await api.orgUnits.refresh(state.category);
        if (!res.ok) { window.alert('更新失敗：' + res.error); }
        else {
          cats = await api.orgUnits.categories();
          state.page = 1; state.q = ''; searchInput.value = '';
        }
        await load();
      } catch (err) {
        window.alert('更新失敗：' + err.message);
      } finally {
        window.UI.button(refreshBtn, false);
      }
    });

    // Boot
    const hide = window.UI.overlay(modalBody);
    try {
      cats = await api.orgUnits.categories();
      state.category = cats[0] && cats[0].key;
      renderTabs();
    } catch (err) {
      meta.textContent = '載入分類失敗：' + err.message;
    } finally {
      hide();
    }
    if (state.category) load();
  }

  // --- Wiring ------------------------------------------------------------ //
  function init() {
    menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });

    $('admin-company').addEventListener('click', () => { closeMenu(); openCompanyAdmin(); });
    $('admin-docnum').addEventListener('click', () => { closeMenu(); openDocNumberAdmin(); });
    $('admin-org').addEventListener('click', () => { closeMenu(); openOrgAdmin(); });

    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn && !menuBtn.contains(e.target)) {
        closeMenu();
      }
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
