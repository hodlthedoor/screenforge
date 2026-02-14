"""Tests for synchronous ScreenForgeClient."""

import json
import httpx
import pytest
from screenforge import (
    ScreenForgeClient,
    ScreenForgeError,
    ValidationError,
    AuthenticationError,
    RateLimitError,
)


def test_screenshot_with_url():
    """Test screenshot with URL string."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/screenshot"
        assert request.headers["authorization"] == "Bearer test-key"
        body = json.loads(request.content)
        assert body["url"] == "https://example.com"
        return httpx.Response(200, content=b"fake-png-data", headers={"content-type": "image/png"})

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", base_url="http://localhost:3100", transport=transport)

    result = client.screenshot("https://example.com")
    assert result == b"fake-png-data"


def test_screenshot_with_options():
    """Test screenshot with options dict."""
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["url"] == "https://example.com"
        assert body["fullPage"] is True
        assert body["format"] == "jpeg"
        return httpx.Response(200, content=b"fake-jpeg-data")

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.screenshot({"url": "https://example.com", "fullPage": True, "format": "jpeg"})
    assert result == b"fake-jpeg-data"


def test_pdf_with_url():
    """Test PDF generation with URL string."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/pdf"
        body = json.loads(request.content)
        assert body["url"] == "https://example.com"
        return httpx.Response(200, content=b"fake-pdf-data", headers={"content-type": "application/pdf"})

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.pdf("https://example.com")
    assert result == b"fake-pdf-data"


def test_og_image():
    """Test OG image generation."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/og"
        body = json.loads(request.content)
        assert body["url"] == "https://example.com"
        assert body["title"] == "Test Title"
        return httpx.Response(200, content=b"fake-og-data")

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.og("https://example.com", {"title": "Test Title"})
    assert result == b"fake-og-data"


def test_screenshot_async():
    """Test async screenshot request."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert "async=true" in str(request.url)
        return httpx.Response(
            200,
            json={"jobId": "job_123", "pollUrl": "http://localhost:3100/v1/render/job_123"},
        )

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.screenshot_async("https://example.com")
    assert result.jobId == "job_123"
    assert result.pollUrl == "http://localhost:3100/v1/render/job_123"


def test_pdf_async():
    """Test async PDF request."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert "async=true" in str(request.url)
        return httpx.Response(
            200,
            json={"jobId": "job_456", "pollUrl": "http://localhost:3100/v1/render/job_456"},
        )

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.pdf_async("https://example.com")
    assert result.jobId == "job_456"


def test_poll_job():
    """Test polling a render job."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/render/job_123"
        return httpx.Response(
            200,
            json={
                "id": "job_123",
                "type": "screenshot",
                "url": "https://example.com",
                "status": "completed",
                "contentType": "image/png",
                "createdAt": "2024-01-01T00:00:00Z",
                "pollUrl": "http://localhost:3100/v1/render/job_123",
            },
        )

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.poll_job("job_123")
    assert result.id == "job_123"
    assert result.status == "completed"


def test_batch_render():
    """Test batch render request."""
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert "items" in body
        assert len(body["items"]) == 2
        return httpx.Response(
            200,
            json={
                "batchId": "batch_123",
                "jobs": [
                    {"jobId": "job_1", "pollUrl": "http://localhost:3100/v1/render/job_1"},
                    {"jobId": "job_2", "pollUrl": "http://localhost:3100/v1/render/job_2"},
                ],
            },
        )

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    items = [
        {"type": "screenshot", "url": "https://example.com"},
        {"type": "pdf", "url": "https://example.org"},
    ]
    result = client.batch_render(items)
    assert result.batchId == "batch_123"
    assert len(result.jobs) == 2


def test_get_usage():
    """Test getting usage statistics."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/usage"
        return httpx.Response(
            200,
            json={
                "apiKeyId": "key_123",
                "tier": "pro",
                "usage": {"today": 10, "thisMonth": 100, "monthlyQuota": 10000, "remaining": 9900},
                "rateLimit": {"requestsPerMinute": 60},
            },
        )

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.get_usage()
    assert result.apiKeyId == "key_123"
    assert result.tier == "pro"
    assert result.usage["today"] == 10


def test_malformed_async_response_missing_job_id():
    """Test that malformed async response raises ScreenForgeError."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"pollUrl": "http://localhost:3100/v1/render/job_123"})

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    with pytest.raises(ScreenForgeError, match="Malformed API response"):
        client.screenshot_async("https://example.com")


