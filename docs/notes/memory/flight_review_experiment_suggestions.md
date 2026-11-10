---
name: flight-review-experiment-suggestions
description: "In every \"new flight, do your thing\" review, check for an experiment worth suggesting — but only rarely and methodically, never one per flight just to have one"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
  modified: 2026-11-10T18:40:53.277Z
---

Dean 2026-11-10: in each "new flight, do your thing" review, also consider whether a Sim Profiles experiment is worth trying. If yes, include an ABRP-PROFILE paste block (format in [[sim-profile-experiments]]). Most flights will have nothing to suggest, and that's the expected outcome.

**Why:** he wants a methodical tuning process, not a suggestion attached to every flight. A suggestion made for its own sake erodes trust and muddies the data.

**How to apply:**
- **Never suggest while an experiment is active.** One test at a time. Report its progress instead ("Light shafts Ultra: 2 of 3, no measurable cost so far").
- When a test finishes, give a Keep/Revert recommendation from the verdict.
- A new suggestion needs evidence from the data:
  - GPU headroom (avg GPU busy well under the frame), or
  - a repeated stutter pattern a setting could plausibly fix, or
  - a sim-update / driver drift, or
  - video memory pressure (suggest a VRAM-saving change).
- The suggestion must be one setting, with a one-line why tied to the numbers.
- Prefer ABRP's own proposal list when it matches the evidence.
- When there's nothing worth suggesting, omit the topic entirely. Don't write "no suggestions this time".
