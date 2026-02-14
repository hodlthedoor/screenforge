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


def test_extract_with_url():
    """Test extract() with URL and schema."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/extract"
        body = json.loads(request.content)
        assert body["url"] == "https://example.com/product"
        assert body["prompt"] == "Extract title and price"
        assert body["schema"] == {"title": "string", "price": "number"}
        assert body["model"] == "sonnet"
        return httpx.Response(200, json={
            "extractionId": "ext_123",
            "data": {"title": "Test Product", "price": 99.99},
            "modelUsed": "claude-sonnet-4.5",
            "tokensUsed": 450,
            "screenshotPath": "screenshots/test.png",
            "durationMs": 1234,
        })

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.extract({
        "url": "https://example.com/product",
        "prompt": "Extract title and price",
        "schema": {"title": "string", "price": "number"},
        "model": "sonnet",
    })

    assert result.extractionId == "ext_123"
    assert result.data == {"title": "Test Product", "price": 99.99}
    assert result.modelUsed == "claude-sonnet-4.5"
    assert result.tokensUsed == 450
    assert result.screenshotPath == "screenshots/test.png"
    assert result.durationMs == 1234


def test_extract_with_job_id():
    """Test extract() with job_id."""
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["job_id"] == "job_abc123"
        assert body["prompt"] == "Extract product name"
        return httpx.Response(200, json={
            "extractionId": "ext_456",
            "data": {"name": "Product"},
            "modelUsed": "claude-haiku-4.5",
            "tokensUsed": 200,
            "durationMs": 567,
        })

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.extract({
        "job_id": "job_abc123",
        "prompt": "Extract product name",
    })

    assert result.extractionId == "ext_456"
    assert result.screenshotPath is None


def test_extract_malformed_response():
    """Test extract() with malformed response."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "extractionId": "",
            "data": {},
        })

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    with pytest.raises(ScreenForgeError) as exc_info:
        client.extract({"url": "https://example.com", "prompt": "test"})

    assert exc_info.value.code == "MALFORMED_RESPONSE"


def test_accessibility_audit():
    """Test accessibility() with full report."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/accessibility"
        body = json.loads(request.content)
        assert body["url"] == "https://example.com"
        assert body["standard"] == "WCAG2AA"
        assert body["include_screenshot"] is True
        return httpx.Response(200, json={
            "auditId": "audit_123",
            "url": "https://example.com",
            "standard": "WCAG2AA",
            "violations": [
                {
                    "id": "color-contrast",
                    "impact": "serious",
                    "description": "Elements must meet minimum color contrast ratio",
                    "helpUrl": "https://dequeuniversity.com/rules/axe/4.0/color-contrast",
                    "nodes": [
                        {
                            "html": "<button>Submit</button>",
                            "target": ["#submit-btn"],
                            "failureSummary": "Fix contrast ratio",
                        },
                    ],
                },
            ],
            "passesCount": 42,
            "violationsCount": 1,
            "incompleteCount": 0,
            "screenshotPath": "accessibility/screenshot.png",
            "annotatedScreenshotPath": "accessibility/annotated.png",
            "durationMs": 3456,
            "timestamp": "2026-02-14T12:00:00Z",
        })

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.accessibility("https://example.com", standard="WCAG2AA", include_screenshot=True)

    assert result.auditId == "audit_123"
    assert result.url == "https://example.com"
    assert result.standard == "WCAG2AA"
    assert len(result.violations) == 1
    assert result.violations[0].id == "color-contrast"
    assert result.passesCount == 42
    assert result.violationsCount == 1
    assert result.screenshotPath == "accessibility/screenshot.png"


def test_accessibility_malformed_response():
    """Test accessibility() with malformed response."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "auditId": "",
            "violations": "not-an-array",
        })

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    with pytest.raises(ScreenForgeError) as exc_info:
        client.accessibility("https://example.com")

    assert exc_info.value.code == "MALFORMED_RESPONSE"


# GIF tests

def test_gif():
    """Test gif() rendering."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/gif"
        body = json.loads(request.content)
        assert body["url"] == "https://example.com"
        assert body["duration"] == 5000
        assert body["fps"] == 30
        return httpx.Response(200, content=b"\x47\x49\x46", headers={"content-type": "image/gif"})

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.gif({"url": "https://example.com", "duration": 5000, "fps": 30})

    assert result == b"\x47\x49\x46"


def test_gif_async():
    """Test gif_async() returns job ID and poll URL."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/gif"
        assert "async=true" in str(request.url)
        return httpx.Response(200, json={"jobId": "job_gif_123", "pollUrl": "/v1/render/job_gif_123"})

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.gif_async({"url": "https://example.com"})

    assert result.jobId == "job_gif_123"
    assert result.pollUrl == "/v1/render/job_gif_123"


