"""
AWS Lambda handler for syncing biometric attendance records from the
datalake-biometric React Native SDK.

Receives a JSON array of attendance records over HTTPS, writes each one
idempotently to DynamoDB. The device-generated HMAC-SHA256 signature is
preserved in the row for audit, but server-side verification is intentionally
NOT performed in this reference backend — the signing key on the device
lives in the Android Keystore and never leaves the device, so the Lambda has
nothing to compare against. Production hardening would add a per-device key
registration handshake; see SECURITY.md for the threat model and limitation.

Environment variables:
  DYNAMODB_TABLE       Name of the DynamoDB table. Set by the SAM template.
"""

import json
import os
import time
from typing import Any, Dict

import boto3
from botocore.exceptions import ClientError

# Initialise the DynamoDB resource once per cold start (module scope = cached
# across invocations on the same container).
_dynamodb = boto3.resource("dynamodb")
_table = _dynamodb.Table(os.environ["DYNAMODB_TABLE"])

# 90 days. Each row gets a TTL attribute so DynamoDB auto-purges old records.
_TTL_SECONDS = 90 * 24 * 60 * 60


def _response(status: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """Wrap a JSON body in the API Gateway HTTP API response envelope."""
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            # CORS — also configured on the HTTP API itself in template.yaml,
            # but echoing here keeps curl + browser tests symmetric.
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": json.dumps(body),
    }


def _persist(record: Dict[str, Any]) -> str:
    """
    Idempotently write a single record. Returns one of:
      "stored"     — fresh write
      "duplicate"  — same (deviceId, id) already in the table
      raises ClientError for anything else.
    """
    item = {
        "deviceId": record["deviceId"],
        "id": record["id"],
        "workerId": record["workerId"],
        "timestamp": int(record["timestamp"]),
        "latitude": str(record["latitude"]),
        "longitude": str(record["longitude"]),
        "confidence": str(record["confidence"]),
        "signature": record.get("signature", ""),
        "receivedAt": int(time.time()),
        "ttl": int(time.time()) + _TTL_SECONDS,
    }
    try:
        _table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(id)",
        )
        return "stored"
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return "duplicate"
        raise


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    Expected POST body:
      { "records": [ { id, workerId, timestamp, latitude, longitude,
                       confidence, deviceId, signature }, ... ] }

    Response:
      200 OK with per-record status array.
      400 if the body is missing/invalid.
      500 on unexpected DynamoDB errors.
    """
    # OPTIONS preflight from a browser — answer 204 with the CORS headers.
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return _response(204, {})

    try:
        raw_body = event.get("body", "")
        body = json.loads(raw_body) if isinstance(raw_body, str) else (raw_body or {})
        records = body.get("records") or []
        if not isinstance(records, list):
            return _response(400, {"error": "records must be an array"})
        if not records:
            return _response(200, {"summary": {"total": 0, "stored": 0, "duplicate": 0, "failed": 0}, "results": []})

        results = []
        counters = {"stored": 0, "duplicate": 0, "failed": 0}

        for record in records:
            record_id = record.get("id", "<missing-id>")
            required = ("id", "deviceId", "workerId", "timestamp", "latitude", "longitude", "confidence")
            missing = [k for k in required if k not in record]
            if missing:
                results.append({"id": record_id, "status": "failed", "reason": f"missing fields: {missing}"})
                counters["failed"] += 1
                continue

            try:
                outcome = _persist(record)
                results.append({"id": record_id, "status": outcome})
                counters[outcome] += 1
            except Exception as exc:  # noqa: BLE001 — log + return per-record
                print(f"persist failed for {record_id}: {exc}")
                results.append({"id": record_id, "status": "failed", "reason": str(exc)})
                counters["failed"] += 1

        return _response(
            200,
            {
                "summary": {"total": len(records), **counters},
                "results": results,
            },
        )

    except json.JSONDecodeError as exc:
        return _response(400, {"error": f"invalid JSON: {exc}"})
    except Exception as exc:  # noqa: BLE001
        print(f"unhandled error: {exc}")
        return _response(500, {"error": str(exc)})
