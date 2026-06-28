# MSFS 2024 Silent Performance Logger

A tiny tool that quietly records how *smooth* your flights are, stamps your settings
and context onto each run, and files everything into a tidy folder so Claude can look
it over later and help you find your best settings.

**It only measures.** It does not change your graphics settings. If you want something
to tune TLOD/OLOD for you automatically, that's what **AeroTuneMFS** or **AutoFPS** are
for — this tool tells you whether those settings are actually delivering smooth frames.

> Integrating this with another project? See **`2026-06-18-project-definition-outline.md`**
> — the full technical handoff (data schemas, integration seams, current state).

---

## What it captures

- **Frametime smoothness** — the headline. P99, 1%/0.1% lows, stutter count, and how
  consistent your frames are. (Your FPS is capped at 30/60, so the FPS number itself is
  boring — *smoothness* is what your eyes actually feel.)
- **VRAM usage** — average and peak against your 12 GB. On a 12 GB card this is usually
  what decides whether a high TLOD turns into stutters.
- **Flight context, stamped automatically** — TLOD/OLOD, GPU driver version, MSFS sim
  version, aircraft (Fenix/PMDG), and your SimBrief route for the flight.
- **Flight-phase breakdown** — splits your smoothness across Ground / Climb / Cruise /
  Descent (by vertical speed), so if a flight went bad you can see *which phase* it
  happened in.
- **CPU-vs-GPU bound** — saved in the raw data so we can later tell *why* a stutter
  happened (terrain/CPU vs GPU).
- **Spike forensics** — every frametime spike can be classified (CPU-bound, GPU-bound,
  present-stall, or an outside process) from the raw per-frame data, with alt-tab/pause
  gaps filtered out. Flights also log 1 Hz telemetry (altitude, VRAM, system CPU/RAM, and
  the busiest other app) so a stutter can be tied to a flight phase or an external culprit.
  Ask Claude "what caused the spikes on my last flight."

---

## One-time setup

1. **Python 3.9+** — install from <https://www.python.org/downloads/> and tick
   *"Add Python to PATH"* during install.
