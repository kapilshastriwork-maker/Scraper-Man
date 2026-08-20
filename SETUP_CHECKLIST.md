# Setup Checklist

These are **manual, human-only** steps. Do not attempt to run or automate any of them — they require a human browser session and Bright Data account access.

- [ ] Sign up at https://brightdata.com
- [ ] Apply the WeMakeDevs hackathon promo / credit code (from the hackathon's kickoff guide) under Billing
- [ ] Run `npx -p @brightdata/cli bdata login --device` in this repo's terminal and complete the device authorization in the browser
- [ ] Visit https://brightdata.com/cp/scrapers/browse and confirm none of the three targets below (or their ATS platform generally) already have a maintained scraper in the library:
  - https://www.retellai.com/careers (custom)
  - https://jobs.ashbyhq.com/Linear (Ashby)
  - https://job-boards.greenhouse.io/kalshi (Greenhouse)
- [ ] Once logged in, confirm `bdata --version` runs successfully in this repo's terminal

When all five are checked off, advance to Phase 2 in `PROGRESS.md`.
