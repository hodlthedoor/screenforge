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
)

__version__ = "1.2.0"

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
]
