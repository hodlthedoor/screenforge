"""Official Python SDK for ScreenForge screenshot, PDF, and OG image API."""

from .client import ScreenForgeClient, AsyncScreenForgeClient
from .exceptions import (
    ScreenForgeError,
    AuthenticationError,
    RateLimitError,
    ValidationError,
    RenderError,
)
from .types import (
    Action,
    ScreenshotOptions,
    PdfOptions,
    OgOptions,
    BatchItem,
    RenderJob,
    BatchJob,
    UsageStats,
    AsyncRenderResponse,
    BatchRenderResponse,
    ExtractOptions,
    ExtractResult,
    ExtractScreenshotOptions,
    AccessibilityOptions,
    AccessibilityReport,
    AccessibilityScreenshotOptions,
    AccessibilityViolation,
    AccessibilityViolationNode,
    GifOptions,
    DiffOptions,
    DiffScreenshotOptions,
    ScheduleRenderType,
    ScheduleCreate,
    ScheduleUpdate,
    Schedule,
)

__version__ = "1.5.0"

__all__ = [
    # Clients
    "ScreenForgeClient",
    "AsyncScreenForgeClient",
    # Exceptions
    "ScreenForgeError",
    "AuthenticationError",
    "RateLimitError",
    "ValidationError",
    "RenderError",
    # Types
    "Action",
    "ScreenshotOptions",
    "PdfOptions",
    "OgOptions",
    "BatchItem",
    "RenderJob",
    "BatchJob",
    "UsageStats",
    "AsyncRenderResponse",
    "BatchRenderResponse",
    "ExtractOptions",
    "ExtractResult",
    "ExtractScreenshotOptions",
    "AccessibilityOptions",
    "AccessibilityReport",
    "AccessibilityScreenshotOptions",
    "AccessibilityViolation",
    "AccessibilityViolationNode",
    "GifOptions",
    "DiffOptions",
    "DiffScreenshotOptions",
    "ScheduleRenderType",
    "ScheduleCreate",
    "ScheduleUpdate",
    "Schedule",
]
