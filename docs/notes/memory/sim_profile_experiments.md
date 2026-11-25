---
name: sim-profile-experiments
description: "How to hand Dean a settings test (v6.37.0: drop an ABRP-PROFILE file in ABRP's inbox; paste is the fallback), the Baseline/Suggested/Experimental model, and how to read his results"
metadata:
  node_type: memory
  type: reference
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
  modified: 2026-11-25T05:03:40.159Z
---

**Model since v6.37.0 (Dean's design, 2026-11-24): three profiles + a "flies next" dot.**
- 🔒 **Baseline:** the frozen known-good (his Aug 27 – Oct 7 setup). It NEVER changes; he uses it as the sanity check after sim/aircraft updates.
- ⭐ **ABRP Suggested:** Baseline + only proven changes. At migration that was Light shafts Ultra + Contact shadows Ultra. He adds each passed test with one click.
- 🧪 **Experimental:** Suggested + the ONE change under test.
- The dot decides what Launch + Capture loads. Judging order: smoothness first, then VRAM headroom (96% AutoFPS hold line). A test passes on free / saves / noeffect; smooth but over the VRAM line = "Costs video-memory headroom", not offered.

**How I hand him a test:** with his OK ("queue it"), write ONE `.txt` file into `%APPDATA%\A Better Route Planner\inbox\`. ABRP imports it on the next page open, app start, or Launch + Capture. It becomes the Experimental test (dot moves) or "up next" if one is running, and the file moves to `inbox\done\` (or `inbox\rejected\` with a reason shown). This is outside the project folder: only write there when he says so. Fallback: a ```text paste block (Sim Profiles → Paste one instead).

Format:
```
ABRP-PROFILE v1
name: Light shafts Ultra
base: ABRP Suggested          (default; "Baseline" also works)
set: Light shafts = Ultra     (in-sim row name or ABRP label or raw id; in-sim words or raw values)
flights: 3                    (test budget, 1-20; default 3)
why: one line — it shows on the test card
```
Parser rules:
- No TLOD/OLOD (AutoFPS owns them) and no display/VR keys.
- Values must exist for that setting, capped at the sim's Ultra preset (Windshield/Glass/Water/Particles top out at High).
- One change per test.

He can paste back `ABRP-EXPERIMENT-RESULTS v1` blocks (Copy results for Claude). Read those instead of asking for screenshots. Only suggest a new test when none is running.

ABRP proposes tests itself (GPU-cost, VRAM-light, one step up from ABRP Suggested) when GPU busy < 60% of the frame. 2026-11-24: ~10.6 of 33.3 ms → next idea Raymarched reflections Ultra.

AutoFPS band: read the latest autofps_trace.json. Nov 2026: IFR 50–200, and the `autofps_cfg` reader is correct. (I wrongly doubted it on 2026-11-24 because of an outdated memory.)

Code: perf/native/profiles.js (parseChangeText / experimentVerdict / baselineCheck / proposeExperiments), profiles_store.js (migrate / flyNext / addTest / dropTest / importInbox / preflight). Tests: tests/test_three_profiles.js. Related: [[usercfg-scale-gotchas]].
