# scraper/

This directory is reserved for **Phase 2 — Build the base scraper in Scraper Studio**.

The actual scraper does not live in this repo. It is built and hosted in
Bright Data Scraper Studio and driven remotely via the `bdata` CLI. Once the
Collector is created, its **Collector ID** and any local run/heal scripts that
invoke `bdata` will be stored here.

Do not add scraper extraction logic as local code — that belongs in Scraper
Studio templates, not this codebase.
