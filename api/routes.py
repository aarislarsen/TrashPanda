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

# Hard limits to prevent hangs on large inputs
MAX_CANDIDATES  = 50   # max tokens to validate per scan
VALIDATE_TIMEOUT = 8   # seconds per token/endpoint pair
MAX_WORKERS     = 10   # concurrent validation threads


# ── Token ingestion & validation ──────────────────────────────────────────────

@bp.route("/extract", methods=["POST"])
def extract():
    """Extract PAT candidates from raw text."""
    data = request.get_json(force=True)
    text = data.get("text", "")
    tokens = extract_pats(text)
    truncated = len(tokens) > MAX_CANDIDATES
    return jsonify({
        "tokens": tokens[:MAX_CANDIDATES],
        "total_found": len(tokens),
        "truncated": truncated,
    })


def _validate_one(token, endpoint):
    """Validate a single token against a single endpoint, with timeout."""
    with ThreadPoolExecutor(max_workers=1) as ex:
        future = ex.submit(validate_token, token, endpoint)
        try:
            res = future.result(timeout=VALIDATE_TIMEOUT)
        except FuturesTimeout:
            res = {"valid": False, "error": f"Timed out after {VALIDATE_TIMEOUT}s"}
        except Exception as e:
            res = {"valid": False, "error": str(e)}
    res["endpoint"] = endpoint
    return res


@bp.route("/validate", methods=["POST"])
def validate():
    """
    Validate tokens against endpoints concurrently.
    Body: { tokens: [...], endpoints: [...] }
    """
    data = request.get_json(force=True)
    tokens    = data.get("tokens", [])[:MAX_CANDIDATES]
    endpoints = data.get("endpoints", ["https://api.github.com"])

    # Build all (token, endpoint) pairs
    pairs = [(t, ep) for t in tokens for ep in endpoints]

    results_flat = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        future_map = {ex.submit(_validate_one, t, ep): (t, ep) for t, ep in pairs}
        for future, (token, endpoint) in future_map.items():
            try:
                res = future.result(timeout=VALIDATE_TIMEOUT + 2)
            except Exception as e:
                res = {"valid": False, "error": str(e), "endpoint": endpoint}
            results_flat.setdefault(token, []).append(res)

    results = {}
    for token, ep_results in results_flat.items():
        results[token] = {
            "endpoints": ep_results,
            "valid": any(r["valid"] for r in ep_results),
        }

    return jsonify(results)


# ── Repository enumeration ────────────────────────────────────────────────────

@bp.route("/repos", methods=["POST"])
def repos():
    data = request.get_json(force=True)
    token    = data["token"]
    endpoint = data.get("endpoint", "https://api.github.com")
    return jsonify({"repos": list_repos(token, endpoint), "orgs": list_orgs(token, endpoint)})


# ── Repository content browsing ───────────────────────────────────────────────

@bp.route("/contents", methods=["POST"])
def contents():
    data     = request.get_json(force=True)
    token    = data["token"]
    endpoint = data.get("endpoint", "https://api.github.com")
    owner    = data["owner"]
    repo     = data["repo"]
    path     = data.get("path", "")
    result   = list_repo_contents(token, endpoint, owner, repo, path)
    perms    = check_repo_permissions(token, endpoint, owner, repo)
    return jsonify({"contents": result, "permissions": perms})


@bp.route("/file", methods=["POST"])
def file_content():
    data     = request.get_json(force=True)
    token    = data["token"]
    endpoint = data.get("endpoint", "https://api.github.com")
    owner    = data["owner"]
    repo     = data["repo"]
    path     = data["path"]
    content  = get_file_content(token, endpoint, owner, repo, path)
    perms    = check_repo_permissions(token, endpoint, owner, repo)
    return jsonify({"file": content, "permissions": perms})


@bp.route("/file_at_ref", methods=["POST"])
def file_at_ref():
    data     = request.get_json(force=True)
    token    = data["token"]
    endpoint = data.get("endpoint", "https://api.github.com")
    owner    = data["owner"]
    repo     = data["repo"]
    path     = data["path"]
    ref      = data["ref"]
    content  = get_file_content(token, endpoint, owner, repo, path, ref=ref)
    perms    = check_repo_permissions(token, endpoint, owner, repo)
    return jsonify({"file": content, "permissions": perms})


@bp.route("/commits", methods=["POST"])
def commits():
    data     = request.get_json(force=True)
    token    = data["token"]
    endpoint = data.get("endpoint", "https://api.github.com")
    owner    = data["owner"]
    repo     = data["repo"]
    path     = data.get("path", "")
    history  = get_commits(token, endpoint, owner, repo, path)
    return jsonify({"commits": history})


@bp.route("/ping", methods=["POST"])
def ping():
    """Check if a GitHub API endpoint is reachable (unauthenticated)."""
    import requests as req
    data     = request.get_json(force=True)
    endpoint = data.get("endpoint", "")
    if not endpoint:
        return jsonify({"reachable": False, "error": "No endpoint provided"})
    try:
        r = req.get(f"{endpoint.rstrip('/')}/", timeout=5)
        reachable = r.status_code in (200, 401, 403)
        return jsonify({"reachable": reachable, "status": r.status_code})
    except Exception as e:
        return jsonify({"reachable": False, "error": str(e)})
