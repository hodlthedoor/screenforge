"""Tests for asynchronous AsyncScreenForgeClient."""

import json
import httpx
import pytest
from screenforge import AsyncScreenForgeClient, ValidationError, ScreenForgeError


@pytest.mark.asyncio
async def test_async_screenshot_with_url():
    """Test async screenshot with URL string."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/screenshot"
        assert request.headers["authorization"] == "Bearer test-key"
        body = json.loads(request.content)
        assert body["url"] == "https://example.com"
        return httpx.Response(200, content=b"fake-png-data", headers={"content-type": "image/png"})

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(
        api_key="test-key", base_url="http://localhost:3100", transport=transport
    )

    result = await client.screenshot("https://example.com")
    assert result == b"fake-png-data"
    await client.close()


@pytest.mark.asyncio
async def test_async_pdf_with_options():
    """Test async PDF with options."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["url"] == "https://example.com"
        assert body["landscape"] is True
        return httpx.Response(200, content=b"fake-pdf-data")

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    result = await client.pdf({"url": "https://example.com", "landscape": True})
    assert result == b"fake-pdf-data"
    await client.close()


@pytest.mark.asyncio
async def test_async_screenshot_async():
    """Test async screenshot_async method."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert "async=true" in str(request.url)
        return httpx.Response(
            200,
            json={"jobId": "job_async_123", "pollUrl": "http://localhost:3100/v1/render/job_async_123"},
        )

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    result = await client.screenshot_async("https://example.com")
    assert result.jobId == "job_async_123"
    await client.close()


@pytest.mark.asyncio
async def test_async_get_usage():
    """Test async get_usage method."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "apiKeyId": "key_async_123",
                "tier": "enterprise",
                "usage": {"today": 50, "thisMonth": 500, "monthlyQuota": 100000, "remaining": 99500},
                "rateLimit": {"requestsPerMinute": 120},
            },
        )

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    result = await client.get_usage()
    assert result.apiKeyId == "key_async_123"
    assert result.tier == "enterprise"
    await client.close()


@pytest.mark.asyncio
async def test_async_context_manager():
    """Test async client as context manager."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"data")

    transport = httpx.MockTransport(handler)

    async with AsyncScreenForgeClient(api_key="test-key", transport=transport) as client:
        result = await client.screenshot("https://example.com")
        assert result == b"data"


@pytest.mark.asyncio
async def test_async_error_handling():
    """Test async error handling."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "Bad request"}})

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport, max_retries=0)

    with pytest.raises(ValidationError):
        await client.screenshot("https://example.com")

    await client.close()


@pytest.mark.asyncio
async def test_async_extract():
    """Test async extract() method."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/extract"
        body = json.loads(request.content)
        assert body["url"] == "https://example.com/product"
        assert body["prompt"] == "Extract title and price"
        return httpx.Response(
            200,
            json={
                "extractionId": "ext_async_123",
                "data": {"title": "Async Product", "price": 49.99},
                "modelUsed": "claude-sonnet-4.5",
                "tokensUsed": 350,
                "screenshotPath": "screenshots/async.png",
                "durationMs": 987,
            },
        )

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    result = await client.extract({
        "url": "https://example.com/product",
        "prompt": "Extract title and price",
    })

    assert result.extractionId == "ext_async_123"
    assert result.data == {"title": "Async Product", "price": 49.99}
    assert result.modelUsed == "claude-sonnet-4.5"
    assert result.tokensUsed == 350
    await client.close()


@pytest.mark.asyncio
async def test_async_extract_malformed():
    """Test async extract() with malformed response."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"extractionId": "", "data": {}})

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    with pytest.raises(ScreenForgeError) as exc_info:
        await client.extract({"url": "https://example.com", "prompt": "test"})

    assert exc_info.value.code == "MALFORMED_RESPONSE"
    await client.close()


