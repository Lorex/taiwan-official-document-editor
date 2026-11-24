'use strict';

// Shared loading-spinner + modal helpers used across the app.
//   UI.overlay(container)  -> covers a (positioned) container with a spinner;
//                             returns a function that removes it.
//   UI.center(container)   -> replaces a container's content with a spinner.
//   UI.button(btn, on)     -> swaps a button's label for an inline spinner and
//                             disables it (on=true) / restores it (on=false).
//   UI.openModal(title)    -> opens the shared #modal-overlay shell, clears the
//                             body and returns the body element.
//   UI.closeModal()        -> hides the shared modal shell.

(function () {
  function makeSpinner(cls) {
    const s = document.createElement('div');
    s.className = 'spinner' + (cls ? ' ' + cls : '');
    return s;
  }

  window.UI = {
    makeSpinner,

    overlay(container) {
      const ov = document.createElement('div');
      ov.className = 'loading-overlay';
      ov.appendChild(makeSpinner('spinner-lg'));
      container.appendChild(ov);
      return () => ov.remove();
    },

    center(container) {
      container.replaceChildren();
      const w = document.createElement('div');
      w.className = 'loading-center';
      w.appendChild(makeSpinner('spinner-lg'));
      container.appendChild(w);
    },

    openModal(title) {
      document.getElementById('modal-title').textContent = title;
      const body = document.getElementById('modal-body');
      body.replaceChildren();
      document.getElementById('modal-overlay').hidden = false;
      return body;
    },

    closeModal() {
      document.getElementById('modal-overlay').hidden = true;
      document.getElementById('modal-body').replaceChildren();
    },

    button(btn, on) {
      if (!btn) return;
      if (on) {
        if (btn.dataset.loading) return;
        btn.dataset.loading = '1';
        btn.dataset.label = btn.textContent;
        btn.disabled = true;
        const sp = document.createElement('span');
        sp.className = 'spinner-btn';
        btn.replaceChildren(sp);
      } else {
        if (!btn.dataset.loading) return;
        delete btn.dataset.loading;
        btn.disabled = false;
        btn.textContent = btn.dataset.label || '';
        delete btn.dataset.label;
      }
    },
  };

  // Modal shell wiring: close button / backdrop click / Escape.
  window.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    document.getElementById('modal-close').addEventListener('click', window.UI.closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) window.UI.closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) window.UI.closeModal(); });
  });
})();
