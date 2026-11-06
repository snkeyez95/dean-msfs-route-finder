---
name: airpods-audio-stutter
description: Dean's sim-audio crackles on climb-out happen on Bluetooth AirPods — Bluetooth's tight audio deadlines drop out during CPU spikes; using the AirPods mic (SayIntentions) forces worse HFP mode
metadata:
  type: project
---

**Pattern (2026-10-30 KBOS-KDCA, recurring theme):** Dean heard sim/engine audio stutters on climb-out while frames were flawless (no hitch >90 ms). That window had system CPU 60-84% (flight avg 37%) leaving dense Boston photogrammetry + payware KBOS. NOT AutoFPS's TLOD ramp (identical 50→200 ramp on the LOWW climb that morning stayed at 35-48% CPU, no audio issue). SI voices were fine (fenced to cores 14-15).

**Why AirPods matter:** Bluetooth audio needs small buffers delivered on a strict schedule; a CPU spike makes one late → dropout/crackle, where wired audio rides through. If SayIntentions uses the AirPods MIC, Windows flips them to Hands-Free (HFP) for the whole flight — low quality, least stable. AirPods can't do mic + good A2DP stereo at once.

**How to apply:** when Dean reports audio stutters with clean frames, ask first whether he was on AirPods and which mic SI uses. Fixes in order: wired headset with mic; AirPods output-only + separate USB/webcam mic for SI; free A/B = one climb-out wired. Was first discussed earlier in session 169a96fe and got lost — don't re-derive from scratch. Related: [[process-lasso-si-affinity-fence]].

**Confirmed 2026-10-30:** SI WAS using the AirPods mic on KBOS-KDCA → AirPods in HFP the whole flight. Recommended: separate mic for SI (or wired headset), then re-test a heavy-city climb-out.
