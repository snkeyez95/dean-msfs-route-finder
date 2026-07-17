---
name: optimize-code-and-data
description: "Dean wants ongoing attention to code + data optimization, not just \"it works\" — flag and improve inefficiencies as we go"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
---

Dean (2026-06-30): "At every point from here on out, we need to think about optimization of code and
data we have. I always hear developers talking 'yea, the code works, but it's terribly optimized.'"

**Why:** functionality is necessary but not sufficient — Dean cares about the app being efficient
and maintainable for the long term, not just passing the happy path.

**How to apply (ongoing, not a one-time task):**
- When touching any area, note inefficiencies: redundant fetches/IO, repeated full scans, polling that
  could be event-driven, unbounded growth (the raw `frametimes.csv` size issue Dean already flagged →
  Phase 7 retention), N+1 file reads, work done on every render that could be cached/memoized.
- Prefer keeping data handling in Node + reading small summaries over heavy artifacts (see
  [[powershell_51_not_7]] / the Compare view reading summaries not raw CSVs).
- Surface optimization opportunities proactively in reviews; log them to the roadmap backlog with a
  rough cost/benefit so they can be picked up deliberately — don't silently over-engineer mid-feature.
- Balance: don't sacrifice the working/validated path for premature optimization (see
  [[work-discipline-validate-before-ship]]). Optimize deliberately, validated, like any other change.
