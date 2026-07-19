---
name: dean_colorblind
description: "Dean is red-green colorblind — chart/UI colors must be CB-safe, pair hue with pattern"
metadata: 
  node_type: memory
  type: user
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
---

Dean said (2026-07-18): "I am a bit color blind" — the VRAM line (purple) and TLOD line (green)
on the frametime chart looked the same to him. Classic red-green color vision.

**Why:** any green-vs-red/orange/purple pairing on charts, pills, or status colors may be
indistinguishable to him.

**How to apply:** when adding chart lines or color-coded UI, never let hue be the only cue — pair
color with a pattern (dashed vs solid), shape, or label. Prefer blue/yellow/magenta/teal separations
over green-vs-red/orange/purple. Fixed in v6.13.12: VRAM line = magenta + dashed vs TLOD solid
green. Ask Dean to confirm any new color pairing looks distinct to him.
