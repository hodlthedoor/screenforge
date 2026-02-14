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
    ScreenshotOptions,
    PdfOptions,
    OgOptions,
    BatchItem,
    RenderJob,
    BatchJob,
    UsageStats,
    AsyncRenderResponse,
    BatchRenderResponse,
)

__version__ = "1.0.0"

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
    "ScreenshotOptions",
    "PdfOptions",
    "OgOptions",
    "BatchItem",
    "RenderJob",
    "BatchJob",
    "UsageStats",
    "AsyncRenderResponse",
    "BatchRenderResponse",
]
