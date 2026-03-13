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
      const repos = data.repos || [];
      _renderRepos(col, repos, data.truncated);
    } catch (e) {
      col.querySelector('.col-body').innerHTML =
        `<div class="col-loading" style="color:var(--red)">Error: ${e.message}</div>`;
    }
  }

  function _renderRepos(col, repos, truncated) {
    // Update column title to include count
    const countLabel = truncated ? `${repos.length}+` : repos.length;
    col.querySelector('.col-header span:first-child').textContent =
      `🗂 REPOSITORIES (${countLabel})`;

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

    // Fix 1: notify user if results were capped at the pagination limit
    if (truncated) {
      const notice = document.createElement('div');
      notice.className = 'truncation-notice';
      notice.textContent = '⚠ Results capped at 1 000 repos. Token may have access to more.';
      body.appendChild(notice);
    }
  }
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
      const perms            = data.permissions || {};
      const p                = perms.permissions || {};
      const canWrite         = p.push || p.admin || p.maintain;
      const canWriteDefault  = perms.can_write_default;
      const branchProtected  = perms.branch_protected;
      const defaultBranch    = perms.default_branch || 'main';

      if (canWrite) {
        if (canWriteDefault) {
          // Red — can push directly to default branch (or is admin)
          col.classList.add('writable');
          col.querySelector('.col-header').insertAdjacentHTML('beforeend',
            `<span class="writable-badge">⚠ WRITE ACCESS</span>`);
        } else {
          // Orange — write access but default branch is protected
          col.classList.add('writable-protected');
          col.querySelector('.col-header').insertAdjacentHTML('beforeend',
            `<span class="writable-badge protected">⚠ WRITE (${_esc(defaultBranch)} protected)</span>`);
        }
      }

      _renderPreviewContent(col, data.file, null);
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

    // Fix 7: set path text safely — never use innerHTML with path/ref values
    const pathEl = col.querySelector('.col-path');
    if (ref) {
      // Preserve original base path on first ref view
      if (!pathEl.dataset.basePath) pathEl.dataset.basePath = pathEl.textContent;
      // Reset and rebuild: text node + styled SHA span
      pathEl.textContent = pathEl.dataset.basePath + ' ';
      const shaSpan = document.createElement('span');
      shaSpan.style.color = 'var(--amber)';
      shaSpan.textContent = `@ ${ref.slice(0, 7)}`;
      pathEl.appendChild(shaSpan);
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

          // Re-apply write access styling (classes set by loadFilePreview persist)
          // Nothing to do — classes are on the column element and survive content refresh
        } catch (e) {
          previewCol.querySelector('.col-body').innerHTML =
            `<div class="col-loading" style="color:var(--red)">Error: ${e.message}</div>`;
        }
      });

      body.appendChild(el);
    });
  }


  // ── Clear repos column ────────────────────────────────────────────
  function clearRepos() {
    _clearFrom(0);
    if (!document.querySelector('.explorer-placeholder')) {
      _container().innerHTML = `
        <div class="explorer-placeholder">
          <span class="ph-icon">🦝</span>
          <span class="ph-text">Select a token to begin exploring</span>
        </div>`;
    }
  }

  // ── Diff mode: show repos unique to each token ────────────────────
  async function loadDiff(tokenObjs) {
    _clearFrom(0);
    const placeholder = document.querySelector('.explorer-placeholder');
    if (placeholder) placeholder.remove();

    const col = _makeCol('repos', '🗂 DIFF');
    _appendCol(col);
    col.querySelector('.col-body').innerHTML = _loading();

    try {
      // Fetch repo lists for all selected tokens in parallel
      const results = await Promise.allSettled(
        tokenObjs.map(t => API.repos(t.token, t.endpoint).then(d => ({
          token: t,
          repos: d.repos || [],
          truncated: d.truncated || false,
        })))
      );

      // Fix 4: use allSettled — partial failures show which token failed
      const settled = results.map((r, idx) => {
        if (r.status === 'fulfilled') return r.value;
        return { token: tokenObjs[idx], repos: [], truncated: false, error: r.reason?.message || 'Failed' };
      });

      const anyError = settled.filter(s => s.error);
      if (anyError.length) {
        anyError.forEach(s => {
          const login = s.token.user?.login || s.token.token.slice(0, 8);
          toast(`Repo fetch failed for ${login}: ${s.error}`, 'error', 5000);
        });
      }

      const succeeded = settled.filter(s => !s.error);
      if (!succeeded.length) {
        col.querySelector('.col-body').innerHTML =
          `<div class="col-loading" style="color:var(--red)">All repo fetches failed</div>`;
        return;
      }

      // Build map: full_name -> array of token logins that can access it
      const repoMap = new Map();
      succeeded.forEach(({ token, repos }) => {
        repos.forEach(repo => {
          if (!repoMap.has(repo.full_name)) {
            repoMap.set(repo.full_name, { repo, tokens: [] });
          }
          repoMap.get(repo.full_name).tokens.push(token.user?.login || token.token.slice(0, 8));
        });
      });

      // Symmetric difference: repos NOT accessible by ALL successfully-fetched tokens
      const totalTokens = succeeded.length;
      const diffRepos = [...repoMap.values()].filter(({ tokens }) => tokens.length < totalTokens);
      const anyTruncated = settled.some(s => s.truncated);

      _renderDiffRepos(col, diffRepos, settled, anyTruncated);
    } catch (e) {
      col.querySelector('.col-body').innerHTML =
        `<div class="col-loading" style="color:var(--red)">Error: ${e.message}</div>`;
    }
  }

  function _renderDiffRepos(col, diffRepos, results, anyTruncated) {
    const totalTokens = results.filter(r => !r.error).length;
    const logins = results.map(r => r.token.user?.login || r.token.token.slice(0, 8));

    const countLabel = anyTruncated ? `${diffRepos.length}+` : diffRepos.length;
    col.querySelector('.col-header span:first-child').textContent =
      `🗂 DIFF (${countLabel} unique)`;

    if (!diffRepos.length) {
      col.querySelector('.col-body').innerHTML =
        '<div class="empty-state">No unique repositories — all tokens share the same access</div>';
      return;
    }

    const body = col.querySelector('.col-body');
    body.innerHTML = '';

    // Group by which token(s) own them
    diffRepos.forEach(({ repo, tokens: accessors }) => {
      const el = document.createElement('div');
      el.className = 'repo-entry';
      const [owner] = repo.full_name.split('/');

      // Show which token(s) can access this repo
      const accessTags = accessors.map(login =>
        `<span class="diff-owner-tag">${_esc(login)}</span>`
      ).join('');

      el.innerHTML = `
        <div class="repo-name">${_esc(repo.full_name)}</div>
        <div class="repo-desc">${_esc(repo.description || '')}</div>
        <div class="repo-meta">
          ${repo.private ? '<span class="repo-private">🔒 private</span>' : '<span>🌐 public</span>'}
          ${repo.fork ? '<span class="repo-fork">🍴 fork</span>' : ''}
          <span>⭐ ${repo.stargazers_count}</span>
          <span>${repo.language || ''}</span>
        </div>
        <div class="diff-access-row">only: ${accessTags}</div>
      `;

      // Use the first token that has access to browse this repo
      const ownerToken = results.find(r =>
        !r.error && (r.repos || []).some(rp => rp.full_name === repo.full_name)
      );

      el.addEventListener('click', () => {
        col.querySelectorAll('.repo-entry').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        _clearFrom(1);
        if (ownerToken) {
          _token    = ownerToken.token.token;
          _endpoint = ownerToken.token.endpoint;
        }
        loadContents(owner, repo.name, '');
      });

      body.appendChild(el);
    });

    // Fix 1: warn if any token's repo list was capped
    if (anyTruncated) {
      const notice = document.createElement('div');
      notice.className = 'truncation-notice';
      notice.textContent = '⚠ One or more tokens had results capped at 1 000 repos — diff may be incomplete.';
      body.appendChild(notice);
    }
  }

  return { loadToken, loadContents, loadFilePreview, loadCommits, loadDiff, clearRepos };
})();
