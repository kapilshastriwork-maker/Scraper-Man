## Project: Startup Hiring Signal Tracker
Skills: TypeScript, Node.js, REST API integration, LLM APIs (Groq, Anthropic),
automated evaluation and validation logic, human-in-the-loop correction, CI/CD
(GitHub Actions), SQLite, data pipeline design
Built a scraper with an automated self-healing layer for the WeMakeDevs Scrape-Verse
hackathon. The core design principle: never trust an AI-proposed fix without
independently re-evaluating it twice - once against its preview output, once against
real production output - before treating it as resolved. Built a validation layer that
scores every run against defined correctness criteria, and an escalation path that
refuses to approve a fix when evaluation doesn't clear that bar, rather than guessing.
This caught a real case where a human's manual approval of an AI-proposed fix was
wrong: the system's own re-evaluation of the live result exposed it, the approval was
reversed, and the incident was documented rather than hidden. Runs unattended on a
twelve-hour schedule via CI, with a full audit trail logging every evaluation decision
and its reasoning.
Link: (add your GitHub repo URL if you want it included)
