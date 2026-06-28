# MSFS 2024 Performance Logger — Step-by-Step Guide
*Written June 13, 2026*

> ⚠️ **SUPERSEDED (as of June 18, 2026) — kept for history only.**
> This describes the original **manual** workflow (start `record.bat` after you've
> loaded into the cockpit). The tool now has **hands-free auto-start** via
> `record_auto.bat`, which begins recording on its own when the aircraft rolls — so
> the "when exactly do I press record" timing below no longer applies.
> **For the current workflow, see `README.md`.** Don't follow the steps below.

This is your timing-by-timing walkthrough: what to open, and exactly **when**, around
opening and closing the sim. Keep it handy for your first few flights.

---

## The rhythm in one line

> **Close sim → `prep.bat` → open sim → load flight → `record.bat` → fly → `Enter` → done.**

Everything below is just that, spelled out.

---

## Your test plan

The tool walks you through these automatically, one per flight, lowest first:

| # | TLOD | OLOD | | # | TLOD | OLOD |
|---|------|------|---|---|------|------|
| 1 | 80 | 120 | | 5 | 175 | 120 |
| 2 | 100 | 120 | | 6 | 200 | 120 |
| 3 | 125 | 120 | | 7 | 250 | 120 |
| 4 | 150 | 120 | | 8 | 300 | 120 |

OLOD stays at 120 the whole time so TLOD is the only thing changing. Keep your
conditions **demanding** — 3rd-party scenery, live weather, BATC traffic. The exact
airport can vary flight to flight; that's fine, it's real-world data.

---

## Before your very first flight (one-time — already done ✅)

- Python installed ✅
- PresentMon installed ✅
- "Performance Log Users" permission added + rebooted ✅
- VRAM library installed ✅

Nothing to do here again. Listed so you know it's covered.

---

## The walkthrough — every flight, in order

### Step 1 — BEFORE you open the sim *(MSFS must be CLOSED)*
- Double-click **`prep.bat`**.
- It backs up your settings file, sets the next TLOD/OLOD for you, and prints something
  like *"Set TLOD 80 / OLOD 120."*
- Press Enter to close it.
- ⚠️ This only works with MSFS closed. If the sim is open, it'll tell you to close it first
  (the sim would just overwrite the change).

### Step 2 — Open MSFS 2024
- Launch the sim normally. It reads the new TLOD/OLOD as it starts up.

### Step 3 — Set up your flight *(at the main menu / world map)*
- Pick a **high-demand** setup: busy 3rd-party airport, live weather, BATC traffic on.
- ⚠️ **Don't touch the TLOD/OLOD sliders in the graphics menu.** `prep.bat` already set them
  — changing them here would override the test value.

### Step 4 — Click *Ready to Fly* and load into the cockpit
- Wait for it to finish loading. You're sitting in the aircraft, ready to go.

### Step 5 — START recording *(now that you're loaded in)*
- Double-click **`record.bat`**.
- A small black window opens and says **`RECORDING`**. Leave it open.
- *(Starting it here means you capture the flight itself, not the menus or loading.)*

### Step 6 — Fly your flight
- Fly normally — taxi, takeoff, cruise, approach, landing. The window just sits there
  quietly logging. It won't cost you any noticeable performance.

### Step 7 — STOP recording *(after you land and taxi clear)*
- Click the black `record.bat` window, press **`Enter`**.
- It processes the flight and prints your numbers: **P99, stutter %, VRAM peak**. That
  printout is your confirmation it filed correctly.
- Press Enter again to close it.

### Step 8 — Look, then set up the next one
- Open the new flight's **`report.html`** (in `Sessions\<date>\<time_TLOD_OLOD>\`) for that
  flight's graph, or **`Sessions\combined_report.html`** for the across-flights trend.
- Next time you sit down to fly: **close MSFS**, run **`prep.bat`** again (it advances to the
  next TLOD on its own), and repeat from Step 1.

---

## Timing cheat sheet

| Moment | Sim state | What you do |
|--------|-----------|-------------|
| Before flying | **CLOSED** | Double-click `prep.bat` (sets next TLOD) |
| Launch | — | Open MSFS normally |
| Main menu / world map | Open | Pick demanding airport + live weather + BATC. **Don't touch LOD sliders.** |
| Ready to Fly → cockpit | Loading | Wait until you're in the aircraft |
| Loaded in, ready to go | Flying | Double-click `record.bat` → `RECORDING` |
| The whole flight | Flying | Leave the window open, fly normally |
| After landing + taxi | Flying | Click the window → `Enter` → it files the flight |
| Done | — | Open the graphs. Close MSFS before the next `prep.bat`. |

---

## Doing several tests back-to-back in one sitting

`prep.bat` needs the sim closed, so the clean loop is one test per sim session (which fits
normal flying). **But** if you want to test a few TLOD values without restarting MSFS:

- Change TLOD in the **in-sim graphics menu** between flights (Apply). The tool reads your
  setting when you stop recording, so it still logs the correct value — no `prep.bat`
  needed in this case.
- Just remember to actually change it, and to fly a fresh `record.bat` capture for each.

Use whichever fits your mood: `prep.bat` for "just tell me what to fly next," or the in-sim
menu for "I'm doing a few in a row right now."

---

## Tips for good data

- **One flight per TLOD to start** — that maps the rough curve across all 8 settings.
- **Then repeats around the interesting zone** — once we see where smoothness starts
  dropping, fly that area 1–2 more times so real-world variety averages out.
- **Keep it demanding and real** — your varied 3rd-party/live-weather/BATC flying is exactly
  what we want to measure. Don't sanitize it.
- **A flight of ~15+ minutes** gives a solid sample; approach/landing is where the worst
  frames live, so a full flight to a busy field is ideal.

---

## When to check back with me (Claude)

After about **5–8 flights** (a good chunk of the ladder), open a chat, point me at the
`Sessions` folder, and say *"show me how TLOD is affecting my smoothness and VRAM."* I'll
build the curve, find your knee, and we'll decide your TLOD together — then set up the OLOD
sweep.

---

## If something looks off

- No `RECORDING` / an error when you start `record.bat` → check `msfs_perf_logger.log` and
  tell me what it says.
- TLOD/OLOD shows "n/a" in a report → the settings file couldn't be read; let me know.
- Want to undo a settings change → every `prep.bat` run backs up your file into
  `usercfg_backups\` (with a pristine `UserCfg_ORIGINAL.opt`). You can restore any of them.
