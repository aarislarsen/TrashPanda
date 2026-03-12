"""
core/pat_extractor.py
Extracts GitHub PAT candidates from raw text.

Pattern rationale
-----------------
Prefixed tokens (github_pat_*, gho_*, ghu_*, ghs_*, ghr_*, ghp_*) are
unambiguous — no other common credential or hash uses these prefixes.

Classic 40-char hex tokens are ambiguous: Git commit SHAs, content hashes,
and many other values share the same format. To reduce false positives we
apply two additional heuristics before accepting a 40-char hex string:

  1. Context keywords — the token must appear near a known GitHub/token
     keyword on the same line (e.g. "token", "pat", "key", "secret",
     "authorization", "github", "credential", "password", "passwd", "pwd").

  2. Character set diversity — real PATs use mixed case hex and tend to
     have a balanced distribution. We reject strings that are all-lowercase
     (typical of Git SHAs in log output) unless a context keyword is present.

These heuristics will miss some classic PATs that appear with no context,
but that is an acceptable trade-off against flooding the validator with
thousands of commit SHAs from lockfiles and git logs.
"""

import re
from typing import List

# ── Prefixed token patterns (unambiguous) ─────────────────────────
_PREFIXED_PATTERNS = [
    re.compile(r'github_pat_[A-Za-z0-9_]{82}'),
    re.compile(r'gho_[A-Za-z0-9]{36}'),
    re.compile(r'ghu_[A-Za-z0-9]{36}'),
    re.compile(r'ghs_[A-Za-z0-9]{36}'),
    re.compile(r'ghr_[A-Za-z0-9]{36}'),
    re.compile(r'ghp_[A-Za-z0-9]{36}'),
]

# ── Classic 40-char hex (ambiguous) ───────────────────────────────
_CLASSIC_RE = re.compile(r'(?<![a-fA-F0-9])([a-fA-F0-9]{40})(?![a-fA-F0-9])')

# Keywords that suggest a line contains a credential rather than a hash
_CONTEXT_KEYWORDS = re.compile(
    r'token|pat|api[_\-]?key|secret|auth|credential|password|passwd|pwd|github|bearer',
    re.IGNORECASE,
)


def _looks_like_classic_pat(token: str, line: str) -> bool:
    """
    Return True if a 40-char hex string is plausibly a PAT rather than
    a commit SHA or content hash.

    Heuristics (either is sufficient):
      - The line contains a credential context keyword.
      - The token contains both upper and lower case hex characters
        (Git SHAs are always lowercase; GitHub classic PATs use mixed case).
    """
    has_context = bool(_CONTEXT_KEYWORDS.search(line))
    is_mixed_case = (
        any(c.isupper() for c in token) and any(c.islower() for c in token)
    )
    return has_context or is_mixed_case


def extract_pats(text: str) -> List[str]:
    """
    Extract unique PAT candidates from a block of text.
    Returns a deduplicated list; order is not guaranteed.
    """
    found: set = set()

    # Prefixed tokens — scan full text, all matches are candidates
    for pattern in _PREFIXED_PATTERNS:
        for match in pattern.findall(text):
            found.add(match.strip())

    # Classic tokens — apply per-line heuristics
    for line in text.splitlines():
        for match in _CLASSIC_RE.finditer(line):
            token = match.group(1)
            if _looks_like_classic_pat(token, line):
                found.add(token)

    return list(found)
