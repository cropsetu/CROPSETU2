"""Retrieval-Augmented Generation layer for treatment grounding.

retrieve(disease, crop, zone) returns the structured grounding the
treatment LLM should base its recommendation on: registered actives
(CIB&RC), cultural practices (ICAR package-of-practices), zone-specific
ETL thresholds, FSSAI MRL values, and regulatory notes (spurious-
pesticide advisory, off-label warnings).

v1 is a structured KB — no embeddings, no PDF ingestion. The Phase 7
plan keeps it that way; later phases can swap retrieve()'s body for an
embedding lookup without touching the treatment agent's call site.
"""
from rag.knowledge_base import retrieve  # noqa: F401