2. **PresentMon** — the free Intel engine that does the frame capture. Easiest install:
   ```
   winget install Intel.PresentMon.Console
   ```
   (Or let the tool auto-download it on first run, or grab `PresentMon-x64.exe` from
   <https://github.com/GameTechDev/PresentMon/releases> and drop it in this folder.)
3. **Capture permission (one-time)** — Windows frame-tracing needs elevated rights.
   Rather than run as admin every time, add your account to the "Performance Log Users"
   group **once**. Open Command Prompt **as administrator** and run (replace `USERNAME`
   with your Windows username):
   ```
   net localgroup "Performance Log Users" USERNAME /add
   ```
   Then **log out and back in**. After that the launchers work with a normal
   double-click — no admin prompt.
4. **VRAM capture** — open a command prompt in this folder and run once:
   ```
   pip install nvidia-ml-py
   ```
   (Skip this and everything still works, just without VRAM numbers.)
5. **Auto-start (optional but recommended)** — for hands-free recording:
   ```
   pip install SimConnect
   ```
   (Skip this and the tool falls back to manual start.)
6. **System telemetry (optional)** — to record what *other* processes were doing during a
   flight (for spike forensics):
   ```
   pip install psutil
   ```
   (Skip this and flights still log altitude/VRAM/phase telemetry, just without the
   system-CPU/RAM and top-process columns.)

---

## How to use it

There are two ways to record. Pick whichever fits.

### Option A — Auto (hands-free) ⭐ recommended

1. **Double-click `record_auto.bat`** any time — before or during your flight. It opens
   minimized and waits quietly.
2. **Fly.** It watches via SimConnect and **starts recording on its own** the moment the
   aircraft is actually rolling (so it skips menus, loading, and GSX repositioning).
   *(If it doesn't trigger for some reason, click its taskbar window and press Enter to
   start manually.)*
3. **Stop:** just close MSFS, or press Enter in its window. It files the session
   automatically — including trimming the post-landing/shutdown junk off the end.

That's it. Set it and forget it.

### Option B — Manual

1. **Launch MSFS 2024** and get into your flight, loaded in the cockpit.
2. **Double-click `record.bat`.** A small window says `RECORDING`.
3. **Fly.**
4. **Press Enter** in that window when you're done (or quit MSFS, which also stops it).

Either way, it files the session and prints your headline numbers. Open the `report.html`
it points to for that flight's graph.

### Option C — Clean test flight (closes background apps first)

For a flight where you want the smoothness data uncontaminated by background apps (a
downloader, a media server, etc. stealing CPU), use **`record_clean.bat`** instead of
`record_auto.bat`:

1. **Double-click `record_clean.bat`.** It sets the flight's TLOD, force-closes the apps
   listed at the top of the file, then starts the same auto-logger. (It runs minimized.)
2. **Fly.**
3. **Close the sim when done.** That's the trigger — it files the flight and **relaunches
   those apps automatically**, so you don't have to remember to bring them back.

To change which apps it closes, open `record_clean.bat` and edit the one `TARGETS` line near
the top (process names, no `.exe`, comma-separated). Their install locations are figured out
automatically, so you only ever type the name. Not sure of an app's exact process name?
Double-click **`list_running_apps.bat`** (in `tools\`) to see everything that's running.

If that window ever gets killed mid-flight and leaves your apps closed, double-click
**`tools\restore_apps.bat`** to bring them back.

**Hands-free with ABRP Quick Launch:** because `record_clean.bat` runs minimized and reopens
your apps on sim-close, you can point ABRP's companion-apps "Quick Launch" at it (replace the
`record_auto.bat` entry with `record_clean.bat`). One Quick Launch then opens MSFS, closes your
background apps, records the flight, and reopens them when you close the sim — no extra clicks.

> Tip: change your TLOD/OLOD between flights so each session tests a different value.
> That's how we build up a picture of what TLOD does to your smoothness.

---

## Auto-stepping through a test plan (optional)

Instead of changing TLOD/OLOD by hand, let the tool walk you through a plan:

1. **With MSFS fully closed**, double-click **`prep.bat`**.
2. It looks at what you've already flown, picks the next setting from `test_plan.json`,
   **backs up your `UserCfg.opt`** (into `usercfg_backups\`), writes the new TLOD/OLOD,
   and tells you what it set.
3. **Launch MSFS, fly your standard test flight, then capture** (`record_auto.bat` or
   `record.bat`).
4. Next time you run `prep.bat`, it advances to the next setting automatically.

The default plan sweeps **TLOD 80 → 100 → 125 → 150 → 175 → 200 → 250 → 300 at a fixed
OLOD of 120** (find the knee first). Edit `test_plan.json` to add finer steps or an OLOD
sweep — or just ask Claude to update it after reviewing your results. When every combo is
flown, `prep.bat` says so.

Two rules it enforces for you: it won't write while MSFS is running (the sim would
overwrite it), and it backs up your config every single time, so you can always restore an
earlier `UserCfg.opt` from `usercfg_backups\`.

> Note: you can also just change TLOD in the **in-sim graphics menu** between flights —
> the tool reads your actual setting at capture time, so it always logs the right value.
> `prep.bat` is only for "tell me what to fly next."

---

## Where your data goes

```
Sessions\
  index.json              <- master list (this is what Claude reads first)
  index.csv               <- same thing, easy to glance at in Excel
  combined_report.html    <- interactive dashboard across ALL flights (auto-rebuilt)
  2026-06-18\
    1328_TLOD150_OLOD120\
      frametimes.csv       <- raw frame data
      summary.json         <- the numbers + your settings + phases, for Claude
      report.html          <- this flight's graph (cards, frametime line, phase chart)
```

Each flight gets its own folder, named with the date, time, and the TLOD/OLOD it was
flown at — so you can see at a glance what's what.

**Two reports, automatically:**
- `report.html` in each flight's folder — that single flight's smoothness picture,
  including the Ground / Low / High phase breakdown.
- `combined_report.html` in the `Sessions` folder — refreshed after every flight. An
  interactive dashboard: average P99 smoothness by TLOD, with a Fenix-vs-PMDG toggle and
  a filterable table of every flight you can click through to. (Needs a few flights at
  different TLOD values to be useful.)

**Rebuild reports any time:**
- `python msfs_perf_logger.py --combined` — rebuild the combined dashboard.
- `python msfs_perf_logger.py --rebuild-session 2026-06-18_1328` — rebuild one flight's
  report (use the session id from `index.json`). Also upgrades older reports to the new
  zoomable chart.
- …or just ask Claude.

**Diagnose frametime spikes:**
- `python msfs_perf_logger.py --spike-report 2026-06-18_1328` — find the real stutters in a
  flight, separate them from alt-tab/pause gaps, and classify each one (CPU-bound, GPU-bound,
  present-stall, or an outside process). Works on every logged flight; flights from 2026-06-22
  on also show the flight phase, altitude, VRAM, and which other app was busy. Or just ask
  Claude "what caused the spikes on my last flight" — the analysis skill runs this for you.

The per-flight `report.html` frametime graph is **zoomable** — scroll to zoom into a section,
drag to pan, double-click to reset. Flights with telemetry also show a faint altitude line so
you can see what phase a spike happened in.

---

## Working with Claude

After you've flown a handful of sessions:

> Open a Claude session, point it at this `Sessions` folder, and say
> *"look at my flights and show me how TLOD affects smoothness and VRAM."*

Claude reads `index.json` plus the per-session summaries, builds the
smoothness-and-VRAM-vs-TLOD picture across all your flights, and helps you settle on the
TLOD/OLOD that stays smooth without running you out of VRAM. The more you fly, the better
that picture gets.

---

## Good to know

- After the one-time "Performance Log Users" step, no admin prompt per capture.
- Nothing is sent anywhere — it all stays in this folder on your PC. (The one exception:
  it fetches your latest SimBrief route over the internet to label the flight.)
- It won't crash mid-flight; if something looks off, check `msfs_perf_logger.log`.
- Auto-start needs the `SimConnect` package; without it, use `record.bat` (manual).
- **Heads-up on storage:** the raw `frametimes.csv` files are large (50–120 MB each) and
  add up fast. We're keeping full detail for now; when the folder gets heavy we'll add a
  command to summarize/shrink the old ones. Your summaries and reports stay tiny either way.
