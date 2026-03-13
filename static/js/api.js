/**
 * static/js/api.js
 * Thin wrapper around the Flask REST API.
 */

const API = (() => {
  const post = async (path, body) => {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
    return r.json();
  };

  return {
    /** Extract PAT candidates from raw text */
    extract: (text) => post('/api/extract', { text }),

    /** Validate tokens against endpoints */
    validate: (tokens, endpoints) => post('/api/validate', { tokens, endpoints }),

    /** List repos for a valid token */
    repos: (token, endpoint) => post('/api/repos', { token, endpoint }),

    /** List directory contents at path */
    contents: (token, endpoint, owner, repo, path = '') =>
      post('/api/contents', { token, endpoint, owner, repo, path }),

    /** Fetch decoded file content at HEAD */
    file: (token, endpoint, owner, repo, path) =>
      post('/api/file', { token, endpoint, owner, repo, path }),

    /** Fetch decoded file content at a specific commit SHA */
    fileAtRef: (token, endpoint, owner, repo, path, ref) =>
      post('/api/file_at_ref', { token, endpoint, owner, repo, path, ref }),

    /** Fetch commit history (optionally scoped to file path) */
    commits: (token, endpoint, owner, repo, path = '') =>
      post('/api/commits', { token, endpoint, owner, repo, path }),

    /** Check if a GitHub API endpoint is reachable (unauthenticated) */
    ping: (endpoint) => post('/api/ping', { endpoint }),
  };
})();
