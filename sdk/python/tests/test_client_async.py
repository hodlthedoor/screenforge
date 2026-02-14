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
