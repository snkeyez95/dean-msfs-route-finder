---
name: port-watch-reminder
description: STANDING DUTY every session in this project — check the UDP port-watch log, tell Dean when it has named the port hog, then tell him to uninstall the snapshot task
metadata:
  type: feedback
---

Dean asked (2026-10-28): don't build an in-app alert. Instead, remind him myself any time we work in this project, and tell him when the snapshot task is no longer needed.

**At the start of any session in this project (before the main reply, a one-line check):**
1. Is the task installed? `schtasks /query /tn "ABRP Port Watch"`. If not installed and the culprit isn't named yet → remind him once: run `tools\port-watch\install.ps1`.
2. Read `%APPDATA%\A Better Route Planner\port_watch\port_watch.jsonl`. Lines labelled `event+0s/+20s/+60s` = a real Tcpip 4266 capture (`manual` = a self-test, ignore it).
3. Also check new flights' `summary.settings.udp` (peak / peak_top / exhaustion_events).

**Verdict rule:**
- **Conclusive** = one process (top_names[0]) holds ≥50% of the 16,384 pool at event+0s, and drops by +60s or the sim was closing. One clear capture is enough; two that agree is better.
- **Inconclusive** = no single big holder (e.g. svchost spread, or reserved_udp jumped) → tell Dean "caught one, no clear culprit yet, keep it running". Note: a large `reserved_udp` jump points at Hyper-V/WSL port reservations instead.

**When conclusive:** lead the reply with it — name the process, the port count, and when it happened. Then tell him the task isn't needed anymore and give him `tools\port-watch\uninstall.ps1` to run (Claude is blocked from removing persistence itself... same as install). After he confirms it's removed, update this memory to "done" and drop the duty.

Status 2026-10-28: task NOT installed yet; no log. Related: [[udp-port-exhaustion]].
