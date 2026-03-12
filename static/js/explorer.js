/**
 * static/js/explorer.js
 * Commander-style multi-column explorer.
 * Column types: repos | contents | preview | commits
 */

const Explorer = (() => {
  // Active context
  let _token = null;
  let _endpoint = null;

  // Column DOM nodes in order
  const _cols = [];

  function _container() {
    return document.getElementById('explorerColumns');
  }

  function _clearFrom(index) {
    while (_cols.length > index) {
      const col = _cols.pop();
      col.remove();
    }
  }

  function _appendCol(el) {
    _cols.push(el);
    _container().appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
  }

  function _makeCol(type, title) {
    const col = document.createElement('div');
    col.className = `exp-col ${type}`;
    col.dataset.type = type;
    col.innerHTML = `
      <div class="col-header">
        <span>${title.toUpperCase()}</span>
        <span class="col-path"></span>
      </div>
      <div class="col-body"></div>
    `;
    return col;
  }

  function _setColPath(col, path) {
    col.querySelector('.col-path').textContent = path;
  }

  function _loading() {
    return `<div class="col-loading"><span class="spinner"></span> Loading…</div>`;
  }

  function _formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}K`;
    return `${(bytes / 1048576).toFixed(1)}M`;
  }

  function _fileIcon(name, type) {
    if (type === 'dir') return '📁';
    const ext = name.split('.').pop().toLowerCase();
    const map = { py:'🐍', js:'📜', ts:'📜', json:'📋', md:'📝',
                  yml:'⚙️', yaml:'⚙️', sh:'🔧', txt:'📄', html:'🌐',
                  css:'🎨', jpg:'🖼️', png:'🖼️', gif:'🖼️', svg:'🖼️',
                  pdf:'📕', zip:'📦', tar:'📦', gz:'📦', env:'🔑',
                  key:'🔑', pem:'🔑', cert:'🔑' };
    return map[ext] || '📄';
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Token selected: load repo list ───────────────────────────────
  async function loadToken(tokenObj) {
    _token = tokenObj.token;
    _endpoint = tokenObj.endpoint;

    _clearFrom(0);
    const placeholder = document.querySelector('.explorer-placeholder');
    if (placeholder) placeholder.remove();

    const col = _makeCol('repos', '🗂 REPOSITORIES');
    _appendCol(col);
    col.querySelector('.col-body').innerHTML = _loading();

    try {
      const data = await API.repos(_token, _endpoint);
      _renderRepos(col, data.repos || []);
    } catch (e) {
      col.querySelector('.col-body').innerHTML =
        `<div class="col-loading" style="color:var(--red)">Error: ${e.message}</div>`;
    }
  }

  function _renderRepos(col, repos) {
    if (!repos.length) {
      col.querySelector('.col-body').innerHTML = '<div class="empty-state">No accessible repositories</div>';
      return;
    }
    const body = col.querySelector('.col-body');
    body.innerHTML = '';
    repos.forEach(repo => {
      const el = document.createElement('div');
      el.className = 'repo-entry';
      const [owner] = repo.full_name.split('/');
      el.innerHTML = `
        <div class="repo-name">${repo.full_name}</div>
        <div class="repo-desc">${_esc(repo.description || '')}</div>
        <div class="repo-meta">
          ${repo.private ? '<span class="repo-private">🔒 private</span>' : '<span>🌐 public</span>'}
          ${repo.fork ? '<span class="repo-fork">🍴 fork</span>' : ''}
          <span>⭐ ${repo.stargazers_count}</span>
          <span>${repo.language || ''}</span>
        </div>
      `;
      el.addEventListener('click', () => {
        col.querySelectorAll('.repo-entry').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        _clearFrom(1);
        loadContents(owner, repo.name, '');
      });
      body.appendChild(el);
    });
  }

  // ── Load directory contents ───────────────────────────────────────
  async function loadContents(owner, repo, path, parentColIndex = 1) {
    _clearFrom(parentColIndex);

    const col = _makeCol('contents', '📁 FILES');
    _setColPath(col, `${owner}/${repo}${path ? '/' + path : ''}`);
    _appendCol(col);
    col.querySelector('.col-body').innerHTML = _loading();

    try {
      const data = await API.contents(_token, _endpoint, owner, repo, path);
      const items = data.contents?.data;
      const perms = data.permissions || {};
      _renderContents(col, items, owner, repo, path, perms, parentColIndex);
    } catch (e) {
      col.querySelector('.col-body').innerHTML =
        `<div class="col-loading" style="color:var(--red)">Error: ${e.message}</div>`;
    }
  }

  function _renderContents(col, items, owner, repo, path, perms, colIndex) {
    if (!Array.isArray(items)) {
      col.querySelector('.col-body').innerHTML = '<div class="empty-state">Cannot list (may be a file)</div>';
      return;
    }

    items.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'dir' ? -1 : 1;
    });

    const body = col.querySelector('.col-body');
    body.innerHTML = '';
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'entry';
      el.innerHTML = `
        <span class="entry-icon">${_fileIcon(item.name, item.type)}</span>
        <span class="entry-name ${item.type === 'dir' ? 'dir' : ''}">${_esc(item.name)}</span>
        <span class="entry-size">${item.type === 'file' ? _formatSize(item.size) : ''}</span>
      `;
      el.addEventListener('click', () => {
        col.querySelectorAll('.entry').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        const nextIndex = colIndex + 1;
        _clearFrom(nextIndex);
        if (item.type === 'dir') {
          loadContents(owner, repo, item.path, nextIndex);
        } else {
          loadFilePreview(owner, repo, item.path, nextIndex);
        }
      });
      body.appendChild(el);
    });
  }

  // ── Load file preview ─────────────────────────────────────────────
  // previewColIndex is where the preview column lives in _cols
  async function loadFilePreview(owner, repo, path, colIndex) {
    _clearFrom(colIndex);

    const col = _makeCol('preview', '👁 PREVIEW');
    _setColPath(col, path);
    _appendCol(col);
    col.querySelector('.col-body').innerHTML = _loading();

    try {
      const data = await API.file(_token, _endpoint, owner, repo, path);
      const perms = data.permissions || {};
      const canWrite = perms.push || perms.admin;

      if (canWrite) {
        col.classList.add('writable');
        col.querySelector('.col-header').insertAdjacentHTML('beforeend',
          '<span class="writable-badge">⚠ WRITE ACCESS</span>');
      }

      _renderPreviewContent(col, data.file, null);
      // Auto-load commit history to the right; pass preview col ref for updates
      loadCommits(owner, repo, path, colIndex + 1, col, canWrite);
    } catch (e) {
      col.querySelector('.col-body').innerHTML =
        `<div class="col-loading" style="color:var(--red)">Error: ${e.message}</div>`;
    }
  }

  /**
   * Render (or refresh) the preview body.
   * ref: null = HEAD, string = commit SHA being shown
   */
  function _renderPreviewContent(col, fileData, ref) {
    const body = col.querySelector('.col-body');

    // Update header path to show ref if viewing historical version
    const pathEl = col.querySelector('.col-path');
    if (ref) {
      pathEl.innerHTML = `${_esc(pathEl.dataset.basePath || pathEl.textContent)} <span style="color:var(--amber)">@ ${ref.slice(0,7)}</span>`;
      pathEl.dataset.basePath = pathEl.dataset.basePath || pathEl.textContent;
    } else {
      if (pathEl.dataset.basePath) pathEl.textContent = pathEl.dataset.basePath;
    }

    if (!fileData || fileData.error) {
      body.innerHTML = `<div class="col-loading" style="color:var(--red)">${fileData?.error || 'Unknown error'}</div>`;
      return;
    }

    const content = fileData.decoded;
    if (content == null) {
      body.className = 'col-body binary';
      body.textContent = '[Binary file — cannot preview]';
      return;
    }

    body.className = 'col-body';
    body.style.cssText = 'white-space:pre-wrap;word-break:break-all;font-family:var(--font-mono);font-size:12px;line-height:1.6;padding:12px;overflow:auto;';
    body.textContent = content;
  }

  // ── Load commit history ───────────────────────────────────────────
  // previewCol: reference to the preview column so commits can update it in place
  async function loadCommits(owner, repo, path, colIndex, previewCol, canWrite) {
    _clearFrom(colIndex);

    const col = _makeCol('commits', '📜 COMMITS');
    _setColPath(col, path);
    _appendCol(col);
    col.querySelector('.col-body').innerHTML = _loading();

    try {
      const data = await API.commits(_token, _endpoint, owner, repo, path);
      _renderCommits(col, data.commits || [], owner, repo, path, previewCol, canWrite);
    } catch (e) {
      col.querySelector('.col-body').innerHTML =
        `<div class="col-loading" style="color:var(--red)">Error: ${e.message}</div>`;
    }
  }

  function _renderCommits(col, commits, owner, repo, path, previewCol, canWrite) {
    if (!commits.length) {
      col.querySelector('.col-body').innerHTML = '<div class="empty-state">No commits found</div>';
      return;
    }

    const body = col.querySelector('.col-body');
    body.innerHTML = '';

    commits.forEach((c, idx) => {
      const el = document.createElement('div');
      el.className = 'commit-entry';
      const sha = c.sha || '';
      const shortSha = sha.slice(0, 7);
      const msg = c.commit?.message?.split('\n')[0] || '';
      const author = c.commit?.author?.name || '';
      const date = c.commit?.author?.date
        ? new Date(c.commit.author.date).toLocaleDateString()
        : '';

      // First entry = HEAD — label it
      const headBadge = idx === 0
        ? '<span class="commit-head-badge">HEAD</span>'
        : '';

      el.innerHTML = `
        <div class="commit-sha">${shortSha} ${headBadge}</div>
        <div class="commit-msg">${_esc(msg)}</div>
        <div class="commit-author">${_esc(author)} · <span class="commit-date">${date}</span></div>
      `;

      el.style.cursor = 'pointer';
      el.addEventListener('click', async () => {
        // Highlight selected commit
        body.querySelectorAll('.commit-entry').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');

        if (!previewCol) return;

        // Show loading in preview body without destroying the column
        previewCol.querySelector('.col-body').innerHTML = _loading();

        try {
          // HEAD = use normal file endpoint (no ref), others use SHA
          let fileData;
          if (idx === 0) {
            const data = await API.file(_token, _endpoint, owner, repo, path);
            fileData = data.file;
          } else {
            const data = await API.fileAtRef(_token, _endpoint, owner, repo, path, sha);
            fileData = data.file;
          }
          _renderPreviewContent(previewCol, fileData, idx === 0 ? null : sha);

          // Re-apply writable border if needed
          if (canWrite) {
            previewCol.classList.add('writable');
          }
        } catch (e) {
          previewCol.querySelector('.col-body').innerHTML =
            `<div class="col-loading" style="color:var(--red)">Error: ${e.message}</div>`;
        }
      });

      body.appendChild(el);
    });
  }

  return { loadToken, loadContents, loadFilePreview, loadCommits };
})();
