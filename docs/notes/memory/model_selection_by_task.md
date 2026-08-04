---
name: model-selection-by-task
description: Proactively recommend a model at planning↔coding↔chatting transitions to balance quality vs token spend
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
  modified: 2026-08-04T17:49:56.515Z
---

Dean (2026-07-09) asked me to recommend which model to switch to at task transitions — to work efficiently while limiting token exposure. Default tiers to suggest:
- **Opus 4.8** (`claude-opus-4-8`) — design/planning, debugging from screenshots, weighing tradeoffs, AND careful surgical implementation in the big single-file `index.html` (6000+ lines, guardrails).
- **Sonnet 5** (`claude-sonnet-5`) — well-specified, lower-risk coding (~40% cheaper) or lengthy chatting.
- **Haiku 4.5** (`claude-haiku-4-5`) — simple status / quick Q&A / screenshot glances.
- **Fable 5** (`claude-fable-5`) — reserve for rare gnarly high-stakes architecture (~2× Opus cost).

**The bigger lever (say it):** in long sessions the re-sent conversation is the main token cost, more than model choice — suggest `/clear` between unrelated tasks, `/compact` mid-task. `/fast` on Opus = free speed, not a downgrade.

**STANDING RULE (Dean 2026-08-04): before EXECUTING a task, proactively state the best model for it.** Dean made this a rule to minimize token spend while still getting strong output. So when a request lands that means real work (not a quick chat/lookup), open with a ONE-LINE model recommendation for that specific job before diving in — e.g. "This is a surgical `index.html` edit + tests → Opus is right, staying on it" or "This is well-specified mechanical work → Sonnet would do it ~40% cheaper." Recommend even when the current model is already correct (say "Opus is the right call here, no change needed") so Dean gets the signal every time. Don't wait for a planning↔coding transition — flag it up front on any substantive request. Keep it to one line; don't nag on trivial turns.

**Plan mode + model switching (facts, verified 2026-08-04):** a `/model` switch in Claude Code takes effect on the NEXT turn — it does NOT change the model mid-generation. So a plan being written by one model finishes on that model; the switch applies to the next turn. Practical workflow for "plan with Fable, execute with Opus": let Fable finish the plan, then type `/model claude-opus-4-8` at the approval prompt, THEN accept — the execution runs on the next turn under Opus. There's no button in the accept dialog to pick a model; the `/model` command IS the way, and it works before accepting. (Not officially documented as a workflow, but that's the mechanism.)

**Why:** balance work quality/speed against token exposure; Dean cares about both.
**How to apply:** the up-front one-line recommendation above is now the default on substantive requests. Dean runs `/model` himself; I just flag it. A few clear tiers, not a suggestion every message. Relates to [[optimize-code-and-data]].