def test_gif_async_normalizes_id():
    """Test gif_async() normalizes id to jobId."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "job_gif_456", "pollUrl": "/v1/render/job_gif_456"})

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.gif_async({"url": "https://example.com"})

    assert result.jobId == "job_gif_456"


# Diff tests

def test_diff():
    """Test diff() with URL comparison."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/diff"
        body = json.loads(request.content)
        assert body["url_a"] == "https://example.com/v1"
        assert body["url_b"] == "https://example.com/v2"
        assert body["threshold"] == 0.1
        return httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.diff({"url_a": "https://example.com/v1", "url_b": "https://example.com/v2", "threshold": 0.1})

    assert result == b"\x89PNG"


# Schedule tests

def test_create_schedule():
    """Test create_schedule()."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/schedules"
        body = json.loads(request.content)
        assert body["name"] == "Daily screenshot"
        assert body["cron_expression"] == "0 9 * * *"
        return httpx.Response(201, json={
            "schedule": {
                "id": "sched_123",
                "name": "Daily screenshot",
                "cron_expression": "0 9 * * *",
                "render_type": "screenshot",
                "render_config": {"url": "https://example.com"},
                "enabled": True,
                "next_run_at": "2026-02-15T09:00:00Z",
                "last_run_at": None,
                "created_at": "2026-02-14T12:00:00Z",
                "updated_at": "2026-02-14T12:00:00Z",
            }
        })

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.create_schedule({
        "name": "Daily screenshot",
        "cron_expression": "0 9 * * *",
        "render_type": "screenshot",
        "render_config": {"url": "https://example.com"},
    })

    assert result.id == "sched_123"
    assert result.name == "Daily screenshot"
    assert result.cron_expression == "0 9 * * *"


def test_list_schedules():
    """Test list_schedules()."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/schedules"
        return httpx.Response(200, json={
            "schedules": [
                {
                    "id": "sched_1",
                    "name": "Schedule 1",
                    "cron_expression": "0 9 * * *",
                    "render_type": "screenshot",
                    "render_config": {},
                    "enabled": True,
                    "next_run_at": "2026-02-15T09:00:00Z",
                    "last_run_at": None,
                    "created_at": "2026-02-14T12:00:00Z",
                    "updated_at": "2026-02-14T12:00:00Z",
                },
                {
                    "id": "sched_2",
                    "name": "Schedule 2",
                    "cron_expression": "0 18 * * *",
                    "render_type": "pdf",
                    "render_config": {},
                    "enabled": False,
                    "next_run_at": None,
                    "last_run_at": "2026-02-14T18:00:00Z",
                    "created_at": "2026-02-13T12:00:00Z",
                    "updated_at": "2026-02-14T12:00:00Z",
                },
            ]
        })

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.list_schedules()

    assert len(result) == 2
    assert result[0].id == "sched_1"
    assert result[1].id == "sched_2"


def test_get_schedule():
    """Test get_schedule()."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/schedules/sched_123"
        return httpx.Response(200, json={
            "schedule": {
                "id": "sched_123",
                "name": "Test schedule",
                "cron_expression": "0 9 * * *",
                "render_type": "screenshot",
                "render_config": {},
                "enabled": True,
                "next_run_at": "2026-02-15T09:00:00Z",
                "last_run_at": None,
                "created_at": "2026-02-14T12:00:00Z",
                "updated_at": "2026-02-14T12:00:00Z",
            }
        })

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.get_schedule("sched_123")

    assert result.id == "sched_123"
    assert result.name == "Test schedule"


def test_update_schedule():
    """Test update_schedule()."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/schedules/sched_123"
        assert request.method == "PATCH"
        body = json.loads(request.content)
        assert body["name"] == "Updated name"
        assert body["enabled"] is False
        return httpx.Response(200, json={
            "schedule": {
                "id": "sched_123",
                "name": "Updated name",
                "cron_expression": "0 10 * * *",
                "render_type": "screenshot",
                "render_config": {},
                "enabled": False,
                "next_run_at": None,
                "last_run_at": None,
                "created_at": "2026-02-14T12:00:00Z",
                "updated_at": "2026-02-14T13:00:00Z",
            }
        })

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    result = client.update_schedule("sched_123", {"name": "Updated name", "enabled": False})

    assert result.id == "sched_123"
    assert result.name == "Updated name"
    assert result.enabled is False


def test_delete_schedule():
    """Test delete_schedule()."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/schedules/sched_123"
        assert request.method == "DELETE"
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    client = ScreenForgeClient(api_key="test-key", transport=transport)

    client.delete_schedule("sched_123")  # Should not raise
