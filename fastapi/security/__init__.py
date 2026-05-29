"""
security/ — auth, PII redaction, spend caps, rate limits.

This package contains *enforcement* layers that sit between the network
edge (FastAPI middleware / dependency) and the agents. Nothing here
talks to LLMs directly.
"""
