"""
observability/ — logging, tracing, metrics helpers.

Currently exposes:
  logging.RequestContext   — contextvar-backed request_id + user_id carrier
  logging.JsonFormatter    — JSON line formatter for structured logs
  logging.setup_logging    — single entrypoint used by main.lifespan
"""
