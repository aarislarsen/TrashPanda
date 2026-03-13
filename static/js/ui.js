/**
 * static/js/ui.js
 * DOM helpers, toast notifications, scan overlay, endpoint list, token list.
 */

// ── Toast ─────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Scan overlay ──────────────────────────────────────────────────
const ScanOverlay = {
  show() { document.getElementById('scanOverlay').classList.remove('hidden'); },
  hide() { document.getElementById('scanOverlay').classList.add('hidden'); },
  setStatus(msg) { document.getElementById('scanStatus').textContent = msg; },
  setProgress(pct) { document.getElementById('scanBar').style.width = `${pct}%`; },
};

// ── Endpoint connectivity check ───────────────────────────────────
async function pingEndpoint(itemEl) {
  const url = itemEl.dataset.url;
  const dot = itemEl.querySelector('.ep-dot');
  dot.className = 'ep-dot checking';
  try {
    const res = await API.ping(url);
    if (res.reachable) {
      dot.className = 'ep-dot reachable';
      dot.title = `Reachable (HTTP ${res.status})`;
    } else {
      dot.className = 'ep-dot unreachable';
      dot.title = res.error ? `Unreachable: ${res.error}` : `Unreachable (HTTP ${res.status})`;
    }
  } catch (e) {
    dot.className = 'ep-dot unreachable';
    dot.title = `Error: ${e.message}`;
  }
}

// ── Endpoint list ─────────────────────────────────────────────────
const EndpointManager = {
  getEndpoints() {
    return [...document.querySelectorAll('#endpointList .endpoint-item')]
      .map(el => el.dataset.url);
  },

  _buildItem(url, label = 'custom') {
    const el = document.createElement('div');
    el.className = 'endpoint-item';
    el.dataset.url = url;
    const host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    el.innerHTML = `
      <span class="ep-dot checking" title="Checking…"></span>
      <span class="ep-label">${label}</span>
      <span class="ep-url">${host}</span>
      <button class="ep-remove" title="Remove">×</button>
    `;
    el.querySelector('.ep-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      el.remove();
    });
    return el;
  },

  addEndpoint(url, label = 'custom') {
    if (!url.startsWith('http')) { toast('Endpoint must start with http(s)://', 'error'); return; }
    const existing = document.querySelector(`#endpointList [data-url="${CSS.escape(url)}"]`);
    if (existing) { toast('Endpoint already in list', 'info'); return; }
    const el = this._buildItem(url, label);
    document.getElementById('endpointList').appendChild(el);
    pingEndpoint(el);
  },

  pingAll() {
    document.querySelectorAll('#endpointList .endpoint-item').forEach(el => pingEndpoint(el));
  },
};

// ── Token list (multi-select) ─────────────────────────────────────
const TokenList = {
  _tokens: [],
  _selected: new Set(),   // indices of selected tokens

  clear() {
    this._tokens = [];
    this._selected = new Set();
    this._render();
  },

  add(tokenObj) {
    const key = tokenObj.token + '|' + tokenObj.endpoint;
    if (this._tokens.find(t => t.token + '|' + t.endpoint === key)) return;
    this._tokens.push(tokenObj);
    this._render();
  },

  _handleClick(i, event) {
    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+click: add to or remove from selection
      if (this._selected.has(i)) {
        this._selected.delete(i);
      } else {
        this._selected.add(i);
      }
    } else {
      // Plain click: replace selection with just this token
      this._selected = new Set([i]);
    }
    this._render();
    this._dispatch();
  },

  _dispatch() {
    const selected = [...this._selected].map(i => this._tokens[i]);
    if (selected.length === 0) {
      Explorer.clearRepos();
    } else if (selected.length === 1) {
      Explorer.loadToken(selected[0]);
    } else {
      Explorer.loadDiff(selected);
    }
  },

  _render() {
    const list = document.getElementById('tokenList');
    document.getElementById('tokenCount').textContent = this._tokens.length;

    if (this._tokens.length === 0) {
      list.innerHTML = '<div class="empty-state">No valid tokens yet</div>';
      return;
    }

    // Show hint when more than one token is available
    const hint = this._tokens.length > 1
      ? '<div class="multi-select-hint">Ctrl+click to select multiple</div>'
      : '';

    list.innerHTML = hint;

    this._tokens.forEach((t, i) => {
      const isSelected = this._selected.has(i);
      const el = document.createElement('div');
      el.className = 'token-item' + (isSelected ? ' selected' : '');
      const login = t.user?.login || 'unknown';

      // Issue 8: fine-grained PATs don't return X-OAuth-Scopes — the header is
      // absent, so scopes will always be empty.  Show an explanatory note rather
      // than the misleading "no scopes" label.
      const isFineGrained = t.token_type === 'fine-grained';
      let scopeHTML;
      if (isFineGrained) {
        scopeHTML = '<span class="scope-tag scope-note">fine-grained — scopes not visible via API</span>';
      } else {
        const tags = (t.scopes || []).map(s => {
          const cls = s.includes('write') || s.includes('delete') ? 'write'
                    : s === 'admin' || s.includes(':admin') ? 'admin' : '';
          return `<span class="scope-tag ${cls}">${s}</span>`;
        }).join('');
        scopeHTML = tags || '<span class="scope-tag">no scopes</span>';
      }

      // Issues 1 & 9: build the skeleton with innerHTML for *static* content only.
      // User-controlled values (token, login, endpoint) are set via textContent
      // afterwards so they are never parsed as HTML and cannot contain event handlers.
      el.innerHTML = `
        <div class="token-header">
          <span class="token-check">${isSelected ? '✓' : ''}</span>
          <span class="token-avatar">👤</span>
          <span class="token-login"></span>
          <span class="token-type"></span>
        </div>
        <div class="token-full">
          <span class="token-value" title="Full token value"></span>
          <button class="token-copy" title="Copy to clipboard">⎘</button>
        </div>
        <div class="token-scopes">${scopeHTML}</div>
        <div class="token-endpoint"></div>
      `;

      // Set user-supplied values safely via textContent (issues 1 & 9)
      el.querySelector('.token-login').textContent    = login;
      el.querySelector('.token-type').textContent     = t.token_type || '';
      el.querySelector('.token-value').textContent    = t.token;
      el.querySelector('.token-endpoint').textContent = t.endpoint.replace('https://', '');

      // Issue 1: copy handler via addEventListener — token value is captured in
      // closure, never interpolated into an attribute string
      const rawToken = t.token;
      el.querySelector('.token-copy').addEventListener('click', e => {
        e.stopPropagation();
        navigator.clipboard.writeText(rawToken)
          .then(() => toast('Token copied', 'success', 1500))
          .catch(() => toast('Copy failed — use manual selection', 'error'));
      });

      // Prevent clicks on the token-full row from triggering the select handler
      el.querySelector('.token-full').addEventListener('click', e => e.stopPropagation());

      el.addEventListener('click', (e) => this._handleClick(i, e));
      list.appendChild(el);
    });
  },
};

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnAddEp').addEventListener('click', () => {
    const val = document.getElementById('epInput').value.trim();
    if (val) {
      EndpointManager.addEndpoint(val);
      document.getElementById('epInput').value = '';
    }
  });
  document.getElementById('epInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btnAddEp').click();
  });

  document.querySelectorAll('#endpointList .endpoint-item').forEach(el => {
    el.querySelector('.ep-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      el.remove();
    });
    pingEndpoint(el);
  });
});
