---
name: dlss-setup-preset-k
description: Dean's DLSS setup — sim-shipped DLSS 310.9.16, Preset K forced via DLSS Swapper, on driver 566.36 (RTX 3080 Ti); research verdict on presets
metadata:
  type: project
---

As of 2026-10-27: MSFS 2024 ships nvngx_dlss.dll 310.9.16 (Steam install, dated 2026-10-14). Dean forces **Preset K** via DLSS Swapper (FG preset B irrelevant — he uses FSR frame gen). Driver stays 566.36.

Research verdict (11 sources; only ~3 tie 566.36 to presets): DLSS DLL ships with the game, so an old driver is NOT mismatched; 566.36 just can't use the NVIDIA App override (needs 572.16+), so DLSS Swapper / Profile Inspector is the right path. Preset K = the consensus pick for 30-series. Avoid 4.5 presets M/L: no FP8 on Ampere → 10–24% fps cost + up to ~2× DLSS VRAM, and his VRAM already peaks 95–96%. He's CPU-bound ~97%, so preset choice mostly affects clarity, not smoothness.

**How to apply:** don't recommend M/L or a driver bump for DLSS reasons. A sim update replacing the DLL may drop the Swapper preset — re-check DLSS Swapper after SUs. Related: [[autofps-tlod-band-250-400]], [[process-lasso-si-affinity-fence]].
