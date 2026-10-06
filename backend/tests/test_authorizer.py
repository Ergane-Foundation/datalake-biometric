# SPDX-License-Identifier: Apache-2.0
import authorizer


def test_accepts_only_the_exact_bearer_token():
    assert authorizer.is_authorized("Bearer s3cret", "s3cret")
    assert authorizer.is_authorized("bearer s3cret", "s3cret")
    assert not authorizer.is_authorized("Bearer wrong", "s3cret")
    assert not authorizer.is_authorized("Basic s3cret", "s3cret")
    assert not authorizer.is_authorized("Bearer ", "s3cret")
    assert not authorizer.is_authorized("", "s3cret")


def test_an_empty_configured_token_never_authorizes():
    assert not authorizer.is_authorized("Bearer ", "")
    assert not authorizer.is_authorized("Bearer x", "")


def test_handler_reads_the_lower_cased_header(monkeypatch):
    monkeypatch.setattr(authorizer, "_expected_token", lambda: "s3cret")
    assert authorizer.handler({"headers": {"authorization": "Bearer s3cret"}}, None) == {"isAuthorized": True}
    assert authorizer.handler({"headers": {}}, None) == {"isAuthorized": False}
    assert authorizer.handler({}, None) == {"isAuthorized": False}
