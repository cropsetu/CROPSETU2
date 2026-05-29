"""
safety/ — deterministic guardrails that run AFTER any LLM call.

The LLM is treated as untrusted input: every chemical it recommends is
re-validated against a versioned registry of CIB&RC-registered actives
and explicit ban list before it reaches the farmer or the dealer sheet.

Modules
  chemicals.py   — versioned data: banned, registered, brand aliases.
  validator.py   — TreatmentValidator: strips/flags unsafe recs.
  compliance.py  — builds the real compliance_audit block for reports.
  policy.py      — confidence/OOD gates that decide whether to emit
                   chemical recommendations at all.
"""
