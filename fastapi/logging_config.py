"""
Thin shim — preserves the historic `from logging_config import setup_logging`
import while the real implementation lives in observability/logging.py.

Why keep this file? Several modules at the project root (and the tests)
import `setup_logging` from here, and rather than churn every call site
this re-exports the new structured-logging entrypoint.
"""
from observability.logging import setup_logging  # noqa: F401

__all__ = ["setup_logging"]
