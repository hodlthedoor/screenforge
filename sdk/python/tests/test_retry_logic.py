"""Tests for retry logic and error handling."""

import json
import httpx
import pytest
from screenforge import ScreenForgeClient, RateLimitError, ScreenForgeError


def test_retry_on_429_with_retry_after():
    """Test that 429 with Retry-After triggers retry."""
    attempt = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempt
        attempt += 1
        if attempt == 1:
            return httpx.Response(
                429,
                json={"error": {"message": "Rate limited", "details": {"retryAfter": 1}}},
            )
        return httpx.Response(200, content=b"success")

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport, max_retries=2)

    result = client.screenshot("https://example.com")
    assert result == b"success"
    assert attempt == 2


def test_retry_on_500():
    """Test retry on 500 server error."""
    attempt = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempt
        attempt += 1
        if attempt <= 2:
            return httpx.Response(500, json={"error": {"message": "Internal error"}})
        return httpx.Response(200, content=b"success-after-retries")

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport, max_retries=3)

    result = client.screenshot("https://example.com")
    assert result == b"success-after-retries"
    assert attempt == 3


def test_max_retries_exceeded():
    """Test that max_retries is respected."""
    attempt = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempt
        attempt += 1
        return httpx.Response(503, json={"error": {"message": "Service unavailable"}})

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport, max_retries=2)

    with pytest.raises(ScreenForgeError):
        client.screenshot("https://example.com")

    assert attempt == 3  # initial + 2 retries


def test_no_retry_on_400():
    """Test that 400 errors are not retried."""
    attempt = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempt
        attempt += 1
        return httpx.Response(400, json={"error": {"message": "Bad request"}})

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport, max_retries=2)

    with pytest.raises(ScreenForgeError):
        client.screenshot("https://example.com")

    assert attempt == 1  # no retries


def test_retry_after_header():
    """Test Retry-After header parsing."""
    attempt = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempt
        attempt += 1
        if attempt == 1:
            return httpx.Response(
                429,
                headers={"Retry-After": "2"},
                json={"error": {"message": "Rate limited"}},
            )
        return httpx.Response(200, content=b"success")

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport, max_retries=2)

    result = client.screenshot("https://example.com")
    assert result == b"success"


def test_nested_error_metadata_extraction():
    """Test that nested error metadata is extracted correctly."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={
                "error": {
                    "error": {
                        "code": "RATE_LIMITED",
                        "message": "Too many requests",
                        "details": {"retryAfter": 10},
                        "request_id": "req_nested_123",
                    }
                }
            },
        )

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport, max_retries=0)

    with pytest.raises(RateLimitError) as exc_info:
        client.screenshot("https://example.com")

    assert exc_info.value.code == "RATE_LIMITED"
    assert exc_info.value.request_id == "req_nested_123"
    assert exc_info.value.retry_after == 10


def test_non_json_error_response():
    """Test handling of non-JSON error responses."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"Internal Server Error", headers={"content-type": "text/plain"})

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport, max_retries=0)

    with pytest.raises(ScreenForgeError) as exc_info:
        client.screenshot("https://example.com")

    assert exc_info.value.status == 500
