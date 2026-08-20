# orchestrator/

This directory is reserved for **Phase 4 — Healing orchestrator**.

It will hold the self-healing loop: run the scraper (via `bdata`), pass output
through the validator, detect layout-break signatures, decide whether a re-heal
attempt is warranted, and trigger re-runs — all without human intervention.
