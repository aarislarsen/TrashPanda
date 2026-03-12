# 🦝 TrashPanda

A browser-based tool for validating GitHub Personal Access Tokens (PATs) and exploring the resources they can access. Designed to run locally from WSL and accessed via a browser.

Intended for use during penetration tests, red team engagements, and incident response investigations where GitHub PATs have been discovered in source code, configuration files, secrets vaults, or tool output.

---

## What it does

### Token ingestion
Accepts tokens in two ways:
- **Paste** — paste raw text directly, including tool output, log files, environment variable dumps, or anything else
- **File** — drop or browse to a file (`.txt`, `.json`, `.csv`, `.log`, `.yml`, `.xml`, etc.)

TrashPanda scans the input for all known GitHub PAT formats and extracts candidates automatically. Up to 50 candidates are extracted per scan to prevent hangs on large files.

### Token formats detected

| Format | Example prefix | Type |
|---|---|---|
| Fine-grained PAT | `github_pat_` | Fine-grained |
| Classic prefixed | `ghp_` | Classic |
| OAuth token | `gho_` | OAuth |
| User-to-server | `ghu_` | User-to-server |
| Server-to-server | `ghs_` | Server-to-server |
| Refresh token | `ghr_` | Refresh |
| Classic (legacy) | 40-char hex | Classic |

Classic 40-character hex tokens are filtered against context heuristics to avoid false positives from Git commit SHAs and content hashes — a token is only accepted if the surrounding line contains a credential keyword (e.g. `token`, `secret`, `auth`, `github`, `password`) or the hex string contains mixed case (Git SHAs are always lowercase; GitHub PATs are not).

### Token validation
Each candidate is validated against all configured endpoints by calling the GitHub `/user` API. For each valid token, TrashPanda records:
- **GitHub username** associated with the token
- **Token type** (fine-grained, classic, OAuth, etc.)
- **OAuth scopes** granted (e.g. `repo`, `read:org`, `admin:org`)
- **Rate limit** remaining

Validation runs concurrently with an 8-second per-token timeout so a single unresponsive endpoint cannot hang the scan.

### Endpoint management
Supports both GitHub.com and GitHub Enterprise. Multiple endpoints can be configured simultaneously — tokens are validated against all of them. Each endpoint displays a status indicator:

- 🟡 Pulsing — currently checking reachability
- 🟢 Green — endpoint is reachable
- 🔴 Red — endpoint is unreachable (connection refused, timeout, or DNS failure)

Endpoints are pinged on page load and immediately when a new one is added.

### Repository explorer
Valid tokens are listed in the left panel. Clicking a token opens a Commander-style multi-column file explorer:

```
[Repositories] → [Files] → [File Preview] → [Commit History]
```

- **Repositories** — all repos accessible to the token, showing visibility, fork status, star count, and language
- **Files** — directory tree for the selected repo; directories expand into a new column
- **File preview** — decoded file content with correct whitespace and line formatting
- **Commit history** — the last 20 commits scoped to the selected file; clicking a commit loads that version of the file in the preview pane

### Write access indicators
If a token grants write or admin access to a repository, the file preview pane is outlined in red and labelled **⚠ WRITE ACCESS**. This is determined by the `push` and `admin` permission flags returned by the GitHub API for that repository.

---

## Setup

**Requirements:** Python 3.10+, running in WSL or native Linux.

```bash
git clone <repo>
cd TrashPanda
pip install -r requirements.txt
python3 app.py
```

Then open `http://localhost:5000` in your browser. If running in WSL, use `http://localhost:5000` from Windows — Flask binds to `0.0.0.0` so it is reachable from the Windows host.

---

## Usage

### 1. Configure endpoints
The sidebar pre-populates with `api.github.com` and a placeholder GHE entry. Remove or edit these as needed. Add any GitHub Enterprise endpoints in the format:

```
https://github.yourcorp.com/api/v3
```

### 2. Ingest tokens

**From a paste:**
1. Click the **Paste** tab
2. Paste any raw text — environment variable exports, tool output, config files, etc.
3. Click **Extract & Validate**

**From a file:**
1. Click the **File** tab
2. Drag a file onto the drop zone, or click **browse** to select one
3. Click **Extract & Validate**

Useful input sources include:
- Output from [trufflehog](https://github.com/trufflesecurity/trufflehog), [gitleaks](https://github.com/gitleaks/gitleaks), or [noseyparker](https://github.com/praetorian-inc/noseyparker)
- `.env` files, CI/CD configuration files, Kubernetes secrets dumps
- Shell history files, bash/zsh history
- AWS Secrets Manager or HashiCorp Vault exports
- Raw git repository contents

### 3. Review valid tokens
Valid tokens appear in the **VALID TOKENS** panel on the left. Each entry shows:
- GitHub username
- Token type
- Granted scopes (write-level scopes are highlighted amber, admin scopes red)
- Which endpoint the token was valid against

### 4. Explore repositories
Click a token to load its accessible repositories. Then:
- Click a **repository** to browse its file tree
- Click a **directory** to expand it in a new column
- Click a **file** to preview its contents and load its commit history
- Click a **commit** to view that historical version of the file in the preview pane
- A **red border** on the preview pane means the token has write or admin access to that repository

---

## Project structure

```
TrashPanda/
├── app.py                    # Flask entry point
├── requirements.txt
├── core/
│   ├── pat_extractor.py      # Regex extraction and classic token heuristics
│   └── github_client.py      # GitHub API calls: validate, enumerate, browse
├── api/
│   └── routes.py             # REST endpoints consumed by the frontend
├── templates/
│   └── index.html            # Single-page HTML shell
└── static/
    ├── css/main.css
    └── js/
        ├── api.js            # fetch() wrappers — one function per endpoint
        ├── ui.js             # Toast, scan overlay, endpoint list, token list
        ├── explorer.js       # Multi-column file explorer logic
        └── main.js           # Ingestion and scan flow
```

---

## Limitations

- Classic 40-char hex PATs with no surrounding context will not be extracted (by design — to avoid false positives from commit SHAs)
- Binary files cannot be previewed
- Commit history is capped at 20 entries per file
- Token validation is capped at 50 candidates per scan; if a file produces more, a warning is shown and the first 50 are used
- The tool makes real API calls to GitHub — run it only against endpoints you are authorised to test

---

## Legal

This tool is intended for authorised security testing and incident response only. Ensure you have written permission before using discovered tokens to access any systems or data.
