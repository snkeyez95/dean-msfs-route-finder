---
name: model-selection-by-task
description: Proactively recommend a model at planning↔coding↔chatting transitions to balance quality vs token spend
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
---

Dean (2026-07-09) asked me to recommend which model to switch to at task transitions — to work efficiently while limiting token exposure. Default tiers to suggest:
- **Opus 4.8** (`claude-opus-4-8`) — design/planning, debugging from screenshots, weighing tradeoffs, AND careful surgical implementation in the big single-file `index.html` (6000+ lines, guardrails).
- **Sonnet 5** (`claude-sonnet-5`) — well-specified, lower-risk coding (~40% cheaper) or lengthy chatting.
- **Haiku 4.5** (`claude-haiku-4-5`) — simple status / quick Q&A / screenshot glances.
- **Fable 5** (`claude-fable-5`) — reserve for rare gnarly high-stakes architecture (~2× Opus cost).

**The bigger lever (say it):** in long sessions the re-sent conversation is the main token cost, more than model choice — suggest `/clear` between unrelated tasks, `/compact` mid-task. `/fast` on Opus = free speed, not a downgrade.

**Why:** balance work quality/speed against token exposure; Dean cares about both.
**How to apply:** at planning↔coding↔chatting transitions, add a ONE-LINE model nudge (e.g. "heavy implementation next — Opus, or Sonnet to save"). Dean runs `/model` himself; I just flag it. Don't over-do it — a few clear tiers, not a suggestion every message. Relates to [[optimize-code-and-data]].