@pytest.mark.asyncio
async def test_async_accessibility():
    """Test async accessibility() method."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/accessibility"
        body = json.loads(request.content)
        assert body["url"] == "https://example.com"
        return httpx.Response(
            200,
            json={
                "auditId": "audit_async_123",
                "url": "https://example.com",
                "standard": "WCAG2AA",
                "violations": [
                    {
                        "id": "alt-text",
                        "impact": "critical",
                        "description": "Images must have alt text",
                        "helpUrl": "https://dequeuniversity.com/rules/axe/4.0/image-alt",
                        "nodes": [
                            {
                                "html": "<img src='logo.png'>",
                                "target": ["#logo"],
                                "failureSummary": "Add alt attribute",
                            },
                        ],
                    },
                ],
                "passesCount": 35,
                "violationsCount": 1,
                "incompleteCount": 2,
                "durationMs": 2345,
                "timestamp": "2026-02-14T12:00:00Z",
            },
        )

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    result = await client.accessibility("https://example.com")

    assert result.auditId == "audit_async_123"
    assert result.url == "https://example.com"
    assert len(result.violations) == 1
    assert result.violations[0].id == "alt-text"
    assert result.passesCount == 35
    await client.close()


@pytest.mark.asyncio
async def test_async_accessibility_malformed():
    """Test async accessibility() with malformed response."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"auditId": "", "violations": "not-array"})

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    with pytest.raises(ScreenForgeError) as exc_info:
        await client.accessibility("https://example.com")

    assert exc_info.value.code == "MALFORMED_RESPONSE"
    await client.close()


# GIF tests

@pytest.mark.asyncio
async def test_async_gif():
    """Test async gif() rendering."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/gif"
        return httpx.Response(200, content=b"\x47\x49\x46", headers={"content-type": "image/gif"})

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    result = await client.gif({"url": "https://example.com", "duration": 5000})

    assert result == b"\x47\x49\x46"
    await client.close()


@pytest.mark.asyncio
async def test_async_gif_async():
    """Test async gif_async() returns job ID."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert "async=true" in str(request.url)
        return httpx.Response(200, json={"jobId": "job_gif_async", "pollUrl": "/v1/render/job_gif_async"})

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    result = await client.gif_async({"url": "https://example.com"})

    assert result.jobId == "job_gif_async"
    await client.close()


# Diff tests

@pytest.mark.asyncio
async def test_async_diff():
    """Test async diff()."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/diff"
        return httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    result = await client.diff({"url_a": "https://example.com/v1", "url_b": "https://example.com/v2"})

    assert result == b"\x89PNG"
    await client.close()


# Schedule tests

@pytest.mark.asyncio
async def test_async_create_schedule():
    """Test async create_schedule()."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/schedules"
        return httpx.Response(201, json={
            "schedule": {
                "id": "sched_async_123",
                "name": "Async schedule",
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
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    result = await client.create_schedule({
        "name": "Async schedule",
        "cron_expression": "0 9 * * *",
        "render_type": "screenshot",
        "render_config": {"url": "https://example.com"},
    })

    assert result.id == "sched_async_123"
    assert result.name == "Async schedule"
    await client.close()


@pytest.mark.asyncio
async def test_async_list_schedules():
    """Test async list_schedules()."""

    def handler(request: httpx.Request) -> httpx.Response:
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
            ]
        })

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    result = await client.list_schedules()

    assert len(result) == 1
    assert result[0].id == "sched_1"
    await client.close()


@pytest.mark.asyncio
async def test_async_update_schedule():
    """Test async update_schedule()."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PATCH"
        return httpx.Response(200, json={
            "schedule": {
                "id": "sched_123",
                "name": "Updated async",
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
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    result = await client.update_schedule("sched_123", {"name": "Updated async"})

    assert result.name == "Updated async"
    await client.close()


@pytest.mark.asyncio
async def test_async_delete_schedule():
    """Test async delete_schedule()."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    client = AsyncScreenForgeClient(api_key="test-key", transport=transport)

    await client.delete_schedule("sched_123")  # Should not raise
    await client.close()
