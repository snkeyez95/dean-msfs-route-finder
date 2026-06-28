# NVIDIA Driver Rollback + Clean Install Guide
*Researched & written June 13, 2026 · RTX 3080 Ti (EVGA FTW) · MSFS 2024*

You're testing **two** drivers to see which is genuinely better for *your* machine. This guide covers
both, plus the clean-install process and the measured comparison.

---

## The two candidates

| | **566.36** (PRIMARY) | **596.49** (BACKUP) |
|---|---|---|
| Released | Dec 5, 2024 | May 12, 2026 |
| Reputation | The "rock-solid" base — last good driver before the troubled 572.xx era; even game devs recommend it | The immediate, well-validated rollback from your problematic 610.47 |
| Bet | Escape the *whole* post-2024 driver era | Undo only the *recent* change (matches your "a month ago" timeline) |
| Cost | ~18 months old — loses newer MSFS-era driver fixes (but you don't use DLSS, so newer DLSS features are irrelevant to you) | Stays current |
| Bonus | Restores the classic NVIDIA Control Panel (App optional) | Also pre-Control-Panel-retirement → Control Panel returns too |

**Plan:** test 566.36 first (deepest trust, one shot). If it doesn't help — or you want the smaller
step — test 596.49. The logger now stamps the driver on every flight, so you can compare cleanly.

### Honest caveats (unchanged — these matter)
- The documented 610.47 bug is **G-Sync frame pacing on 40-series**, not a 30-series VRAM bug. No
  source proves "newer driver = more VRAM on Ampere." So this is a **measured test, not a sure fix.**
- High VRAM *usage* ≠ a problem. Your TLOD 80 flight was 92% VRAM yet smooth (0.28% stutter). MSFS
  caches all the VRAM it can find. Let the numbers — not the forums — decide.

---

## Downloads (grab all of these first)

1. **Driver 566.36** (primary): https://www.nvidia.com/en-us/drivers/details/237752/
2. **Driver 596.49** (backup): https://www.nvidia.com/en-us/drivers/details/270391/
   (mirror: https://www.guru3d.com/download/nvidia-geforce-59649-whql-driver-download/)
3. **DDU (Display Driver Uninstaller)** — official: https://www.wagnardsoft.com/
4. **NVCleanstall** (v1.19.0) — TechPowerUp: https://www.techpowerup.com/download/techpowerup-nvcleanstall/

Older drivers can also be pulled from the TechPowerUp driver archive if NVIDIA's page is fussy.

---

## Step-by-step (same process for either driver)

### A. Before you start
- [ ] Download the driver(s) + DDU + NVCleanstall.
- [ ] Your NVIDIA settings are already backed up (`nvidia_settings_backup\`). Optional extra: export a
      `.nip` in NVIDIA Profile Inspector into that folder.
- [ ] Close MSFS and other apps.

### B. Remove the old driver — DDU in Safe Mode
1. Open DDU → let it reboot you into **Safe Mode**.
2. In Safe Mode: DDU → **GPU → NVIDIA** → **"Clean and restart."**
3. After reboot you're on basic display drivers (low-res screen is normal).
> **Disconnect the internet** before the next step so Windows doesn't auto-install a driver.

### C. Install cleanly — NVCleanstall
1. Launch **NVCleanstall** → **"Use driver files on disk"** → pick your downloaded driver
   (566.36 first). (Or let NVCleanstall download it.)
2. **Components:** keep **Display Driver** only — uncheck NVIDIA App, ShadowPlay/GeForce Experience,
   etc. (566.36 includes the classic Control Panel, so you don't need the App.)
3. **Tweaks / checkboxes (current NVCleanstall options):**
   - ✔ Disable Installer Telemetry & Advertising
   - ✔ Perform Clean Installation
   - ✔ Disable Driver Telemetry (Expert Tweaks)
   - ✔ Disable Multiplane Overlay (MPO)  *(optional — often reduces alt-tab stutter)*
   - ✔ Use method compatible with Easy Anti-Cheat
   - ✔ Auto-accept unsigned driver warning
   - Keep it minimal — don't strip components you don't recognize.
4. Install, then reconnect the internet.

### D. Restore your settings (no reconfiguring)
1. Double-click **`restore_nvidia_settings.bat`** → approve the admin prompt.
2. **Reboot.** Global + MSFS 3D settings/profile come back exactly.
   *(Fallback: import your `.nip` in Profile Inspector if anything looks off.)*

### E. Two quick optimizations worth doing (from the community advice, vetted)
- **Resizable BAR (ReBAR):** first confirm it's enabled in your **motherboard BIOS** ("Above 4G
  Decoding" + "Re-Size BAR" = On). MSFS isn't in NVIDIA's default ReBAR list, so force it on for the
  MSFS profile in **NVIDIA Profile Inspector** (set "rBAR Feature" + "rBAR Options" + "rBAR Size Limit"
  on the FlightSimulator2024 profile). Can lower VRAM pressure / improve throughput on 30-series.
- **Clear shader cache** after the driver change (NVIDIA Control Panel → Manage 3D Settings, or delete
  `%LocalAppData%\NVIDIA\GLCache` and `%LocalAppData%\D3DSCache`).

### F. One-minute glance (things the backup doesn't cover)
Resolution / refresh, **G-SYNC** on/off, **HDR**, digital vibrance, display scaling.

---

## The measured comparison (the whole point)

Your logger now records the **driver version** on every flight, so the three runs are directly
comparable. Keep **TLOD 100 / OLOD 120** for all of them.

| Driver | VRAM peak | P99 | How |
|--------|-----------|-----|-----|
| **610.47** (baseline) | **12,026 MB** | **25.5 ms** | already captured |
| **566.36** | ? | ? | install → fly TLOD 100 → `record.bat` |
| **596.49** | ? | ? | install → fly TLOD 100 → `record.bat` |

Then drop the `Sessions` folder on me (or open `combined_report.html`) and we'll see which driver — if
any — actually gives you VRAM headroom back. If neither moves the needle, the driver's cleared and we
look at an MSFS sim update or a scenery/add-on as the real cause.

---

## Quick reference
- Restore settings: `restore_nvidia_settings.bat`
- Re-run combined graph: `record.bat` with `--combined` (or just ask me)
- Settings backup location: `nvidia_settings_backup\`
