"""ScreenForge SDK type definitions."""

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, TypedDict, Union


class Viewport(TypedDict, total=False):
    """Viewport dimensions for screenshot rendering."""

    width: int
    height: int


class Cookie(TypedDict, total=False):
    """Cookie configuration."""

    name: str
    value: str
    domain: str
    path: str


class _ActionRequired(TypedDict):
    """Required fields for Action."""

    type: Literal["click", "scroll", "type", "hover", "wait", "delay"]


class Action(_ActionRequired, total=False):
    """Pre-capture interaction action. `type` is required."""

    selector: str
    value: Union[str, int]
    x: int
    y: int


class ScreenshotOptions(TypedDict, total=False):
    """Options for screenshot rendering."""

    url: str
    html: str
    viewport: Viewport
    format: Literal["png", "jpeg", "webp", "avif"]
    quality: int
    fullPage: bool
    selector: str
    waitFor: str
    darkMode: bool
    deviceScaleFactor: float
    callback_url: str
    headers: Dict[str, str]
    cookies: List[Cookie]
    actions: List[Action]
    hide_selectors: List[str]
    remove_selectors: List[str]
    blur_selectors: List[str]
    blur_radius: int
    fail_if_contains: str
    fail_if_missing: str
    block_ads: bool


class PdfMargins(TypedDict, total=False):
    """PDF margin configuration."""

    top: str
    right: str
    bottom: str
    left: str


class PdfOptions(TypedDict, total=False):
    """Options for PDF rendering."""

    url: str
    html: str
    format: Literal["a4", "letter", "legal"]
    landscape: bool
    margins: PdfMargins
    printBackground: bool
    headerTemplate: str
    footerTemplate: str
    scale: float
    callback_url: str
    headers: Dict[str, str]
    cookies: List[Cookie]
    actions: List[Action]
    hide_selectors: List[str]
    remove_selectors: List[str]
    blur_selectors: List[str]
    blur_radius: int
    fail_if_contains: str
    fail_if_missing: str
    block_ads: bool


class OgOptions(TypedDict, total=False):
    """Options for OG image rendering."""

    url: str
    title: str
    description: str
    siteName: str
    image: str
    theme: Literal["light", "dark"]
    template: Literal["default", "article", "product"]
    headers: Dict[str, str]
    cookies: List[Cookie]


class BatchItem(TypedDict, total=False):
    """Single item in a batch render request."""

    type: Literal["screenshot", "pdf"]
    url: str
    html: str
    options: Dict[str, Any]
    callbackUrl: str


RenderJobStatus = Literal["pending", "processing", "completed", "failed"]


@dataclass
class RenderJob:
    """Render job status and metadata."""

    id: str
    type: Literal["screenshot", "pdf", "og"]
    url: str
    status: RenderJobStatus
    createdAt: str
    pollUrl: str
    error: Optional[str] = None
    contentType: Optional[str] = None
    durationMs: Optional[int] = None
    completedAt: Optional[str] = None


@dataclass
class BatchJobItem:
    """Single job within a batch."""

    id: str
    type: Literal["screenshot", "pdf", "og"]
    url: str
    status: RenderJobStatus
    pollUrl: str
    error: Optional[str] = None
    durationMs: Optional[int] = None


@dataclass
class BatchJob:
    """Batch job status and metadata."""

    id: str
    total: int
    completed: int
    failed: int
    status: RenderJobStatus
    createdAt: str
    jobs: List[BatchJobItem]
    completedAt: Optional[str] = None


@dataclass
class UsageStats:
    """API usage statistics."""

    apiKeyId: str
    tier: str
    usage: Dict[str, int]
    rateLimit: Dict[str, int]


@dataclass
class AsyncRenderResponse:
    """Response from async render request."""

    jobId: str
    pollUrl: str


@dataclass
class BatchRenderResponse:
    """Response from batch render request."""

    batchId: str
    jobs: List[Dict[str, str]]


# Extract API types


