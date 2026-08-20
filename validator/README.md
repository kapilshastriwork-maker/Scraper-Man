# validator/

This directory is reserved for **Phase 3 — Validator**.

It will hold the schema validation logic that checks Bright Data scraper
output against `config/schema.json` (v1 fields: role_title, location, job_url)
and surfaces records that are missing, malformed, or structurally suspect —
the input that the healing orchestrator in Phase 4 needs to act on.
