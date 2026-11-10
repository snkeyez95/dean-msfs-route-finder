---
name: usercfg-scale-gotchas
description: UserCfg.opt numerals do NOT share one scale — Texture Quality is inverted (lower number = higher quality); read perf/native/gfx_watch.js calibration notes before calling any setting "up" or "down"
metadata:
  type: feedback
---

**Texture Quality is inverted:** UserCfg `{Texture} Quality 2` = in-sim "Medium", `1` = "High" (so 2 → 1 is an INCREASE). On 2026-11-10 I told Dean his textures went DOWN (2→1) when he had raised them Medium→High — the exact backwards-label mistake he warned about before.

**Why:** scales differ per key. Calibrated (in-sim confirmed, see the header comment in perf/native/gfx_watch.js): most Quality enums 1=Medium/2=High/3=Ultra; Particles 1=High; Water FFTSize 512=High; Texture 2=Medium (inverted). Buildings/Trees/others are NOT calibrated — direction unknown.

**How to apply:** before describing any UserCfg change as up/down, check gfx_watch.js labels; for an uncalibrated key, give the raw numbers and say the direction is unverified (or ask Dean). Related: [[dlss-setup-preset-k]].

**Since v6.27.0 (2026-11-10):** the single source of truth is `perf/native/usercfg_schema.js` (Sim Profiles + Settings A/B both read it); each key carries calib = confirmed / inferred / unverified. Dean agreed to send screenshots of every in-sim graphics page so the inferred/unverified ones (buildings, trees, plants, grass, traffic, people, DOF, etc.) get confirmed. When they arrive, update the schema's labels + calib + its CALIBRATION LOG header.
