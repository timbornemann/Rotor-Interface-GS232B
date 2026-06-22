"""Example package demonstrating API usage for the Rotor Interface GS232B."""

from .rotor_client import (
    RotorApiClient,
    RotorApiConnectionError,
    RotorApiError,
    RotorApiResponseError,
    RotorApiTimeoutError,
    RotorApiValidationError,
    RotorDisconnectedError,
    SessionRequiredError,
    SessionSuspendedError,
)

__all__ = [
    "RotorApiClient",
    "RotorApiError",
    "RotorApiValidationError",
    "RotorApiConnectionError",
    "RotorApiTimeoutError",
    "RotorApiResponseError",
    "RotorDisconnectedError",
    "SessionRequiredError",
    "SessionSuspendedError",
]
