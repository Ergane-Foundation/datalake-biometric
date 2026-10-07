# SPDX-License-Identifier: Apache-2.0
"""
Sync endpoint for attendance records queued by the faceproof SDK.

Receives a JSON batch of records and writes each one to DynamoDB. Writes are
idempotent: a record that was already stored is reported as "duplicate", so a
device can safely retry a batch after a network error. Requests reach this
function only after the token authorizer (authorizer.py) has accepted them.

The device's HMAC-SHA256 signature is stored with each record but not verified
here: each device signs with its own key, which never leaves the device. Server
side verification needs a key registration step; see docs/SECURITY_MODEL.md.

Environment variables:
  DYNAMODB_TABLE   Name of the DynamoDB table (set by template.yaml).
"""

import json
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import boto3
from botocore.exceptions import ClientError

_table = boto3.resource("dynamodb").Table(os.environ["DYNAMODB_TABLE"])

# Records are deleted by DynamoDB TTL 90 days after they are received.
_TTL_SECONDS = 90 * 24 * 60 * 60
MAX_RECORDS_PER_REQUEST = 500
_REQUIRED_TEXT = ("id", "deviceId", "workerId")


def _response(status: int, body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _number(value: Any) -> Optional[float]:
    # bool is a subclass of int in Python, but true/false is not a number here.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def validate(record: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Returns (item, None) for a valid record, or (None, reason) otherwise."""
    if not isinstance(record, dict):
        return None, "record must be an object"
    for key in _REQUIRED_TEXT:
        value = record.get(key)
        if not isinstance(value, str) or not 0 < len(value) <= 128:
            return None, f"{key} must be a string of 1 to 128 characters"
    timestamp = _number(record.get("timestamp"))
    confidence = _number(record.get("confidence"))
    if timestamp is None or confidence is None:
        return None, "timestamp and confidence must be numbers"

    now = int(time.time())
    item: Dict[str, Any] = {
        "deviceId": record["deviceId"],
        "id": record["id"],
        "workerId": record["workerId"],
        "timestamp": int(timestamp),
        # DynamoDB has no float type; decimals are kept as strings.
        "confidence": str(confidence),
        "signature": str(record.get("signature", ""))[:256],
        "receivedAt": now,
        "ttl": now + _TTL_SECONDS,
    }
    latitude = _number(record.get("latitude"))
    longitude = _number(record.get("longitude"))
    if (latitude is None) != (longitude is None):
        return None, "latitude and longitude must be given together"
    if latitude is not None and longitude is not None:
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return None, "location is out of range"
        item["latitude"] = str(latitude)
        item["longitude"] = str(longitude)
    return item, None


def _persist(item: Dict[str, Any]) -> str:
    try:
        _table.put_item(Item=item, ConditionExpression="attribute_not_exists(id)")
        return "stored"
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return "duplicate"
        raise


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    POST body: {"records": [{id, deviceId, workerId, timestamp, confidence,
    signature, latitude?, longitude?}, ...]}

    Returns 200 with a per-record status ("stored", "duplicate" or "failed").
    Clients should mark only "stored" and "duplicate" records as synced.
    """
    try:
        raw = event.get("body") or "{}"
        body = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return _response(400, {"error": "body must be valid JSON"})

    records = body.get("records") if isinstance(body, dict) else None
    if not isinstance(records, list):
        return _response(400, {"error": "records must be an array"})
    if len(records) > MAX_RECORDS_PER_REQUEST:
        return _response(413, {"error": f"at most {MAX_RECORDS_PER_REQUEST} records per request"})

    results: List[Dict[str, str]] = []
    counts = {"stored": 0, "duplicate": 0, "failed": 0}
    for record in records:
        record_id = record.get("id") if isinstance(record, dict) else None
        item, reason = validate(record)
        if item is None:
            results.append({"id": str(record_id), "status": "failed", "reason": reason or "invalid"})
            counts["failed"] += 1
            continue
        try:
            status = _persist(item)
        except ClientError as exc:
            # Logged for the operator; the client only gets a generic reason.
            print(f"DynamoDB error for record {item['id']}: {exc.response['Error']['Code']}")
            results.append({"id": item["id"], "status": "failed", "reason": "storage error"})
            counts["failed"] += 1
            continue
        results.append({"id": item["id"], "status": status})
        counts[status] += 1

    return _response(200, {"summary": {"total": len(records), **counts}, "results": results})
