---
name: reset_report_style
description: The logged-data-backed report/analysis style Dean values; a report in this style went to ResetXPDR (AutoFPS) and made Test19 release notes
metadata: 
  node_type: memory
  type: reference
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
---

Dean specifically values the analysis/report STYLE used in the AutoFPS deep-dives: real logged
data pulled from the AutoFPS log + our sidecars, laid out clearly (tables, per-phase / per-time
breakdowns), with concrete numbers and an honest verdict — not hand-waving. A report we wrote in
this style was sent to ResetXPDR (the AutoFPS dev) and **made it into his Test19 release notes**
(Dean: "Nice, we made it into his release notes"). Dean may ask to reference or reproduce that
report/format later.

**How to apply:** when Dean asks for a flight/AutoFPS debrief or an external report, lead with
logged-data tables (TLOD/VRAM/GPU/phase, felt-stutter/hr, deltas vs comparable flights), state the
mechanism from the actual log lines (e.g. the `LTD` VRAM-limited flag, `Pri:FPS`, `DetectPeriodic
spikeCount`), and give a plain verdict. The exact text of the original Reset report lives in the
session history — offer to pull it up if he wants to reference it. See [[feedback_response_style]].
