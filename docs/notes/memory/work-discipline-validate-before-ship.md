---
name: work-discipline-validate-before-ship
description: "Don't make Dean the test harness — validate each fix in the REAL runtime before shipping; diagnose with data, not theory; don't rapid-fire untested guesses"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
---

Dean (2026-06-29, after ~7 versions chasing the flight app close/reopen + installer prompt):
"Why are we chasing the same issues over and over? Add something to memory that tells you to be
more consistent with clean work."

**Why this kept happening:** I shipped fix after fix that tested green in *my* terminal (PowerShell
7) and failed on Dean's (PowerShell 5.1), each on theory rather than proof — making Dean install,
test, and report back every round. That burns his time, tokens, and trust. Each new release is also
another install he has to run and another chance to hit a side issue.

**How to apply — every time, before shipping a fix:**
1. **Validate in the REAL runtime, not the dev shell.** ABRP spawns Windows PowerShell 5.1 — test
   with `powershell.exe`, never assume the pwsh-7 terminal matches (see [[powershell_51_not_7]]).
2. **Diagnose with DATA first.** The per-app `[FLIGHT]` log cracked the reopen bug after rounds of
   theorizing — read the log/state before proposing a cause. Add logging EARLY, not after it fails.
3. **If I cannot test it myself, say so plainly** and don't call it "fixed." Shutdown/installer
   timing and packaged-app behavior can't be verified from this seat — label those UNVERIFIED and
   don't rapid-fire another guess at them, especially while Dean is mid-test on something else.
4. **Slow down; batch and verify.** Fewer, fully-validated releases beat a rapid string of partial
   ones. Restraint is the fix Dean is asking for — chasing a cosmetic issue (e.g. the installer
   "Retry" prompt, which is harmless) with another untested change is the anti-pattern.
5. **Keep data handling in Node, OS actions in PowerShell** — the architecture that finally made the
   reopen portable and reliable.
6. **Map the WHOLE pipeline + environment up front; instrument BEFORE the first test.** This dragged
   ~7 versions because I fixed one stage at a time and the bug kept moving: PS-5.1 JSON read-back →
   then the elevated-process path-capture → then the multi-instance Radarr dup. Each fix surfaced the
   next. For any OS / process / integration work, trace the entire path (capture → persist → read →
   relaunch) AND the environment that warps it (admin/elevation, PowerShell version, multi-instance
   apps, per-app launch quirks) before writing the fix, and add per-stage logging up front so the
   FIRST failure gives data, not a guess. The "this should be easy" Windows-process tasks almost
   always hide several of these at once — front-load them instead of discovering them serially on
   Dean's machine.