class ExtractScreenshotOptions(TypedDict, total=False):
    """Screenshot options for extraction."""

    viewport_width: int
    viewport_height: int
    format: Literal["png", "jpeg", "webp", "avif"]
    full_page: bool
    delay_ms: int


class _ExtractOptionsRequired(TypedDict):
    """Required fields for ExtractOptions."""

    prompt: str


class ExtractOptions(_ExtractOptionsRequired, total=False):
    """Options for LLM-powered data extraction. `prompt` is required."""

    url: str
    job_id: str
    schema: Dict[str, Any]
    model: Literal["sonnet", "haiku"]
    screenshot_options: ExtractScreenshotOptions


@dataclass
class ExtractResult:
    """Result from extraction request."""

    extractionId: str
    data: Any
    modelUsed: str
    tokensUsed: int
    durationMs: int
    screenshotPath: Optional[str] = None


# Accessibility API types


class AccessibilityScreenshotOptions(TypedDict, total=False):
    """Screenshot options for accessibility audit."""

    viewport_width: int
    viewport_height: int
    delay_ms: int


class _AccessibilityOptionsRequired(TypedDict):
    """Required fields for AccessibilityOptions."""

    url: str


class AccessibilityOptions(_AccessibilityOptionsRequired, total=False):
    """Options for WCAG accessibility audit. `url` is required."""

    standard: Literal["WCAG2A", "WCAG2AA", "WCAG2AAA"]
    screenshot_options: AccessibilityScreenshotOptions
    include_screenshot: bool


@dataclass
class AccessibilityViolationNode:
    """Single node with accessibility violation."""

    html: str
    target: List[str]
    failureSummary: Optional[str] = None


@dataclass
class AccessibilityViolation:
    """Accessibility violation details."""

    id: str
    impact: str
    description: str
    helpUrl: str
    nodes: List[AccessibilityViolationNode]


@dataclass
class AccessibilityReport:
    """WCAG accessibility audit report."""

    auditId: str
    url: str
    standard: Literal["WCAG2A", "WCAG2AA", "WCAG2AAA"]
    violations: List[AccessibilityViolation]
    passesCount: int
    violationsCount: int
    incompleteCount: int
    durationMs: int
    timestamp: str
    screenshotPath: Optional[str] = None
    annotatedScreenshotPath: Optional[str] = None


# GIF API types


class GifOptions(TypedDict, total=False):
    """Options for GIF rendering."""

    url: str
    html: str
    viewport: Viewport
    duration: int
    fps: int
    scrollDistance: int
    waitFor: str
    callback_url: str
    headers: Dict[str, str]
    cookies: List[Cookie]
    actions: List[Action]


# Diff API types


class DiffScreenshotOptions(TypedDict, total=False):
    """Screenshot options for diff comparison."""

    viewport_width: int
    viewport_height: int
    format: Literal["png", "jpeg", "webp", "avif"]
    full_page: bool
    delay_ms: int


class DiffOptions(TypedDict, total=False):
    """Options for diff comparison."""

    url_a: str
    url_b: str
    job_id_a: str
    job_id_b: str
    threshold: float
    screenshot_options: DiffScreenshotOptions


# Schedule API types

ScheduleRenderType = Literal["screenshot", "pdf", "og"]


class _ScheduleCreateRequired(TypedDict):
    """Required fields for ScheduleCreate."""

    name: str
    cron_expression: str
    render_type: ScheduleRenderType
    render_config: Dict[str, Any]


class ScheduleCreate(_ScheduleCreateRequired, total=False):
    """Options for creating a schedule. name, cron_expression, render_type, and render_config are required."""

    enabled: bool


class ScheduleUpdate(TypedDict, total=False):
    """Options for updating a schedule."""

    name: str
    cron_expression: str
    render_type: ScheduleRenderType
    render_config: Dict[str, Any]
    enabled: bool


@dataclass
class Schedule:
    """Recurring render schedule."""

    id: str
    name: str
    cron_expression: str
    render_type: ScheduleRenderType
    render_config: Dict[str, Any]
    enabled: bool
    created_at: str
    updated_at: str
    next_run_at: Optional[str] = None
    last_run_at: Optional[str] = None
