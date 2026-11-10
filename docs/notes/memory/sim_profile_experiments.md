---
name: sim-profile-experiments
description: "How to hand Dean a settings change — the ABRP-PROFILE paste format for Sim Profiles → 🧪 Experiments (v6.28.0), and how to read his pasted results"
metadata:
  node_type: memory
  type: reference
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
  modified: 2026-11-10T18:30:03.935Z
---

Since v6.28.0, when I suggest an MSFS graphics change, I give Dean a **paste block** instead of in-sim instructions. He pastes it in Sim Profiles → ＋ New experiment (ABRP also auto-detects it on the clipboard), saves, then applies it with the sim closed. ABRP judges it from his next flights (per-aircraft, ±1σ noise) and shows Keep / Revert.

Format (put it in a ```text block so he can copy it in one go):
```
ABRP-PROFILE v1
name: Light shafts Ultra
base: ABRP Suggested          (or a saved profile's exact name, or "current"; omit = profile his sim matches)
set: Light shafts = Ultra     (in-sim row name or ABRP label or raw id "Graphics/SSR/Quality"; in-sim words or raw values)
flights: 3                    (test budget, 1-20; default 3)
why: one line — it shows on the experiment card
```
Rules the parser enforces: no TLOD/OLOD (AutoFPS owns them), no display/VR keys, values must exist for that setting, caps from the in-sim Ultra preset (Windshield/Glass/Water/Particles top out at High). "Depth of field = Medium" sets on-flag + quality. One change per experiment unless there's a reason (it warns on 2+).

He can paste back **"Copy results for Claude"** blocks starting `ABRP-EXPERIMENT-RESULTS v1` — base vs experiment per metric, "within/BEYOND noise", verdict, notes (AutoFPS range / sim version / traffic differences). Read those instead of asking for screenshots.

ABRP also proposes experiments itself (GPU-cost, VRAM-light, confirmed settings, one step up) when GPU busy < 60% of the frame. As of 2026-11-10: ~11.4 ms of 33.3 ms, so it offers Light shafts / Contact shadows / Raymarched reflections Ultra.

Code: perf/native/profiles.js (parseChangeText / toChangeText / experimentVerdict / proposeExperiments), profiles_store.js (create/finish), usercfg_schema.js (findKey/parseValue). Related: [[usercfg-scale-gotchas]].
