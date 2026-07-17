---
name: fresh-routes-removal-timing
description: v5.9.19 fresh-filter fix holds, BUT registry PRUNING can still delete an actively-planned route mid-session (proven 2026-07-02) — fix = prune-exempt recent SimBrief pairs
metadata:
  node_type: memory
  type: project
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
---

**Two separate mechanisms — don't conflate them (I did once; Dean's pushback corrected it):**

1. **Fresh-routes FILTER hiding (RESOLVED v5.9.19, verified live):** a pair SimBriefed this session
   is exempted from the fresh filter via `S.sessionSimBrief` until next launch. This fix works.

2. **Registry PRUNE deletion (REAL, proven 2026-07-02, unfixed):** Dean found KFLL→MMUN as a real
   registry route (fresh filter, one-scenery), SimBriefed it 13:41Z; the 8-hour auto-refresh
   completed 13:51Z and its `pruneRegistry()` DELETED the route (last_seen June 3 = 29 days > the
   21-day cutoff; registry also pinned at the 5000 cap). Route vanished from Plan a Flight
   mid-session while he was actively flying it. Snapshot (never pruned) retains it — that's how it
   was proven.

**Fix design (roadmap Master List B1):** `pruneRegistry()` must exempt pairs in
`recentSimBriefRoutes` (and `sessionSimBrief`) from BOTH the 21-day and 5000-cap prunes — those are
exactly the routes Dean is flying. Pair with "Clickable Recent Routes → reopen route panel", which
should fall back to SNAPSHOT data when the registry no longer has the pair.
Related: [[project_next_steps]].
