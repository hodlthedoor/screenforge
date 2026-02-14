"""ScreenForge SDK exceptions."""

from typing import Any, Optional


class ScreenForgeError(Exception):
    """Base exception for all ScreenForge SDK errors."""

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        code: Optional[str] = None,
        details: Any = None,
        request_id: Optional[str] = None,
        retry_after: Optional[int] = None,
        cause: Optional[Exception] = None,
    ):
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details
        self.request_id = request_id
        self.retry_after = retry_after
        self.__cause__ = cause

    def __repr__(self) -> str:
        attrs = []
        if self.status is not None:
            attrs.append(f"status={self.status}")
        if self.code:
            attrs.append(f"code={self.code!r}")
        if self.request_id:
            attrs.append(f"request_id={self.request_id!r}")
        attrs_str = ", ".join(attrs)
        return f"{self.__class__.__name__}({self.args[0]!r}, {attrs_str})" if attrs_str else f"{self.__class__.__name__}({self.args[0]!r})"


class RateLimitError(ScreenForgeError):
    """Exception raised when rate limit is exceeded (HTTP 429)."""

    pass


class ValidationError(ScreenForgeError):
    """Exception raised for validation errors (HTTP 400)."""

    pass


class AuthenticationError(ScreenForgeError):
    """Exception raised for authentication/authorization errors (HTTP 401/403)."""

    pass


class RenderError(ScreenForgeError):
    """Exception raised when a render job fails."""

    pass
