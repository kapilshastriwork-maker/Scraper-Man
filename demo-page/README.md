# demo-page/

**Purpose:** a self-controlled target reserved exclusively for the **Phase 7 controlled-break self-healing demo**.

This page is a static fake startup careers page (fictional company "Northwind Labs") that mirrors the schema of the real target — each listing exposes a job title, a location, and an "Apply" link, under simple, obvious semantic class names:

- `class="job-card"` (wrapper per role)
- `class="job-title"`
- `class="job-location"`
- `class="job-apply-link"`

Because we own this markup completely, in Phase 7 we will deliberately rename and restructure these exact classes to simulate a site redesign, then prove the healing loop catches and fixes the break unattended. That is the whole reason this page exists: a genuine, filmable self-heal event we control, rather than hoping a real site redesigns itself mid-hackathon.

## Current state

- `index.html` — built, 6 fictional roles
- **Not deployed.** This page needs a GitHub repo + remote + Pages enabled in Settings before Phase 7. That is a manual human step, tracked in `PROGRESS.md` under Known Issues / Open Questions.

<!-- No build step. No framework. No JS. The only job of this page is to be scraped and later broken on command. -->
