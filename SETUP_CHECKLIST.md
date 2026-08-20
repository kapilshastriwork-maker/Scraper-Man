# Setup Checklist

These are **manual, human-only** steps. Do not attempt to run or automate any of them — they require a human browser session and Bright Data account access.

- [ ] Sign up at https://brightdata.com
- [ ] Apply the WeMakeDevs hackathon promo / credit code (from the hackathon's kickoff guide) under Billing
- [ ] Run `npx -p @brightdata/cli bdata login --device` in this repo's terminal and complete the device authorization in the browser
- [ ] Visit https://brightdata.com/cp/scrapers/browse and confirm the real target below does not already have a maintained scraper in the library:
  - https://www.retellai.com/careers (custom careers page, not a third-party ATS)
- [ ] Once logged in, confirm `bdata --version` runs successfully in this repo's terminal

When all five are checked off, advance to Phase 2 in `PROGRESS.md`.
