---
name: dlss-setup-preset-k
description: Dean's DLSS setup — sim-shipped DLSS 310.9.16, Preset K forced via DLSS Swapper, on driver 566.36 (RTX 3080 Ti); research verdict on presets
metadata:
  type: project
---

As of 2026-10-27: MSFS 2024 ships nvngx_dlss.dll 310.9.16 (Steam install, dated 2026-10-14). Dean forces **Preset K** via DLSS Swapper (FG preset B irrelevant — he uses FSR frame gen). Driver stays 566.36.

Research verdict (11 sources; only ~3 tie 566.36 to presets): DLSS DLL ships with the game, so an old driver is NOT mismatched; 566.36 just can't use the NVIDIA App override (needs 572.16+), so DLSS Swapper / Profile Inspector is the right path. Preset K = the consensus pick for 30-series. Avoid 4.5 presets M/L: no FP8 on Ampere → 10–24% fps cost + up to ~2× DLSS VRAM, and his VRAM already peaks 95–96%. He's CPU-bound ~97%, so preset choice mostly affects clarity, not smoothness.

**How to apply:** don't recommend M/L or a driver bump for DLSS reasons. A sim update replacing the DLL may drop the Swapper preset — re-check DLSS Swapper after SUs. Related: [[autofps-tlod-band-250-400]], [[process-lasso-si-affinity-fence]].

**2026-10-29 DECISION: Dean went back to TAA and is staying there.** DLSS Quality (11 flights, 10-13→10-27) felt worse to him even with the glass-cockpit fix; the visual gain wasn't worth it. Don't suggest DLSS again unless he asks. Mod cleanup: RHI (mod manager, %LOCALAPPDATA%\RHI) installed ReShade 6.8 as dxgi.dll in the MSFS folder (2026-10-13); two ReShade add-ons dropped in by hand: glass-cockpit-dlss-fix.addon64 (DLSS-era, removing) and msfs2024-camera-fx-off.addon64 (sun flare/bloom off, keep-or-not = Dean's call; it needs ReShade). Also: AutoFPS's in-flight OLOD changes get saved into UserCfg.opt when the sim exits, so the Settings A/B snapshot can show AutoFPS leftovers as "changes" (OLOD 120→84 on 10-29 was AutoFPS, not Dean).

**2026-10-29 CLEANUP DONE:** ReShade + both add-ons out of the MSFS folder (backup: Desktop\MSFS_ReShade_removed_2026-10-29, deletable after a good flight); RHI uninstalled via Revo — Program Files\RHI, LocalAppData\RHI, startup/tasks all verified gone. MSFS is fully vanilla TAA again.
