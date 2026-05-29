"""
persistence/ — durable storage of diagnosis events.

Why this exists
  Every scan today returns a report to the client and vanishes. That kills
  three things we need for production:
    • An audit trail — "what did we tell farmer X on day Y?"
    • An eval set — replay historical inputs against a new prompt and
      compare outputs without rerunning the LLM in production.
    • Drift detection — confidence histograms, escalation rate, model
      mix over time.

Design
  • Single table `ai_scan_diagnoses` created idempotently on first call.
  • Fire-and-forget: orchestrator awaits a wrapper that catches all
    exceptions, so a DB outage never breaks a scan.
  • Opt-out: set DIAGNOSIS_PERSISTENCE_ENABLED=false to disable.
  • PII-light by default: we store the perceptual hash of each image
    rather than the bytes; symptom_description is stored hashed.

Schema lives in `models.py`; the public API is `record_diagnosis` in
`diagnosis_repo.py`.
"""
