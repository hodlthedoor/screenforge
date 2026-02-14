"""Tests for asynchronous AsyncScreenForgeClient."""

import json
import httpx
import pytest
from screenforge import AsyncScreenForgeClient, ValidationError


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
