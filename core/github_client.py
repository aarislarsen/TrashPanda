"""
core/github_client.py
Validates PATs against a given GitHub endpoint and enumerates accessible
resources: user info, scopes, orgs, repos. Supports github.com and GHE.
"""

import requests
from typing import Optional, Dict, Any, List

TIMEOUT = 10  # seconds per request


def _session(token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    return s


def validate_token(token: str, api_base: str) -> Dict[str, Any]:
    """
    Validate a PAT against api_base (e.g. https://api.github.com).
    Returns a dict with: valid, user, scopes, token_type, error.

    Rate limit is intentionally not fetched here — validate_token is called
    concurrently for every candidate, so fetching rate_limit per token would
    double the number of outbound requests.  Callers that need rate_limit
    data should call _get_rate_limit() separately after validation.
    """
    s = _session(token)
    url = f"{api_base.rstrip('/')}/user"
    try:
        r = s.get(url, timeout=TIMEOUT)
    except requests.RequestException as e:
        return {"valid": False, "error": str(e)}

    if r.status_code == 401:
        return {"valid": False, "error": "Unauthorized (401)"}
    if r.status_code == 403:
        return {"valid": False, "error": "Forbidden (403) — may be suspended"}
    if r.status_code not in (200, 201):
        return {"valid": False, "error": f"HTTP {r.status_code}"}

    scopes_raw = r.headers.get("X-OAuth-Scopes", "")
    scopes = [s.strip() for s in scopes_raw.split(",") if s.strip()]
    user_data = r.json()

    return {
        "valid": True,
        "user": user_data,
        "scopes": scopes,
        "token_type": _classify_token(token),
    }


def _classify_token(token: str) -> str:
    if token.startswith("github_pat_"):
        return "fine-grained"
    if token.startswith("gho_"):
        return "oauth"
    if token.startswith("ghu_"):
        return "user-to-server"
    if token.startswith("ghs_"):
        return "server-to-server"
    if token.startswith("ghr_"):
        return "refresh"
    if token.startswith("ghp_"):
        return "classic-prefixed"
    return "classic"


def _get_rate_limit(session: requests.Session, api_base: str) -> Optional[Dict]:
    try:
        r = session.get(f"{api_base.rstrip('/')}/rate_limit", timeout=TIMEOUT)
        if r.status_code == 200:
            return r.json().get("rate", {})
    except Exception:
        pass
    return None


_MAX_REPO_PAGES = 10  # cap at 1 000 repos (10 pages × 100 per page)


def list_repos(token: str, api_base: str):
    """
    Return repos accessible to the token, with pagination.

    Returns (repos: List[Dict], truncated: bool).
    Capped at _MAX_REPO_PAGES pages to prevent runaway requests against
    machine-user tokens with access to thousands of repositories.
    """
    s = _session(token)
    repos: List[Dict] = []
    url: Optional[str] = f"{api_base.rstrip('/')}/user/repos?per_page=100&sort=updated"
    pages = 0
    while url and pages < _MAX_REPO_PAGES:
        try:
            r = s.get(url, timeout=TIMEOUT)
            if r.status_code != 200:
                break
            repos.extend(r.json())
            url = _next_link(r.headers.get("Link", ""))
            pages += 1
        except requests.RequestException:
            break
    truncated = url is not None  # a next page exists beyond the cap
    return repos, truncated


def list_orgs(token: str, api_base: str) -> List[Dict]:
    """Return all orgs accessible to the token (handles pagination)."""
    s = _session(token)
    orgs: List[Dict] = []
    url: Optional[str] = f"{api_base.rstrip('/')}/user/orgs?per_page=100"
    while url:
        try:
            r = s.get(url, timeout=TIMEOUT)
            if r.status_code != 200:
                break
            orgs.extend(r.json())
            url = _next_link(r.headers.get("Link", ""))
        except Exception:
            break
    return orgs


def list_repo_contents(token: str, api_base: str, owner: str, repo: str, path: str = "") -> Any:
    """List directory contents or return file metadata at path."""
    s = _session(token)
    url = f"{api_base.rstrip('/')}/repos/{owner}/{repo}/contents/{path}"
    try:
        r = s.get(url, timeout=TIMEOUT)
        return {"status": r.status_code, "data": r.json()}
    except Exception as e:
        return {"status": 0, "error": str(e)}


def get_file_content(token: str, api_base: str, owner: str, repo: str, path: str, ref: str = None) -> Dict:
    """
    Fetch raw decoded content of a file, optionally at a specific commit ref.

    The Contents API (/repos/.../contents/...) is tried first.  If the file
    exceeds 1 MB GitHub returns 403 with a specific message; in that case we
    fall back to the Git Blobs API (/repos/.../git/blobs/:sha) which supports
    files up to 100 MB.
    """
    import base64
    s = _session(token)
    base = api_base.rstrip('/')

    url = f"{base}/repos/{owner}/{repo}/contents/{path}"
    if ref:
        url += f"?ref={ref}"

    try:
        r = s.get(url, timeout=TIMEOUT)
    except Exception as e:
        return {"error": str(e)}

    # GitHub returns 403 + specific message when file exceeds 1 MB via Contents API
    if r.status_code == 403:
        try:
            msg = r.json().get("message", "")
        except Exception:
            msg = ""
        if "1 MB" in msg or "too large" in msg.lower() or "blob" in msg.lower():
            return _get_large_file(s, base, owner, repo, path, ref)
        return {"error": f"HTTP 403 — {msg or 'Forbidden'}"}

    if r.status_code != 200:
        return {"error": f"HTTP {r.status_code}"}

    data = r.json()

    # Contents API may also return size field indicating truncation risk
    if isinstance(data, dict) and data.get("size", 0) > 1_000_000 and not data.get("content"):
        return _get_large_file(s, base, owner, repo, path, ref)

    if data.get("encoding") == "base64":
        try:
            data["decoded"] = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        except Exception:
            data["decoded"] = None
    return data


def _get_large_file(session: requests.Session, base: str, owner: str, repo: str, path: str, ref: Optional[str]) -> Dict:
    """
    Fetch a file that exceeds the 1 MB Contents API limit using the Git Blobs API.
    Requires resolving the blob SHA first via the Trees API.
    """
    import base64

    # Step 1: get the tree SHA for the given ref (or HEAD)
    ref_param = ref or "HEAD"
    try:
        r = session.get(
            f"{base}/repos/{owner}/{repo}/git/trees/{ref_param}?recursive=1",
            timeout=TIMEOUT,
        )
        if r.status_code != 200:
            return {"error": f"Large file: could not fetch tree (HTTP {r.status_code})"}
        tree = r.json().get("tree", [])
    except Exception as e:
        return {"error": f"Large file: tree fetch failed — {e}"}

    # Step 2: find the blob SHA for our path
    blob_sha = next((item["sha"] for item in tree if item.get("path") == path), None)
    if not blob_sha:
        return {"error": f"Large file: path '{path}' not found in tree"}

    # Step 3: fetch the blob
    try:
        r = session.get(
            f"{base}/repos/{owner}/{repo}/git/blobs/{blob_sha}",
            timeout=TIMEOUT,
        )
        if r.status_code != 200:
            return {"error": f"Large file: blob fetch failed (HTTP {r.status_code})"}
        data = r.json()
        if data.get("encoding") == "base64":
            try:
                data["decoded"] = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
            except Exception:
                data["decoded"] = None
        return data
    except Exception as e:
        return {"error": f"Large file: blob fetch failed — {e}"}


def get_commits(token: str, api_base: str, owner: str, repo: str, path: str = "", per_page: int = 20) -> List[Dict]:
    """Get commit history, optionally scoped to a file path."""
    s = _session(token)
    params = f"?per_page={per_page}" + (f"&path={path}" if path else "")
    url = f"{api_base.rstrip('/')}/repos/{owner}/{repo}/commits{params}"
    try:
        r = s.get(url, timeout=TIMEOUT)
        return r.json() if r.status_code == 200 else []
    except Exception:
        return []


def check_repo_permissions(token: str, api_base: str, owner: str, repo: str) -> Dict:
    """
    Return repo permissions and default branch protection status.
    Result keys:
      permissions       - dict with pull/push/admin/maintain booleans
      default_branch    - name of the default branch (e.g. 'main')
      branch_protected  - True if the default branch has protection rules
      can_write_default - True if token can push to the default branch
                          (admin tokens bypass branch protection rules)
    """
    s = _session(token)
    base = api_base.rstrip('/')

    # 1. Fetch repo metadata
    try:
        r = s.get(f"{base}/repos/{owner}/{repo}", timeout=TIMEOUT)
        if r.status_code != 200:
            return {}
        repo_data = r.json()
    except Exception:
        return {}

    perms          = repo_data.get("permissions", {})
    default_branch = repo_data.get("default_branch", "main")

    # 2. Check branch protection on the default branch
    # 403 = protected but token lacks permission to read rules (still protected)
    # 404 = no protection rules configured
    # 200 = protection rules exist and are readable
    branch_protected = False
    try:
        bp_url = f"{base}/repos/{owner}/{repo}/branches/{default_branch}/protection"
        bp = s.get(bp_url, timeout=TIMEOUT)
        if bp.status_code in (200, 403):
            branch_protected = True
        elif bp.status_code == 404:
            branch_protected = False
    except Exception:
        pass  # Treat as unprotected if call fails

    # Admin tokens can disable protection rules — treat as full write access
    can_write_default = (
        (perms.get("push") or perms.get("maintain")) and not branch_protected
    ) or perms.get("admin", False)

    return {
        "permissions":       perms,
        "default_branch":    default_branch,
        "branch_protected":  branch_protected,
        "can_write_default": can_write_default,
    }


def _next_link(link_header: str) -> Optional[str]:
    """
    Parse an RFC 5988 Link header and return the URL for rel="next", or None.

    The old implementation split on ',' which breaks when a URL contains a
    comma in its query string.  Using a regex to match each <url>; rel="next"
    pair directly is safe against that.
    """
    import re
    for m in re.finditer(r'<([^>]+)>\s*;[^,]*\brel="next"', link_header):
        return m.group(1)
    return None
