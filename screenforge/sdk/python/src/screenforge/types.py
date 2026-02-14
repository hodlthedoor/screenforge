"""ScreenForge SDK type definitions."""

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, TypedDict


class Viewport(TypedDict, total=False):
    """Viewport dimensions for screenshot rendering."""

    width: int
    height: int


class ScreenshotOptions(TypedDict, total=False):
    """Options for screenshot rendering."""

    url: str
    html: str
    viewport: Viewport
    format: Literal["png", "jpeg"]
    quality: int
    fullPage: bool
    selector: str
    waitFor: str
    darkMode: bool
    deviceScaleFactor: float
    callback_url: str


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


class OgOptions(TypedDict, total=False):
    """Options for OG image rendering."""

    title: str
    description: str
    siteName: str
    image: str
    theme: Literal["light", "dark"]
    template: Literal["default", "article", "product"]


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
