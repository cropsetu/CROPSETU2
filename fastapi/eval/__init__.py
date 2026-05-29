"""
eval/ — offline replay + comparison tooling.

Built on top of the persistence layer (ai_scan_diagnoses). Lets you take
a sample of historical scans, rerun them against a new prompt version
(or a new model chain), and produce a side-by-side report — so prompt
changes are evaluated against REAL traffic, not a synthetic test set.
"""
