# screenforge

Official Python SDK for the [ScreenForge](https://screenforge.dev) screenshot, PDF, and OG image API.

## Installation

```bash
pip install screenforge
```

## Quick Start

### Synchronous Client

```python
from screenforge import ScreenForgeClient

client = ScreenForgeClient(
    api_key="your-api-key",
    base_url="https://api.screenforge.dev"
)

# Take a screenshot
screenshot = client.screenshot("https://example.com")
with open("screenshot.png", "wb") as f:
    f.write(screenshot)

# Generate a PDF
pdf = client.pdf("https://example.com", {"format": "a4", "landscape": True})
with open("page.pdf", "wb") as f:
    f.write(pdf)

# Generate an OG image
og_image = client.og("https://example.com", {
    "title": "My Page",
    "description": "A great page",
    "theme": "dark"
})
with open("og.png", "wb") as f:
    f.write(og_image)

# Clean up
client.close()
```

### Asynchronous Client

```python
import asyncio
from screenforge import AsyncScreenForgeClient

async def main():
    async with AsyncScreenForgeClient(api_key="your-api-key") as client:
        # Take a screenshot asynchronously
        screenshot = await client.screenshot("https://example.com")
        with open("screenshot.png", "wb") as f:
            f.write(screenshot)

        # Queue an async render job
        job = await client.screenshot_async("https://example.com")
        print(f"Job ID: {job.jobId}")
        print(f"Poll URL: {job.pollUrl}")

        # Poll job status
        status = await client.poll_job(job.jobId)
        print(f"Status: {status.status}")

asyncio.run(main())
```

## API Reference

### ScreenForgeClient / AsyncScreenForgeClient

Both clients support the same methods. Use `ScreenForgeClient` for synchronous code and `AsyncScreenForgeClient` for async/await.

#### Constructor

```python
ScreenForgeClient(
    api_key: str,
    base_url: str = "http://localhost:3100",
    timeout: int = 30000,  # milliseconds
    max_retries: int = 2,
    retry_base_delay_ms: int = 200
)
```

#### Methods

##### `screenshot(url_or_options, options=None) -> bytes`

Render a screenshot synchronously.

```python
# Simple URL
screenshot = client.screenshot("https://example.com")

# With options
screenshot = client.screenshot({
    "url": "https://example.com",
    "viewport": {"width": 1280, "height": 720},
    "fullPage": True,
    "format": "jpeg",
    "quality": 90
})

# URL + options
screenshot = client.screenshot("https://example.com", {
    "fullPage": True,
    "darkMode": True
})

# Pre-capture actions
screenshot = client.screenshot("https://example.com", {
    "actions": [
        {"type": "click", "selector": "#accept-cookies"},
        {"type": "scroll", "y": 500},
        {"type": "type", "selector": "#search", "value": "hello"},
    ]
})

# Hide, remove, or blur elements
screenshot = client.screenshot("https://example.com", {
    "hide_selectors": [".ad-banner", ".cookie-popup"],
    "remove_selectors": [".tracking-pixel"],
    "blur_selectors": [".email", ".phone"],
    "blur_radius": 15,
    "block_ads": True,
})

# Content validation
screenshot = client.screenshot("https://example.com", {
    "fail_if_contains": "Error 404",
    "fail_if_missing": ".main-content",
})
```

**Options:**
- `url` (str): URL to screenshot
- `html` (str): Raw HTML to screenshot (alternative to `url`)
- `viewport` (dict): `{"width": int, "height": int}`
- `format` (str): `"png"`, `"jpeg"`, or `"webp"` (default: `"png"`)
- `quality` (int): JPEG/WebP quality 0-100 (default: 80)
- `fullPage` (bool): Capture full scrollable page (default: `False`)
- `selector` (str): CSS selector to screenshot
- `waitFor` (str): CSS selector to wait for before screenshot
- `darkMode` (bool): Enable dark mode (default: `False`)
- `deviceScaleFactor` (float): Device scale factor (default: 1)
- `callback_url` (str): Webhook URL for async completion
- `actions` (list): Pre-capture interactions `[{"type": "click|scroll|type|hover|wait", "selector": "...", "value": "...", "x": 0, "y": 0}]`
- `hide_selectors` (list[str]): CSS selectors to hide (visibility: hidden)
- `remove_selectors` (list[str]): CSS selectors to remove from DOM
- `blur_selectors` (list[str]): CSS selectors to blur
- `blur_radius` (int): Blur radius in pixels (1-50, default: 10)
- `fail_if_contains` (str): Fail if page contains this text
- `fail_if_missing` (str): Fail if page is missing this text
- `block_ads` (bool): Block ads and trackers

##### `pdf(url_or_options, options=None) -> bytes`

Render a PDF synchronously.

```python
# Simple URL
pdf = client.pdf("https://example.com")

# With options
pdf = client.pdf({
    "url": "https://example.com",
    "format": "a4",
    "landscape": True,
    "printBackground": True
})
```

**Options:**
- `url` (str): URL to convert to PDF
- `html` (str): Raw HTML to convert (alternative to `url`)
- `format` (str): `"a4"`, `"letter"`, or `"legal"` (default: `"a4"`)
- `landscape` (bool): Landscape orientation (default: `False`)
- `margins` (dict): `{"top": str, "right": str, "bottom": str, "left": str}` (e.g., `"1cm"`)
- `printBackground` (bool): Print background graphics (default: `False`)
- `headerTemplate` (str): HTML template for header
- `footerTemplate` (str): HTML template for footer
- `scale` (float): Scale factor (default: 1)
- `callback_url` (str): Webhook URL for async completion
- `actions` (list): Pre-capture interactions `[{"type": "click|scroll|type|hover|wait", ...}]`
- `hide_selectors` (list[str]): CSS selectors to hide (visibility: hidden)
- `remove_selectors` (list[str]): CSS selectors to remove from DOM
- `blur_selectors` (list[str]): CSS selectors to blur
- `blur_radius` (int): Blur radius in pixels (1-50, default: 10)
- `fail_if_contains` (str): Fail if page contains this text
- `fail_if_missing` (str): Fail if page is missing this text
- `block_ads` (bool): Block ads and trackers

##### `og(url, options=None) -> bytes`

Generate an OG (Open Graph) image.

```python
og_image = client.og("https://example.com", {
    "title": "My Page Title",
    "description": "Page description",
    "siteName": "My Site",
    "theme": "dark",
    "template": "article"
})
```

**Options:**
- `title` (str): Title text
- `description` (str): Description text
- `siteName` (str): Site name
- `image` (str): Background image URL
- `theme` (str): `"light"` or `"dark"`
- `template` (str): `"default"`, `"article"`, or `"product"`

##### `screenshot_async(url_or_options, options=None) -> AsyncRenderResponse`

Queue an async screenshot render.

```python
job = client.screenshot_async("https://example.com")
print(job.jobId)  # e.g., "job_abc123"
print(job.pollUrl)  # e.g., "https://api.screenforge.dev/v1/render/job_abc123"
```

##### `pdf_async(url_or_options, options=None) -> AsyncRenderResponse`

Queue an async PDF render.

```python
job = client.pdf_async("https://example.com")
```

##### `poll_job(job_id) -> RenderJob`

Poll the status of a render job.

```python
status = client.poll_job("job_abc123")
print(status.status)  # "pending", "processing", "completed", or "failed"
print(status.error)  # Error message if failed
```

##### `batch_render(items) -> BatchRenderResponse`

Submit a batch of render jobs.

```python
batch = client.batch_render([
    {"type": "screenshot", "url": "https://example.com"},
    {"type": "pdf", "url": "https://example.org", "options": {"landscape": True}},
])
print(batch.batchId)
for job in batch.jobs:
    print(f"{job['jobId']}: {job['pollUrl']}")
```

##### `get_usage() -> UsageStats`

Get API usage statistics.

```python
usage = client.get_usage()
print(f"Tier: {usage.tier}")
print(f"Today: {usage.usage['today']}")
print(f"This month: {usage.usage['thisMonth']}")
print(f"Monthly quota: {usage.usage['monthlyQuota']}")
print(f"Remaining: {usage.usage['remaining']}")
print(f"Rate limit: {usage.rateLimit['requestsPerMinute']} req/min")
```

##### `extract(options: ExtractOptions) -> ExtractResult`

Extract structured data from a webpage using LLM-powered vision analysis.

```python
# Extract from a URL
result = client.extract({
    "url": "https://example.com/product",
    "prompt": "Extract the product title, price, and description",
    "schema": {
        "title": "string",
        "price": "number",
        "description": "string"
    },
    "model": "sonnet"
})

print(result.data)  # {"title": "...", "price": 99.99, "description": "..."}
print(f"Model: {result.modelUsed}, Tokens: {result.tokensUsed}")

# Extract from an existing render job
extracted = client.extract({
    "job_id": "job_abc123",
    "prompt": "Extract all product names from the page",
    "model": "haiku"
})

# Async version
async with AsyncScreenForgeClient(api_key="your-api-key") as client:
    result = await client.extract({
        "url": "https://example.com",
        "prompt": "Extract page title"
    })
    print(result.data)
```

##### `accessibility(url: str, **options) -> AccessibilityReport`

Run a comprehensive WCAG accessibility audit on a webpage using axe-core.

```python
# Run accessibility audit
report = client.accessibility(
    "https://example.com",
    standard="WCAG2AA",
    include_screenshot=True
)

print(f"Audit ID: {report.auditId}")
print(f"Violations: {report.violationsCount}")
print(f"Passes: {report.passesCount}")

for violation in report.violations:
    print(f"\n{violation.id} ({violation.impact})")
    print(f"  {violation.description}")
    print(f"  Help: {violation.helpUrl}")

    for node in violation.nodes:
        print(f"  - Target: {', '.join(node.target)}")
        print(f"    HTML: {node.html}")

if report.screenshotPath:
    print(f"Screenshot: {report.screenshotPath}")
    print(f"Annotated: {report.annotatedScreenshotPath}")

# Async version
async with AsyncScreenForgeClient(api_key="your-api-key") as client:
    report = await client.accessibility("https://example.com")
    print(f"Violations: {report.violationsCount}")
```

##### `gif(options: GifOptions) -> bytes`

Render an animated GIF by scrolling through a webpage.

```python
gif_data = client.gif({
    "url": "https://example.com",
    "duration": 5000,
    "fps": 30,
    "scrollDistance": 1000,
})
with open("animation.gif", "wb") as f:
    f.write(gif_data)

# Async version
async with AsyncScreenForgeClient(api_key="your-api-key") as client:
    gif_data = await client.gif({"url": "https://example.com", "duration": 5000})
```

**Options:**
- `url` (str): URL to render
- `duration` (int): Animation duration in ms (default: 5000)
- `fps` (int): Frames per second (default: 30)
- `scrollDistance` (int): Vertical scroll distance in pixels
- `viewport` (dict): `{"width": int, "height": int}`
- `waitFor` (str): CSS selector to wait for before starting
- `headers` (dict): Custom HTTP headers
- `cookies` (list): Cookies to set
- `actions` (list): Pre-capture interactions

##### `gif_async(options: GifOptions) -> AsyncRenderResponse`

Queue a GIF render job asynchronously.

```python
job = client.gif_async({"url": "https://example.com", "duration": 10000})
print(f"Job ID: {job.jobId}")
status = client.poll_job(job.jobId)
```

##### `diff(options: DiffOptions) -> bytes`

Generate a visual diff image comparing two screenshots.

```python
# Compare two URLs
diff_image = client.diff({
    "url_a": "https://example.com/old",
    "url_b": "https://example.com/new",
    "threshold": 0.1,
})
with open("diff.png", "wb") as f:
    f.write(diff_image)

# Compare two existing render jobs
diff_image = client.diff({
    "job_id_a": "job_123",
    "job_id_b": "job_456",
})

# Async version
async with AsyncScreenForgeClient(api_key="your-api-key") as client:
    diff_image = await client.diff({
        "url_a": "https://example.com/v1",
        "url_b": "https://example.com/v2",
    })
```

**Options:**
- `url_a` (str): First URL to compare
- `url_b` (str): Second URL to compare
- `job_id_a` (str): First job ID to compare (alternative to `url_a`)
- `job_id_b` (str): Second job ID to compare (alternative to `url_b`)
- `threshold` (float): Diff sensitivity (0-1, default: 0.1)
- `screenshot_options` (dict): Screenshot capture settings

##### `create_schedule(options: ScheduleCreate) -> Schedule`

Create a recurring render schedule using cron expressions.

```python
schedule = client.create_schedule({
    "name": "Daily homepage screenshot",
    "cron_expression": "0 9 * * *",
    "render_type": "screenshot",
    "render_config": {"url": "https://example.com", "fullPage": True},
})
print(f"Created: {schedule.id}, Next run: {schedule.next_run_at}")

# Async version
async with AsyncScreenForgeClient(api_key="your-api-key") as client:
    schedule = await client.create_schedule({...})
```

##### `list_schedules() -> List[Schedule]`

List all schedules for the authenticated API key.

```python
schedules = client.list_schedules()
for s in schedules:
    print(f"{s.id}: {s.name} ({s.cron_expression})")
```

##### `get_schedule(schedule_id: str) -> Schedule`

Get a specific schedule by ID.

```python
schedule = client.get_schedule("sched_123")
print(schedule.name)
```

##### `update_schedule(schedule_id: str, options: ScheduleUpdate) -> Schedule`

Update an existing schedule.

```python
updated = client.update_schedule("sched_123", {"name": "Updated name", "enabled": False})
```

##### `delete_schedule(schedule_id: str) -> None`

Delete a schedule.

```python
client.delete_schedule("sched_123")
```

**Schedule object properties:**
- `id` (str): Schedule ID
- `name` (str): Schedule name
- `cron_expression` (str): Unix cron format
- `render_type` (str): `"screenshot"`, `"pdf"`, or `"og"`
- `render_config` (dict): Render options
- `enabled` (bool): Whether the schedule is active
- `next_run_at` (str | None): ISO 8601 timestamp of next run
- `last_run_at` (str | None): ISO 8601 timestamp of last run
- `created_at` (str): ISO 8601 creation timestamp
- `updated_at` (str): ISO 8601 last update timestamp

## Error Handling

The SDK raises typed exceptions for different error scenarios:

```python
from screenforge import (
    ScreenForgeClient,
    ScreenForgeError,
    ValidationError,
    AuthenticationError,
    RateLimitError,
    RenderError,
)

client = ScreenForgeClient(api_key="your-api-key")

try:
    screenshot = client.screenshot("https://example.com")
except ValidationError as e:
    # 400 - Invalid request parameters
    print(f"Validation error: {e}")
    print(f"Status: {e.status}")
    print(f"Code: {e.code}")
    print(f"Details: {e.details}")
except AuthenticationError as e:
    # 401/403 - Invalid API key or insufficient permissions
    print(f"Auth error: {e}")
except RateLimitError as e:
    # 429 - Rate limit exceeded
    print(f"Rate limited: {e}")
    print(f"Retry after {e.retry_after} seconds")
except RenderError as e:
    # Render job failed
    print(f"Render failed: {e}")
except ScreenForgeError as e:
    # Base exception for all other errors
    print(f"Error: {e}")
    print(f"Request ID: {e.request_id}")
```

### Error Properties

All exceptions inherit from `ScreenForgeError` and include:

- `message` (str): Error message
- `status` (int | None): HTTP status code
- `code` (str | None): Error code from API
- `details` (Any | None): Additional error details
- `request_id` (str | None): Request ID for debugging
- `retry_after` (int | None): Seconds to wait before retrying (for rate limits)

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

- **Retryable status codes:** 429, 500, 502, 503, 504
- **Default max retries:** 2 (configurable via `max_retries`)
- **Backoff strategy:** Exponential with configurable base delay
- **Retry-After header:** Automatically respected for 429 responses

```python
# Disable retries
client = ScreenForgeClient(api_key="your-api-key", max_retries=0)

# Increase retries and base delay
client = ScreenForgeClient(
    api_key="your-api-key",
    max_retries=5,
    retry_base_delay_ms=500
)
```

## Context Managers

Both clients support context managers for automatic cleanup:

```python
# Sync
with ScreenForgeClient(api_key="your-api-key") as client:
    screenshot = client.screenshot("https://example.com")

# Async
async with AsyncScreenForgeClient(api_key="your-api-key") as client:
    screenshot = await client.screenshot("https://example.com")
```

## Development

### Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows

# Install in editable mode with dev dependencies
pip install -e ".[dev]"
```

### Running Tests

```bash
pytest
```

### Building

```bash
python -m build
```

### Publishing to PyPI

```bash
# Install build and twine
pip install build twine

# Build the package
python -m build

# Upload to PyPI
python -m twine upload dist/*
```

For test PyPI:

```bash
python -m twine upload --repository testpypi dist/*
```

## License

MIT

## Links

- [ScreenForge Homepage](https://screenforge.dev)
- [Documentation](https://docs.screenforge.dev)
- [API Reference](https://docs.screenforge.dev/api)
- [GitHub Repository](https://github.com/hodlthedoor/screenforge)
- [Bug Reports](https://github.com/hodlthedoor/screenforge/issues)
