# .github/workflows/

This directory is reserved for **Phase 6 — Unattended CI loop + scale**.

It will hold GitHub Actions workflows that run the orchestrator on a schedule
with no human in the loop, and scale the self-healing loop across all three
target ATS families.

Note: a GitHub remote must be configured before these workflows can actually
run. The remote is intentionally left unset in Phase 1 and will be wired up
before Phase 6 begins.
