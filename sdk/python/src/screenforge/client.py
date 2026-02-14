"""ScreenForge API clients."""

import asyncio
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Union
from urllib.parse import quote

import httpx

from .exceptions import (
    AuthenticationError,
    RateLimitError,
    RenderError,
    ScreenForgeError,
    ValidationError,
)
from .types import (
    AccessibilityOptions,
    AccessibilityReport,
    AccessibilityViolation,
    AccessibilityViolationNode,
    AsyncRenderResponse,
    BatchItem,
    BatchJob,
    BatchJobItem,
    BatchRenderResponse,
    ExtractOptions,
    ExtractResult,
    OgOptions,
    PdfOptions,
    RenderJob,
    ScreenshotOptions,
    UsageStats,
)

DEFAULT_TIMEOUT_MS = 30000
DEFAULT_MAX_RETRIES = 2
DEFAULT_RETRY_BASE_DELAY_MS = 200


class ScreenForgeClient:
    """Synchronous ScreenForge API client."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:3100",
        timeout: int = DEFAULT_TIMEOUT_MS,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_base_delay_ms: int = DEFAULT_RETRY_BASE_DELAY_MS,
        transport: Optional[httpx.BaseTransport] = None,
    ):
        """Initialize the ScreenForge client.

        Args:
            api_key: Your ScreenForge API key
            base_url: Base URL for the ScreenForge API
            timeout: Request timeout in milliseconds
            max_retries: Maximum number of retry attempts
            retry_base_delay_ms: Base delay for exponential backoff in milliseconds
            transport: Optional httpx transport for testing
        """
        if not api_key:
            raise ValidationError("api_key is required")

        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout / 1000.0  # Convert to seconds
        self.max_retries = max_retries
        self.retry_base_delay_ms = retry_base_delay_ms
        self._client = httpx.Client(timeout=self.timeout, transport=transport)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def close(self):
        """Close the HTTP client."""
        self._client.close()

    def screenshot(
        self,
        url_or_options: Union[str, ScreenshotOptions],
        options: Optional[ScreenshotOptions] = None,
    ) -> bytes:
        """Render a screenshot.

        Args:
            url_or_options: URL string or screenshot options dict
            options: Additional options (if url_or_options is a string)

        Returns:
            Screenshot image data as bytes
        """
        if isinstance(url_or_options, str):
            body = {"url": url_or_options, **(options or {})}
        else:
            body = url_or_options
        return self._request("POST", "/v1/screenshot", body, expect_binary=True)

    def pdf(
        self,
        url_or_options: Union[str, PdfOptions],
        options: Optional[PdfOptions] = None,
    ) -> bytes:
        """Render a PDF.

        Args:
            url_or_options: URL string or PDF options dict
            options: Additional options (if url_or_options is a string)

        Returns:
            PDF document data as bytes
        """
        if isinstance(url_or_options, str):
            body = {"url": url_or_options, **(options or {})}
        else:
            body = url_or_options
        return self._request("POST", "/v1/pdf", body, expect_binary=True)

    def og(self, url: str, options: Optional[OgOptions] = None) -> bytes:
        """Render an OG image.

        Args:
            url: URL for the OG image
            options: OG image options

        Returns:
            OG image data as bytes
        """
        body = {"url": url, **(options or {})}
        return self._request("POST", "/v1/og", body, expect_binary=True)

    def screenshot_async(
        self,
        url_or_options: Union[str, ScreenshotOptions],
        options: Optional[ScreenshotOptions] = None,
    ) -> AsyncRenderResponse:
        """Queue an async screenshot render.

        Args:
            url_or_options: URL string or screenshot options dict
            options: Additional options (if url_or_options is a string)

        Returns:
            AsyncRenderResponse with jobId and pollUrl
        """
        if isinstance(url_or_options, str):
            body = {"url": url_or_options, **(options or {})}
        else:
            body = url_or_options
        result = self._request("POST", "/v1/screenshot?async=true", body)
        return self._normalize_async_response(result)

    def pdf_async(
        self,
        url_or_options: Union[str, PdfOptions],
        options: Optional[PdfOptions] = None,
    ) -> AsyncRenderResponse:
        """Queue an async PDF render.

        Args:
            url_or_options: URL string or PDF options dict
            options: Additional options (if url_or_options is a string)

        Returns:
            AsyncRenderResponse with jobId and pollUrl
        """
        if isinstance(url_or_options, str):
            body = {"url": url_or_options, **(options or {})}
        else:
            body = url_or_options
        result = self._request("POST", "/v1/pdf?async=true", body)
        return self._normalize_async_response(result)

    def poll_job(self, job_id: str) -> RenderJob:
        """Poll a render job status.

        Args:
            job_id: The job ID to poll

        Returns:
            RenderJob status
        """
        result = self._request("GET", f"/v1/render/{quote(job_id)}")
        return RenderJob(**result)

    def batch_render(self, items: List[BatchItem]) -> BatchRenderResponse:
        """Submit a batch render request.

        Args:
            items: List of batch items to render

        Returns:
            BatchRenderResponse with batchId and jobs
        """
        result = self._request("POST", "/v1/batch", {"items": items})
        batch_id = self._normalize_non_empty_string(result.get("batchId"))
        jobs = result.get("jobs", [])

        if not batch_id or not isinstance(jobs, list):
            raise ScreenForgeError(
                "Malformed API response: expected batchId and jobs array",
                code="MALFORMED_RESPONSE",
                details=result,
            )

        normalized_jobs = []
        for job in jobs:
            if not isinstance(job, dict):
                raise ScreenForgeError(
                    "Malformed API response: expected job object in batch jobs array",
                    code="MALFORMED_RESPONSE",
                    details=job,
                )
            job_id = self._normalize_non_empty_string(job.get("jobId")) or self._normalize_non_empty_string(
                job.get("id")
            )
            poll_url = self._normalize_non_empty_string(job.get("pollUrl"))
            if not job_id or not poll_url:
                raise ScreenForgeError(
                    "Malformed API response: expected jobId/id and pollUrl for each batch job",
                    code="MALFORMED_RESPONSE",
                    details=job,
                )
            normalized_jobs.append({"jobId": job_id, "pollUrl": poll_url})

        return BatchRenderResponse(batchId=batch_id, jobs=normalized_jobs)

    def get_usage(self) -> UsageStats:
        """Get API usage statistics.

        Returns:
            UsageStats with current usage and limits
        """
        result = self._request("GET", "/v1/usage")
        return UsageStats(**result)

    def extract(self, options: ExtractOptions) -> ExtractResult:
        """Extract structured data from a webpage using LLM.

        Args:
            options: Extraction options including prompt, URL/job_id, schema, model

        Returns:
            ExtractResult with extracted data and metadata
        """
        result = self._request("POST", "/v1/extract", options)

        extraction_id = self._normalize_non_empty_string(result.get("extractionId"))
        model_used = self._normalize_non_empty_string(result.get("modelUsed"))
        tokens_used = result.get("tokensUsed")
        duration_ms = result.get("durationMs")

        if (
            not extraction_id
            or not model_used
            or not isinstance(tokens_used, int)
            or not isinstance(duration_ms, int)
        ):
            raise ScreenForgeError(
                "Malformed API response: expected extractionId, modelUsed, tokensUsed, and durationMs",
                code="MALFORMED_RESPONSE",
                details=result,
            )

        return ExtractResult(
            extractionId=extraction_id,
            data=result.get("data"),
            modelUsed=model_used,
            tokensUsed=tokens_used,
            screenshotPath=result.get("screenshotPath"),
            durationMs=duration_ms,
        )

    def accessibility(self, url: str, **options) -> AccessibilityReport:
        """Run WCAG accessibility audit on a webpage.

        Args:
            url: URL to audit
            **options: Additional options (standard, screenshot_options, include_screenshot)

        Returns:
            AccessibilityReport with violations and metadata
        """
        body: AccessibilityOptions = {"url": url, **options}  # type: ignore
        result = self._request("POST", "/v1/accessibility", body)

        audit_id = self._normalize_non_empty_string(result.get("auditId"))
        violations_data = result.get("violations")
        passes_count = result.get("passesCount")

        if not audit_id or not isinstance(violations_data, list) or not isinstance(passes_count, int):
            raise ScreenForgeError(
                "Malformed API response: expected auditId, violations array, and passesCount",
                code="MALFORMED_RESPONSE",
                details=result,
            )

        violations = [
            AccessibilityViolation(
                id=v["id"],
                impact=v["impact"],
                description=v["description"],
                helpUrl=v["helpUrl"],
                nodes=[
                    AccessibilityViolationNode(
                        html=n["html"],
                        target=n["target"],
                        failureSummary=n.get("failureSummary"),
                    )
                    for n in v.get("nodes", [])
                ],
            )
            for v in violations_data
        ]

        return AccessibilityReport(
            auditId=audit_id,
            url=result["url"],
            standard=result["standard"],
            violations=violations,
            passesCount=passes_count,
            violationsCount=result["violationsCount"],
            incompleteCount=result["incompleteCount"],
            durationMs=result["durationMs"],
            timestamp=result["timestamp"],
            screenshotPath=result.get("screenshotPath"),
            annotatedScreenshotPath=result.get("annotatedScreenshotPath"),
        )

    def _normalize_async_response(self, result: Dict[str, Any]) -> AsyncRenderResponse:
        """Normalize async render response."""
        job_id = self._normalize_non_empty_string(result.get("jobId")) or self._normalize_non_empty_string(
            result.get("id")
        )
        poll_url = self._normalize_non_empty_string(result.get("pollUrl"))

        if not job_id or not poll_url:
            raise ScreenForgeError(
                "Malformed API response: expected jobId/id and pollUrl",
                code="MALFORMED_RESPONSE",
                details=result,
            )

        return AsyncRenderResponse(jobId=job_id, pollUrl=poll_url)

    def _normalize_non_empty_string(self, value: Any) -> Optional[str]:
        """Normalize a value to a non-empty string or None."""
        if not isinstance(value, str):
            return None
        trimmed = value.strip()
        return trimmed if trimmed else None

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
        expect_binary: bool = False,
    ) -> Any:
        """Make an HTTP request with retry logic."""
        url = f"{self.base_url}{path}"

        for attempt in range(self.max_retries + 1):
            try:
                headers = {
                    "authorization": f"Bearer {self.api_key}",
                    "accept": "*/*" if expect_binary else "application/json",
                }
                if body is not None:
                    headers["content-type"] = "application/json"

                response = self._client.request(
                    method,
                    url,
                    json=body if body is not None else None,
                    headers=headers,
                )

                if response.is_success:
                    if expect_binary:
                        return response.content
                    return response.json()

                # Parse error response
                parsed_error = self._parse_error_response(response)
                metadata = self._extract_error_metadata(parsed_error, response.status_code)

                # Check for Retry-After header
                retry_after_header = self._parse_retry_after_header(response.headers.get("retry-after"))
                retry_after_seconds = metadata.get("retry_after") or retry_after_header
                if retry_after_seconds is not None:
                    metadata["retry_after"] = retry_after_seconds

                # Retry on specific status codes
                if self._should_retry_status(response.status_code) and attempt < self.max_retries:
                    delay = self._retry_delay(attempt, retry_after_seconds)
                    time.sleep(delay / 1000.0)
                    continue

                # Raise appropriate error
                raise self._map_http_error(response.status_code, metadata)

            except ScreenForgeError:
                raise
            except httpx.TimeoutException as e:
                if attempt < self.max_retries:
                    time.sleep(self._retry_delay(attempt) / 1000.0)
                    continue
                raise ScreenForgeError(
                    f"Request timed out after {self.timeout * 1000}ms",
                    code="TIMEOUT",
                    cause=e,
                )
            except Exception as e:
                if attempt < self.max_retries:
                    time.sleep(self._retry_delay(attempt) / 1000.0)
                    continue
                raise ScreenForgeError("Network request failed", code="NETWORK_ERROR", cause=e)

    def _should_retry_status(self, status: int) -> bool:
        """Check if a status code should trigger a retry."""
        return status in (429, 500, 502, 503, 504)

    def _retry_delay(self, attempt: int, retry_after_seconds: Optional[float] = None) -> int:
        """Calculate retry delay in milliseconds."""
        if retry_after_seconds is not None and retry_after_seconds > 0:
            return int(retry_after_seconds * 1000)
        return self.retry_base_delay_ms * (2**attempt)

    def _parse_error_response(self, response: httpx.Response) -> Dict[str, Any]:
        """Parse error response body."""
        content_type = response.headers.get("content-type", "")
        if "application/json" not in content_type:
            return {"error": response.text or "Request failed"}

        try:
            return response.json()
        except Exception:
            return {"error": response.text or "Request failed"}

    def _extract_error_metadata(self, parsed: Dict[str, Any], status: int) -> Dict[str, Any]:
        """Extract error metadata from nested response."""
        queue = []
        seen = set()

        def enqueue(value: Any):
            if not isinstance(value, dict):
                return
            value_id = id(value)
            if value_id in seen:
                return
            seen.add(value_id)
            queue.append(value)

        enqueue(parsed)
        enqueue(parsed.get("error"))

        message = None
        code = None
        details = None
        request_id = None
        retry_after = None

        # Check for top-level error string
        top_level_error = self._normalize_non_empty_string(parsed.get("error"))
        if top_level_error:
            message = top_level_error

        # BFS through nested objects
        while queue:
            current = queue.pop(0)

            if message is None and isinstance(current.get("message"), str):
                message = current["message"] or None

            if code is None and isinstance(current.get("code"), str):
                code = current["code"] or None

            if details is None and "details" in current:
                details = current["details"]

            if request_id is None and isinstance(current.get("request_id"), str):
                request_id = current["request_id"] or None

            if request_id is None and isinstance(current.get("requestId"), str):
                request_id = current["requestId"] or None

            if retry_after is None:
                retry_after = self._to_retry_after_seconds(
                    current.get("retryAfter")
                ) or self._to_retry_after_seconds(current.get("retry_after"))

            enqueue(current.get("error"))

        # Check details for retry_after
        if retry_after is None and isinstance(details, dict):
            retry_after = self._to_retry_after_seconds(details.get("retryAfter")) or self._to_retry_after_seconds(
                details.get("retry_after")
            )

        return {
            "message": message or f"Request failed with status {status}",
            "code": code,
            "details": details,
            "request_id": request_id,
            "retry_after": retry_after,
        }

    def _parse_retry_after_header(self, retry_after_header: Optional[str]) -> Optional[float]:
        """Parse Retry-After header value."""
        if not retry_after_header:
            return None

        # Try as number
        as_number = self._to_retry_after_seconds(retry_after_header)
        if as_number is not None:
            return as_number

        # Try as HTTP date (always UTC)
        try:
            date_value = datetime.strptime(retry_after_header, "%a, %d %b %Y %H:%M:%S GMT")
            seconds = (date_value.timestamp() - time.time())
            return seconds if seconds > 0 else None
        except Exception:
            return None

    def _to_retry_after_seconds(self, value: Any) -> Optional[float]:
        """Convert value to retry-after seconds."""
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
        if isinstance(value, str):
            try:
                parsed = float(value)
                return parsed if parsed > 0 else None
            except ValueError:
                return None
        return None

    def _map_http_error(self, status: int, metadata: Dict[str, Any]) -> ScreenForgeError:
        """Map HTTP status to appropriate exception."""
        kwargs = {
            "status": status,
            "code": metadata.get("code"),
            "details": metadata.get("details"),
            "request_id": metadata.get("request_id"),
            "retry_after": metadata.get("retry_after"),
        }

        message = metadata.get("message", f"Request failed with status {status}")

        if status == 429:
            return RateLimitError(message, **kwargs)
        if status == 400:
            return ValidationError(message, **kwargs)
        if status in (401, 403):
            return AuthenticationError(message, **kwargs)

        return ScreenForgeError(message, **kwargs)


class AsyncScreenForgeClient:
    """Asynchronous ScreenForge API client."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:3100",
        timeout: int = DEFAULT_TIMEOUT_MS,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_base_delay_ms: int = DEFAULT_RETRY_BASE_DELAY_MS,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        """Initialize the async ScreenForge client.

        Args:
            api_key: Your ScreenForge API key
            base_url: Base URL for the ScreenForge API
            timeout: Request timeout in milliseconds
            max_retries: Maximum number of retry attempts
            retry_base_delay_ms: Base delay for exponential backoff in milliseconds
            transport: Optional httpx async transport for testing
        """
        if not api_key:
            raise ValidationError("api_key is required")

        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout / 1000.0
        self.max_retries = max_retries
        self.retry_base_delay_ms = retry_base_delay_ms
        self._client = httpx.AsyncClient(timeout=self.timeout, transport=transport)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    async def close(self):
        """Close the HTTP client."""
        await self._client.aclose()

    async def screenshot(
        self,
        url_or_options: Union[str, ScreenshotOptions],
        options: Optional[ScreenshotOptions] = None,
    ) -> bytes:
        """Render a screenshot (async).

        Args:
            url_or_options: URL string or screenshot options dict
            options: Additional options (if url_or_options is a string)

        Returns:
            Screenshot image data as bytes
        """
        if isinstance(url_or_options, str):
            body = {"url": url_or_options, **(options or {})}
        else:
            body = url_or_options
        return await self._request("POST", "/v1/screenshot", body, expect_binary=True)

    async def pdf(
        self,
        url_or_options: Union[str, PdfOptions],
        options: Optional[PdfOptions] = None,
    ) -> bytes:
        """Render a PDF (async).

        Args:
            url_or_options: URL string or PDF options dict
            options: Additional options (if url_or_options is a string)

        Returns:
            PDF document data as bytes
        """
        if isinstance(url_or_options, str):
            body = {"url": url_or_options, **(options or {})}
        else:
            body = url_or_options
        return await self._request("POST", "/v1/pdf", body, expect_binary=True)

    async def og(self, url: str, options: Optional[OgOptions] = None) -> bytes:
        """Render an OG image (async).

        Args:
            url: URL for the OG image
            options: OG image options

        Returns:
            OG image data as bytes
        """
        body = {"url": url, **(options or {})}
        return await self._request("POST", "/v1/og", body, expect_binary=True)

    async def screenshot_async(
        self,
        url_or_options: Union[str, ScreenshotOptions],
        options: Optional[ScreenshotOptions] = None,
    ) -> AsyncRenderResponse:
        """Queue an async screenshot render.

        Args:
            url_or_options: URL string or screenshot options dict
            options: Additional options (if url_or_options is a string)

        Returns:
            AsyncRenderResponse with jobId and pollUrl
        """
        if isinstance(url_or_options, str):
            body = {"url": url_or_options, **(options or {})}
        else:
            body = url_or_options
        result = await self._request("POST", "/v1/screenshot?async=true", body)
        return self._normalize_async_response(result)

    async def pdf_async(
        self,
        url_or_options: Union[str, PdfOptions],
        options: Optional[PdfOptions] = None,
    ) -> AsyncRenderResponse:
        """Queue an async PDF render.

        Args:
            url_or_options: URL string or PDF options dict
            options: Additional options (if url_or_options is a string)

        Returns:
            AsyncRenderResponse with jobId and pollUrl
        """
        if isinstance(url_or_options, str):
            body = {"url": url_or_options, **(options or {})}
        else:
            body = url_or_options
        result = await self._request("POST", "/v1/pdf?async=true", body)
        return self._normalize_async_response(result)

    async def poll_job(self, job_id: str) -> RenderJob:
        """Poll a render job status (async).

        Args:
            job_id: The job ID to poll

        Returns:
            RenderJob status
        """
        result = await self._request("GET", f"/v1/render/{quote(job_id)}")
        return RenderJob(**result)

    async def batch_render(self, items: List[BatchItem]) -> BatchRenderResponse:
        """Submit a batch render request (async).

        Args:
            items: List of batch items to render

        Returns:
            BatchRenderResponse with batchId and jobs
        """
        result = await self._request("POST", "/v1/batch", {"items": items})
        batch_id = self._normalize_non_empty_string(result.get("batchId"))
        jobs = result.get("jobs", [])

        if not batch_id or not isinstance(jobs, list):
            raise ScreenForgeError(
                "Malformed API response: expected batchId and jobs array",
                code="MALFORMED_RESPONSE",
                details=result,
            )

        normalized_jobs = []
        for job in jobs:
            if not isinstance(job, dict):
                raise ScreenForgeError(
                    "Malformed API response: expected job object in batch jobs array",
                    code="MALFORMED_RESPONSE",
                    details=job,
                )
            job_id = self._normalize_non_empty_string(job.get("jobId")) or self._normalize_non_empty_string(
                job.get("id")
            )
            poll_url = self._normalize_non_empty_string(job.get("pollUrl"))
            if not job_id or not poll_url:
                raise ScreenForgeError(
                    "Malformed API response: expected jobId/id and pollUrl for each batch job",
                    code="MALFORMED_RESPONSE",
                    details=job,
                )
            normalized_jobs.append({"jobId": job_id, "pollUrl": poll_url})

        return BatchRenderResponse(batchId=batch_id, jobs=normalized_jobs)

    async def get_usage(self) -> UsageStats:
        """Get API usage statistics (async).

        Returns:
            UsageStats with current usage and limits
        """
        result = await self._request("GET", "/v1/usage")
        return UsageStats(**result)

    async def extract(self, options: ExtractOptions) -> ExtractResult:
        """Extract structured data from a webpage using LLM (async).

        Args:
            options: Extraction options including prompt, URL/job_id, schema, model

        Returns:
            ExtractResult with extracted data and metadata
        """
        result = await self._request("POST", "/v1/extract", options)

        extraction_id = self._normalize_non_empty_string(result.get("extractionId"))
        model_used = self._normalize_non_empty_string(result.get("modelUsed"))
        tokens_used = result.get("tokensUsed")
        duration_ms = result.get("durationMs")

        if (
            not extraction_id
            or not model_used
            or not isinstance(tokens_used, int)
            or not isinstance(duration_ms, int)
        ):
            raise ScreenForgeError(
                "Malformed API response: expected extractionId, modelUsed, tokensUsed, and durationMs",
                code="MALFORMED_RESPONSE",
                details=result,
            )

        return ExtractResult(
            extractionId=extraction_id,
            data=result.get("data"),
            modelUsed=model_used,
            tokensUsed=tokens_used,
            screenshotPath=result.get("screenshotPath"),
            durationMs=duration_ms,
        )

    async def accessibility(self, url: str, **options) -> AccessibilityReport:
        """Run WCAG accessibility audit on a webpage (async).

        Args:
            url: URL to audit
            **options: Additional options (standard, screenshot_options, include_screenshot)

        Returns:
            AccessibilityReport with violations and metadata
        """
        body: AccessibilityOptions = {"url": url, **options}  # type: ignore
        result = await self._request("POST", "/v1/accessibility", body)

        audit_id = self._normalize_non_empty_string(result.get("auditId"))
        violations_data = result.get("violations")
        passes_count = result.get("passesCount")

        if not audit_id or not isinstance(violations_data, list) or not isinstance(passes_count, int):
            raise ScreenForgeError(
                "Malformed API response: expected auditId, violations array, and passesCount",
                code="MALFORMED_RESPONSE",
                details=result,
            )

        violations = [
            AccessibilityViolation(
                id=v["id"],
                impact=v["impact"],
                description=v["description"],
                helpUrl=v["helpUrl"],
                nodes=[
                    AccessibilityViolationNode(
                        html=n["html"],
                        target=n["target"],
                        failureSummary=n.get("failureSummary"),
                    )
                    for n in v.get("nodes", [])
                ],
            )
            for v in violations_data
        ]

        return AccessibilityReport(
            auditId=audit_id,
            url=result["url"],
            standard=result["standard"],
            violations=violations,
            passesCount=passes_count,
            violationsCount=result["violationsCount"],
            incompleteCount=result["incompleteCount"],
            durationMs=result["durationMs"],
            timestamp=result["timestamp"],
            screenshotPath=result.get("screenshotPath"),
            annotatedScreenshotPath=result.get("annotatedScreenshotPath"),
        )

    def _normalize_async_response(self, result: Dict[str, Any]) -> AsyncRenderResponse:
        """Normalize async render response."""
        job_id = self._normalize_non_empty_string(result.get("jobId")) or self._normalize_non_empty_string(
            result.get("id")
        )
        poll_url = self._normalize_non_empty_string(result.get("pollUrl"))

        if not job_id or not poll_url:
            raise ScreenForgeError(
                "Malformed API response: expected jobId/id and pollUrl",
                code="MALFORMED_RESPONSE",
                details=result,
            )

        return AsyncRenderResponse(jobId=job_id, pollUrl=poll_url)

    def _normalize_non_empty_string(self, value: Any) -> Optional[str]:
        """Normalize a value to a non-empty string or None."""
        if not isinstance(value, str):
            return None
        trimmed = value.strip()
        return trimmed if trimmed else None

    async def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
        expect_binary: bool = False,
    ) -> Any:
        """Make an async HTTP request with retry logic."""
        url = f"{self.base_url}{path}"

        for attempt in range(self.max_retries + 1):
            try:
                headers = {
                    "authorization": f"Bearer {self.api_key}",
                    "accept": "*/*" if expect_binary else "application/json",
                }
                if body is not None:
                    headers["content-type"] = "application/json"

                response = await self._client.request(
                    method,
                    url,
                    json=body if body is not None else None,
                    headers=headers,
                )

                if response.is_success:
                    if expect_binary:
                        return response.content
                    return response.json()

                # Parse error response
                parsed_error = self._parse_error_response(response)
                metadata = self._extract_error_metadata(parsed_error, response.status_code)

                # Check for Retry-After header
                retry_after_header = self._parse_retry_after_header(response.headers.get("retry-after"))
                retry_after_seconds = metadata.get("retry_after") or retry_after_header
                if retry_after_seconds is not None:
                    metadata["retry_after"] = retry_after_seconds

                # Retry on specific status codes
                if self._should_retry_status(response.status_code) and attempt < self.max_retries:
                    delay = self._retry_delay(attempt, retry_after_seconds)
                    await asyncio.sleep(delay / 1000.0)
                    continue

                # Raise appropriate error
                raise self._map_http_error(response.status_code, metadata)

            except ScreenForgeError:
                raise
            except httpx.TimeoutException as e:
                if attempt < self.max_retries:
                    await asyncio.sleep(self._retry_delay(attempt) / 1000.0)
                    continue
                raise ScreenForgeError(
                    f"Request timed out after {self.timeout * 1000}ms",
                    code="TIMEOUT",
                    cause=e,
                )
            except Exception as e:
                if attempt < self.max_retries:
                    await asyncio.sleep(self._retry_delay(attempt) / 1000.0)
                    continue
                raise ScreenForgeError("Network request failed", code="NETWORK_ERROR", cause=e)

    def _should_retry_status(self, status: int) -> bool:
        """Check if a status code should trigger a retry."""
        return status in (429, 500, 502, 503, 504)

    def _retry_delay(self, attempt: int, retry_after_seconds: Optional[float] = None) -> int:
        """Calculate retry delay in milliseconds."""
        if retry_after_seconds is not None and retry_after_seconds > 0:
            return int(retry_after_seconds * 1000)
        return self.retry_base_delay_ms * (2**attempt)

    def _parse_error_response(self, response: httpx.Response) -> Dict[str, Any]:
        """Parse error response body."""
        content_type = response.headers.get("content-type", "")
        if "application/json" not in content_type:
            return {"error": response.text or "Request failed"}

        try:
            return response.json()
        except Exception:
            return {"error": response.text or "Request failed"}

    def _extract_error_metadata(self, parsed: Dict[str, Any], status: int) -> Dict[str, Any]:
        """Extract error metadata from nested response (same as sync client)."""
        queue = []
        seen = set()

        def enqueue(value: Any):
            if not isinstance(value, dict):
                return
            value_id = id(value)
            if value_id in seen:
                return
            seen.add(value_id)
            queue.append(value)

        enqueue(parsed)
        enqueue(parsed.get("error"))

        message = None
        code = None
        details = None
        request_id = None
        retry_after = None

        top_level_error = self._normalize_non_empty_string(parsed.get("error"))
        if top_level_error:
            message = top_level_error

        while queue:
            current = queue.pop(0)

            if message is None and isinstance(current.get("message"), str):
                message = current["message"] or None

            if code is None and isinstance(current.get("code"), str):
                code = current["code"] or None

            if details is None and "details" in current:
                details = current["details"]

            if request_id is None and isinstance(current.get("request_id"), str):
                request_id = current["request_id"] or None

            if request_id is None and isinstance(current.get("requestId"), str):
                request_id = current["requestId"] or None

            if retry_after is None:
                retry_after = self._to_retry_after_seconds(
                    current.get("retryAfter")
                ) or self._to_retry_after_seconds(current.get("retry_after"))

            enqueue(current.get("error"))

        if retry_after is None and isinstance(details, dict):
            retry_after = self._to_retry_after_seconds(details.get("retryAfter")) or self._to_retry_after_seconds(
                details.get("retry_after")
            )

        return {
            "message": message or f"Request failed with status {status}",
            "code": code,
            "details": details,
            "request_id": request_id,
            "retry_after": retry_after,
        }

    def _parse_retry_after_header(self, retry_after_header: Optional[str]) -> Optional[float]:
        """Parse Retry-After header value."""
        if not retry_after_header:
            return None

        as_number = self._to_retry_after_seconds(retry_after_header)
        if as_number is not None:
            return as_number

        try:
            date_value = datetime.strptime(retry_after_header, "%a, %d %b %Y %H:%M:%S %Z")
            seconds = (date_value.timestamp() - time.time())
            return seconds if seconds > 0 else None
        except Exception:
            return None

    def _to_retry_after_seconds(self, value: Any) -> Optional[float]:
        """Convert value to retry-after seconds."""
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
        if isinstance(value, str):
            try:
                parsed = float(value)
                return parsed if parsed > 0 else None
            except ValueError:
                return None
        return None

    def _map_http_error(self, status: int, metadata: Dict[str, Any]) -> ScreenForgeError:
        """Map HTTP status to appropriate exception."""
        kwargs = {
            "status": status,
            "code": metadata.get("code"),
            "details": metadata.get("details"),
            "request_id": metadata.get("request_id"),
            "retry_after": metadata.get("retry_after"),
        }

        message = metadata.get("message", f"Request failed with status {status}")

        if status == 429:
            return RateLimitError(message, **kwargs)
        if status == 400:
            return ValidationError(message, **kwargs)
        if status in (401, 403):
            return AuthenticationError(message, **kwargs)

        return ScreenForgeError(message, **kwargs)
