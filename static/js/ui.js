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

  // Pulsing while checking
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
    // Ping immediately after adding
    pingEndpoint(el);
  },

  pingAll() {
    document.querySelectorAll('#endpointList .endpoint-item').forEach(el => {
      pingEndpoint(el);
    });
  },
};

// ── Token list ────────────────────────────────────────────────────
const TokenList = {
  _tokens: [],
  _selected: null,

  clear() {
    this._tokens = [];
    this._selected = null;
    this._render();
  },

  add(tokenObj) {
    const key = tokenObj.token + '|' + tokenObj.endpoint;
    if (this._tokens.find(t => t.token + '|' + t.endpoint === key)) return;
    this._tokens.push(tokenObj);
    this._render();
  },

  _render() {
    const list = document.getElementById('tokenList');
    document.getElementById('tokenCount').textContent = this._tokens.length;

    if (this._tokens.length === 0) {
      list.innerHTML = '<div class="empty-state">No valid tokens yet</div>';
      return;
    }

    list.innerHTML = '';
    this._tokens.forEach((t, i) => {
      const el = document.createElement('div');
      el.className = 'token-item' + (this._selected === i ? ' selected' : '');
      const login = t.user?.login || 'unknown';
      const scopeTags = (t.scopes || []).map(s => {
        const cls = s.includes('write') || s.includes('delete') ? 'write'
                  : s === 'admin' || s.includes(':admin') ? 'admin' : '';
        return `<span class="scope-tag ${cls}">${s}</span>`;
      }).join('');

      el.innerHTML = `
        <div class="token-header">
          <span class="token-avatar">👤</span>
          <span class="token-login">${login}</span>
          <span class="token-type">${t.token_type || ''}</span>
        </div>
        <div class="token-full" onclick="event.stopPropagation()">
          <span class="token-value" title="Click to select">${t.token}</span>
          <button class="token-copy" title="Copy to clipboard" onclick="event.stopPropagation(); navigator.clipboard.writeText('${t.token}').then(() => toast('Token copied', 'success', 1500))">⎘</button>
        </div>
        <div class="token-scopes">${scopeTags || '<span class="scope-tag">no scopes</span>'}</div>
        <div class="token-endpoint">${t.endpoint.replace('https://','')}</div>
      `;
      el.addEventListener('click', () => {
        this._selected = i;
        this._render();
        Explorer.loadToken(t);
      });
      list.appendChild(el);
    });
  },
};

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Wire add button
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

  // Wire remove buttons on pre-populated endpoints and ping them
  document.querySelectorAll('#endpointList .endpoint-item').forEach(el => {
    el.querySelector('.ep-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      el.remove();
    });
    pingEndpoint(el);
  });
});
