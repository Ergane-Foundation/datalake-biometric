# SPDX-License-Identifier: Apache-2.0
import json

import pytest
from botocore.exceptions import ClientError

import lambda_sync_handler as sync


class FakeTable:
    """Mimics put_item with ConditionExpression attribute_not_exists(id)."""

    def __init__(self, fail_with=None):
        self.items = {}
        self.fail_with = fail_with

    def put_item(self, Item, ConditionExpression):
        if self.fail_with:
            raise ClientError({"Error": {"Code": self.fail_with}}, "PutItem")
        key = (Item["deviceId"], Item["id"])
        if key in self.items:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem")
        self.items[key] = Item


def record(**overrides):
    base = {
        "id": "r1",
        "deviceId": "d1",
        "workerId": "W-1",
        "timestamp": 1700000000000,
        "confidence": 0.91,
        "signature": "sig",
    }
    base.update(overrides)
    return base


def call(records):
    response = sync.handler({"body": json.dumps({"records": records})}, None)
    return response["statusCode"], json.loads(response["body"])


@pytest.fixture
def table(monkeypatch):
    fake = FakeTable()
    monkeypatch.setattr(sync, "_table", fake)
    return fake


def test_stores_new_records_and_reports_retries_as_duplicates(table):
    status, body = call([record()])
    assert status == 200
    assert body["results"] == [{"id": "r1", "status": "stored"}]

    _, body = call([record()])
    assert body["results"] == [{"id": "r1", "status": "duplicate"}]
    assert len(table.items) == 1


def test_location_is_optional_but_must_be_complete_and_in_range(table):
    _, body = call([
        record(id="no-location"),
        record(id="with-location", latitude=10.5, longitude=20.25),
        record(id="half", latitude=10.5),
        record(id="far", latitude=91, longitude=0),
    ])
    statuses = {r["id"]: r["status"] for r in body["results"]}
    assert statuses == {"no-location": "stored", "with-location": "stored", "half": "failed", "far": "failed"}
    assert "latitude" not in table.items[("d1", "no-location")]
    assert table.items[("d1", "with-location")]["latitude"] == "10.5"


@pytest.mark.parametrize(
    "bad",
    [record(id=""), record(workerId=None), record(timestamp="soon"), record(confidence=True), "not-an-object"],
)
def test_rejects_invalid_records_individually(table, bad):
    _, body = call([bad, record(id="good")])
    assert [r["status"] for r in body["results"]] == ["failed", "stored"]


def test_rejects_malformed_or_oversized_requests(table):
    assert sync.handler({"body": "{not json"}, None)["statusCode"] == 400
    assert sync.handler({"body": json.dumps({"records": "x"})}, None)["statusCode"] == 400
    status, _ = call([record(id=str(i)) for i in range(sync.MAX_RECORDS_PER_REQUEST + 1)])
    assert status == 413


def test_storage_errors_are_not_leaked_to_the_client(monkeypatch):
    monkeypatch.setattr(sync, "_table", FakeTable(fail_with="ProvisionedThroughputExceededException"))
    _, body = call([record()])
    assert body["results"] == [{"id": "r1", "status": "failed", "reason": "storage error"}]
