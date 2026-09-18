---
name: autofps-tlod-band-250-400
description: "Dean's validated AutoFPS TLOD band (min 250 / max 400) and the reasoning behind it — detail where you see it, not at cruise"
metadata: 
  node_type: memory
  type: project
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
  modified: 2026-09-18T19:52:17.829Z
---

Dean's AutoFPS TLOD philosophy, validated 2026-09-18: **high TLOD at cruise is wasted** — at FL430 you
can't resolve terrain detail 8 miles down; TLOD's visible payoff is **low altitude** (taxi / climb /
approach). His own traces proved AutoFPS was doing the opposite by default — on payware GROUND it pinned
TLOD at the 125 floor (VRAM had room, 77–81%), then at CRUISE cranked it to the 800 cap (VRAM redline
95–98%) — spending frame-rate headroom on detail he can't see, because cruise is a light scene with spare
FPS, not because it needs it.

**Fix = narrow the band toward where detail pays:** raise min 125→**250** (low-alt detail floor),
lower max 800→**400** (kill the wasted cruise TLOD and the VRAM redline).

**Validated** (Citation X, LDDU→LTFM, a near-perfect reverse-leg A/B vs the 800-cap LTFM→LDDU flight the
day before): floor held **exactly at 250** (VRAM backstop never fired, even the LDDU payware taxi sat at
250 with VRAM 88%); capped at 400 (71% of the flight at cap); **VRAM peak 89.4% vs 95.6%** on the 800-cap
reverse leg; **P99 17.18 vs 17.22**, 0 periodic both. Net: ~6 points of VRAM cushion back, off the
crash redline, smoothness identical, detail moved to the phases he actually sees it.

Key correction (Dean, confirmed): **min is a SOFT floor** — AutoFPS's VRAM protection can pull TLOD below
min when VRAM goes critical (same override as the cruise sawtooth). So a high min is lower-risk than a hard
floor would be; the heavy-double-payware taxi (KORD/EGLL/KLAX) is the only place to watch it.

Headroom to spare at 89% peak — could nudge max to ~450–500 for a bit more mid-altitude/approach detail and
still stay safe. This flight is also the textbook real-world dataset for the parked "AutoFPS envelope card"
feature. Context: last week's S_OK device-removed crash (1.8.16 sim) is why the VRAM cushion matters.
See [[project_next_steps]].
