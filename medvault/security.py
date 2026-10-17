"""Password hashing and session tokens, stdlib only (no native wheels to worry about on s390x).

Record encryption (AES-256-GCM via ``cryptography``) lives in the KMS module (VLT-1), not here.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets

PBKDF2_ALGORITHM = "pbkdf2_sha256"
PBKDF2_ITERATIONS = 100_000  # ~40 ms per login on a laptop; demo-friendly, still not trivial
_SALT_BYTES = 16


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str, *, iterations: int = PBKDF2_ITERATIONS) -> str:
    salt = os.urandom(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{PBKDF2_ALGORITHM}${iterations}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt, digest = stored.split("$", 3)
        if algorithm != PBKDF2_ALGORITHM:
            return False
        expected = _unb64(digest)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), _unb64(salt), int(iterations)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str, secret_key: str) -> str:
    """Keyed hash of a session token: a leaked DB row cannot be replayed as a cookie."""
    return hmac.new(secret_key.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()
