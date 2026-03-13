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
    Returns a dict with: valid, user, scopes, headers, error.
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
        "rate_limit": _get_rate_limit(s, api_base),
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


def list_repos(token: str, api_base: str) -> List[Dict]:
    """Return all repos accessible to the token (handles pagination)."""
    s = _session(token)
    repos = []
    url = f"{api_base.rstrip('/')}/user/repos?per_page=100&sort=updated"
    while url:
        try:
            r = s.get(url, timeout=TIMEOUT)
            if r.status_code != 200:
                break
            repos.extend(r.json())
            url = _next_link(r.headers.get("Link", ""))
        except requests.RequestException:
            break
    return repos


def list_orgs(token: str, api_base: str) -> List[Dict]:
    s = _session(token)
    try:
        r = s.get(f"{api_base.rstrip('/')}/user/orgs?per_page=100", timeout=TIMEOUT)
        return r.json() if r.status_code == 200 else []
    except Exception:
        return []


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
    """Fetch raw decoded content of a file, optionally at a specific commit ref."""
    import base64
    s = _session(token)
    url = f"{api_base.rstrip('/')}/repos/{owner}/{repo}/contents/{path}"
    if ref:
        url += f"?ref={ref}"
    try:
        r = s.get(url, timeout=TIMEOUT)
        if r.status_code != 200:
            return {"error": f"HTTP {r.status_code}"}
        data = r.json()
        if data.get("encoding") == "base64":
            try:
                data["decoded"] = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
            except Exception:
                data["decoded"] = None
        return data
    except Exception as e:
        return {"error": str(e)}


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
    """Parse RFC 5988 Link header for 'next' relation."""
    for part in link_header.split(","):
        parts = part.strip().split(";")
        if len(parts) == 2 and 'rel="next"' in parts[1]:
            return parts[0].strip().strip("<>")
    return None
