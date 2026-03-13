"""
api/routes.py
Flask blueprint exposing all REST endpoints consumed by the frontend.
"""

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from flask import Blueprint, request, jsonify
from core.pat_extractor import extract_pats
from core.github_client import (
    validate_token,
    list_repos,
    list_orgs,
    list_repo_contents,
    get_file_content,
    get_commits,
    check_repo_permissions,
)

bp = Blueprint("api", __name__, url_prefix="/api")


def _get_body():
    """
    Parse the JSON request body. Returns an empty dict if the body is
    missing or not valid JSON rather than raising AttributeError downstream.
    """
    data = request.get_json(force=True, silent=True)
    return data if isinstance(data, dict) else {}


# Hard limits to prevent hangs on large inputs
MAX_CANDIDATES  = 50   # max tokens to validate per scan
VALIDATE_TIMEOUT = 8   # seconds per token/endpoint pair
MAX_WORKERS     = 10   # concurrent validation threads


# ── Token ingestion & validation ──────────────────────────────────────────────

@bp.route("/extract", methods=["POST"])
def extract():
    """Extract PAT candidates from raw text."""
    data = _get_body()
    text = data.get("text", "")
    tokens = extract_pats(text)
    truncated = len(tokens) > MAX_CANDIDATES
    return jsonify({
        "tokens": tokens[:MAX_CANDIDATES],
        "total_found": len(tokens),
        "truncated": truncated,
    })


@bp.route("/validate", methods=["POST"])
def validate():
    """
    Validate tokens against endpoints concurrently.
    Body: { tokens: [...], endpoints: [...] }

    Each (token, endpoint) pair is submitted directly to the pool.
    validate_token() uses requests with a hardcoded TIMEOUT so no nested
    executor is needed — the outer future.result(timeout=...) is the safety net.
    """
    data      = _get_body()
    tokens    = data.get("tokens", [])[:MAX_CANDIDATES]
    endpoints = data.get("endpoints", ["https://api.github.com"])

    pairs = [(t, ep) for t in tokens for ep in endpoints]

    results_flat = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        future_map = {ex.submit(validate_token, t, ep): (t, ep) for t, ep in pairs}
        for future, (token, endpoint) in future_map.items():
            try:
                res = future.result(timeout=VALIDATE_TIMEOUT + 2)
            except FuturesTimeout:
                res = {"valid": False, "error": f"Timed out after {VALIDATE_TIMEOUT}s"}
            except Exception as e:
                res = {"valid": False, "error": str(e)}
            res["endpoint"] = endpoint
            results_flat.setdefault(token, []).append(res)

    results = {
        token: {
            "endpoints": ep_results,
            "valid": any(r["valid"] for r in ep_results),
        }
        for token, ep_results in results_flat.items()
    }

    return jsonify(results)


def _require(data, *keys):
    """
    Extract required keys from a request dict.
    Raises a 400 JSON response via ValueError if any key is missing or blank.
    """
    values = []
    for k in keys:
        v = data.get(k)
        if v is None:
            raise KeyError(k)
        values.append(v)
    return values if len(values) > 1 else values[0]


def _bad_request(missing_key):
    from flask import jsonify as _j
    return _j({"error": f"Missing required field: {missing_key}"}), 400


# ── Repository enumeration ────────────────────────────────────────────────────

@bp.route("/repos", methods=["POST"])
def repos():
    data     = _get_body()
    try:
        token = _require(data, "token")
    except KeyError as e:
        return _bad_request(e.args[0])
    endpoint = data.get("endpoint", "https://api.github.com")
    # list_repos returns (repos, truncated) — unpack both
    repo_list, truncated = list_repos(token, endpoint)
    return jsonify({
        "repos": repo_list,
        "orgs": list_orgs(token, endpoint),
        "truncated": truncated,
    })


# ── Repository content browsing ───────────────────────────────────────────────

@bp.route("/contents", methods=["POST"])
def contents():
    data = _get_body()
    try:
        token, owner, repo = _require(data, "token", "owner", "repo")
    except KeyError as e:
        return _bad_request(e.args[0])
    endpoint = data.get("endpoint", "https://api.github.com")
    path     = data.get("path", "")
    result   = list_repo_contents(token, endpoint, owner, repo, path)
    perms    = check_repo_permissions(token, endpoint, owner, repo)
    return jsonify({"contents": result, "permissions": perms})


@bp.route("/file", methods=["POST"])
def file_content():
    data = _get_body()
    try:
        token, owner, repo, path = _require(data, "token", "owner", "repo", "path")
    except KeyError as e:
        return _bad_request(e.args[0])
    endpoint = data.get("endpoint", "https://api.github.com")
    content  = get_file_content(token, endpoint, owner, repo, path)
    perms    = check_repo_permissions(token, endpoint, owner, repo)
    return jsonify({"file": content, "permissions": perms})


@bp.route("/file_at_ref", methods=["POST"])
def file_at_ref():
    data = _get_body()
    try:
        token, owner, repo, path, ref = _require(data, "token", "owner", "repo", "path", "ref")
    except KeyError as e:
        return _bad_request(e.args[0])
    endpoint = data.get("endpoint", "https://api.github.com")
    content  = get_file_content(token, endpoint, owner, repo, path, ref=ref)
    perms    = check_repo_permissions(token, endpoint, owner, repo)
    return jsonify({"file": content, "permissions": perms})


@bp.route("/commits", methods=["POST"])
def commits():
    data = _get_body()
    try:
        token, owner, repo = _require(data, "token", "owner", "repo")
    except KeyError as e:
        return _bad_request(e.args[0])
    endpoint = data.get("endpoint", "https://api.github.com")
    path     = data.get("path", "")
    history  = get_commits(token, endpoint, owner, repo, path)
    return jsonify({"commits": history})


@bp.route("/ping", methods=["POST"])
def ping():
    """Check if a GitHub API endpoint is reachable (unauthenticated)."""
    import requests as req
    data     = _get_body()
    endpoint = data.get("endpoint", "")
    if not endpoint:
        return jsonify({"reachable": False, "error": "No endpoint provided"})
    try:
        r = req.get(f"{endpoint.rstrip('/')}/", timeout=5)
        reachable = r.status_code in (200, 401, 403)
        return jsonify({"reachable": reachable, "status": r.status_code})
    except Exception as e:
        return jsonify({"reachable": False, "error": str(e)})
