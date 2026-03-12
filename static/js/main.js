/**
 * static/js/main.js
 * Wires up the ingestion flow: extract → validate → populate token list.
 */

document.addEventListener('DOMContentLoaded', () => {

  // ── Tab switching ───────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab${capitalize(target)}`).classList.add('active');
    });
  });

  // ── Paste flow ──────────────────────────────────────────────────
  document.getElementById('btnExtract').addEventListener('click', () => {
    const text = document.getElementById('tokenInput').value.trim();
    if (!text) { toast('Paste some text first', 'error'); return; }
    runScan(text);
  });

  // ── File drop / browse ───────────────────────────────────────────
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  let pendingFileText = null;

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });

  function loadFile(file) {
    document.getElementById('fileName').textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      pendingFileText = e.target.result;
      document.getElementById('btnExtractFile').disabled = false;
    };
    reader.readAsText(file);
  }

  document.getElementById('btnExtractFile').addEventListener('click', () => {
    if (!pendingFileText) return;
    runScan(pendingFileText);
  });

  // ── New scan button ──────────────────────────────────────────────
  document.getElementById('btnNewScan').addEventListener('click', () => {
    TokenList.clear();
    document.getElementById('tokenInput').value = '';
    document.getElementById('fileName').textContent = '';
    pendingFileText = null;
    document.getElementById('btnExtractFile').disabled = true;
    document.getElementById('explorerColumns').innerHTML = `
      <div class="explorer-placeholder">
        <span class="ph-icon">🦝</span>
        <span class="ph-text">Select a token to begin exploring</span>
      </div>`;
    toast('Cleared', 'info');
  });

  // ── Main scan flow ───────────────────────────────────────────────
  async function runScan(text) {
    const endpoints = EndpointManager.getEndpoints();
    if (!endpoints.length) { toast('Add at least one endpoint', 'error'); return; }

    ScanOverlay.show();
    ScanOverlay.setStatus('Extracting tokens…');
    ScanOverlay.setProgress(5);

    let candidates = [];
    try {
      const res = await API.extract(text);
      candidates = res.tokens || [];
      if (res.truncated) {
        toast(`Input had ${res.total_found} candidates — capped at ${candidates.length} to prevent hangs. Refine your input if tokens are missing.`, 'info', 6000);
      }
    } catch (e) {
      ScanOverlay.hide();
      toast(`Extract failed: ${e.message}`, 'error');
      return;
    }

    if (!candidates.length) {
      ScanOverlay.hide();
      toast('No token candidates found in input', 'info');
      return;
    }

    ScanOverlay.setStatus(`Found ${candidates.length} candidate(s). Validating…`);
    ScanOverlay.setProgress(20);

    let validCount = 0;
    try {
      const results = await API.validate(candidates, endpoints);
      const total = Object.keys(results).length;
      let i = 0;

      for (const [token, result] of Object.entries(results)) {
        i++;
        ScanOverlay.setProgress(20 + Math.round((i / total) * 75));
        ScanOverlay.setStatus(`Checking ${i}/${total}…`);

        if (!result.valid) continue;

        // Add one entry per valid endpoint
        result.endpoints.forEach(ep => {
          if (!ep.valid) return;
          validCount++;
          TokenList.add({
            token,
            endpoint: ep.endpoint,
            user: ep.user,
            scopes: ep.scopes,
            token_type: ep.token_type,
            rate_limit: ep.rate_limit,
          });
        });
      }
    } catch (e) {
      ScanOverlay.hide();
      toast(`Validation failed: ${e.message}`, 'error');
      return;
    }

    ScanOverlay.setProgress(100);
    ScanOverlay.setStatus('Done');
    setTimeout(() => ScanOverlay.hide(), 400);

    if (validCount === 0) {
      toast(`${candidates.length} candidate(s) found, none valid`, 'info');
    } else {
      toast(`${validCount} valid token(s) found`, 'success');
    }
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
});
