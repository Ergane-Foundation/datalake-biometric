# SPDX-License-Identifier: Apache-2.0
"""
Lambda authorizer for the sync API (HTTP API, payload format 2.0, simple responses).

A request is allowed only if it carries `Authorization: Bearer <token>` and the
token equals the SecureString stored in SSM Parameter Store. The token is never
in the code, the template or the app's source; the app user types it in.

Environment variables:
  TOKEN_PARAMETER   Full SSM parameter name, for example /faceproof/sync-token.
"""

import hmac
import os
import time
from typing import Any, Dict, Optional

import boto3

_ssm = boto3.client("ssm")

# Re-read the token at most every five minutes, so a rotated token takes
# effect quickly without an SSM call on every request.
_CACHE_SECONDS = 300
_cached_token: Optional[str] = None
_cached_at = 0.0


def _expected_token() -> str:
    global _cached_token, _cached_at
    if _cached_token is None or time.time() - _cached_at > _CACHE_SECONDS:
        response = _ssm.get_parameter(Name=os.environ["TOKEN_PARAMETER"], WithDecryption=True)
        _cached_token = response["Parameter"]["Value"]
        _cached_at = time.time()
    return _cached_token


def is_authorized(header: str, expected: str) -> bool:
    """Checks a raw Authorization header value against the expected token."""
    scheme, _, presented = header.partition(" ")
    if scheme.lower() != "bearer" or not presented or not expected:
        return False
    # Constant-time comparison, so response timing does not leak the token.
    return hmac.compare_digest(presented.encode(), expected.encode())


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, bool]:
    # HTTP API lower-cases header names in payload format 2.0.
    header = (event.get("headers") or {}).get("authorization", "")
    return {"isAuthorized": is_authorized(header, _expected_token())}