def test_error_400_validation():
    """Test that 400 status raises ValidationError."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={"error": {"message": "Invalid URL format", "code": "VALIDATION_ERROR"}},
        )

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport, max_retries=0)

    with pytest.raises(ValidationError) as exc_info:
        client.screenshot("invalid-url")

    assert exc_info.value.status == 400
    assert exc_info.value.code == "VALIDATION_ERROR"


def test_error_401_authentication():
    """Test that 401 status raises AuthenticationError."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={"error": {"message": "Invalid API key", "code": "INVALID_API_KEY"}},
        )

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="invalid", transport=transport, max_retries=0)

    with pytest.raises(AuthenticationError) as exc_info:
        client.screenshot("https://example.com")

    assert exc_info.value.status == 401


def test_error_429_rate_limit():
    """Test that 429 status raises RateLimitError."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={
                "error": {
                    "message": "Rate limit exceeded",
                    "code": "RATE_LIMITED",
                    "details": {"retryAfter": 5},
                }
            },
        )

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport, max_retries=0)

    with pytest.raises(RateLimitError) as exc_info:
        client.screenshot("https://example.com")

    assert exc_info.value.status == 429
    assert exc_info.value.retry_after == 5


def test_screenshot_with_actions():
    """Test screenshot with pre-capture actions."""
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["url"] == "https://example.com"
        assert len(body["actions"]) == 3
        assert body["actions"][0] == {"type": "click", "selector": "#accept"}
        assert body["actions"][1] == {"type": "scroll", "y": 500}
        assert body["actions"][2] == {"type": "type", "selector": "#search", "value": "hello"}
        return httpx.Response(200, content=b"fake-png-data")

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.screenshot("https://example.com", {
        "actions": [
            {"type": "click", "selector": "#accept"},
            {"type": "scroll", "y": 500},
            {"type": "type", "selector": "#search", "value": "hello"},
        ]
    })
    assert result == b"fake-png-data"


def test_screenshot_with_selector_options():
    """Test screenshot with hide/remove/blur selectors."""
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["hide_selectors"] == [".ad-banner", ".cookie-popup"]
        assert body["remove_selectors"] == [".tracking-pixel"]
        assert body["blur_selectors"] == [".email", ".phone"]
        assert body["blur_radius"] == 15
        return httpx.Response(200, content=b"fake-png-data")

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.screenshot("https://example.com", {
        "hide_selectors": [".ad-banner", ".cookie-popup"],
        "remove_selectors": [".tracking-pixel"],
        "blur_selectors": [".email", ".phone"],
        "blur_radius": 15,
    })
    assert result == b"fake-png-data"


def test_screenshot_with_content_validation():
    """Test screenshot with fail_if_contains and fail_if_missing."""
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["fail_if_contains"] == "Error 404"
        assert body["fail_if_missing"] == ".main-content"
        return httpx.Response(200, content=b"fake-png-data")

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.screenshot("https://example.com", {
        "fail_if_contains": "Error 404",
        "fail_if_missing": ".main-content",
    })
    assert result == b"fake-png-data"


def test_screenshot_with_block_ads():
    """Test screenshot with block_ads option."""
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["block_ads"] is True
        return httpx.Response(200, content=b"fake-png-data")

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.screenshot("https://example.com", {"block_ads": True})
    assert result == b"fake-png-data"


def test_pdf_with_rendering_options():
    """Test PDF with actions, selectors, content validation, and block_ads."""
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["actions"] == [{"type": "click", "selector": "#expand-all"}]
        assert body["hide_selectors"] == [".no-print"]
        assert body["remove_selectors"] == [".sidebar"]
        assert body["blur_selectors"] == [".ssn"]
        assert body["blur_radius"] == 20
        assert body["fail_if_contains"] == "Access Denied"
        assert body["fail_if_missing"] == "#report-content"
        assert body["block_ads"] is True
        return httpx.Response(200, content=b"fake-pdf-data")

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.pdf("https://example.com", {
        "actions": [{"type": "click", "selector": "#expand-all"}],
        "hide_selectors": [".no-print"],
        "remove_selectors": [".sidebar"],
        "blur_selectors": [".ssn"],
        "blur_radius": 20,
        "fail_if_contains": "Access Denied",
        "fail_if_missing": "#report-content",
        "block_ads": True,
    })
    assert result == b"fake-pdf-data"
