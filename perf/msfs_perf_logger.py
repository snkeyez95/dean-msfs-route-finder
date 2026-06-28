#!/usr/bin/env python3
"""
MSFS 2024 Silent Performance Logger
===================================

A tiny, dumb-but-reliable capture tool. It silently records frametime data while
you fly MSFS 2024 (using Intel's free PresentMon engine), samples VRAM usage,
stamps your current TLOD/OLOD settings onto the run, and files everything into a
tidy per-session folder that Claude can read and analyze later.

It does NOT tune anything. It only measures and files. Analysis + visuals across
flights are done by Claude in a later session by reading the Sessions folder.

Usage:
    Double-click run via record.bat, or:  python msfs_perf_logger.py
    Fly. When done, press Enter in the window to stop and file the run.

    Auto-start mode (record_auto.bat / python msfs_perf_logger.py --auto):
    waits for SimConnect to report the parking brake released and the
    aircraft actually rolling (debounced a few seconds, so it ignores the
    brake sim-var's unreliable state at spawn). Recording then starts on its
    own - no need to press Enter. Stop is unchanged: closing the sim, or
    pressing Enter, both still file the session. This avoids needing a
    brake-based stop trigger too, since real flights end inconsistently
    (sometimes quit right after the runway, sometimes taxi all the way in).

Dependencies:
    - PresentMon-x64.exe  (free Intel binary; auto-downloaded or dropped in folder)
    - pip install nvidia-ml-py    (optional, for VRAM sampling)
    - pip install SimConnect      (optional, only needed for --auto mode)
    - Python 3.9+

Captures: frametime (smoothness-focused), VRAM usage, FPS (context only), and the
raw PresentMon CPU/GPU-bound columns (kept in frametimes.csv for deeper analysis).
"""

import csv
import html
import json
import logging
import math
import os
import re
import shutil
import signal
import statistics
import subprocess
import sys
import threading
import time
from datetime import datetime

# --------------------------------------------------------------------------- #
# Paths and constants
# --------------------------------------------------------------------------- #

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# ABRP integration (behavior-neutral): SCRIPT_DIR is the ASSET dir (this script, PresentMon,
# bundled defaults — read-only when frozen). DATA_ROOT is the WRITABLE data home (Sessions,
# logs, backups, transient state). It defaults to SCRIPT_DIR, so running standalone is identical
# to before; ABRP sets MSFS_PERF_ROOT to point data at its user-data folder.
DATA_ROOT = os.environ.get("MSFS_PERF_ROOT") or SCRIPT_DIR
SESSIONS_DIR = os.path.join(DATA_ROOT, "Sessions")
LOG_FILE = os.path.join(DATA_ROOT, "msfs_perf_logger.log")

# MSFS 2024 process to watch.
TARGET_PROCESS = "FlightSimulator2024.exe"

# UserCfg.opt location (env vars expanded at runtime).
USERCFG_PATH = os.path.expandvars(
    r"%APPDATA%\Microsoft Flight Simulator 2024\UserCfg.opt"
)

# Smoothness thresholds (effective 60fps target via FSR3 frame-gen).
TARGET_FRAMETIME_MS = 16.67           # 60 fps effective
STUTTER_FRAMETIME_MS = TARGET_FRAMETIME_MS * 2.0   # 33.3 ms -> a stutter
SPIKE_FRAMETIME_MS = 50.0             # a hard hitch
CONSISTENCY_BAND = 0.20               # +/-20% of median = "consistent"

# Reject obviously-invalid frametimes.
MIN_VALID_MS = 0.0
MAX_VALID_MS = 1000.0

# Tail-trim: keep this many seconds past last detected movement before trimming.
STOP_BUFFER_S   = 30
# Tail-trim fallback: blind trim when no SimConnect movement data is available.
TAIL_FALLBACK_S = 60
# Tail-trim: always clip at least this many seconds to catch sim-shutdown frames.
MIN_TAIL_TRIM_S = 5
# Head-trim: drop this many seconds from the start to clear PresentMon init artifacts.
HEAD_TRIM_S = 5

# SimBrief: username for auto-fetching route after each flight.
SIMBRIEF_USERNAME = "snkeyez95"

# Coverage goal: aim for an even spread of flights across aircraft x TLOD so a final
# TLOD recommendation is trustworthy. Drives the dashboard "fly next" panel and the
# SimBrief-driven auto-prep. Floor is TLOD 100 (80 is visually safe, not worth testing).
COVERAGE_TARGET_PER_CELL = 3
COVERAGE_TLODS = [100, 125, 150, 175]
COVERAGE_AIRCRAFT = ["Fenix", "PMDG"]

# Aircraft labeled anything outside COVERAGE_AIRCRAFT are "reference" flights: we still log and
# report them per-flight, but they're kept out of the baseline analysis (combined trend, knee,
# coverage goal). The Citation Sovereign+ is the first such reference aircraft.
CITATION_LABEL = "Citation Sovereign+"


def is_primary_aircraft(ac):
    """True for the aircraft that drive the baseline TLOD goal (Fenix / PMDG)."""
    return ac in COVERAGE_AIRCRAFT

# Candidate column names across PresentMon versions (we match the first present).
FRAMETIME_COLUMNS = ["MsBetweenPresents", "msBetweenPresents", "FrameTime",
                     "ms_between_presents", "MsBetweenDisplayChange"]
CPUBUSY_COLUMNS = ["MsCPUBusy", "CPUBusy", "msCPUBusy"]
GPUBUSY_COLUMNS = ["MsGPUBusy", "GPUBusy", "msGPUBusy"]
# Extra PresentMon 2.x columns used by spike forensics (--spike-report). Optional:
# any missing column is treated as absent, never fatal.
TIME_COLUMNS = ["TimeInMs", "TimeInSeconds"]            # per-frame timestamp (see _TIME_IS_SECONDS)
CPUWAIT_COLUMNS = ["MsCPUWait", "CPUWait"]
GPUWAIT_COLUMNS = ["MsGPUWait", "GPUWait"]
GPULATENCY_COLUMNS = ["MsGPULatency", "GPULatency"]
GPUTIME_COLUMNS = ["MsGPUTime", "GPUTime"]
RENDERLATENCY_COLUMNS = ["MsRenderPresentLatency", "MsUntilDisplayed", "RenderPresentLatency"]
ANIMERROR_COLUMNS = ["MsAnimationError", "AnimationError"]
PRESENTMODE_COLUMNS = ["PresentMode"]

# A "frametime" larger than this isn't a stutter — it's the sim not presenting at all
# (alt-tab, pause, loading screen, menu, shutdown). PresentMon records the whole gap as
# one giant MsBetweenPresents. The spike forensics reports these as non-render gaps and
# excludes them from stutter culprit analysis. (Validated on real data: a single 765s and
# ~12 near-identical 27s "frames" were alt-tab gaps, not stutters.)
GAP_CEILING_MS = 2000.0

# PresentMon executable: accept any of these names in the script folder.
PRESENTMON_NAMES = ["PresentMon-x64.exe", "PresentMon.exe", "presentmon.exe"]
PRESENTMON_RELEASES_API = "https://api.github.com/repos/GameTechDev/PresentMon/releases/latest"


# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #

def _cap_log_file(path, max_bytes=512_000, keep_lines=4000):
    """Keep the log readable: if it has grown past max_bytes, rewrite it with
    only its most recent keep_lines. Runs once at startup, before the file is
    opened for appending. Best-effort — never blocks startup on failure."""
    try:
        if os.path.isfile(path) and os.path.getsize(path) > max_bytes:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                tail = fh.readlines()[-keep_lines:]
            with open(path, "w", encoding="utf-8") as fh:
                fh.writelines(tail)
    except Exception:  # noqa: BLE001 - housekeeping must never break logging
        pass


_cap_log_file(LOG_FILE)

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
)


def say(msg):
    """Print to console AND log it."""
    print(msg)
    logging.info(msg)


# --------------------------------------------------------------------------- #
# PresentMon discovery
# --------------------------------------------------------------------------- #

def find_presentmon():
    """Return the path to a PresentMon exe in the script folder, or None."""
    for name in PRESENTMON_NAMES:
        candidate = os.path.join(SCRIPT_DIR, name)
        if os.path.isfile(candidate):
            return candidate
    # Also accept a versioned name like PresentMon-2.3.1-x64.exe.
    try:
        for f in os.listdir(SCRIPT_DIR):
            low = f.lower()
            if low.startswith("presentmon") and low.endswith(".exe"):
                return os.path.join(SCRIPT_DIR, f)
    except OSError:
        pass
    # Finally, accept a PATH install (e.g. via `winget install
    # Intel.PresentMon.Console`, which registers a `presentmon` command).
    for cmd in ("presentmon", "PresentMon-x64", "PresentMon"):
        found = shutil.which(cmd)
        if found:
            return found
    return None


def try_download_presentmon():
    """Best-effort download of the latest PresentMon console exe from GitHub."""
    try:
        import urllib.request

        say("PresentMon not found - attempting to download the latest release...")
        req = urllib.request.Request(
            PRESENTMON_RELEASES_API, headers={"User-Agent": "msfs-perf-logger"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)

        asset_url = None
        asset_name = None
        for asset in data.get("assets", []):
            name = asset.get("name", "")
            low = name.lower()
            # Prefer the console x64 exe.
            if low.endswith(".exe") and "x64" in low and "present" in low:
                asset_url = asset.get("browser_download_url")
                asset_name = name
                break
        if not asset_url:
            for asset in data.get("assets", []):
                name = asset.get("name", "")
                if name.lower().endswith(".exe") and "present" in name.lower():
                    asset_url = asset.get("browser_download_url")
                    asset_name = name
                    break

        if not asset_url:
            say("Could not find a PresentMon .exe in the latest release assets.")
            return None

        dest = os.path.join(SCRIPT_DIR, "PresentMon-x64.exe")
        say(f"Downloading {asset_name} ...")
        req2 = urllib.request.Request(
            asset_url, headers={"User-Agent": "msfs-perf-logger"}
        )
        with urllib.request.urlopen(req2, timeout=60) as resp, open(dest, "wb") as out:
            shutil.copyfileobj(resp, out)
        say("PresentMon downloaded.")
        return dest
    except Exception as exc:  # noqa: BLE001 - never crash on download
        logging.warning("PresentMon download failed: %s", exc)
        say(f"Automatic download failed ({exc}).")
        return None


def ensure_presentmon():
    """Locate PresentMon, downloading if needed. Exit with guidance if absent."""
    pm = find_presentmon()
    if pm:
        return pm
    pm = try_download_presentmon()
    if pm:
        return pm
    say("")
    say("  PresentMon-x64.exe is required and could not be obtained automatically.")
    say("  Please download it from:")
    say("     https://github.com/GameTechDev/PresentMon/releases")
    say(f"  and place PresentMon-x64.exe next to this script:")
    say(f"     {SCRIPT_DIR}")
    say("")
    return None


# --------------------------------------------------------------------------- #
# UserCfg.opt parsing (the settings stamp)
# --------------------------------------------------------------------------- #

def _search_float(text, pattern):
    m = re.search(pattern, text, re.IGNORECASE)
    if not m:
        return None
    try:
        return float(m.group(1))
    except (ValueError, IndexError):
        return None


def read_settings():
    """Read TLOD/OLOD and related settings from UserCfg.opt. Never raises."""
    settings = {
        "tlod": None,
        "olod": None,
        "upscaling": None,       # active AA/upscaler, e.g. "TAA", "FSR Balanced"
        "frame_gen": None,       # frame-gen method, e.g. "FSR FG", "off"
        "target_fps": None,
        "fg_multiplier": None,
        "texture_quality": None,
        "usercfg_found": False,
    }
    try:
        if not os.path.isfile(USERCFG_PATH):
            logging.warning("UserCfg.opt not found at %s", USERCFG_PATH)
            return settings
        with open(USERCFG_PATH, "r", encoding="utf-8", errors="ignore") as fh:
            text = fh.read()
        settings["usercfg_found"] = True

        # MSFS 2024 stores TLOD/OLOD as LoDFactor inside named blocks, and keeps
        # a separate {GraphicsVR} copy. Scope to the flat {Graphics} section so we
        # read the desktop values (TLOD = {Terrain}, OLOD = {ObjectsLoD}), not VR.
        gfx = text
        m_gfx = re.search(r"\{Graphics(?!VR)", text, re.IGNORECASE)
        if m_gfx:
            start = m_gfx.end()
            m_vr = re.search(r"\{GraphicsVR", text, re.IGNORECASE)
            end = m_vr.start() if (m_vr and m_vr.start() > start) else len(text)
            gfx = text[start:end]

        m_tlod = re.search(r"\{Terrain\b.*?LoDFactor\s+([0-9.]+)", gfx,
                           re.IGNORECASE | re.DOTALL)
        if m_tlod:
            settings["tlod"] = round(float(m_tlod.group(1)) * 100)

        m_olod = re.search(r"\{ObjectsLoD\b.*?LoDFactor\s+([0-9.]+)", gfx,
                           re.IGNORECASE | re.DOTALL)
        if m_olod:
            settings["olod"] = round(float(m_olod.group(1)) * 100)

        # Upscaler/AA: the ACTIVE method is AntiAliasing. FSRMode/DLSSMode are
        # only the stored quality presets for when those methods are selected, so
        # report them only when AntiAliasing actually points at them. These live
        # outside the {Graphics} LOD block; the VR twins have a "VR" suffix with
        # no space, so "<name>\s+" matches the flat (non-VR) value first.
        aa = re.search(r"AntiAliasing\s+(\w+)", text, re.IGNORECASE)
        if aa:
            method = aa.group(1).upper()
            upscaling = method
            if method.startswith("FSR"):
                mode = re.search(r"FSRMode\s+(\w+)", text, re.IGNORECASE)
                if mode:
                    upscaling = f"FSR {mode.group(1).title()}"
            elif method in ("DLSS", "DLAA"):
                mode = re.search(r"DLSSMode\s+(\w+)", text, re.IGNORECASE)
                if mode:
                    upscaling = f"{method} {mode.group(1).title()}"
            settings["upscaling"] = upscaling

        # Frame generation method (separate from the upscaler).
        fg = re.search(r"FrameGeneration\s+(\w+)", text, re.IGNORECASE)
        if fg:
            settings["frame_gen"] = {
                "FSRFG": "FSR FG", "DLSSFG": "DLSS FG",
                "NONE": "off", "OFF": "off",
            }.get(fg.group(1).upper(), fg.group(1))

        tfps = _search_float(text, r"TargetFrameRate\s+([0-9.]+)")
        if tfps is not None:
            settings["target_fps"] = int(tfps)

        nbf = _search_float(text, r"NBFramesToGenerate\s+([0-9.]+)")
        if nbf is not None:
            settings["fg_multiplier"] = int(nbf) + 1

        # NOTE: Texture Resolution is intentionally NOT parsed. The {Texture}
        # block in UserCfg.opt holds many unlabelled "Quality N" entries (one per
        # advanced setting), so picking the right one by position is unreliable -
        # it mis-read Medium as High in testing. Left as None rather than guess.
    except Exception as exc:  # noqa: BLE001
        logging.warning("Failed to read UserCfg.opt: %s", exc)
    return settings


# --------------------------------------------------------------------------- #
# Test-plan automation: write the next TLOD/OLOD into UserCfg.opt
# --------------------------------------------------------------------------- #

TEST_PLAN_PATH = os.path.join(DATA_ROOT, "test_plan.json")
BACKUP_DIR = os.path.join(DATA_ROOT, "usercfg_backups")

# Coarse TLOD sweep at fixed OLOD - find the smoothness/VRAM knee first.
# Refine + OLOD sweep get appended after reviewing results with Claude.
DEFAULT_TEST_PLAN = {
    "philosophy": (
        "Start low and ramp up. Fine TLOD steps where the sweet spot lives "
        "(80-200), then bigger jumps (250, 300) to find the ceiling. OLOD held "
        "at 120 (Dean's normal) so TLOD is the only variable. First lap: one "
        "flight per TLOD; then repeats around the knee, then an OLOD sweep "
        "(Claude adds those after reviewing results)."
    ),
    "conditions": ("Keep conditions consistently demanding: 3rd-party scenery, "
                   "live weather, BATC traffic. Exact airport can vary - fly a "
                   "couple at each TLOD so variety averages out."),
    "olod_fixed": 120,
    "combos": [
        {"tlod": 80, "olod": 120},
        {"tlod": 100, "olod": 120},
        {"tlod": 125, "olod": 120},
        {"tlod": 150, "olod": 120},
        {"tlod": 175, "olod": 120},
        {"tlod": 200, "olod": 120},
        {"tlod": 250, "olod": 120},
        {"tlod": 300, "olod": 120},
    ],
}


def load_test_plan():
    """Load test_plan.json, creating it with defaults on first run."""
    if not os.path.isfile(TEST_PLAN_PATH):
        try:
            with open(TEST_PLAN_PATH, "w", encoding="utf-8") as fh:
                json.dump(DEFAULT_TEST_PLAN, fh, indent=2)
            say(f"  Created default test plan: {TEST_PLAN_PATH}")
        except Exception as exc:  # noqa: BLE001
            logging.warning("Could not write default test plan: %s", exc)
            return DEFAULT_TEST_PLAN
    try:
        with open(TEST_PLAN_PATH, "r", encoding="utf-8") as fh:
            plan = json.load(fh)
        if "combos" not in plan or not plan["combos"]:
            return DEFAULT_TEST_PLAN
        return plan
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not read test plan, using default: %s", exc)
        return DEFAULT_TEST_PLAN


def _tested_combos():
    """Return the set of (tlod, olod) pairs already captured."""
    tested = set()
    index_json = os.path.join(SESSIONS_DIR, "index.json")
    if not os.path.isfile(index_json):
        return tested
    try:
        with open(index_json, "r", encoding="utf-8") as fh:
            for s in json.load(fh).get("sessions", []):
                if s.get("tlod") is not None and s.get("olod") is not None:
                    tested.add((s["tlod"], s["olod"]))
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not read tested combos: %s", exc)
    return tested


def next_untested_combo(plan, tested):
    """First combo in the plan that hasn't been captured yet, or None."""
    for combo in plan["combos"]:
        if (combo["tlod"], combo["olod"]) not in tested:
            return combo
    return None


def is_sim_running():
    """True if FlightSimulator2024.exe is currently running."""
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {TARGET_PROCESS}"],
            capture_output=True, text=True, timeout=10,
        )
        return TARGET_PROCESS.lower() in out.stdout.lower()
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not check if sim is running: %s", exc)
        return False  # don't block on an unknown


def backup_usercfg():
    """Copy UserCfg.opt into usercfg_backups with a timestamp. Returns path."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    dest = os.path.join(BACKUP_DIR, f"UserCfg_{stamp}.opt")
    shutil.copyfile(USERCFG_PATH, dest)
    # Keep a pristine first-ever copy too.
    original = os.path.join(BACKUP_DIR, "UserCfg_ORIGINAL.opt")
    if not os.path.isfile(original):
        shutil.copyfile(USERCFG_PATH, original)
    return dest


def write_settings(tlod, olod):
    """Surgically set TLOD/OLOD in the flat {Graphics} block of UserCfg.opt.

    Only the two LoDFactor numbers change; the {GraphicsVR} block and everything
    else are left untouched. Returns (ok, message).
    """
    # Sanity clamp - MSFS LOD sliders live roughly in this range.
    tlod = max(10, min(int(tlod), 400))
    olod = max(10, min(int(olod), 400))

    if not os.path.isfile(USERCFG_PATH):
        return False, f"UserCfg.opt not found at {USERCFG_PATH}"

    try:
        with open(USERCFG_PATH, "r", encoding="utf-8", errors="ignore") as fh:
            text = fh.read()
    except Exception as exc:  # noqa: BLE001
        return False, f"Could not read UserCfg.opt: {exc}"

    # Scope to the flat {Graphics} section (not {GraphicsVR}).
    m_gfx = re.search(r"\{Graphics(?!VR)", text, re.IGNORECASE)
    if not m_gfx:
        return False, "Could not find the {Graphics} block in UserCfg.opt"
    start = m_gfx.end()
    m_vr = re.search(r"\{GraphicsVR", text, re.IGNORECASE)
    end = m_vr.start() if (m_vr and m_vr.start() > start) else len(text)
    head, gfx, tail = text[:start], text[start:end], text[end:]

    def replace_in_block(block_text, block_name, value):
        pat = re.compile(r"(\{" + block_name + r"\b.*?LoDFactor\s+)([0-9.]+)",
                         re.IGNORECASE | re.DOTALL)
        new_text, n = pat.subn(
            lambda mo: f"{mo.group(1)}{value / 100.0:.6f}", block_text, count=1)
        return new_text, n

    gfx, n_t = replace_in_block(gfx, "Terrain", tlod)
    gfx, n_o = replace_in_block(gfx, "ObjectsLoD", olod)
    if n_t == 0 or n_o == 0:
        return False, (f"Could not locate the LOD lines to edit "
                       f"(Terrain={n_t}, ObjectsLoD={n_o}). File left unchanged.")

    new_text = head + gfx + tail

    try:
        backup = backup_usercfg()
        with open(USERCFG_PATH, "w", encoding="utf-8", newline="") as fh:
            fh.write(new_text)
    except Exception as exc:  # noqa: BLE001
        return False, f"Could not write UserCfg.opt: {exc}"

    # Verify by reading it straight back.
    check = read_settings()
    if check.get("tlod") != tlod or check.get("olod") != olod:
        return False, (f"Wrote the file but read-back doesn't match "
                       f"(got TLOD {check.get('tlod')}, OLOD {check.get('olod')}). "
                       f"Backup at {backup}")
    return True, f"Set TLOD {tlod} / OLOD {olod} (backup: {os.path.basename(backup)})"


def setup_next_test():
    """Pick the next untested combo from the plan and write it to UserCfg.opt."""
    say("")
    say("  --- Set up next test ---")

    if is_sim_running():
        say("")
        say("  MSFS 2024 is currently running. Close it first - the sim only")
        say("  reads these settings at launch and would overwrite the change.")
        say("")
        input("Press Enter to exit...")
        return

    plan = load_test_plan()
    tested = _tested_combos()
    combo = next_untested_combo(plan, tested)

    if combo is None:
        say("")
        say("  All planned tests are done! Nice work.")
        say(f"  {len(tested)} combos captured. Open a Claude session and point me")
        say(f"  at the Sessions folder for the full analysis, or edit test_plan.json")
        say(f"  to add more (e.g. finer steps around the knee, or an OLOD sweep).")
        say("")
        input("Press Enter to exit...")
        return

    if tested:
        done = ", ".join(f"TLOD{t}/OLOD{o}" for t, o in sorted(tested))
        say(f"  Already captured: {done}")
    say(f"  Next up: TLOD {combo['tlod']} / OLOD {combo['olod']}")

    ok, msg = write_settings(combo["tlod"], combo["olod"])
    say("")
    if ok:
        say(f"  {msg}")
        say("")
        say("  Now: launch MSFS 2024, load your standard test flight, and fly it.")
        say("  When done, run record.bat to capture this session.")
        say(f"  Keep conditions demanding (3rd-party scenery, live weather, BATC).")
        cond = plan.get("conditions")
        if cond:
            say(f"   {cond}")
    else:
        say(f"  Could not set the values: {msg}")
        say("  Your UserCfg.opt was not changed. Set TLOD/OLOD manually instead.")
    say("")
    input("Press Enter to exit...")


# --------------------------------------------------------------------------- #
# VRAM sampling (optional, via pynvml)
# --------------------------------------------------------------------------- #

class VRAMSampler:
    """Polls VRAM usage once per second in a background thread. Optional."""

    def __init__(self, interval=1.0):
        self.interval = interval
        self.samples = []          # list of MB used
        self.total_mb = None
        self.running = False
        self._thread = None
        self._nvml = None
        self._handle = None
        self.available = False

        try:
            import pynvml
            pynvml.nvmlInit()
            self._nvml = pynvml
            self._handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            mem = pynvml.nvmlDeviceGetMemoryInfo(self._handle)
            self.total_mb = mem.total // (1024 * 1024)
            self.available = True
        except Exception as exc:  # noqa: BLE001
            logging.warning("pynvml unavailable - VRAM will not be sampled: %s", exc)
            self.available = False

    def start(self):
        if not self.available:
            return
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self):
        while self.running:
            try:
                mem = self._nvml.nvmlDeviceGetMemoryInfo(self._handle)
                self.samples.append(mem.used // (1024 * 1024))
            except Exception as exc:  # noqa: BLE001
                logging.warning("VRAM sample failed: %s", exc)
            time.sleep(self.interval)

    def latest(self):
        """Most recent VRAM-used sample in MB, or None if nothing sampled yet."""
        return self.samples[-1] if self.samples else None

    def stop(self):
        self.running = False
        if self._thread:
            self._thread.join(timeout=2.0)
        try:
            if self._nvml:
                self._nvml.nvmlShutdown()
        except Exception:  # noqa: BLE001
            pass

    def summarize(self):
        if not self.available or not self.samples:
            return {
                "available": False,
                "avg_vram_mb": None,
                "peak_vram_mb": None,
                "total_vram_mb": self.total_mb,
                "peak_pct": None,
                "sample_count": 0,
            }
        avg = int(sum(self.samples) / len(self.samples))
        peak = max(self.samples)
        pct = round(peak / self.total_mb * 100, 1) if self.total_mb else None
        return {
            "available": True,
            "avg_vram_mb": avg,
            "peak_vram_mb": peak,
            "total_vram_mb": self.total_mb,
            "peak_pct": pct,
            "sample_count": len(self.samples),
        }


# --------------------------------------------------------------------------- #
# System telemetry (RAM / CPU / top other-process) — optional, via psutil
# --------------------------------------------------------------------------- #

try:
    import psutil as _psutil
except Exception:  # noqa: BLE001
    _psutil = None

TELEMETRY_COLUMNS = ["wall_ms", "phase", "alt_ft", "vram_mb",
                     "sys_ram_pct", "sys_cpu_pct", "top_proc", "top_proc_cpu"]


def _make_system_sampler():
    """Return a stateful callable that, on each ~1 Hz call, returns
    (sys_cpu_pct, sys_ram_pct, top_proc_name, top_proc_cpu_pct) for the busiest
    NON-MSFS process. cpu_percent needs deltas between calls, so state is kept in a
    closure. Returns (None, None, "", None) if psutil isn't installed — never raises.
    """
    if _psutil is None:
        return lambda: (None, None, "", None)
    cache = {}
    ncpu = _psutil.cpu_count() or 1
    self_pid = os.getpid()
    ignore = {"flightsimulator2024.exe", "system idle process", "system", "memcompression"}
    try:
        _psutil.cpu_percent(None)  # prime the system-wide meter
    except Exception:  # noqa: BLE001
        pass

    def sample():
        try:
            sys_cpu = _psutil.cpu_percent(None)
            sys_ram = _psutil.virtual_memory().percent
        except Exception:  # noqa: BLE001
            sys_cpu = sys_ram = None
        top_name, top_cpu = "", 0.0
        try:
            seen = set()
            for p in _psutil.process_iter(["pid", "name"]):
                pid = p.info.get("pid")
                seen.add(pid)
                pr = cache.get(pid)
                if pr is None:
                    try:
                        pr = _psutil.Process(pid)
                        pr.cpu_percent(None)        # prime this process
                        cache[pid] = pr
                    except Exception:  # noqa: BLE001
                        pass
                    continue
                try:
                    c = pr.cpu_percent(None) / ncpu  # normalize to whole-system %
                except Exception:  # noqa: BLE001
                    continue
                name = p.info.get("name") or ""
                if pid == self_pid or name.lower() in ignore:
                    continue
                if c > top_cpu:
                    top_cpu, top_name = c, name
            for pid in list(cache):            # prune dead processes
                if pid not in seen:
                    cache.pop(pid, None)
        except Exception:  # noqa: BLE001
            pass
        return (sys_cpu, sys_ram, top_name, round(top_cpu, 1) if top_name else None)

    return sample


def _write_telemetry_csv(session_dir, rows):
    """Write the 1 Hz telemetry sidecar next to frametimes.csv. No-op if no rows."""
    if not rows:
        return
    path = os.path.join(session_dir, "telemetry.csv")
    try:
        with open(path, "w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(TELEMETRY_COLUMNS)
            w.writerows(rows)
        say(f"     Telemetry: {len(rows)} samples -> telemetry.csv")
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not write telemetry.csv: %s", exc)


# --------------------------------------------------------------------------- #
# Frametime CSV parsing + smoothness stats
# --------------------------------------------------------------------------- #

def _pick_column(header, candidates):
    lookup = {h.strip().lower(): h for h in header}
    for cand in candidates:
        if cand.lower() in lookup:
            return lookup[cand.lower()]
    return None


def _percentile(sorted_vals, pct):
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * (pct / 100.0)
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return sorted_vals[int(k)]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def parse_frametimes(csv_path):
    """Read frametimes from a PresentMon CSV and compute smoothness stats."""
    frametimes = []
    cpu_busy = []
    gpu_busy = []
    try:
        with open(csv_path, "r", encoding="utf-8", errors="ignore", newline="") as fh:
            reader = csv.reader(fh)
            header = next(reader, None)
            if not header:
                return None
            ft_col = _pick_column(header, FRAMETIME_COLUMNS)
            cpu_col = _pick_column(header, CPUBUSY_COLUMNS)
            gpu_col = _pick_column(header, GPUBUSY_COLUMNS)
            if ft_col is None:
                logging.error("No frametime column found in %s (header=%s)",
                              csv_path, header)
                return None
            idx = {h: i for i, h in enumerate(header)}
            ft_i = idx[ft_col]
            cpu_i = idx.get(cpu_col) if cpu_col else None
            gpu_i = idx.get(gpu_col) if gpu_col else None

            for row in reader:
                if len(row) <= ft_i:
                    continue
                try:
                    val = float(row[ft_i])
                except ValueError:
                    continue
                if val <= MIN_VALID_MS or val >= MAX_VALID_MS:
                    continue
                frametimes.append(val)
                if cpu_i is not None and len(row) > cpu_i:
                    try:
                        cpu_busy.append(float(row[cpu_i]))
                    except ValueError:
                        pass
                if gpu_i is not None and len(row) > gpu_i:
                    try:
                        gpu_busy.append(float(row[gpu_i]))
                    except ValueError:
                        pass
    except Exception as exc:  # noqa: BLE001
        logging.error("Failed to parse %s: %s", csv_path, exc)
        return None

    if not frametimes:
        return None

    return compute_stats(frametimes, cpu_busy, gpu_busy)


def _read_csv_chronological(csv_path):
    """Read PresentMon CSV in row order; return (ft, cpu, gpu) as parallel lists."""
    ft, cpu, gpu = [], [], []
    try:
        with open(csv_path, "r", encoding="utf-8", errors="ignore", newline="") as fh:
            reader = csv.reader(fh)
            header = next(reader, None)
            if not header:
                return ft, cpu, gpu
            ft_col  = _pick_column(header, FRAMETIME_COLUMNS)
            cpu_col = _pick_column(header, CPUBUSY_COLUMNS)
            gpu_col = _pick_column(header, GPUBUSY_COLUMNS)
            if ft_col is None:
                return ft, cpu, gpu
            idx   = {h: i for i, h in enumerate(header)}
            ft_i  = idx[ft_col]
            cpu_i = idx.get(cpu_col) if cpu_col else None
            gpu_i = idx.get(gpu_col) if gpu_col else None
            for row in reader:
                if len(row) <= ft_i:
                    continue
                try:
                    val = float(row[ft_i])
                except ValueError:
                    continue
                if val <= MIN_VALID_MS or val >= MAX_VALID_MS:
                    continue
                ft.append(val)
                if cpu_i is not None and len(row) > cpu_i:
                    try:
                        cpu.append(float(row[cpu_i]))
                    except ValueError:
                        pass
                if gpu_i is not None and len(row) > gpu_i:
                    try:
                        gpu.append(float(row[gpu_i]))
                    except ValueError:
                        pass
    except Exception as exc:  # noqa: BLE001
        logging.error("Failed to read CSV chronologically: %s", exc)
    return ft, cpu, gpu


def _trim_tail_seconds(ft, cpu, gpu, seconds):
    """Remove the last `seconds` worth of frames from chronological lists."""
    if seconds <= 0 or not ft:
        return ft, cpu, gpu
    budget_ms = seconds * 1000.0
    consumed  = 0.0
    cut = len(ft)
    for i in range(len(ft) - 1, -1, -1):
        consumed += ft[i]
        if consumed >= budget_ms:
            cut = i
            break
    return ft[:cut], cpu[:cut] if cpu else cpu, gpu[:cut] if gpu else gpu


def _trim_head_seconds(ft, cpu, gpu, seconds):
    """Remove the first `seconds` worth of frames from chronological lists.

    Drops PresentMon initialization artifacts — the first captured frame's
    frametime measures time since the last render before capture began, which
    can be 50–200ms of noise unrelated to actual sim performance.
    """
    if seconds <= 0 or not ft:
        return ft, cpu, gpu
    budget_ms = seconds * 1000.0
    consumed  = 0.0
    cut = 0
    for i, v in enumerate(ft):
        consumed += v
        if consumed >= budget_ms:
            cut = i + 1
            break
    return ft[cut:], cpu[cut:] if cpu else cpu, gpu[cut:] if gpu else gpu


def _split_frametimes_by_phase(ft_chron, phase_log, recording_wall_start):
    """Map chronological frametimes to flight phase buckets via wall-clock transitions.

    Returns dict: {"ground": [...], "climb": [...], "cruise": [...], "descent": [...]}
    PresentMon CSV has no wall-clock column, so we correlate by summing frame durations.
    """
    if not phase_log or not ft_chron:
        return {}
    transitions = sorted((t - recording_wall_start, phase) for t, phase in phase_log)
    buckets = {"ground": [], "climb": [], "cruise": [], "descent": []}
    elapsed_ms = 0.0
    trans_idx = 0
    current_phase = transitions[0][1]
    for ft in ft_chron:
        elapsed_s = elapsed_ms / 1000.0
        while trans_idx + 1 < len(transitions) and elapsed_s >= transitions[trans_idx + 1][0]:
            trans_idx += 1
            current_phase = transitions[trans_idx][1]
        if current_phase in buckets:
            buckets[current_phase].append(ft)
        elapsed_ms += ft
    return buckets


def _compute_phase_stats(buckets, total_frames):
    """Per-phase summary stats from frametime buckets."""
    result = {}
    for phase, fts in buckets.items():
        if not fts:
            continue
        n = len(fts)
        avg_ft = round(sum(fts) / n, 2)
        s = sorted(fts)
        p99_ft = round(s[min(int(n * 0.99), n - 1)], 2)
        stutter_pct = round(sum(1 for f in fts if f > STUTTER_FRAMETIME_MS) / n * 100, 3)
        pct_of_total = round(n / total_frames * 100, 1) if total_frames > 0 else 0.0
        result[phase] = {
            "frame_count": n,
            "avg_ft": avg_ft,
            "p99_ft": p99_ft,
            "stutter_pct": stutter_pct,
            "pct_of_total": pct_of_total,
        }
    return result


def compute_stats(frametimes, cpu_busy=None, gpu_busy=None):
    s = sorted(frametimes)
    n = len(s)
    avg = sum(s) / n
    p50 = _percentile(s, 50)
    p95 = _percentile(s, 95)
    p99 = _percentile(s, 99)
    p999 = _percentile(s, 99.9)
    mx = s[-1]
    stdev = statistics.pstdev(s) if n > 1 else 0.0

    # Smoothness: % of frames within +/-20% of median.
    low_band = p50 * (1 - CONSISTENCY_BAND)
    high_band = p50 * (1 + CONSISTENCY_BAND)
    in_band = sum(1 for v in s if low_band <= v <= high_band)
    consistency = round(in_band / n * 100, 1)

    stutter = sum(1 for v in s if v > STUTTER_FRAMETIME_MS)
    spikes = sum(1 for v in s if v > SPIKE_FRAMETIME_MS)

    # "1% low" / "0.1% low" expressed as FPS from the worst-frame percentiles.
    one_pct_low_fps = round(1000.0 / p99, 1) if p99 else None
    point_one_low_fps = round(1000.0 / p999, 1) if p999 else None

    duration = sum(s) / 1000.0

    stats = {
        "avg_ft_ms": round(avg, 2),
        "p50_ft_ms": round(p50, 2),
        "p95_ft_ms": round(p95, 2),
        "p99_ft_ms": round(p99, 2),
        "p999_ft_ms": round(p999, 2),
        "max_ft_ms": round(mx, 2),
        "frametime_stdev_ms": round(stdev, 2),
        "consistency_pct": consistency,
        "stutter_pct": round(stutter / n * 100, 2),
        "stutter_count": stutter,
        "spike_count": spikes,
        "one_pct_low_fps": one_pct_low_fps,
        "point_one_pct_low_fps": point_one_low_fps,
        "avg_fps": round(1000.0 / avg, 1),   # context only (capped)
        "frame_count": n,
        "duration_seconds": round(duration, 1),
    }

    # CPU vs GPU bound (kept light; raw per-frame data stays in frametimes.csv).
    if cpu_busy and gpu_busy and len(cpu_busy) == len(gpu_busy):
        gpu_bound = sum(1 for c, g in zip(cpu_busy, gpu_busy) if g >= c)
        stats["gpu_bound_pct"] = round(gpu_bound / len(cpu_busy) * 100, 1)
        stats["cpu_bound_pct"] = round((1 - gpu_bound / len(cpu_busy)) * 100, 1)
        stats["avg_cpu_busy_ms"] = round(sum(cpu_busy) / len(cpu_busy), 2)
        stats["avg_gpu_busy_ms"] = round(sum(gpu_busy) / len(gpu_busy), 2)
    else:
        stats["gpu_bound_pct"] = None
        stats["cpu_bound_pct"] = None

    return stats, s   # also return sorted frametimes for charting


# --------------------------------------------------------------------------- #
# Grading helpers (shared with report)
# --------------------------------------------------------------------------- #

def grade_p99(p99):
    if p99 is None:
        return "na"
    if p99 <= 20:
        return "good"
    if p99 <= 33.3:
        return "ok"
    return "bad"


def grade_stutter(pct):
    if pct is None:
        return "na"
    if pct < 0.5:
        return "good"
    if pct < 2.0:
        return "ok"
    return "bad"


# --------------------------------------------------------------------------- #
# HTML report (self-contained, inline SVG, opens offline)
# --------------------------------------------------------------------------- #

GRADE_COLORS = {
    "good": "#2ecc71",
    "ok": "#f1c40f",
    "bad": "#e74c3c",
    "na": "#888888",
}


def _read_index_sessions():
    """Best-effort read of every previously filed session (for 'yet' badges)."""
    index_json = os.path.join(SESSIONS_DIR, "index.json")
    if not os.path.isfile(index_json):
        return []
    try:
        with open(index_json, "r", encoding="utf-8") as fh:
            return json.load(fh).get("sessions", [])
    except Exception:  # noqa: BLE001
        return []


# --------------------------------------------------------------------------- #
# CapFrameX-style shared theme (used by both the per-flight and combined report)
# --------------------------------------------------------------------------- #

# CSS variables for light (mirrors CapFrameX's grey/blue/amber) + dark, plus
# common components (header, chips, panels, theme toggle). SVG/HTML colours all
# reference these vars so they adapt to the theme automatically.
THEME_BASE_CSS = """
  :root { --bg:#e9e9e9; --panel:#f4f4f4; --panel-2:#ffffff; --border:#cfcfcf;
    --text:#222428; --text-dim:#5f636a; --text-faint:#8b8f96;
    --accent:#3c8dcc; --line:#3c8dcc; --amber:#f0a830; --target:#7ac142; --ceiling:#e0533d;
    --good:#5bbf5b; --ok:#f0a830; --bad:#e0533d; --vram:#f0a830; --grid:#dadada;
    --blue2:#1f5f93; --orange:#e8862e; --fenix:#3c8dcc; --pmdg:#f0a830; }
  html[data-theme="dark"] { --bg:#1b1b1e; --panel:#242427; --panel-2:#2b2b30; --border:#37373d;
    --text:#e9e9ec; --text-dim:#9a9aa2; --text-faint:#6f6f77;
    --accent:#4ba3e6; --line:#4ba3e6; --amber:#e8a13a; --target:#7ac142; --ceiling:#e0533d;
    --good:#5bbf5b; --ok:#e8a13a; --bad:#e0533d; --vram:#e8a13a; --grid:#2f2f35;
    --blue2:#2f7bbf; --orange:#e8862e; --fenix:#4ba3e6; --pmdg:#e8a13a; }
  * { box-sizing:border-box; }
  body { font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg);
    color:var(--text); margin:0; padding:18px; font-size:13px; }
  .mono { font-family:Consolas,"Courier New",monospace; }
  header { display:flex; align-items:center; gap:14px; margin-bottom:14px; flex-wrap:wrap; }
  header .title { font-size:16px; font-weight:600; }
  header .sub { color:var(--text-dim); font-size:12px; }
  .chips { display:flex; gap:7px; flex-wrap:wrap; margin-left:6px; }
  .chip { background:var(--panel-2); border:1px solid var(--border); border-radius:5px;
    padding:3px 9px; font-size:11px; color:var(--text-dim); }
  .chip b { color:var(--text); font-weight:600; }
  .spacer { flex:1; }
  .toggle { background:var(--panel-2); border:1px solid var(--border); color:var(--text);
    border-radius:6px; padding:6px 11px; cursor:pointer; font-size:12px; }
  .toggle:hover { border-color:var(--accent); color:var(--accent); }
  .navbtn { background:var(--panel-2); border:1px solid var(--border); color:var(--text);
    border-radius:6px; padding:6px 10px; cursor:pointer; font-size:12px; text-decoration:none; }
  .navbtn:hover { border-color:var(--accent); color:var(--accent); }
  .navbtn.disabled { opacity:.35; pointer-events:none; }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:7px; }
  .panel-h { font-size:11px; text-transform:uppercase; letter-spacing:.07em;
    color:var(--text-faint); padding:10px 13px 0; display:flex;
    justify-content:space-between; align-items:center; }
"""

# Theme toggle + restore-from-localStorage. Default is dark; the button flips it.
THEME_JS = """
  window.toggleTheme=function(){var h=document.documentElement;
    var n=h.getAttribute('data-theme')==='dark'?'light':'dark';
    h.setAttribute('data-theme',n);try{localStorage.setItem('cfxTheme',n);}catch(e){}
    var b=document.getElementById('themeBtn');if(b)b.textContent=n==='dark'?'\\u25D0 Light':'\\u25D0 Dark';};
  (function(){try{var s=localStorage.getItem('cfxTheme');
    if(s){document.documentElement.setAttribute('data-theme',s);}}catch(e){}
    var b=document.getElementById('themeBtn');
    if(b)b.textContent=document.documentElement.getAttribute('data-theme')==='dark'?'\\u25D0 Light':'\\u25D0 Dark';})();
"""

# Per-flight report specific CSS.
REPORT_CSS = """
  .tabs { display:flex; gap:2px; border-bottom:1px solid var(--border); margin-bottom:12px; }
  .tab { padding:7px 15px; font-size:12px; color:var(--text-dim); cursor:pointer;
    border-bottom:2px solid transparent; }
  .tab.active { color:var(--accent); border-bottom-color:var(--accent); font-weight:600; }
  .layout { display:grid; grid-template-columns:280px 1fr; gap:12px; margin-bottom:12px; }
  .rcol { display:flex; flex-direction:column; gap:12px; }
  .unit-btn { font-size:11px; color:var(--accent); cursor:pointer; text-transform:none;
    letter-spacing:0; border:1px solid var(--accent); border-radius:4px; padding:2px 9px;
    background:transparent; font-weight:600; }
  .unit-btn:hover { background:var(--accent); color:var(--panel-2); }
  .metrics { padding:10px 13px 13px; }
  .mrow { display:grid; grid-template-columns:84px 1fr 46px; align-items:center; gap:8px; margin:7px 0; }
  .mrow .k { font-size:11px; color:var(--text-dim); text-align:right; }
  .mbar-track { height:16px; }
  .mbar { height:16px; background:var(--amber); border-radius:3px; min-width:2px; }
  .mrow .v { font-family:Consolas,monospace; font-size:12px; font-weight:600; text-align:right; }
  .graph-ctrls { display:flex; align-items:center; gap:8px; text-transform:none; letter-spacing:0; }
  .yscale-sel { background:var(--panel-2); border:1px solid var(--border); color:var(--text);
    border-radius:4px; padding:2px 6px; font-size:11px; cursor:pointer; }
  .yscale-sel:hover { border-color:var(--accent); }
  .chart-legend { display:flex; gap:16px; justify-content:center; padding:2px 12px 0;
    font-size:11px; color:var(--text-dim); }
  .chart-legend .lg { display:flex; align-items:center; gap:6px; }
  .chart-legend .sw { width:14px; height:3px; border-radius:2px; display:inline-block; }
  .graph-wrap { padding:8px 10px 10px; }
  .spike-badge { position:absolute; top:12px; right:14px; background:var(--panel-2);
    border:1px solid var(--bad); color:var(--bad); border-radius:5px; padding:3px 8px;
    font-size:10px; font-family:Consolas,monospace; pointer-events:none; }
  #zoomReset { float:right; }
  .graph-hint { font-size:10px; color:var(--text-faint); text-align:right; padding:0 12px 8px; }
  .lower { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px; }
  .pietabs { display:flex; gap:14px; padding:10px 14px 0; }
  .pietab { font-size:12px; color:var(--text-dim); cursor:pointer; padding-bottom:4px;
    border-bottom:2px solid transparent; }
  .pietab.active { color:var(--accent); border-bottom-color:var(--accent); font-weight:600; }
  .pie-wrap { display:flex; align-items:center; gap:18px; padding:14px 16px 16px; }
  .legend { font-size:12px; color:var(--text-dim); }
  .legend .row { display:flex; align-items:center; gap:7px; margin:5px 0; }
  .legend .sw { width:11px; height:11px; border-radius:2px; flex:none; }
  .vram-body { padding:14px 16px 16px; }
  .bar-track { height:14px; background:var(--panel-2); border-radius:7px; overflow:hidden; border:1px solid var(--border); }
  .bar-fill { height:100%; background:var(--vram); }
  .vram-nums { display:flex; justify-content:space-between; margin-top:8px;
    font-family:Consolas,monospace; font-size:12px; color:var(--text-dim); }
  .phase { padding:6px 15px 15px; }
  .phase-row { display:grid; grid-template-columns:64px 1fr 64px; align-items:center; gap:10px; margin:9px 0; }
  .phase-row .lbl { font-size:12px; color:var(--text-dim); }
  .ph-track { height:18px; background:var(--panel-2); border:1px solid var(--border); border-radius:4px; overflow:hidden; }
  .ph-fill { height:100%; }
  .phase-row .num { font-family:Consolas,monospace; font-size:12px; text-align:right; }
  .note { color:var(--text-faint); font-size:12px; font-style:italic; padding:14px 15px; }
  footer { color:var(--text-faint); font-size:11px; margin-top:6px; line-height:1.6; }
"""

# Per-flight report JS: renders metric bars + pie legends from injected RD, plus
# the FPS/ms, Stuttering/Variances, and Frametime/FPS toggles.
REPORT_JS = """
  (function(){
    var UNIT='fps';
    function renderMetrics(){
      var m=RD.metrics,maxFps=0,maxMs=0;
      m.forEach(function(x){ if(x.fps>maxFps)maxFps=x.fps; if(x.ms>maxMs)maxMs=x.ms; });
      var html='';
      m.forEach(function(x){
        var val=UNIT==='fps'?x.fps:x.ms;
        var w=UNIT==='fps'?(maxFps?x.fps/maxFps*100:0):(maxMs?x.ms/maxMs*100:0);
        var txt=(val==null)?'\\u2014':val.toFixed(1);
        html+='<div class="mrow"><span class="k">'+x.k+'</span><div class="mbar-track">'+
          '<div class="mbar" style="width:'+(w||0).toFixed(0)+'%"></div></div>'+
          '<span class="v">'+txt+'</span></div>';
      });
      document.getElementById('metrics').innerHTML=html;
    }
    window.toggleUnit=function(){UNIT=UNIT==='fps'?'ms':'fps';
      document.getElementById('unitBtn').textContent=UNIT.toUpperCase();renderMetrics();};
    window.showPie=function(which){
      document.getElementById('ptStut').classList.toggle('active',which==='stut');
      document.getElementById('ptVar').classList.toggle('active',which==='var');
      var html='';RD.pies[which].forEach(function(s){
        html+='<div class="row"><span class="sw" style="background:'+s.color+'"></span>'+s.label+'</div>';});
      document.getElementById('pieLegend').innerHTML=html;};
    window.showGraph=function(which){
      var ft=which==='frametime';
      document.getElementById('tabFt').classList.toggle('active',ft);
      document.getElementById('tabFps').classList.toggle('active',!ft);
      var t=document.getElementById('graphTitle');
      if(t&&t.firstChild)t.firstChild.nodeValue=ft?
        'Frametime over flight \\u00b7 ms (lower = smoother) ':
        'FPS over flight \\u00b7 frames/s (higher = smoother) ';
      if(window.setChartUnit)window.setChartUnit(ft?'ms':'fps');};
    renderMetrics();showPie('stut');
  })();
"""


# Per-flight zoomable frametime + altitude chart (Chart.js + zoom plugin). Kept as a
# standalone constant (not an f-string) so its JS braces pass through untouched.
CHART_JS = """
  (function(){
    if(typeof Chart==='undefined'||!window.CHART||!CHART.ft||!CHART.ft.length)return;
    var css=function(n,f){var v=getComputedStyle(document.documentElement)
      .getPropertyValue(n).trim();return v||f;};
    function colors(){return{line:css('--accent','#4ba3e6'),target:css('--target','#7ac142'),
      grid:css('--grid','#2f2f35'),faint:css('--text-faint','#6f6f77'),text:css('--text-dim','#9a9aa2'),
      amber:css('--amber','#e0a030'),bad:css('--bad','#e0564e')};}
    var unit='ms';
    var scaleMode='100';
    var rawT=CHART.ft.map(function(p){return {x:p[0],t:p[1]};});
    var dataMax=0,xmin=rawT[0].x,xmax=rawT[rawT.length-1].x;
    rawT.forEach(function(p){if(p.t>dataMax)dataMax=p.t;});
    var curCeil=100;
    function buildMs(){var fixed=isFinite(parseFloat(scaleMode));
      return rawT.map(function(p){return {x:p.x,y:(fixed&&p.t>curCeil)?curCeil:p.t,t:p.t};});}
    var mavgData=(CHART.mavg||[]).map(function(p){return {x:p[0],y:p[1]};});
    var altData=CHART.alt?CHART.alt.map(function(p){return {x:p[0],y:p[1]};}):null;
    var c=colors();
    var datasets=[];
    if(altData){datasets.push({label:'Altitude',data:altData,yAxisID:'yAlt',
      borderColor:c.faint,borderWidth:1,pointRadius:0,fill:false,tension:0.35,order:3,spanGaps:true});}
    datasets.push({label:'Frametime',data:buildMs(),yAxisID:'yMs',
      borderColor:c.line,borderWidth:1,pointRadius:0,fill:false,tension:0,order:1});
    datasets.push({label:'Moving average',data:mavgData,yAxisID:'yMs',
      borderColor:c.amber,borderWidth:1.6,pointRadius:0,fill:false,tension:0.25,order:0});
    var refLines={id:'tgt',afterDraw:function(ch){
      if(unit!=='ms')return;var sc=ch.scales.yMs;if(!sc)return;
      var a=ch.chartArea,x=ch.ctx;
      function line(val,col,lbl,dy){var y=sc.getPixelForValue(val);
        if(y<a.top||y>a.bottom)return;
        x.save();x.strokeStyle=col;x.setLineDash([5,4]);x.lineWidth=1;
        x.beginPath();x.moveTo(a.left,y);x.lineTo(a.right,y);x.stroke();
        x.setLineDash([]);x.fillStyle=col;x.font='10px sans-serif';
        x.textAlign='right';x.fillText(lbl,a.right-4,y+(dy||-4));x.restore();}
      line(CHART.target,colors().target,CHART.target+' ms target',12);
      if(CHART.stutter)line(CHART.stutter,colors().amber,CHART.stutter+' ms stutter');}};
    var overCaret={id:'ovc',afterDatasetsDraw:function(ch){
      if(unit!=='ms'||!isFinite(parseFloat(scaleMode)))return;
      var sc=ch.scales.yMs,xs=ch.scales.x;if(!sc||!xs)return;
      var a=ch.chartArea,x=ch.ctx,top=sc.getPixelForValue(curCeil);
      x.save();x.fillStyle=colors().bad;
      rawT.forEach(function(p){if(p.t>curCeil){var px=xs.getPixelForValue(p.x);
        if(px<a.left||px>a.right)return;
        x.beginPath();x.moveTo(px,top+1);x.lineTo(px-4,top+8);x.lineTo(px+4,top+8);
        x.closePath();x.fill();}});x.restore();}};
    var chart=new Chart(document.getElementById('ftChart'),{
      type:'line',data:{datasets:datasets},plugins:[refLines,overCaret],
      options:{responsive:true,maintainAspectRatio:false,animation:false,
        parsing:false,normalized:true,interaction:{mode:'nearest',axis:'x',intersect:false},
        scales:{
          x:{type:'linear',title:{display:true,text:'minutes into flight',color:c.text},
            grid:{color:c.grid},ticks:{color:c.faint,maxTicksLimit:12,
            callback:function(v){return v.toFixed(0);}}},
          yMs:{type:'linear',position:'left',min:0,max:100,
            title:{display:true,text:'ms',color:c.text},
            grid:{color:c.grid},ticks:{color:c.faint}},
          yAlt:{type:'linear',position:'right',display:!!altData,
            title:{display:!!altData,text:'altitude',color:c.faint},
            grid:{drawOnChartArea:false},ticks:{color:c.faint,
            callback:function(v){return v>=1000?'FL'+Math.round(v/100):Math.round(v);}}}},
        plugins:{legend:{display:false},
          decimation:{enabled:true,algorithm:'lttb',samples:1500},
          tooltip:{callbacks:{
            title:function(it){return it[0].parsed.x.toFixed(1)+' min';},
            label:function(it){if(it.dataset.label==='Altitude')
                return Math.round(it.parsed.y).toLocaleString()+' ft';
              if(unit==='ms'){var t=(it.raw&&it.raw.t!=null)?it.raw.t:it.parsed.y;
                return it.dataset.label+': '+t.toFixed(1)+' ms';}
              return it.dataset.label+': '+it.parsed.y.toFixed(1)+' fps';}}},
          zoom:{zoom:{wheel:{enabled:true},pinch:{enabled:true},mode:'x'},
            pan:{enabled:true,mode:'x'},limits:{x:{min:'original',max:'original'}}}}}});
    function bucketsAbove(ceil){var n=0;rawT.forEach(function(p){if(p.t>ceil)n++;});return n;}
    function updateBadge(){var b=document.getElementById('spikeBadge');if(!b)return;
      if(unit==='ms'&&scaleMode!=='fit'){
        var cnt=(Math.round(curCeil)===100)?CHART.over_count:bucketsAbove(curCeil);
        if(cnt>0){b.style.display='';
          b.textContent=cnt+' frame'+(cnt>1?'s':'')+' \\u003e '+Math.round(curCeil)
            +' ms \\u00b7 max '+CHART.over_max.toFixed(1)+' ms';return;}}
      b.style.display='none';}
    function renderLegend(){var el=document.getElementById('chartLegend');if(!el)return;
      var cc=colors();
      var a=(unit==='ms')?['Frame time',cc.line]:['FPS',cc.line];
      var bb=(unit==='ms')?['Moving average',cc.amber]:['Avg FPS',cc.target];
      el.innerHTML='<span class="lg"><span class="sw" style="background:'+a[1]+'"></span>'+a[0]+'</span>'
        +'<span class="lg"><span class="sw" style="background:'+bb[1]+'"></span>'+bb[0]+'</span>';}
    window.applyScale=function(mode){scaleMode=mode;window.__yscale=mode;
      try{localStorage.setItem('cfxYScale',mode);}catch(e){}
      if(unit!=='ms')return;
      var y=chart.options.scales.yMs;
      if(mode==='fit'){y.min=0;y.max=undefined;curCeil=dataMax;}
      else if(mode==='iqr'){var q1=(CHART.q1!=null?CHART.q1:0),q3=(CHART.q3!=null?CHART.q3:q1+2);
        var iqr=q3-q1,pad=0.5*iqr+0.5;y.min=Math.max(0,q1-pad);y.max=q3+pad;curCeil=y.max;}
      else{var n=parseFloat(mode)||100;y.min=0;y.max=n;curCeil=n;}
      var ds=chart.data.datasets.find(function(d){return d.label==='Frametime';});
      ds.data=buildMs();updateBadge();chart.update();};
    (function(){var ok=function(v){return v&&/^(fit|iqr|\\d+)$/.test(v);};
      var q=null,ls=null;
      try{q=new URLSearchParams(location.search||'').get('y');}catch(e){}
      try{ls=localStorage.getItem('cfxYScale');}catch(e){}
      var pick=ok(q)?q:(ok(ls)?ls:'100');
      scaleMode=pick;window.__yscale=pick;
      var s0=document.getElementById('yScale');if(s0)s0.value=pick;})();
    applyScale(scaleMode);renderLegend();
    var avgChart=(function(){
      var el=document.getElementById('ftAvgChart');
      if(!el||!mavgData.length)return null;
      // Extra smoothing pass: rolling mean to soften the moving-average's stair-steps.
      var SM=mavgData;
      (function(){var n=mavgData.length;if(n<5)return;
        var w=Math.max(3,Math.round(n/60)),half=Math.floor(w/2),out=[];
        for(var i=0;i<n;i++){var s=0,c=0;
          for(var j=i-half;j<=i+half;j++){if(j>=0&&j<n){s+=mavgData[j].y;c++;}}
          out.push({x:mavgData[i].x,y:s/c});}
        SM=out;})();
      var lo=SM[0].y,hi=SM[0].y;
      SM.forEach(function(p){if(p.y<lo)lo=p.y;if(p.y>hi)hi=p.y;});
      var tgt=CHART.target||16.7;
      // Zoom to THIS flight's average band so the line fills the box instead of floating:
      // ceiling = highest average + 1.5% headroom; floor sits just below the lower of the line
      // and the 16.67ms target (which stays visible as the reference the line rides on).
      var ymax=hi*1.015;
      var ymin=Math.min(lo,tgt)-0.5;
      var tgtLine={id:'avgtgt',afterDraw:function(ch){
        var sc=ch.scales.y;if(!sc)return;var a=ch.chartArea,x=ch.ctx;
        var y=sc.getPixelForValue(tgt);if(y<a.top||y>a.bottom)return;
        x.save();x.strokeStyle=colors().target;x.setLineDash([5,4]);x.lineWidth=1;
        x.beginPath();x.moveTo(a.left,y);x.lineTo(a.right,y);x.stroke();
        x.setLineDash([]);x.fillStyle=colors().target;x.font='10px sans-serif';
        x.textAlign='right';x.fillText(tgt+' ms target',a.right-4,y+12);x.restore();}};
      return new Chart(el,{type:'line',
        data:{datasets:[{label:'Moving average',data:SM,borderColor:colors().amber,
          borderWidth:2,pointRadius:0,fill:false,tension:0.45,cubicInterpolationMode:'monotone'}]},
        plugins:[tgtLine],
        options:{responsive:true,maintainAspectRatio:false,animation:false,
          parsing:false,normalized:true,interaction:{mode:'nearest',axis:'x',intersect:false},
          scales:{
            x:{type:'linear',min:xmin,max:xmax,grid:{color:colors().grid},
              ticks:{color:colors().faint,maxTicksLimit:12,
              callback:function(v){return v.toFixed(0);}}},
            y:{type:'linear',min:ymin,max:ymax,
              title:{display:true,text:'ms',color:colors().text},
              grid:{color:colors().grid},ticks:{color:colors().faint}}},
          plugins:{legend:{display:false},
            decimation:{enabled:true,algorithm:'lttb',samples:800},
            tooltip:{callbacks:{
              title:function(it){return it[0].parsed.x.toFixed(1)+' min';},
              label:function(it){return 'Avg: '+it.parsed.y.toFixed(1)+' ms';}}}}}});
    })();
    window.setChartUnit=function(u){unit=u;
      var tr=chart.data.datasets.find(function(d){return d.label==='Frametime';});
      var ov=chart.data.datasets[chart.data.datasets.length-1];
      var sel=document.getElementById('yScale');
      if(u==='fps'){
        tr.data=rawT.map(function(p){return {x:p.x,y:p.t?1000/p.t:0};});
        ov.label='Avg FPS';ov.borderColor=colors().target;ov.tension=0;
        ov.data=[{x:xmin,y:CHART.avg_fps||0},{x:xmax,y:CHART.avg_fps||0}];
        chart.options.scales.yMs.min=undefined;chart.options.scales.yMs.max=undefined;
        chart.options.scales.yMs.title.text='fps';
        if(sel)sel.style.display='none';}
      else{
        tr.data=buildMs();
        ov.label='Moving average';ov.borderColor=colors().amber;ov.tension=0.25;
        ov.data=mavgData;
        chart.options.scales.yMs.title.text='ms';
        if(sel)sel.style.display='';
        applyScale(scaleMode);}
      updateBadge();renderLegend();chart.update();};
    window.resetZoom=function(){chart.resetZoom();};
    document.getElementById('ftChart').addEventListener('dblclick',function(){chart.resetZoom();});
    new MutationObserver(function(){var cc=colors();
      chart.data.datasets.forEach(function(d){
        if(d.label==='Frametime')d.borderColor=cc.line;
        else if(d.label==='Moving average')d.borderColor=cc.amber;
        else if(d.label==='Avg FPS')d.borderColor=cc.target;
        else d.borderColor=cc.faint;});
      ['x','yMs','yAlt'].forEach(function(k){var s=chart.options.scales[k];if(!s)return;
        if(s.grid&&s.grid.color)s.grid.color=cc.grid;
        if(s.ticks)s.ticks.color=cc.faint;if(s.title)s.title.color=cc.text;});
      renderLegend();chart.update();
      if(avgChart){avgChart.data.datasets[0].borderColor=cc.amber;
        ['x','y'].forEach(function(k){var s=avgChart.options.scales[k];if(!s)return;
          if(s.grid)s.grid.color=cc.grid;if(s.ticks)s.ticks.color=cc.faint;
          if(s.title)s.title.color=cc.text;});
        avgChart.update();}})
      .observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  })();
"""


# Prev/next flight navigation. Reads the shared, always-current Sessions/sessions_nav.js
# (loaded via <script src> so it works under file://, where fetch() is blocked) and wires
# the header arrows + left/right keys. "Prev" = older flight, "Next" = newer. Kept as a
# plain string so its JS braces pass through untouched.
NAV_JS = """
  (function(){
    var all=window.SESSIONS_NAV||[];
    // Find this report's track (primary = Fenix/PMDG, reference = Citation etc.), then cycle
    // prev/next only within the same track so a baseline sweep is never interrupted.
    var me=null;for(var m=0;m<all.length;m++){if(all[m].id===window.THIS_SESSION){me=all[m];break;}}
    var track=me?me.track:null;
    var nav=track?all.filter(function(e){return e.track===track;}):all;
    var i=-1;for(var k=0;k<nav.length;k++){if(nav[k].id===window.THIS_SESSION){i=k;break;}}
    var prev=document.getElementById('navPrev'),next=document.getElementById('navNext');
    var older=(i>0)?nav[i-1]:null, newer=(i>=0&&i<nav.length-1)?nav[i+1]:null;
    function urlFor(entry){
      var y=window.__yscale||'100';
      return '../../'+entry.folder+'/report.html?y='+encodeURIComponent(y);}
    function go(entry){if(entry)location.href=urlFor(entry);}
    function wire(el,entry){if(!el)return;
      if(entry){el.href='../../'+entry.folder+'/report.html';
        el.classList.remove('disabled');el.title=entry.label;
        el.onclick=function(ev){ev.preventDefault();go(entry);};}
      else{el.classList.add('disabled');el.removeAttribute('href');el.onclick=null;}}
    wire(prev,older);wire(next,newer);
    document.addEventListener('keydown',function(e){
      if(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
      if(e.key==='ArrowLeft')go(older);
      else if(e.key==='ArrowRight')go(newer);});
  })();
"""


def _svg_perf_line(ft, as_fps=False, width=880, height=250):
    """Themed line chart (CSS-var colours) of frametime or FPS over the flight."""
    if not ft:
        return ('<svg viewBox="0 0 880 80" width="100%" xmlns="http://www.w3.org/2000/svg">'
                '<text x="20" y="44" font-size="12" fill="var(--text-faint)">'
                'No frametime data.</text></svg>')
    data = ft
    if len(data) > 600:
        step = len(data) / 600
        data = [data[int(i * step)] for i in range(600)]
    if as_fps:
        data = [(1000.0 / v if v else 0.0) for v in data]
    n = len(data)
    pad_l, pad_r, pad_t, pad_b = 44, 14, 16, 26
    plot_w, plot_h = width - pad_l - pad_r, height - pad_t - pad_b
    if as_fps:
        ymax, target, tlabel = 75.0, 60.0, "60 fps"
    else:
        ymax = max(max(data) * 1.1, STUTTER_FRAMETIME_MS * 1.1)
        target, tlabel = TARGET_FRAMETIME_MS, "16.67 ms target"

    def X(i):
        return pad_l + (i / max(n - 1, 1)) * plot_w

    def Y(v):
        return pad_t + plot_h - (v / ymax) * plot_h

    grid = ""
    for f in (0.25, 0.5, 0.75):
        yy = pad_t + plot_h - f * plot_h
        grid += (f'<line x1="{pad_l}" y1="{yy:.1f}" x2="{width - pad_r}" y2="{yy:.1f}" '
                 f'stroke="var(--grid)" stroke-width="1"/>')
    for f in (0.0, 0.5, 1.0):
        yy = pad_t + plot_h - f * plot_h
        grid += (f'<text x="{pad_l - 6}" y="{yy + 3:.1f}" font-size="9" '
                 f'fill="var(--text-faint)" text-anchor="end">{ymax * f:.0f}</text>')
    ty = Y(target)
    ref = (f'<line x1="{pad_l}" y1="{ty:.1f}" x2="{width - pad_r}" y2="{ty:.1f}" '
           f'stroke="var(--target)" stroke-dasharray="5 4" stroke-width="1.2"/>'
           f'<text x="{width - pad_r}" y="{ty - 4:.1f}" font-size="10" '
           f'fill="var(--target)" text-anchor="end">{tlabel}</text>')
    pts = " ".join(f"{X(i):.1f},{Y(v):.1f}" for i, v in enumerate(data))
    axis = (f'<line x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{pad_t + plot_h}" '
            f'stroke="var(--border)" stroke-width="1"/>'
            f'<line x1="{pad_l}" y1="{pad_t + plot_h}" x2="{width - pad_r}" '
            f'y2="{pad_t + plot_h}" stroke="var(--border)" stroke-width="1"/>')
    return (f'<svg viewBox="0 0 {width} {height}" width="100%" '
            f'xmlns="http://www.w3.org/2000/svg" role="img" '
            f'aria-label="performance over the flight">{grid}{ref}'
            f'<polyline points="{pts}" fill="none" stroke="var(--line)" stroke-width="1.2"/>'
            f'{axis}</svg>')


def _chart_frametime_series(ft, max_points=5000):
    """Downsample frametimes to <= max_points buckets for the zoomable Chart.js graph.

    X is minutes into the (already trimmed) flight, derived from cumulative frametime so
    it stays time-accurate. Bucketing keeps the MAX frametime per bucket so spikes survive
    downsampling (a spike is the whole point of inspecting the chart), and the bucket MEAN
    in a parallel series so a moving-average line can track typical frametime, not spikes.
    Returns (max_pts, mean_pts, total_min) where each *_pts = [[x_min, ms], ...] share x.
    """
    n = len(ft)
    if n == 0:
        return [], [], 0.0
    if n <= max_points:
        out, mean_out, cum = [], [], 0.0
        for v in ft:
            cum += v
            x = round(cum / 60000.0, 4)
            out.append([x, round(v, 2)])
            mean_out.append([x, round(v, 2)])
        return out, mean_out, cum / 60000.0
    bucket = n / max_points
    out, mean_out = [], []
    cum, bmax, bsum, bcnt, edge = 0.0, 0.0, 0.0, 0, bucket
    for i, v in enumerate(ft):
        cum += v
        bsum += v
        bcnt += 1
        if v > bmax:
            bmax = v
        if (i + 1) >= edge or i == n - 1:
            x = round(cum / 60000.0, 4)
            out.append([x, round(bmax, 2)])
            mean_out.append([x, round(bsum / max(bcnt, 1), 2)])
            bmax, bsum, bcnt, edge = 0.0, 0.0, 0, edge + bucket
    return out, mean_out, cum / 60000.0


def _rolling_mean_series(mean_pts):
    """Smooth the per-bucket mean series into a CapFrameX-style moving-average line.
    Centered rolling mean, window ~ max(5, len//100). Returns [[x, ms], ...] (same x's)."""
    n = len(mean_pts)
    if n == 0:
        return []
    w = max(5, n // 100)
    half = w // 2
    ys = [p[1] for p in mean_pts]
    out = []
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        seg = ys[lo:hi]
        out.append([mean_pts[i][0], round(sum(seg) / len(seg), 2)])
    return out


def _chart_altitude_series(session_dir, total_min):
    """Altitude points [[x_min, alt_ft], ...] from telemetry.csv aligned to the frametime
    chart's minutes axis (offset by the head trim), or None if no telemetry / no altitude.
    """
    tel = _read_telemetry(session_dir)
    if not tel:
        return None
    out = []
    for r in tel:
        alt = r.get("alt_ft")
        if alt is None or alt > ALT_SANE_FT:
            continue
        x = (r["wall_ms"] - HEAD_TRIM_S * 1000.0) / 60000.0
        if x < 0 or x > total_min + 0.5:
            continue
        out.append([round(x, 4), int(alt)])
    return out or None


def _variance_bins(ft):
    """Frame-to-frame |Δ| binned into <2/<4/<8/<12/>12 ms; returns list of percents."""
    if not ft or len(ft) < 2:
        return None
    counts = [0, 0, 0, 0, 0]
    prev = ft[0]
    for v in ft[1:]:
        d = abs(v - prev)
        prev = v
        if d < 2:
            counts[0] += 1
        elif d < 4:
            counts[1] += 1
        elif d < 8:
            counts[2] += 1
        elif d < 12:
            counts[3] += 1
        else:
            counts[4] += 1
    tot = sum(counts) or 1
    return [round(c / tot * 100, 2) for c in counts]


def _phase_bars_html(phases):
    """Ground/Climb/Cruise/Descent P99 bars as themed HTML, or an 'unavailable' note."""
    order = [("ground", "Ground"), ("climb", "Climb"),
             ("cruise", "Cruise"), ("descent", "Descent")]
    active = [(k, l) for k, l in order
              if phases and k in phases and phases[k].get("frame_count", 0) > 0]
    if not active:
        return ('<div class="note">Flight phase data unavailable — SimConnect wasn\'t '
                'active for this flight. New flights populate Ground / Climb / Cruise / '
                'Descent by vertical speed.</div>')
    mx = max(phases[k]["p99_ft"] for k, _ in active)
    mx = max(mx * 1.1, 25.0)
    rows = ""
    for k, l in order:
        if not phases or k not in phases or phases[k].get("frame_count", 0) == 0:
            rows += (f'<div class="phase-row"><span class="lbl">{l}</span>'
                     f'<div class="ph-track"></div>'
                     f'<span class="num" style="color:var(--text-faint)">—</span></div>')
            continue
        p99 = phases[k]["p99_ft"]
        w = min(p99 / mx * 100, 100)
        col = ("var(--good)" if p99 <= 20 else
               ("var(--ok)" if p99 <= 33.3 else "var(--bad)"))
        rows += (f'<div class="phase-row"><span class="lbl">{l}</span>'
                 f'<div class="ph-track"><div class="ph-fill" '
                 f'style="width:{w:.0f}%;background:{col}"></div></div>'
                 f'<span class="num" style="color:{col}">{p99:.1f} ms</span></div>')
    return f'<div class="phase">{rows}</div>'


def write_report(html_path, session_id, settings, stats, vram,
                 frametimes_in_order, sorted_frametimes, prior_sessions=None,
                 driver_version=None, sim_version=None):
    def fmt(v):
        return "n/a" if v is None else v

    tlod = settings.get("tlod")
    olod = settings.get("olod")
    aircraft = settings.get("aircraft") or "n/a"
    route = _display_route(settings.get("simbrief_route") or "")
    ts_disp = ""  # filled from session_id timestamp below if available

    chip_pairs = [
        ("Aircraft", html.escape(str(aircraft))),
        ("TLOD", f"{fmt(tlod)} / OLOD {fmt(olod)}"),
    ]
    if route:
        chip_pairs.append(("Route", html.escape(route)))
    chip_pairs += [
        ("Driver", html.escape(str(fmt(driver_version)))),
        ("Sim", html.escape(str(fmt(sim_version)))),
    ]
    chips_html = "".join(
        f'<span class="chip">{label} <b>{val}</b></span>' for label, val in chip_pairs)

    # Metric bars (both FPS and ms; the unit button swaps them client-side).
    def sfps(ms):
        return round(1000.0 / ms, 1) if ms else None

    def sms(fps):
        return round(1000.0 / fps, 2) if fps else None

    metrics = [
        {"k": "Average", "fps": stats.get("avg_fps"), "ms": stats.get("avg_ft_ms")},
        {"k": "P95", "fps": sfps(stats.get("p95_ft_ms")), "ms": stats.get("p95_ft_ms")},
        {"k": "P99", "fps": sfps(stats.get("p99_ft_ms")), "ms": stats.get("p99_ft_ms")},
        {"k": "P99.9", "fps": sfps(stats.get("p999_ft_ms")), "ms": stats.get("p999_ft_ms")},
        {"k": "1% low", "fps": stats.get("one_pct_low_fps"), "ms": sms(stats.get("one_pct_low_fps"))},
        {"k": "0.1% low", "fps": stats.get("point_one_pct_low_fps"), "ms": sms(stats.get("point_one_pct_low_fps"))},
    ]

    # Stutter pie (smooth / stutter 33-50ms / spike >50ms) and variance pie.
    fc = stats.get("frame_count") or 0
    stut_n = stats.get("stutter_count") or 0
    spike_n = stats.get("spike_count") or 0
    smooth_n = max(fc - stut_n, 0)
    mid_n = max(stut_n - spike_n, 0)
    pct = (lambda x: round(x / fc * 100, 2) if fc else 0.0)
    stut_pie = [
        {"label": f"Smooth: {pct(smooth_n)}%", "color": "var(--accent)"},
        {"label": f"Stutter 33-50ms: {pct(mid_n)}%", "color": "var(--amber)"},
        {"label": f"Spike >50ms: {pct(spike_n)}%", "color": "var(--bad)"},
    ]
    vb = _variance_bins(frametimes_in_order)
    if vb:
        var_pie = [
            {"label": f"< 2ms: {vb[0]}%", "color": "var(--accent)"},
            {"label": f"< 4ms: {vb[1]}%", "color": "var(--blue2)"},
            {"label": f"< 8ms: {vb[2]}%", "color": "var(--amber)"},
            {"label": f"< 12ms: {vb[3]}%", "color": "var(--orange)"},
            {"label": f"> 12ms: {vb[4]}%", "color": "var(--bad)"},
        ]
    else:
        var_pie = [{"label": "no data", "color": "var(--text-faint)"}]

    rd_json = json.dumps({"metrics": metrics, "pies": {"stut": stut_pie, "var": var_pie}})
    session_id_json = json.dumps(session_id)

    # Zoomable Chart.js series: frametime (spike-preserving downsample) + optional altitude.
    ft_points, mean_points, total_min = _chart_frametime_series(frametimes_in_order)
    alt_points = _chart_altitude_series(os.path.dirname(html_path), total_min)
    over_count = sum(1 for v in frametimes_in_order if v > 100.0)
    over_max = stats.get("max_ft_ms") or (
        max(frametimes_in_order) if frametimes_in_order else 0.0)
    # Light rolling mean over the per-bucket means -> the moving-average line.
    mavg_points = _rolling_mean_series(mean_points)
    # Quartiles for the Interquartile-range Y-axis option (sorted list is passed in).
    q1 = q3 = None
    if sorted_frametimes:
        m = len(sorted_frametimes)
        q1 = round(sorted_frametimes[int(m * 0.25)], 2)
        q3 = round(sorted_frametimes[min(int(m * 0.75), m - 1)], 2)
    chart_json = json.dumps({"ft": ft_points, "mavg": mavg_points, "alt": alt_points,
                             "target": TARGET_FRAMETIME_MS,
                             "stutter": round(STUTTER_FRAMETIME_MS, 1),
                             "avg_fps": stats.get("avg_fps"),
                             "q1": q1, "q3": q3,
                             "over_count": over_count,
                             "over_max": round(over_max, 2)})
    phase_html = _phase_bars_html(stats.get("phases"))

    if vram.get("available"):
        peak = vram["peak_vram_mb"]
        total = vram["total_vram_mb"]
        vpct = vram["peak_pct"]
        avg = vram["avg_vram_mb"]
        head = round((total - peak) / 1024, 1)
        vram_html = (
            f'<div class="bar-track"><div class="bar-fill" style="width:{vpct}%"></div></div>'
            f'<div class="vram-nums"><span>{peak:,} MB peak</span>'
            f'<span>{vpct}% of {round(total / 1024)} GB</span></div>'
            f'<div class="vram-nums"><span>avg {avg:,} MB</span>'
            f'<span>headroom {head} GB</span></div>'
            f'<div class="vram-nums" style="color:var(--text-faint);margin-top:10px">'
            f'<span>(CapFrameX can\'t capture this)</span></div>')
    else:
        vram_html = ('<div class="vram-nums"><span>VRAM not captured</span>'
                     '<span>install nvidia-ml-py</span></div>')

    cpu_gpu = ""
    if stats.get("gpu_bound_pct") is not None:
        cpu_gpu = (f"{stats['cpu_bound_pct']}% CPU-bound / "
                   f"{stats['gpu_bound_pct']}% GPU-bound · "
                   f"avg CPU {stats.get('avg_cpu_busy_ms', '?')} ms / "
                   f"GPU {stats.get('avg_gpu_busy_ms', '?')} ms")

    page = f'''<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MSFS Performance — {session_id}</title>
<style>{THEME_BASE_CSS}{REPORT_CSS}</style>
</head>
<body>
  <header>
    <div>
      <div class="title">MSFS Performance Analysis</div>
      <div class="sub mono">{session_id}</div>
    </div>
    <div class="chips">{chips_html}</div>
    <div class="spacer"></div>
    <a class="navbtn disabled" id="navPrev" title="Older flight">&#8249; Prev</a>
    <a class="navbtn disabled" id="navNext" title="Newer flight">Next &#8250;</a>
    <button class="toggle" id="themeBtn" onclick="toggleTheme()">◐ Light</button>
  </header>

  <div class="tabs">
    <div class="tab active" id="tabFt" onclick="showGraph('frametime')">Frametime</div>
    <div class="tab" id="tabFps" onclick="showGraph('fps')">FPS</div>
  </div>

  <div class="layout">
    <div class="panel">
      <div class="panel-h">Metrics<button class="unit-btn" id="unitBtn" onclick="toggleUnit()">FPS</button></div>
      <div class="metrics" id="metrics"></div>
    </div>
    <div class="rcol">
      <div class="panel">
        <div class="panel-h" id="graphTitle">Frametime over flight · ms (lower = smoother)
          <span class="graph-ctrls">
            <select class="yscale-sel" id="yScale" onchange="window.applyScale&&applyScale(this.value)">
              <option value="100" selected>0-100 ms</option>
              <option value="80">0-80 ms</option>
              <option value="60">0-60 ms</option>
              <option value="40">0-40 ms</option>
              <option value="30">0-30 ms</option>
              <option value="20">0-20 ms</option>
              <option value="10">0-10 ms</option>
              <option value="fit">Full fit</option>
              <option value="iqr">Interquartile range</option>
            </select>
            <button class="unit-btn" id="zoomReset" onclick="resetZoom()">Reset zoom</button>
          </span>
        </div>
        <div class="graph-wrap" style="height:300px;position:relative">
          <canvas id="ftChart" role="img" aria-label="frametime over the flight, with altitude overlay"></canvas>
          <div id="spikeBadge" class="spike-badge" style="display:none"></div>
        </div>
        <div class="chart-legend" id="chartLegend"></div>
        <div class="graph-hint">Scroll to zoom · drag to pan · double-click to reset</div>
      </div>
      <div class="panel">
        <div class="panel-h">Moving average · what the flight actually felt like (ms)</div>
        <div class="graph-wrap" style="height:150px;position:relative">
          <canvas id="ftAvgChart" role="img" aria-label="moving-average frametime over the flight"></canvas>
        </div>
        <div class="graph-hint">The orange line above, on its own zoomed scale — gentle = smooth.</div>
      </div>
    </div>
  </div>

  <div class="lower">
    <div class="panel">
      <div class="pietabs">
        <div class="pietab active" id="ptStut" onclick="showPie('stut')">Stuttering</div>
        <div class="pietab" id="ptVar" onclick="showPie('var')">Variances</div>
      </div>
      <div class="pie-wrap">
        <svg viewBox="0 0 120 120" width="104" height="104" role="img" aria-label="stutter breakdown">
          <circle cx="60" cy="60" r="50" fill="var(--accent)"/>
          <line x1="60" y1="10" x2="60" y2="60" stroke="var(--bad)" stroke-width="1"/>
        </svg>
        <div class="legend" id="pieLegend"></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-h">VRAM peak</div>
      <div class="vram-body">{vram_html}</div>
    </div>
  </div>

  <div class="panel" style="margin-bottom:12px">
    <div class="panel-h">Flight phase breakdown · P99 frametime per phase</div>
    {phase_html}
  </div>

  <footer>
    {stats.get('frame_count', 0):,} frames · {stats.get('duration_seconds', 0)} s · {cpu_gpu}<br/>
    Captured by MSFS Silent Performance Logger · raw per-frame data in frametimes.csv
  </footer>

<script>var RD = {rd_json};</script>
<script>var CHART = {chart_json};</script>
<script>var THIS_SESSION = {session_id_json};</script>
<script>{THEME_JS}</script>
<script>{REPORT_JS}</script>
<script src="../../sessions_nav.js"></script>
<script>{NAV_JS}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/hammer.js/2.0.8/hammer.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/chartjs-plugin-zoom/2.0.1/chartjs-plugin-zoom.min.js"></script>
<script>{CHART_JS}</script>
</body>
</html>'''

    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(page)


# --------------------------------------------------------------------------- #
# Index files
# --------------------------------------------------------------------------- #

def write_sessions_nav(sessions):
    """Write Sessions/sessions_nav.js — the shared, always-current ordered flight list
    that every report.html loads to wire its prev/next arrows. A .js file (global var)
    rather than JSON because browsers block fetch() of local file:// resources but load
    <script src> fine. Order matches index.json (chronological: oldest -> newest)."""
    entries = []
    for s in sessions:
        folder = (s.get("folder") or "").replace("\\", "/")
        if not folder:
            continue
        tlod = s.get("tlod")
        ac = s.get("aircraft") or ""
        disp = s.get("timestamp_display") or s.get("session_id") or ""
        label = " · ".join(p for p in (disp, ac,
                                            (f"TLOD {tlod}" if tlod is not None else "")) if p)
        track = "primary" if is_primary_aircraft(ac) else "reference"
        entries.append({"id": s.get("session_id"), "folder": folder,
                        "label": label, "track": track})
    out = os.path.join(SESSIONS_DIR, "sessions_nav.js")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("window.SESSIONS_NAV = " + json.dumps(entries, indent=1) + ";\n")


def update_index(session_entry):
    """Append the session to Sessions/index.json and index.csv."""
    os.makedirs(SESSIONS_DIR, exist_ok=True)
    index_json = os.path.join(SESSIONS_DIR, "index.json")
    index_csv = os.path.join(SESSIONS_DIR, "index.csv")

    # JSON
    data = {"version": "1.0", "sessions": []}
    if os.path.isfile(index_json):
        try:
            with open(index_json, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if "sessions" not in data:
                data["sessions"] = []
        except Exception as exc:  # noqa: BLE001
            logging.warning("Could not read index.json, starting fresh: %s", exc)
            data = {"version": "1.0", "sessions": []}
    data["sessions"].append(session_entry)
    data["last_updated"] = datetime.now().isoformat(timespec="seconds")
    with open(index_json, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)

    # Keep the shared prev/next flight list current for every report's arrows.
    write_sessions_nav(data["sessions"])

    # CSV (human glance)
    fields = ["session_id", "timestamp", "driver_version", "sim_version", "aircraft",
              "route", "tlod", "olod", "p99_ft_ms", "stutter_pct", "consistency_pct",
              "avg_fps", "peak_vram_mb", "frame_count", "folder"]
    # If an older version of this script wrote index.csv without sim_version,
    # rebuild it from index.json (the source of truth) so the header stays valid.
    needs_rewrite = False
    if os.path.isfile(index_csv):
        with open(index_csv, "r", encoding="utf-8", newline="") as fh:
            existing_header = next(csv.reader(fh), [])
        needs_rewrite = existing_header != fields
    if needs_rewrite:
        with open(index_csv, "w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields)
            writer.writeheader()
            for s in data["sessions"]:
                writer.writerow({k: s.get(k, "") for k in fields})
        return

    write_header = not os.path.isfile(index_csv)
    with open(index_csv, "a", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        if write_header:
            writer.writeheader()
        writer.writerow({k: session_entry.get(k, "") for k in fields})


# --------------------------------------------------------------------------- #
# Combined report (TLOD vs smoothness + VRAM across all flights)
# --------------------------------------------------------------------------- #

def _display_route(route):
    """Strip leading flight-number prefix for display: '1809 KSFO-KRDM' → 'KSFO-KRDM'."""
    if not route:
        return ""
    parts = route.split()
    if len(parts) >= 2 and "-" in parts[-1]:
        return parts[-1]
    return route




# Combined dashboard specific CSS.
DASH_CSS = """
  .cards { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px; }
  .acard { padding:12px 15px; }
  .acard .name { font-size:14px; font-weight:600; margin-bottom:8px; display:flex; align-items:center; gap:8px; }
  .dot { width:11px; height:11px; border-radius:3px; }
  .agrid { display:grid; grid-template-columns:1fr 1fr; gap:6px 14px; }
  .lab { font-size:11px; color:var(--text-dim); }
  .aval { font-family:Consolas,monospace; font-size:18px; font-weight:600; }
  .ctrls { display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-wrap:wrap; }
  .seg { display:flex; border:1px solid var(--border); border-radius:6px; overflow:hidden; }
  .seg button { background:var(--panel-2); color:var(--text-dim); border:none; padding:6px 14px; font-size:12px; cursor:pointer; }
  .seg button.active { background:var(--accent); color:#fff; font-weight:600; }
  .tlodf { display:flex; gap:6px; flex-wrap:wrap; }
  .tchip { display:flex; align-items:center; gap:5px; background:var(--panel-2); border:1px solid var(--border);
    border-radius:6px; padding:4px 9px; font-size:12px; cursor:pointer; color:var(--text-dim); user-select:none; }
  .tchip.on { border-color:var(--accent); color:var(--text); }
  .tchip input { margin:0; accent-color:var(--accent); }
  .tchip .ct { color:var(--text-faint); font-size:11px; }
  .charts { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px; }
  .graph-wrap { padding:8px 12px 12px; }
  .legend { display:flex; gap:16px; padding:0 13px 10px; font-size:11px; color:var(--text-dim); }
  .legend span { display:flex; align-items:center; gap:6px; }
  .legend .sw { width:10px; height:10px; border-radius:2px; }
  .note { background:var(--panel); border:1px solid var(--border); border-radius:7px;
    padding:11px 15px; margin-bottom:12px; font-size:12px; color:var(--text-dim); }
  .note b { color:var(--text); }
  table { width:100%; border-collapse:collapse; font-size:12px; background:var(--panel);
    border:1px solid var(--border); border-radius:7px; overflow:hidden; }
  th,td { text-align:left; padding:7px 11px; border-bottom:1px solid var(--grid); }
  th { color:var(--text-faint); font-weight:500; font-size:10px; text-transform:uppercase; letter-spacing:.05em; }
  tbody tr:last-child td { border-bottom:none; }
  td.mono { font-family:Consolas,monospace; }
  .g-good { color:var(--good); } .g-ok { color:var(--ok); } .g-bad { color:var(--bad); } .g-na { color:var(--text-faint); }
  .covbody { padding:11px 15px 14px; }
  .covrec { font-size:15px; font-weight:600; margin-bottom:10px; }
  .covrec .pick { color:var(--accent); }
  .covgrid { border-collapse:collapse; font-size:12px; margin-bottom:8px; background:none; border:none; }
  .covgrid th { color:var(--text-faint); font-weight:500; padding:3px 10px; text-align:center;
    font-size:11px; text-transform:none; letter-spacing:0; border:none; }
  .covgrid td { padding:3px 10px; text-align:center; border:none; }
  .covgrid td.lbl { text-align:left; color:var(--text-dim); }
  .covcell { font-family:Consolas,monospace; border-radius:4px; padding:2px 9px; }
  .cov0 { background:rgba(224,83,61,0.18); color:var(--bad); }
  .cov1 { background:rgba(240,168,48,0.18); color:var(--ok); }
  .cov3 { background:rgba(91,191,91,0.18); color:var(--good); }
  .covnext { font-size:12px; color:var(--text-dim); margin-top:4px; }
  .covnote { font-size:11px; color:var(--text-faint); margin-top:6px; }
"""

# Combined dashboard JS: renders the two by-TLOD bar charts from injected DD,
# the TLOD filter (with counts), the Combined/By-aircraft toggle, and table filtering.
DASH_JS = """
  (function(){
    var VIEW='combined';
    var SHOW_REF=true;
    var TLODS=DD.tlods, COUNTS=DD.counts, SELECTED={};
    TLODS.forEach(function(t){SELECTED[t]=true;});
    function grade(v){return v<=20?'var(--good)':(v<=33.3?'var(--ok)':'var(--bad)');}
    function activeIdx(){return TLODS.map(function(t,i){return i;}).filter(function(i){return SELECTED[TLODS[i]];});}
    function barChart(series,maxY,refY,refLabel,colorMode){
      var W=420,H=230,padL=34,padR=12,padT=14,padB=34;
      var plotW=W-padL-padR,plotH=H-padT-padB;
      var idxs=activeIdx(),groups=Math.max(idxs.length,1),gw=plotW/groups;
      function y(v){return padT+plotH-(v/maxY)*plotH;}
      var isCeil=refLabel.indexOf('12')>-1, rc=isCeil?'var(--ceiling)':'var(--target)';
      var svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="metric by TLOD">';
      [0,0.5,1].forEach(function(f){var yy=padT+plotH-f*plotH;
        svg+='<line x1="'+padL+'" y1="'+yy+'" x2="'+(W-padR)+'" y2="'+yy+'" stroke="var(--grid)" stroke-width="1"/>';
        svg+='<text x="'+(padL-5)+'" y="'+(yy+3)+'" font-size="9" fill="var(--text-faint)" text-anchor="end">'+(maxY*f).toFixed(0)+'</text>';});
      if(refY<=maxY){var ry=y(refY);
        svg+='<line x1="'+padL+'" y1="'+ry+'" x2="'+(W-padR)+'" y2="'+ry+'" stroke="'+rc+'" stroke-dasharray="5 4" stroke-width="1.2"/>';
        svg+='<text x="'+(W-padR)+'" y="'+(ry-4)+'" font-size="9" fill="'+rc+'" text-anchor="end">'+refLabel+'</text>';}
      if(idxs.length===0){svg+='<text x="'+(padL+plotW/2)+'" y="'+(padT+plotH/2)+'" font-size="11" fill="var(--text-faint)" text-anchor="middle">Select a TLOD to show data</text>';}
      idxs.forEach(function(oi,gi){var cx=padL+gi*gw;
        svg+='<text x="'+(cx+gw/2)+'" y="'+(H-padB+16)+'" font-size="10" fill="var(--text-dim)" text-anchor="middle">'+TLODS[oi]+'</text>';
        if(VIEW==='combined'){var v=series.combined[oi];if(v==null)return;
          var bw=gw*0.5,bx=cx+(gw-bw)/2,col=colorMode==='grade'?grade(v):'var(--accent)';
          svg+='<rect x="'+bx+'" y="'+y(v)+'" width="'+bw+'" height="'+(padT+plotH-y(v))+'" fill="'+col+'" rx="2"/>';
          svg+='<text x="'+(bx+bw/2)+'" y="'+(y(v)-4)+'" font-size="9" fill="var(--text)" text-anchor="middle">'+v.toFixed(1)+'</text>';
        }else{var bw2=gw*0.3;
          [['fenix','var(--fenix)'],['pmdg','var(--pmdg)']].forEach(function(s,si){var v=series[s[0]][oi];if(v==null)return;
            var bx=cx+gw/2-bw2+si*bw2;
            svg+='<rect x="'+bx+'" y="'+y(v)+'" width="'+(bw2-2)+'" height="'+(padT+plotH-y(v))+'" fill="'+s[1]+'" rx="2"/>';
            svg+='<text x="'+(bx+bw2/2-1)+'" y="'+(y(v)-4)+'" font-size="8" fill="var(--text)" text-anchor="middle">'+v.toFixed(1)+'</text>';});}
      });
      svg+='<line x1="'+padL+'" y1="'+(padT+plotH)+'" x2="'+(W-padR)+'" y2="'+(padT+plotH)+'" stroke="var(--border)" stroke-width="1"/>';
      svg+='<text x="'+(padL+plotW/2)+'" y="'+(H-3)+'" font-size="9" fill="var(--text-faint)" text-anchor="middle">TLOD setting</text>';
      return svg+'</svg>';
    }
    function legend(mode){
      if(VIEW==='byac')return '<span><span class="sw" style="background:var(--fenix)"></span>Fenix</span><span><span class="sw" style="background:var(--pmdg)"></span>PMDG</span>';
      if(mode==='grade')return '<span><span class="sw" style="background:var(--good)"></span>\\u226420ms</span><span><span class="sw" style="background:var(--ok)"></span>\\u226433ms</span><span><span class="sw" style="background:var(--bad)"></span>&gt;33ms</span>';
      return '<span><span class="sw" style="background:var(--accent)"></span>avg peak VRAM</span>';
    }
    function buildFilter(){var h='';
      TLODS.forEach(function(t){h+='<label class="tchip '+(SELECTED[t]?'on':'')+'" id="tc'+t+'">'+
        '<input type="checkbox" '+(SELECTED[t]?'checked':'')+' onchange="toggleTlod('+t+',this.checked)"/>'+
        t+' <span class="ct">('+(COUNTS[t]||0)+')</span></label>';});
      document.getElementById('tlodFilter').innerHTML=h;}
    window.toggleTlod=function(t,on){SELECTED[t]=on;document.getElementById('tc'+t).classList.toggle('on',on);render();};
    window.setView=function(v){VIEW=v;
      document.getElementById('segCombined').classList.toggle('active',v==='combined');
      document.getElementById('segByAc').classList.toggle('active',v==='byac');render();};
    function render(){
      document.getElementById('chartP99').innerHTML=barChart(DD.p99,30,16.67,'16.67ms target','grade');
      document.getElementById('chartVram').innerHTML=barChart(DD.vram,12.5,12,'12 GB ceiling','flat');
      document.getElementById('legP99').innerHTML=legend('grade');
      document.getElementById('legVram').innerHTML=legend('flat');
      Array.prototype.forEach.call(document.querySelectorAll('#tbody tr'),function(tr){
        var t=tr.getAttribute('data-tlod');
        var isRef=tr.getAttribute('data-primary')==='0';
        var tlodOk=(t==null||t==='n/a'||SELECTED[t]);
        tr.style.display=(tlodOk && (!isRef||SHOW_REF))?'':'none';});
    }
    window.toggleRefRows=function(on){SHOW_REF=on;render();};
    window.toggleRef=function(){
      var cards=document.getElementById('refCards');
      var showBtn=document.getElementById('refShowBtn');
      if(!cards)return;
      var hide=cards.style.display!=='none';
      cards.style.display=hide?'none':'';
      if(showBtn)showBtn.style.display=hide?'':'none';
      try{localStorage.setItem('cfxRefHidden',hide?'1':'0');}catch(e){}
    };
    try{if(localStorage.getItem('cfxRefHidden')==='1'){
      var c=document.getElementById('refCards'),b=document.getElementById('refShowBtn');
      if(c){c.style.display='none';if(b)b.style.display='';}
    }}catch(e){}
    buildFilter();render();
  })();
"""


def rebuild_combined_report():
    """Regenerate Sessions/combined_report.html as the CapFrameX-style dashboard."""
    index_json = os.path.join(SESSIONS_DIR, "index.json")
    if not os.path.isfile(index_json):
        return
    try:
        from collections import defaultdict
        with open(index_json, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        sessions = data.get("sessions", [])

        by = defaultdict(lambda: {"p99": [], "vram": []})
        tlod_set = set()
        for s in sessions:
            tl = s.get("tlod")
            p = s.get("p99_ft_ms")
            if tl is None or p is None:
                continue
            tlod_set.add(tl)
            ac = s.get("aircraft") or "Other"
            by[(ac, tl)]["p99"].append(p)
            v = s.get("peak_vram_mb")
            if v:
                by[(ac, tl)]["vram"].append(v)
        tlods = sorted(tlod_set)

        def series(metric, ac=None):
            # ac=None is the "combined" line — restrict it to primary aircraft (Fenix/PMDG)
            # so reference flights (e.g. Citation) never pollute the baseline trend.
            out = []
            for tl in tlods:
                vals = []
                for (a, t), d in by.items():
                    if t != tl or (ac and a != ac):
                        continue
                    if ac is None and not is_primary_aircraft(a):
                        continue
                    vals += d[metric]
                if not vals:
                    out.append(None)
                elif metric == "vram":
                    out.append(round(sum(vals) / len(vals) / 1024, 1))
                else:
                    out.append(round(sum(vals) / len(vals), 1))
            return out

        # Per-TLOD flight counts on the trend chart — primary aircraft only (matches the goal).
        counts = {tl: sum(1 for s in sessions
                          if s.get("tlod") == tl and s.get("p99_ft_ms") is not None
                          and is_primary_aircraft(s.get("aircraft")))
                  for tl in tlods}

        DD = {
            "tlods": tlods,
            "counts": {str(t): counts[t] for t in tlods},
            "p99": {"combined": series("p99"), "fenix": series("p99", "Fenix"),
                    "pmdg": series("p99", "PMDG")},
            "vram": {"combined": series("vram"), "fenix": series("vram", "Fenix"),
                     "pmdg": series("vram", "PMDG")},
        }
        dd_json = json.dumps(DD)

        # Per-aircraft summary cards.
        def aircraft_card(ac, dot, sub=""):
            flights = [s for s in sessions
                       if s.get("aircraft") == ac and s.get("p99_ft_ms") is not None]
            if not flights:
                return ""
            p99s = [s["p99_ft_ms"] for s in flights]
            tl_list = sorted({s["tlod"] for s in flights if s.get("tlod") is not None})
            avgp = round(sum(p99s) / len(p99s), 1)
            bestp = round(min(p99s), 1)
            sub_html = (f'<div class="lab" style="margin-top:-4px;font-size:10px">{sub}</div>'
                        if sub else "")
            return (
                f'<div class="panel acard"><div class="name">'
                f'<span class="dot" style="background:{dot}"></span>{html.escape(ac)}</div>'
                f'{sub_html}'
                f'<div class="agrid">'
                f'<div><div class="lab">Flights</div><div class="aval">{len(flights)}</div></div>'
                f'<div><div class="lab">Avg P99</div><div class="aval g-{grade_p99(avgp)}">{avgp} ms</div></div>'
                f'<div><div class="lab">Best P99</div><div class="aval g-{grade_p99(bestp)}">{bestp} ms</div></div>'
                f'<div><div class="lab">TLODs</div><div class="aval" style="font-size:13px">'
                f'{"·".join(str(t) for t in tl_list) or "—"}</div></div>'
                f'</div></div>')

        cards_html = "".join(aircraft_card(ac, "var(--fenix)" if ac == "Fenix" else "var(--pmdg)")
                             for ac in COVERAGE_AIRCRAFT)
        if not cards_html:
            cards_html = ('<div class="panel acard"><div class="lab">'
                          'No flights logged yet.</div></div>')

        # Reference-aircraft cards (Citation etc.) — shown alongside but flagged as not part of
        # the baseline, and collapsible via a small toggle (persisted in localStorage).
        ref_acs = sorted({s.get("aircraft") for s in sessions
                          if s.get("aircraft") and s.get("p99_ft_ms") is not None
                          and not is_primary_aircraft(s.get("aircraft"))})
        ref_cards = "".join(aircraft_card(ac, "var(--accent)", "reference · not in baseline")
                            for ac in ref_acs)
        if ref_cards:
            ref_cards_html = (
                '<div class="cards" id="refCards">'
                '<button class="toggle" id="refHideBtn" onclick="toggleRef()" '
                'style="align-self:flex-start">Hide reference</button>'
                f'{ref_cards}</div>'
                '<button class="toggle" id="refShowBtn" onclick="toggleRef()" '
                'style="display:none;margin:0 0 12px">Show reference aircraft</button>')
            ref_toggle_html = (
                '<label class="tchip" id="refRowChip" style="margin-right:6px">'
                '<input type="checkbox" id="refRows" checked onchange="toggleRefRows(this.checked)"/>'
                ' Include reference</label>')
        else:
            ref_cards_html = ""
            ref_toggle_html = ""

        # Flight table.
        rows = ""
        for s in sorted(sessions, key=lambda x: x.get("timestamp", ""), reverse=True):
            p = s.get("p99_ft_ms")
            g = grade_p99(p)
            vmb = s.get("peak_vram_mb")
            vdisp = f"{vmb / 1024:.1f} GB" if vmb else "n/a"
            ac = s.get("aircraft") or "n/a"
            tl = s.get("tlod")
            tld = str(tl) if tl is not None else "n/a"
            folder = (s.get("folder") or "").replace("\\", "/")
            href = f"{folder}/report.html" if folder else ""
            route = _display_route(s.get("route") or "")
            rdisp = html.escape(route) if route else "—"
            link = (f'<a href="{href}" style="color:var(--accent);text-decoration:none">open</a>'
                    if href else "")
            prim = "1" if is_primary_aircraft(s.get("aircraft")) else "0"
            rows += (f'<tr data-tlod="{tld}" data-primary="{prim}">'
                     f'<td>{s.get("timestamp_display", "")}</td>'
                     f'<td>{html.escape(ac)}</td><td class="mono">{rdisp}</td>'
                     f'<td class="mono">{s.get("driver_version") or "n/a"}</td>'
                     f'<td class="mono">{tld}</td>'
                     f'<td class="mono g-{g}">{p} ms</td>'
                     f'<td class="mono">{s.get("stutter_pct", "n/a")}%</td>'
                     f'<td class="mono">{vdisp}</td><td>{link}</td></tr>')
        if not rows:
            rows = ('<tr><td colspan="9" style="color:var(--text-faint)">'
                    'No flights logged yet.</td></tr>')

        # Knee note.
        comb = DD["p99"]["combined"]
        smooth = [(tlods[i], comb[i]) for i in range(len(tlods))
                  if comb[i] is not None and comb[i] <= 20]
        knee = ""
        if smooth:
            bt, bp = max(smooth, key=lambda x: x[0])
            knee = (f'Highest TLOD still smooth (avg P99 &le; 20ms): '
                    f'<b>TLOD {bt}</b> at {bp}ms avg. ')
        knee += ('Note: averages can mix drivers — use the table\'s driver column to '
                 'sanity-check before comparing TLODs head to head.')

        # Headline counts are the baseline (primary) flights; reference flights are noted separately.
        n_flights = sum(1 for s in sessions if s.get("p99_ft_ms") is not None
                        and is_primary_aircraft(s.get("aircraft")))
        n_ref = sum(1 for s in sessions if s.get("p99_ft_ms") is not None
                    and not is_primary_aircraft(s.get("aircraft")))
        aircraft_present = sorted({s.get("aircraft") for s in sessions
                                   if s.get("aircraft") and s.get("p99_ft_ms") is not None
                                   and is_primary_aircraft(s.get("aircraft"))})
        drivers = sorted({s.get("driver_version") for s in sessions if s.get("driver_version")})
        tlod_range = (f"{tlods[0]}–{tlods[-1]}" if len(tlods) > 1
                      else (str(tlods[0]) if tlods else "—"))
        chips = (
            f'<span class="chip">Aircraft <b>{html.escape(", ".join(aircraft_present) or "—")}</b></span>'
            f'<span class="chip">TLOD <b>{tlod_range}</b></span>'
            f'<span class="chip">Drivers <b>{len(drivers)} tested</b></span>')

        # Coverage / "what to fly next" panel.
        cov = compute_coverage(sessions)
        tgt = cov["target"]
        cov_grid = ('<table class="covgrid"><tr><th></th>'
                    + "".join(f'<th>{t}</th>' for t in COVERAGE_TLODS) + '</tr>')
        for ac in COVERAGE_AIRCRAFT:
            cov_grid += f'<tr><td class="lbl">{ac}</td>'
            for t in COVERAGE_TLODS:
                c = cov["counts"][(ac, t)]
                cls = "cov0" if c == 0 else ("cov1" if c < tgt else "cov3")
                cov_grid += f'<td><span class="covcell {cls}">{c}/{tgt}</span></td>'
            cov_grid += '</tr>'
        cov_grid += '</table>'
        if cov["gaps"]:
            g0 = cov["gaps"][0]
            cov_rec = (f'Fly next → <span class="pick">{g0["aircraft"]} @ TLOD '
                       f'{g0["tlod"]}</span> ({g0["count"]} of {tgt})')
            nxt = ", ".join(f'{g["aircraft"]} {g["tlod"]}' for g in cov["gaps"][:4])
            cov_next = (f'<div class="covnext">Next up: {nxt} · '
                        f'<b>{cov["total_remaining"]} flights</b> to a full set</div>')
        else:
            cov_rec = 'Coverage complete — even spread reached, ready to finalize a TLOD.'
            cov_next = ''
        coverage_panel = (
            f'<div class="panel" style="margin-bottom:12px"><div class="panel-h">'
            f'Coverage &amp; what to fly next</div><div class="covbody">'
            f'<div class="covrec">{cov_rec}</div>{cov_grid}{cov_next}'
            f'<div class="covnote">Target {tgt} flights per cell · floor TLOD 100 '
            f'(80 excluded as visually-safe)</div></div></div>')

        page = f'''<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MSFS Performance — All Flights</title>
<style>{THEME_BASE_CSS}{DASH_CSS}</style>
</head>
<body>
  <header>
    <div>
      <div class="title">MSFS Performance — All Flights</div>
      <div class="sub mono">{n_flights} baseline flights logged{f" · {n_ref} reference" if n_ref else ""}</div>
    </div>
    <div class="chips">{chips}</div>
    <div class="spacer"></div>
    <button class="toggle" id="themeBtn" onclick="toggleTheme()">◐ Light</button>
  </header>

  <div class="cards">{cards_html}</div>
  {ref_cards_html}

  {coverage_panel}

  <div class="ctrls">
    <div class="seg">
      <button id="segCombined" class="active" onclick="setView('combined')">Combined</button>
      <button id="segByAc" onclick="setView('byac')">By aircraft</button>
    </div>
    <div class="spacer" style="flex:1"></div>
    {ref_toggle_html}
    <span style="font-size:11px;color:var(--text-faint)">Show TLOD:</span>
    <div class="tlodf" id="tlodFilter"></div>
  </div>

  <div class="charts">
    <div class="panel">
      <div class="panel-h">Avg P99 frametime by TLOD · ms (lower = smoother)</div>
      <div class="graph-wrap"><div id="chartP99"></div></div>
      <div class="legend" id="legP99"></div>
    </div>
    <div class="panel">
      <div class="panel-h">Avg peak VRAM by TLOD · GB (headroom to 12 GB)</div>
      <div class="graph-wrap"><div id="chartVram"></div></div>
      <div class="legend" id="legVram"></div>
    </div>
  </div>

  <div class="note">{knee}</div>

  <table>
    <thead><tr><th>When</th><th>Aircraft</th><th>Route</th><th>Driver</th><th>TLOD</th>
      <th>P99</th><th>Stutter</th><th>VRAM peak</th><th></th></tr></thead>
    <tbody id="tbody">{rows}</tbody>
  </table>

<script>var DD = {dd_json};</script>
<script>{THEME_JS}</script>
<script>{DASH_JS}</script>
</body>
</html>'''

        with open(os.path.join(SESSIONS_DIR, "combined_report.html"), "w",
                  encoding="utf-8") as fh:
            fh.write(page)
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not rebuild combined report: %s", exc)


def get_driver_version():
    """GeForce driver version (e.g. '566.36') via nvidia-smi, or None."""
    smi = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"),
                       "System32", "nvidia-smi.exe")
    exe = smi if os.path.isfile(smi) else "nvidia-smi"
    try:
        out = subprocess.run(
            [exe, "--query-gpu=driver_version", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10,
        )
        line = out.stdout.strip().splitlines()
        if line:
            return line[0].strip()
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not read driver version: %s", exc)
    return None


def get_gpu_name():
    """Best-effort GPU model name via nvidia-smi (e.g. 'NVIDIA GeForce RTX 3080 Ti')."""
    smi = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"),
                       "System32", "nvidia-smi.exe")
    exe = smi if os.path.isfile(smi) else "nvidia-smi"
    try:
        out = subprocess.run(
            [exe, "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10,
        )
        line = out.stdout.strip().splitlines()
        if line:
            return line[0].strip()
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not read GPU name: %s", exc)
    return None


def get_sim_version():
    """MSFS 2024 file version (e.g. '1.4.3.0') from the running exe, or None.

    MSFS doesn't expose a friendly "Sim Update N" label anywhere readable, but the
    exe's Windows file-version resource increments with every sim update, so it's
    enough to spot a jump and correlate it against a flight's performance later.
    Only works while the sim is running (which it is, whenever we're recording).
    """
    proc_name = os.path.splitext(TARGET_PROCESS)[0]
    try:
        path_out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"(Get-Process -Name '{proc_name}' -ErrorAction SilentlyContinue "
             "| Select-Object -First 1 -ExpandProperty Path)"],
            capture_output=True, text=True, timeout=10,
        )
        exe_path = path_out.stdout.strip()
        if not exe_path:
            return None
        ver_out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"(Get-Item -LiteralPath '{exe_path}').VersionInfo.FileVersion"],
            capture_output=True, text=True, timeout=10,
        )
        version = ver_out.stdout.strip().replace(",", ".")
        return version or None
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not read MSFS sim version: %s", exc)
        return None


def get_simbrief_route():
    """Fetch latest SimBrief dispatch; return 'FLIGHTNO ORIG-DEST' string or None."""
    if not SIMBRIEF_USERNAME:
        return None
    try:
        import urllib.request
        import xml.etree.ElementTree as ET
        url = f"https://www.simbrief.com/api/xml.fetcher.php?username={SIMBRIEF_USERNAME}"
        with urllib.request.urlopen(url, timeout=10) as resp:
            xml_data = resp.read()
        root = ET.fromstring(xml_data)
        origin = root.findtext("origin/icao_code")
        dest   = root.findtext("destination/icao_code")
        flt    = root.findtext("general/flight_number")
        if origin and dest:
            route = f"{origin}-{dest}"
            if flt:
                route = f"{flt} {route}"
            return route
    except Exception as exc:
        logging.warning("SimBrief fetch failed: %s", exc)
    return None


def _normalize_simbrief_aircraft(*candidates):
    """Map SimBrief aircraft fields (icao code / name / reg) to Fenix / PMDG, or None."""
    blob = " ".join(str(c) for c in candidates if c).lower()
    if "fenix" in blob or any(a in blob for a in ("a318", "a319", "a320", "a321")):
        return "Fenix"
    if "pmdg" in blob or any(b in blob for b in ("b737", "b738", "b739", "737", "738", "739")):
        return "PMDG"
    if "sovereign" in blob or any(c in blob for c in ("c68a", "c680")):
        return CITATION_LABEL
    return None


def get_simbrief_aircraft():
    """Fetch the airframe from the latest SimBrief OFP.

    Returns (raw_code, normalized) where normalized is 'Fenix' / 'PMDG' / None.
    """
    if not SIMBRIEF_USERNAME:
        return None, None
    try:
        import urllib.request
        import xml.etree.ElementTree as ET
        url = f"https://www.simbrief.com/api/xml.fetcher.php?username={SIMBRIEF_USERNAME}"
        with urllib.request.urlopen(url, timeout=10) as resp:
            xml_data = resp.read()
        root = ET.fromstring(xml_data)
        code = (root.findtext("aircraft/icaocode") or root.findtext("aircraft/icao_code")
                or root.findtext("aircraft/base_type") or "")
        name = root.findtext("aircraft/name") or ""
        reg = root.findtext("aircraft/reg") or ""
        return (code or name or reg or None), _normalize_simbrief_aircraft(code, name, reg)
    except Exception as exc:  # noqa: BLE001
        logging.warning("SimBrief aircraft fetch failed: %s", exc)
        return None, None


def compute_coverage(sessions):
    """Flights per (aircraft x TLOD) cell against the coverage goal.

    Returns {counts, ac_totals, gaps (ranked), total_remaining, target}.
    Gap ranking: most-short first, then aircraft with fewer total flights, then lower TLOD.
    """
    counts = {(ac, t): 0 for ac in COVERAGE_AIRCRAFT for t in COVERAGE_TLODS}
    for s in sessions:
        ac, t = s.get("aircraft"), s.get("tlod")
        if ac in COVERAGE_AIRCRAFT and t in COVERAGE_TLODS and s.get("p99_ft_ms") is not None:
            counts[(ac, t)] += 1
    ac_totals = {ac: sum(counts[(ac, t)] for t in COVERAGE_TLODS) for ac in COVERAGE_AIRCRAFT}
    gaps = []
    for ac in COVERAGE_AIRCRAFT:
        for t in COVERAGE_TLODS:
            short = COVERAGE_TARGET_PER_CELL - counts[(ac, t)]
            if short > 0:
                gaps.append({"aircraft": ac, "tlod": t,
                             "count": counts[(ac, t)], "short": short})
    gaps.sort(key=lambda g: (-g["short"], ac_totals[g["aircraft"]], g["tlod"]))
    return {"counts": counts, "ac_totals": ac_totals, "gaps": gaps,
            "total_remaining": sum(g["short"] for g in gaps),
            "target": COVERAGE_TARGET_PER_CELL}


def next_gap_for_aircraft(coverage, aircraft):
    """Thinnest TLOD cell for one aircraft (most short, then lowest TLOD). None if full."""
    cands = [g for g in coverage["gaps"] if g["aircraft"] == aircraft]
    if not cands:
        return None
    cands.sort(key=lambda g: (-g["short"], g["tlod"]))
    return cands[0]["tlod"]


_PREP_AIRCRAFT_FILE = os.path.join(DATA_ROOT, "_prep_aircraft.txt")


def prep_next_tlod():
    """SimBrief-driven auto-prep: set TLOD to fill the thinnest coverage gap for the
    aircraft in the current SimBrief plan. Writes UserCfg.opt (with backup). No pause —
    chains straight into the --auto logger inside record_auto.bat. Never raises."""
    say("  Auto-prep: picking a TLOD to fill the next coverage gap...")
    raw, aircraft = get_simbrief_aircraft()
    if not aircraft:
        say(f"  SimBrief aircraft not recognized ({raw!r}) — leaving TLOD unchanged.")
        return
    # Save detected aircraft so --auto can fall back to it if SimConnect returns garbage.
    try:
        with open(_PREP_AIRCRAFT_FILE, "w", encoding="utf-8") as fh:
            fh.write(aircraft)
    except Exception:  # noqa: BLE001
        pass
    cov = compute_coverage(_read_index_sessions())
    tlod = next_gap_for_aircraft(cov, aircraft)
    if tlod is None:
        say(f"  {aircraft}: coverage already complete — leaving TLOD unchanged.")
        return
    current = read_settings()
    olod = current.get("olod") or 120
    ok, msg = write_settings(tlod, olod)
    say(f"  SimBrief aircraft {raw} -> {aircraft} · thinnest gap = TLOD {tlod}")
    say(f"  {msg}" if ok else f"  Could not set TLOD: {msg}")


# --------------------------------------------------------------------------- #
# Spike forensics  (--spike-report)  — the "Holmes hat" engine
# --------------------------------------------------------------------------- #

def _resolve_session_dir(session_id):
    """Absolute session folder for a session_id from index.json, or None."""
    index_json = os.path.join(SESSIONS_DIR, "index.json")
    if not os.path.isfile(index_json):
        return None
    try:
        with open(index_json, "r", encoding="utf-8") as fh:
            idx = json.load(fh)
    except Exception:  # noqa: BLE001
        return None
    for s in idx.get("sessions", []):
        if s.get("session_id") == session_id:
            folder = (s.get("folder") or "").replace("/", os.sep)
            return os.path.join(SESSIONS_DIR, folder)
    return None


def _classify_spike(r):
    """Classify one spike frame (dict of PresentMon columns) → (label, evidence).

    Rules validated against Dean's real flights:
      - GPU-bound  : GPU actually busy for most of the frame.
      - CPU-bound  : CPU busy dominated and/or the GPU sat idle waiting on the CPU
                     (large MsGPUWait) — the signature of MSFS main-thread / loading hitches.
      - present-stall: frame was ready but couldn't present (render-present latency high,
                       CPU+GPU idle) — driver / vsync / overlay / OS scheduler.
      - external?  : neither CPU nor GPU elevated → the cause is outside MSFS.
    """
    g = lambda x: x if x is not None else 0.0
    ft, cpu, gpu = g(r.get("ft")), g(r.get("cpu")), g(r.get("gpu"))
    gwait, rpl = g(r.get("gwait")), g(r.get("rpl"))
    if gpu >= ft * 0.6 and gpu >= cpu:
        return "GPU-bound", f"GPU busy {gpu:.0f}ms of {ft:.0f}ms frame"
    if cpu >= ft * 0.6 or gwait >= ft * 0.4:
        return "CPU-bound", f"CPU busy {cpu:.0f}ms; GPU starved (wait {gwait:.0f}ms)"
    if rpl >= ft * 0.5 and cpu < ft * 0.4 and gpu < ft * 0.4:
        return "present-stall", f"present latency {rpl:.0f}ms, CPU/GPU idle"
    return "external?", "neither CPU nor GPU busy — likely another process / OS"


def _read_telemetry(session_dir):
    """Load telemetry.csv (going-forward sidecar) as a list of dicts sorted by wall_ms,
    or None if absent (all pre-update flights). Tolerant of missing columns."""
    path = os.path.join(session_dir, "telemetry.csv")
    if not os.path.isfile(path):
        return None
    out = []
    try:
        with open(path, "r", encoding="utf-8-sig", errors="ignore", newline="") as fh:
            for row in csv.DictReader(fh):
                def num(k):
                    try:
                        return float(row[k])
                    except (KeyError, ValueError, TypeError):
                        return None
                out.append({
                    "wall_ms": num("wall_ms"), "phase": row.get("phase") or "",
                    "alt_ft": num("alt_ft"), "vram_mb": num("vram_mb"),
                    "sys_ram_pct": num("sys_ram_pct"), "sys_cpu_pct": num("sys_cpu_pct"),
                    "top_proc": row.get("top_proc") or "", "top_proc_cpu": num("top_proc_cpu"),
                })
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not read telemetry.csv: %s", exc)
        return None
    out = [r for r in out if r["wall_ms"] is not None]
    out.sort(key=lambda r: r["wall_ms"])
    return out or None


def _telemetry_at(telemetry, wall_ms):
    """Nearest telemetry row to a wall-clock time (ms), or None."""
    if not telemetry or wall_ms is None:
        return None
    best, best_d = None, None
    for row in telemetry:
        d = abs(row["wall_ms"] - wall_ms)
        if best_d is None or d < best_d:
            best, best_d = row, d
    return best


def _mmss(ms):
    if ms is None:
        return "  ?  "
    s = int(ms / 1000)
    return f"{s // 60:02d}:{s % 60:02d}"


def spike_report(session_id, top_n=15):
    """Forensic spike analysis for one flight. Prints a human table and a JSON block.

    Retroactive: classification uses only columns already in frametimes.csv, so it works
    on every logged flight. Phase/altitude/system culprit context is joined from
    telemetry.csv when present (flights from the telemetry update forward).
    """
    session_dir = _resolve_session_dir(session_id)
    if not session_dir or not os.path.isdir(session_dir):
        say(f"  Session '{session_id}' not found — pick one from Sessions/index.json.")
        return
    csv_path = os.path.join(session_dir, "frametimes.csv")
    if not os.path.isfile(csv_path):
        say(f"  frametimes.csv not found in {session_dir}")
        return

    # --- read every forensic column we can find, by index ---
    with open(csv_path, "r", encoding="utf-8-sig", errors="ignore", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if not header:
            say("  Empty CSV — nothing to analyze.")
            return
        keymap = {"ft": FRAMETIME_COLUMNS, "t": TIME_COLUMNS, "cpu": CPUBUSY_COLUMNS,
                  "cwait": CPUWAIT_COLUMNS, "gpu": GPUBUSY_COLUMNS, "gwait": GPUWAIT_COLUMNS,
                  "glat": GPULATENCY_COLUMNS, "gtime": GPUTIME_COLUMNS,
                  "rpl": RENDERLATENCY_COLUMNS, "anim": ANIMERROR_COLUMNS, "pm": PRESENTMODE_COLUMNS}
        idx = {}
        for k, cands in keymap.items():
            name = _pick_column(header, cands)
            idx[k] = header.index(name) if name else None
        if idx["ft"] is None:
            say("  No frametime column in CSV — can't analyze.")
            return
        tname = _pick_column(header, TIME_COLUMNS)
        time_is_seconds = bool(tname and "second" in tname.lower())

        def num(parts, k):
            i = idx[k]
            if i is None or i >= len(parts):
                return None
            try:
                return float(parts[i])
            except (ValueError, TypeError):
                return None

        rows = []
        for parts in reader:
            ft = num(parts, "ft")
            if ft is None:
                continue
            t = num(parts, "t")
            if t is not None and time_is_seconds:
                t *= 1000.0
            rows.append({
                "ft": ft, "t": t, "cpu": num(parts, "cpu"), "cwait": num(parts, "cwait"),
                "gpu": num(parts, "gpu"), "gwait": num(parts, "gwait"),
                "glat": num(parts, "glat"), "gtime": num(parts, "gtime"),
                "rpl": num(parts, "rpl"), "anim": num(parts, "anim"),
                "pm": parts[idx["pm"]] if idx["pm"] is not None and idx["pm"] < len(parts) else "",
            })

    n = len(rows)
    if n == 0:
        say("  No frametime rows parsed.")
        return
    fts = sorted(r["ft"] for r in rows)
    median = fts[n // 2]
    gap_floor = max(GAP_CEILING_MS, median * 50.0)

    # --- 1) split capture-gaps (sim not presenting) from real stutters ---
    gaps = [r for r in rows if r["ft"] >= gap_floor]
    gap_dead_s = sum(r["ft"] for r in gaps) / 1000.0

    # --- 2) find + cluster real stutter frames (> SPIKE_FRAMETIME_MS, below gap floor) ---
    spikes = [(i, r) for i, r in enumerate(rows)
              if SPIKE_FRAMETIME_MS < r["ft"] < gap_floor]
    events = []
    for i, r in spikes:
        t = r["t"]
        near = (events and t is not None and events[-1]["t"] is not None
                and t - events[-1]["t_end"] < 1000.0)
        if not near and events and t is None:
            near = (i - events[-1]["i_end"]) <= 60   # fall back to frame proximity
        if near:
            e = events[-1]
            if r["ft"] > e["peak"]["ft"]:
                e["peak"] = r
            e["t_end"] = t if t is not None else e["t_end"]
            e["i_end"] = i
            e["count"] += 1
        else:
            events.append({"peak": r, "t": t, "t_end": t, "i_end": i, "count": 1})

    telemetry = _read_telemetry(session_dir)

    # --- 3) build classified, context-joined event records ---
    out_events = []
    for e in sorted(events, key=lambda e: -e["peak"]["ft"])[:top_n]:
        r = e["peak"]
        label, why = _classify_spike(r)
        tel = _telemetry_at(telemetry, r["t"])
        rec = {
            "time": _mmss(r["t"]), "time_ms": round(r["t"], 1) if r["t"] is not None else None,
            "peak_ft_ms": round(r["ft"], 1), "frames_in_cluster": e["count"], "class": label,
            "why": why,
            "cpu_busy_ms": round(r["cpu"], 1) if r["cpu"] is not None else None,
            "gpu_busy_ms": round(r["gpu"], 1) if r["gpu"] is not None else None,
            "gpu_wait_ms": round(r["gwait"], 1) if r["gwait"] is not None else None,
            "render_latency_ms": round(r["rpl"], 1) if r["rpl"] is not None else None,
            "animation_error_ms": round(r["anim"], 1) if r["anim"] is not None else None,
            "present_mode": r["pm"],
        }
        if tel:
            rec["phase"] = tel["phase"]
            rec["alt_ft"] = int(tel["alt_ft"]) if tel["alt_ft"] is not None else None
            rec["vram_mb"] = int(tel["vram_mb"]) if tel["vram_mb"] is not None else None
            rec["sys_cpu_pct"] = tel["sys_cpu_pct"]
            rec["sys_ram_pct"] = tel["sys_ram_pct"]
            rec["top_proc"] = tel["top_proc"]
            rec["top_proc_cpu"] = tel["top_proc_cpu"]
        out_events.append(rec)

    # --- 4) print human summary + JSON block ---
    say("=" * 70)
    say(f"  Spike forensics — {session_id}")
    say(f"  {n:,} frames · median {median:.1f}ms · gap floor {gap_floor:.0f}ms"
        + ("" if telemetry else " · (no telemetry — pre-update flight, no phase/alt/process join)"))
    say("=" * 70)
    say(f"  Non-render gaps (alt-tab / pause / loading / shutdown — NOT stutters): "
        f"{len(gaps)}, {gap_dead_s:.1f}s dead time total. Excluded from culprit analysis.")
    say(f"  Real stutter events (> {SPIKE_FRAMETIME_MS:.0f}ms): {len(events)}  "
        f"(showing top {min(top_n, len(events))} by peak)")
    say("  " + "-" * 66)
    for rec in out_events:
        ctx = ""
        if "phase" in rec:
            ctx = (f" | {rec['phase']}"
                   + (f" {rec['alt_ft']}ft" if rec.get("alt_ft") is not None else "")
                   + (f" | vram {rec['vram_mb']}MB" if rec.get("vram_mb") is not None else "")
                   + (f" | sysCPU {rec['sys_cpu_pct']:.0f}%" if rec.get("sys_cpu_pct") is not None else "")
                   + (f" | top: {rec['top_proc']}" if rec.get("top_proc") else ""))
        say(f"  {rec['time']}  {rec['peak_ft_ms']:7.1f}ms  {rec['class']:<13} "
            f"(x{rec['frames_in_cluster']})  {rec['why']}{ctx}")
    say("  " + "-" * 66)

    summary_blob = {
        "session_id": session_id, "frames": n, "median_ms": round(median, 2),
        "gap_floor_ms": round(gap_floor, 1), "non_render_gaps": len(gaps),
        "gap_dead_time_s": round(gap_dead_s, 1), "stutter_event_count": len(events),
        "has_telemetry": bool(telemetry), "events": out_events,
    }
    say("SPIKE_JSON_BEGIN")
    print(json.dumps(summary_blob, indent=2))
    say("SPIKE_JSON_END")


def rebuild_session_report(session_id):
    """Regenerate report.html for one session from its existing summary.json + frametimes.csv.

    Re-reads the raw frametimes.csv, applies head and tail trims, recomputes all stats,
    updates summary.json, then regenerates report.html. This means a rebuild always
    reflects the current trim constants — useful when trim values change.
    """
    index_json = os.path.join(SESSIONS_DIR, "index.json")
    session_entry = None
    if os.path.isfile(index_json):
        with open(index_json, "r", encoding="utf-8") as fh:
            idx_data = json.load(fh)
        for s in idx_data.get("sessions", []):
            if s.get("session_id") == session_id:
                session_entry = s
                break
    if not session_entry:
        say(f"  Session '{session_id}' not found in index.json.")
        return

    folder = (session_entry.get("folder") or "").replace("/", os.sep)
    session_dir = os.path.join(SESSIONS_DIR, folder)
    summary_path = os.path.join(session_dir, "summary.json")
    if not os.path.isfile(summary_path):
        say(f"  summary.json not found: {summary_path}")
        return

    with open(summary_path, "r", encoding="utf-8") as fh:
        summary = json.load(fh)

    settings       = summary.get("settings", {})
    vram           = summary.get("vram", {"available": False})
    driver_version = summary.get("driver_version")
    sim_version    = summary.get("sim_version")

    # Re-read raw CSV and apply current trim constants.
    csv_path = os.path.join(session_dir, "frametimes.csv")
    ft_chron, cpu_chron, gpu_chron = _read_csv_chronological(csv_path)
    if not ft_chron:
        say(f"  Could not read frametimes: {csv_path}")
        return

    ft_chron, cpu_chron, gpu_chron = _trim_head_seconds(
        ft_chron, cpu_chron, gpu_chron, HEAD_TRIM_S)
    say(f"  Head trim: {HEAD_TRIM_S}s")

    existing_stop = summary.get("smoothness", {}).get("stop_trim_s", MIN_TAIL_TRIM_S)
    ft_trimmed, cpu_trimmed, gpu_trimmed = _trim_tail_seconds(
        ft_chron, cpu_chron, gpu_chron, existing_stop)
    say(f"  Tail trim: {existing_stop}s")

    parsed = compute_stats(ft_trimmed, cpu_trimmed, gpu_trimmed)
    if not parsed:
        say("  Could not compute stats from CSV.")
        return
    stats, sorted_ft = parsed
    stats["start_trim_s"] = HEAD_TRIM_S
    stats["stop_trim_s"]  = existing_stop

    # Preserve phase data — it can't be recomputed from CSV alone (needs wall-clock log).
    if "phases" in summary.get("smoothness", {}):
        stats["phases"] = summary["smoothness"]["phases"]

    # Update summary.json with recomputed stats.
    summary["smoothness"] = stats
    with open(summary_path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    say(f"  Updated: {summary_path}")

    prior_sessions = [s for s in _read_index_sessions()
                      if s.get("session_id") != session_id]

    html_path = os.path.join(session_dir, "report.html")
    write_report(html_path, session_id, settings, stats, vram,
                 ft_trimmed, sorted_ft,
                 prior_sessions=prior_sessions,
                 driver_version=driver_version,
                 sim_version=sim_version)
    say(f"  Rebuilt: {html_path}")


def _capframex_header_lines(meta, gpu_name):
    """The '//Key=Value' info-header block CapFrameX needs to register a record."""
    HM, SEP = "//", "="
    ts = meta["ts"]
    comment = (f"TLOD {meta['tlod']} / OLOD {meta['olod']} | {meta['aircraft']} | "
               f"{meta['route']} | drv {meta['driver']}")
    return [
        f"{HM}GameName{SEP}MSFS 2024",
        f"{HM}ProcessName{SEP}FlightSimulator2024",
        f"{HM}CreationDate{SEP}{ts.strftime('%m/%d/%Y')}",
        f"{HM}CreationTime{SEP}{ts.strftime('%H:%M:%S')}",
        f"{HM}Motherboard{SEP}Unknown",
        f"{HM}OS{SEP}Windows 11",
        f"{HM}Processor{SEP}Unknown",
        f"{HM}System RAM{SEP}Unknown",
        f"{HM}Base Driver Version{SEP}{meta['driver']}",
        f"{HM}Driver Package{SEP}Unknown",
        f"{HM}GPU{SEP}{gpu_name}",
        f"{HM}GPU #{SEP}1",
        f"{HM}GPU Core Clock (MHz){SEP}Unknown",
        f"{HM}GPU Memory Clock (MHz){SEP}Unknown",
        f"{HM}GPU Memory (MB){SEP}{meta['total_vram']}",
        f"{HM}Comment{SEP}{comment}",
    ]


def _meta_from_session_dir(session_dir):
    """Build CapFrameX metadata from a session folder (summary.json, else folder name)."""
    summ = {}
    sp = os.path.join(session_dir, "summary.json")
    if os.path.isfile(sp):
        try:
            with open(sp, "r", encoding="utf-8") as fh:
                summ = json.load(fh)
        except Exception:  # noqa: BLE001
            summ = {}
    settings = summ.get("settings", {})
    name = os.path.basename(session_dir.rstrip("\\/"))
    date = os.path.basename(os.path.dirname(session_dir.rstrip("\\/")))
    m_t = re.search(r"TLOD(\d+)", name)
    m_o = re.search(r"OLOD(\d+)", name)
    m_hm = re.match(r"(\d{4})", name)
    tlod = settings.get("tlod") or (int(m_t.group(1)) if m_t else "na")
    olod = settings.get("olod") or (int(m_o.group(1)) if m_o else "na")
    sid = summ.get("session_id") or (f"{date}_{m_hm.group(1)}" if m_hm else name)
    aircraft = re.sub(r"[^A-Za-z0-9_-]", "",
                      str(settings.get("aircraft") or summ.get("aircraft") or "Unknown")) or "Unknown"
    route = _display_route(settings.get("simbrief_route") or summ.get("notes") or "")
    driver = summ.get("driver_version") or "Unknown"
    total_vram = (summ.get("vram") or {}).get("total_vram_mb") or 12288
    try:
        ts = datetime.fromisoformat(summ.get("timestamp"))
    except Exception:  # noqa: BLE001
        ts = datetime.now()
    return {"sid": sid, "tlod": tlod, "olod": olod, "aircraft": aircraft,
            "route": route, "driver": driver, "total_vram": total_vram, "ts": ts}


def _capframex_convert_one(src_csv, out_dir, meta, gpu_name):
    """Convert one raw frametimes.csv to a CapFrameX-loadable CSV. Returns out path or None.

    Prepends the info-header block, passes frame data through, and trims the
    sim-shutdown spike(s) off the tail. The original file is never modified.
    """
    try:
        with open(src_csv, "r", encoding="utf-8-sig", errors="ignore", newline="") as src:
            src_lines = src.read().splitlines()
    except Exception as exc:  # noqa: BLE001
        say(f"  Skipping {src_csv}: {exc}")
        return None
    if not src_lines:
        say(f"  Skipping {src_csv}: capture is empty.")
        return None
    col_header = src_lines[0]
    data_rows = src_lines[1:]

    SHUTDOWN_MS, WINDOW_MS = 200.0, 60000.0
    cols = [c.strip() for c in col_header.split(",")]
    ft_col = _pick_column(cols, FRAMETIME_COLUMNS)
    cut = len(data_rows)
    if ft_col is not None and data_rows:
        ft_i = cols.index(ft_col)
        tail_ms = 0.0
        for i in range(len(data_rows) - 1, -1, -1):
            parts = data_rows[i].split(",")
            try:
                ft = float(parts[ft_i])
            except (ValueError, IndexError):
                ft = 0.0
            if ft > SHUTDOWN_MS:
                cut = i
            tail_ms += ft
            if tail_ms > WINDOW_MS:
                break
    trimmed = len(data_rows) - cut

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{meta['sid']}_TLOD{meta['tlod']}_{meta['aircraft']}.csv")
    try:
        with open(out_path, "w", encoding="utf-8", newline="") as out:
            out.write("\n".join(_capframex_header_lines(meta, gpu_name)) + "\n")
            out.write(col_header + "\n")
            out.write("\n".join(data_rows[:cut]))
            out.write("\n")
    except Exception as exc:  # noqa: BLE001
        say(f"  Failed to write {out_path}: {exc}")
        return None
    trim_note = f" (trimmed {trimmed} shutdown frame(s))" if trimmed else ""
    say(f"  Converted: {os.path.basename(out_path)}{trim_note}")
    return out_path


def _find_session_csvs(path):
    """Resolve a dropped file/folder into a list of (frametimes.csv, session_dir) pairs.

    A single frametimes.csv, a session folder, a date folder, or the whole Sessions
    tree all work. Only files named exactly 'frametimes.csv' are matched, so already-
    converted exports are never re-processed.
    """
    path = os.path.abspath(path)
    if os.path.isfile(path):
        if os.path.basename(path).lower() == "frametimes.csv":
            return [(path, os.path.dirname(path))]
        return []
    if os.path.isdir(path):
        direct = os.path.join(path, "frametimes.csv")
        if os.path.isfile(direct):
            return [(direct, path)]
        out = []
        for root, _dirs, files in os.walk(path):
            for f in files:
                if f.lower() == "frametimes.csv":
                    out.append((os.path.join(root, f), root))
        return out
    return []


def convert_paths_to_capframex(paths):
    """Convert dropped session data (folders/files) into Sessions/CapFrameX CSVs."""
    out_dir = os.path.join(SESSIONS_DIR, "CapFrameX")
    gpu_name = get_gpu_name() or "Unknown"
    pairs, seen, count = [], set(), 0
    for p in paths:
        found = _find_session_csvs(p)
        if not found:
            say(f"  No frametimes.csv found under: {p}")
        pairs.extend(found)
    for src_csv, session_dir in pairs:
        key = os.path.abspath(src_csv)
        if key in seen:
            continue
        seen.add(key)
        if _capframex_convert_one(src_csv, out_dir, _meta_from_session_dir(session_dir), gpu_name):
            count += 1
    say("")
    if count:
        say(f"  {count} file(s) written to: {out_dir}")
        say("  In CapFrameX, point the observed directory there to load them.")
    else:
        say("  Nothing converted.")


def export_capframex(session_id):
    """Write CapFrameX-loadable copies of filed sessions (by session id, or 'all')."""
    index_json = os.path.join(SESSIONS_DIR, "index.json")
    sessions = []
    if os.path.isfile(index_json):
        with open(index_json, "r", encoding="utf-8") as fh:
            sessions = json.load(fh).get("sessions", [])
    targets = (sessions if session_id == "all"
               else [s for s in sessions if s.get("session_id") == session_id])
    if not targets:
        say(f"  Session '{session_id}' not found in index.json (try 'all').")
        return
    out_dir = os.path.join(SESSIONS_DIR, "CapFrameX")
    gpu_name = get_gpu_name() or "Unknown"
    count = 0
    for s in targets:
        folder = (s.get("folder") or "").replace("/", os.sep)
        session_dir = os.path.join(SESSIONS_DIR, folder)
        src_csv = os.path.join(session_dir, "frametimes.csv")
        if not os.path.isfile(src_csv):
            say(f"  Skipping {s.get('session_id')}: frametimes.csv not found.")
            continue
        if _capframex_convert_one(src_csv, out_dir, _meta_from_session_dir(session_dir), gpu_name):
            count += 1
    if count:
        say("")
        say(f"  {count} file(s) written to: {out_dir}")
        say("  In CapFrameX, point the observed directory there to load them.")


def file_session(raw_csv_path, settings, stats, sorted_frametimes,
                 frametimes_in_order, vram, started_at, telemetry_rows=None):
    now = started_at
    date_dir = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H%M")
    tlod_str = f"TLOD{settings['tlod']}" if settings["tlod"] is not None else "TLODna"
    olod_str = f"OLOD{settings['olod']}" if settings["olod"] is not None else "OLODna"
    folder_name = f"{time_str}_{tlod_str}_{olod_str}"
    session_id = f"{date_dir}_{time_str}"

    session_dir = os.path.join(SESSIONS_DIR, date_dir, folder_name)
    os.makedirs(session_dir, exist_ok=True)

    # 1. Copy raw frametimes.
    dest_csv = os.path.join(session_dir, "frametimes.csv")
    try:
        shutil.copyfile(raw_csv_path, dest_csv)
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not copy raw CSV: %s", exc)

    # 1b. Telemetry sidecar — written before the report so the altitude overlay picks it up.
    _write_telemetry_csv(session_dir, telemetry_rows or [])

    driver_version = get_driver_version()
    sim_version = settings.get("sim_version") or get_sim_version()

    # 2. summary.json (the key Claude-readable artifact).
    summary = {
        "session_id": session_id,
        "timestamp": now.isoformat(timespec="seconds"),
        "timestamp_display": now.strftime("%b %d %Y %H:%M"),
        "driver_version": driver_version,
        "sim_version": sim_version,
        "settings": settings,
        "smoothness": stats,
        "vram": vram,
        "raw_csv": "frametimes.csv",
        "report": "report.html",
        "notes": settings.get("simbrief_route") or settings.get("notes") or "",
    }
    with open(os.path.join(session_dir, "summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    # 3. report.html (compare against prior flights, filed before this one)
    try:
        prior_sessions = _read_index_sessions()
        write_report(os.path.join(session_dir, "report.html"), session_id,
                     settings, stats, vram, frametimes_in_order, sorted_frametimes,
                     prior_sessions=prior_sessions, driver_version=driver_version,
                     sim_version=sim_version)
    except Exception as exc:  # noqa: BLE001
        logging.warning("Report generation failed: %s", exc)

    # 4. index
    index_entry = {
        "session_id": session_id,
        "timestamp": summary["timestamp"],
        "driver_version": driver_version,
        "sim_version": sim_version,
        "tlod": settings["tlod"],
        "olod": settings["olod"],
        "p99_ft_ms": stats["p99_ft_ms"],
        "stutter_pct": stats["stutter_pct"],
        "consistency_pct": stats["consistency_pct"],
        "avg_fps": stats["avg_fps"],
        "peak_vram_mb": vram.get("peak_vram_mb"),
        "frame_count": stats["frame_count"],
        "aircraft": settings.get("aircraft"),
        "route": settings.get("simbrief_route") or "",
        "timestamp_display": now.strftime("%b %d %Y %H:%M"),
        "folder": os.path.relpath(session_dir, SESSIONS_DIR),
    }
    update_index(index_entry)
    rebuild_combined_report()
    return session_dir, stats, vram


# --------------------------------------------------------------------------- #
# PresentMon control
# --------------------------------------------------------------------------- #

def start_presentmon(pm_path, out_csv):
    args = [
        pm_path,
        "--process_name", TARGET_PROCESS,
        "--output_file", out_csv,
        "--no_console_stats",
        "--stop_existing_session",
        "--terminate_on_proc_exit",
    ]
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
    proc = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )
    return proc


def stop_presentmon(proc):
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            proc.send_signal(signal.CTRL_BREAK_EVENT)
            try:
                proc.wait(timeout=8)
                return
            except subprocess.TimeoutExpired:
                pass
        proc.terminate()
        proc.wait(timeout=8)
    except Exception as exc:  # noqa: BLE001
        logging.warning("Graceful stop failed (%s), killing.", exc)
        try:
            proc.kill()
        except Exception:  # noqa: BLE001
            pass


# --------------------------------------------------------------------------- #
# Auto-start via SimConnect (parking brake released + rolling)
# --------------------------------------------------------------------------- #

AUTO_MIN_SPEED_KT = 2.0     # above GSX spawn-reposition speed, below pushback speed
AUTO_CONFIRM_SECONDS = 3.0  # how long the condition must hold before triggering
AUTO_POLL_INTERVAL = 1.0
ALT_SANE_FT = 45000         # above this = SimConnect not yet settled; disarm trigger + clamp telemetry


def wait_for_auto_start():
    """Block until the parking brake is released and the aircraft is rolling,
    sustained for AUTO_CONFIRM_SECONDS (filters the unreliable brake sim-var
    state some aircraft (PMDG, Fenix) spawn with). Falls back to manual
    Enter-to-start if the SimConnect package isn't installed or the
    connection can't be made. Never raises - worst case, behaves like the
    manual mode.
    """
    try:
        from SimConnect import SimConnect, AircraftRequests
    except ImportError:
        say("  SimConnect package not installed (pip install SimConnect).")
        say("  Auto-start unavailable this run - press Enter to start recording.")
        try:
            input()
        except (EOFError, KeyboardInterrupt):
            pass
        return

    say("  Auto-start mode: waiting for MSFS 2024 SimConnect connection...")
    sm = None
    while sm is None:
        try:
            sm = SimConnect()
        except Exception:  # noqa: BLE001 - sim not up yet, keep retrying
            time.sleep(2.0)

    say("  Connected. Waiting for rolling...")
    say("  (Press ENTER to start capture manually if it doesn't roll on its own.)")
    aq = AircraftRequests(sm, _time=0)
    confirmed_since = None
    altitude = None

    # Manual escape hatch: pressing Enter force-starts capture even in auto mode,
    # so a connect-but-never-roll situation can never dead-end the window.
    forced = threading.Event()

    def _enter_watch():
        try:
            input()
        except (EOFError, KeyboardInterrupt):
            pass
        forced.set()

    threading.Thread(target=_enter_watch, daemon=True).start()

    try:
        last_log = 0.0
        polls = 0
        none_streak = 0
        while True:
            if forced.is_set():
                say("  Manual start - beginning capture now.")
                return
            try:
                gspeed    = aq.get("GROUND_VELOCITY")
                on_ground = aq.get("SIM_ON_GROUND")
                altitude  = aq.get("PLANE_ALTITUDE")
            except Exception as exc:  # noqa: BLE001 - transient read failure, retry
                logging.warning("Auto-start: SimConnect read failed: %s", exc)
                gspeed = on_ground = altitude = None

            polls += 1
            none_streak = none_streak + 1 if gspeed is None else 0

            now = time.monotonic()
            # Diagnostic heartbeat: surface the raw reading (live + logged) every ~15s
            # so a silent "reads return None/0 despite moving" failure is visible.
            if now - last_log >= 15.0:
                say(f"  ...waiting · GROUND_VELOCITY={gspeed!r} · ON_GROUND={on_ground!r} "
                    f"· ALT={altitude!r}ft (need >{AUTO_MIN_SPEED_KT}kt, alt<{ALT_SANE_FT}ft, on_ground)")
                last_log = now

            # Self-heal: if reads stay empty for ~15s, the connection was almost
            # certainly made before the flight finished loading (Quick Launch fires
            # us at the menu). A request made then never refreshes, so rebuild the
            # connection fresh — once the flight is active it reads real speed.
            if none_streak >= 15:
                say("  No speed data yet — refreshing SimConnect connection "
                    "(flight may still be loading).")
                try:
                    sm.exit()
                except Exception:  # noqa: BLE001
                    pass
                sm = None
                while sm is None and not forced.is_set():
                    try:
                        sm = SimConnect()
                    except Exception:  # noqa: BLE001
                        time.sleep(2.0)
                if sm is not None:
                    aq = AircraftRequests(sm, _time=0)
                none_streak = 0
                continue

            if (gspeed is not None and gspeed > AUTO_MIN_SPEED_KT
                    and on_ground and altitude is not None and altitude < ALT_SANE_FT):
                if confirmed_since is None:
                    confirmed_since = now
                elif now - confirmed_since >= AUTO_CONFIRM_SECONDS:
                    say(f"  Rolling ({gspeed:.1f} kt) - starting capture now.")
                    return
            else:
                confirmed_since = None
            time.sleep(AUTO_POLL_INTERVAL)
    finally:
        # Close this one-shot connection; the recording thread opens its own.
        try:
            sm.exit()
        except Exception:  # noqa: BLE001
            pass


def simconnect_check(seconds=40):
    """Live SimConnect diagnostic. Reads key SimVars once per second and prints them,
    comparing _time=0 (our current setting) against _time=200 (periodic refresh) so we
    can see exactly what the sim returns. Run it while taxiing via simcheck.bat.
    """
    say("=" * 60)
    say("  SimConnect diagnostic — live SimVar readout")
    say("=" * 60)
    try:
        from SimConnect import SimConnect, AircraftRequests
    except ImportError:
        say("  SimConnect package not installed (pip install SimConnect).")
        input("\nPress Enter to exit...")
        return
    try:
        import SimConnect as _scmod
        say(f"  SimConnect package version: {getattr(_scmod, '__version__', 'unknown')}")
    except Exception:  # noqa: BLE001
        pass
    say("  Connecting to MSFS 2024...")
    try:
        sm = SimConnect()
    except Exception as exc:  # noqa: BLE001
        say(f"  Could not connect: {exc}  (is the sim running and in a flight?)")
        input("\nPress Enter to exit...")
        return

    aq0 = AircraftRequests(sm, _time=0)      # how the logger reads today
    aq2 = AircraftRequests(sm, _time=200)    # periodic-refresh alternative

    def rd(aq, var):
        try:
            return aq.get(var)
        except Exception as exc:  # noqa: BLE001
            return f"ERR:{exc}"

    say(f"  Connected. Reading for {seconds}s — please taxi so we can see ground speed.")
    say("  Columns: GS=GROUND_VELOCITY (kt), VS=VERTICAL_SPEED, OG=SIM_ON_GROUND")
    say(f"  Aircraft TITLE: {rd(aq0, 'TITLE')!r}")
    say("  " + "-" * 56)
    t0 = time.time()
    while time.time() - t0 < seconds:
        gs0, gs2 = rd(aq0, "GROUND_VELOCITY"), rd(aq2, "GROUND_VELOCITY")
        og, vs = rd(aq2, "SIM_ON_GROUND"), rd(aq2, "VERTICAL_SPEED")
        say(f"  GS[_time=0]={gs0!r:>12}   GS[_time=200]={gs2!r:>12}   OG={og!r}   VS={vs!r}")
        time.sleep(1.0)
    try:
        sm.exit()
    except Exception:  # noqa: BLE001
        pass
    say("  " + "-" * 56)
    say("  Read this: if GS[_time=0] stayed None/0 while GS[_time=200] showed your real")
    say("  speed, that's the bug — the logger needs the periodic-refresh setting.")
    say("  Copy these lines (or msfs_perf_logger.log) back to Claude.")
    input("\nPress Enter to exit...")


def _prep_aircraft_fallback():
    """Return the aircraft saved by --prep-next (SimBrief-derived), then delete the file.
    Used when SimConnect TITLE returns something unrecognized (e.g. C172 while Fenix loads).
    """
    try:
        if os.path.isfile(_PREP_AIRCRAFT_FILE):
            with open(_PREP_AIRCRAFT_FILE, "r", encoding="utf-8") as fh:
                saved = fh.read().strip()
            os.remove(_PREP_AIRCRAFT_FILE)
            return saved or None
    except Exception:  # noqa: BLE001
        pass
    return None


def _aircraft_override():
    """Return the aircraft name passed as `--aircraft "NAME"`, or None.

    Optional manual override (your normal launcher auto-detects the Citation via its title /
    SimBrief plan). Handy only if a plane ever mislabels. Bypasses SimConnect guessing.
    """
    if "--aircraft" in sys.argv:
        i = sys.argv.index("--aircraft")
        if i + 1 < len(sys.argv):
            name = sys.argv[i + 1].strip()
            if name:
                return name
    return None


def get_aircraft_title():
    """Best-effort one-shot read of the loaded aircraft's title via
    SimConnect (e.g. "PMDG 737-800", "Fenix A319"). Returns None if the
    SimConnect package isn't installed, the sim isn't reachable, or the read
    fails for any reason. Never blocks waiting for a connection.

    Falls back to the SimBrief aircraft saved by --prep-next when SimConnect
    returns a title that doesn't normalize to a known family (Fenix / PMDG).
    """
    try:
        from SimConnect import SimConnect, AircraftRequests
    except ImportError:
        return _prep_aircraft_fallback()
    sm = None
    try:
        sm = SimConnect()
        aq = AircraftRequests(sm, _time=0)
        title = aq.get("TITLE")
        if isinstance(title, bytes):
            title = title.decode("utf-8", errors="ignore")
        title = (title or "").strip()
        normalized = _normalize_aircraft(title)
        if normalized in ("Fenix", "PMDG"):
            # Clean recognized aircraft — discard the prep file if it exists.
            try:
                if os.path.isfile(_PREP_AIRCRAFT_FILE):
                    os.remove(_PREP_AIRCRAFT_FILE)
            except Exception:  # noqa: BLE001
                pass
            return normalized
        # SimConnect returned something unrecognized — trust SimBrief instead.
        fallback = _prep_aircraft_fallback()
        if fallback:
            logging.warning(
                "SimConnect TITLE %r not recognized; using SimBrief fallback: %s", title, fallback
            )
            say(f"  SimConnect returned unrecognized aircraft ({title!r}); using SimBrief: {fallback}")
            return fallback
        return normalized or None
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not read aircraft title: %s", exc)
        return _prep_aircraft_fallback()
    finally:
        if sm is not None:
            try:
                sm.exit()
            except Exception:  # noqa: BLE001
                pass


def _normalize_aircraft(title):
    """Normalize a SimConnect aircraft title to a clean family label (PMDG / Fenix).

    The title is the in-sim livery name, which often omits the developer — e.g. the
    PMDG 737 reports '737-800 PAX SSW SC'. So we also match by airframe type: Boeing
    (and the DC-6) => PMDG, Airbus A3xx => Fenix, Citation/Sovereign => Citation Sovereign+
    (a reference aircraft). Anything unrecognized is returned unchanged.
    """
    if not title:
        return title
    tl = title.lower()
    if "fenix" in tl or any(a in tl for a in ("a318", "a319", "a320", "a321")):
        return "Fenix"
    if "pmdg" in tl or any(b in tl for b in ("737", "747", "777", "dc-6", "dc6")):
        return "PMDG"
    if "sovereign" in tl or any(c in tl for c in ("c68a", "c680")):
        return CITATION_LABEL
    return title


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    say("=" * 60)
    say("  MSFS 2024 Silent Performance Logger")
    say("=" * 60)

    # Set-up mode: write the next test's TLOD/OLOD into UserCfg.opt.
    if "--next-test" in sys.argv:
        setup_next_test()
        return

    # Rebuild a single session's report.html from its existing summary.json.
    if "--rebuild-session" in sys.argv:
        idx = sys.argv.index("--rebuild-session")
        if idx + 1 < len(sys.argv):
            rebuild_session_report(sys.argv[idx + 1])
        else:
            say("  Usage: --rebuild-session SESSION_ID  (e.g. 2026-06-18_1328)")
        return

    # Rebuild EVERY session's report.html (applies chart/nav changes retroactively),
    # then refresh the shared nav list and the combined dashboard.
    if "--rebuild-all" in sys.argv:
        index_json = os.path.join(SESSIONS_DIR, "index.json")
        sessions = []
        if os.path.isfile(index_json):
            with open(index_json, "r", encoding="utf-8") as fh:
                sessions = json.load(fh).get("sessions", [])
        if not sessions:
            say("  No sessions found in index.json - nothing to rebuild.")
            return
        say(f"  Rebuilding {len(sessions)} report(s)...")
        ok = 0
        for s in sessions:
            sid = s.get("session_id")
            try:
                rebuild_session_report(sid)
                ok += 1
            except Exception as exc:  # noqa: BLE001
                say(f"    FAILED {sid}: {exc}")
        write_sessions_nav(sessions)
        rebuild_combined_report()
        say(f"  Done - {ok}/{len(sessions)} reports rebuilt, "
            f"sessions_nav.js + combined_report.html refreshed.")
        return

    # Spike forensics: classify what caused the frametime spikes in a flight.
    if "--spike-report" in sys.argv:
        idx = sys.argv.index("--spike-report")
        if idx + 1 < len(sys.argv):
            top_n = 15
            if idx + 2 < len(sys.argv) and sys.argv[idx + 2].isdigit():
                top_n = int(sys.argv[idx + 2])
            spike_report(sys.argv[idx + 1], top_n=top_n)
        else:
            say("  Usage: --spike-report SESSION_ID [N]  (e.g. 2026-06-22_1433)")
        return

    # SimBrief-driven auto-prep: set the gap-filling TLOD before the sim reads its
    # config. Chained ahead of --auto inside record_auto.bat. No pause.
    if "--prep-next" in sys.argv:
        prep_next_tlod()
        return

    # Live SimConnect diagnostic (run via simcheck.bat while taxiing).
    if "--simcheck" in sys.argv:
        simconnect_check()
        return

    # Convert dropped session data (folders/files) into CapFrameX CSVs.
    # Used by Sessions/Convert_to_CapFrameX.bat (drag-and-drop).
    if "--convert-path" in sys.argv:
        idx = sys.argv.index("--convert-path")
        paths = sys.argv[idx + 1:]
        if paths:
            convert_paths_to_capframex(paths)
        else:
            say("  Drag a session folder or frametimes.csv onto Convert_to_CapFrameX.bat.")
        input("\nPress Enter to exit...")
        return

    # Export a CapFrameX-loadable copy of a session's capture (or "all").
    if "--export-capframex" in sys.argv:
        idx = sys.argv.index("--export-capframex")
        sid = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else "all"
        export_capframex(sid)
        input("\nPress Enter to exit...")
        return

    # Rebuild-only mode: regenerate the combined report from existing data.
    if "--combined" in sys.argv:
        rebuild_combined_report()
        out = os.path.join(SESSIONS_DIR, "combined_report.html")
        if os.path.isfile(out):
            say(f"  Combined report rebuilt: {out}")
        else:
            say("  No sessions found yet - nothing to combine.")
        return

    pm_path = ensure_presentmon()
    if not pm_path:
        input("\nPress Enter to exit...")
        return

    settings = read_settings()
    if settings["usercfg_found"]:
        say(f"  Settings read: TLOD={settings['tlod']}  OLOD={settings['olod']}")
    else:
        say("  Note: UserCfg.opt not found - TLOD/OLOD will be 'n/a'.")

    vram = VRAMSampler(interval=1.0)
    if vram.available:
        say(f"  VRAM sampling enabled ({vram.total_mb} MB total).")
    else:
        say("  VRAM sampling off (install nvidia-ml-py to enable).")

    # Temp CSV PresentMon writes to (writable data home).
    tmp_csv = os.path.join(DATA_ROOT, "_capture_tmp.csv")
    if os.path.isfile(tmp_csv):
        try:
            os.remove(tmp_csv)
        except OSError:
            pass

    if "--auto" in sys.argv:
        wait_for_auto_start()

    # Re-read settings now — MSFS is loaded and TLOD/OLOD reflect what the user set in-sim.
    fresh = read_settings()
    settings.update({k: fresh[k] for k in
        ("tlod", "olod", "upscaling", "frame_gen", "target_fps",
         "fg_multiplier", "texture_quality", "usercfg_found")})
    say(f"  TLOD confirmed: TLOD={settings['tlod']}  OLOD={settings['olod']}")

    # Aircraft is auto-detected (SimConnect title, then SimBrief fallback) — your normal
    # launcher handles Fenix, PMDG, and the Citation Sovereign+ with no special handling.
    # --aircraft "NAME" is an optional manual override if a plane ever mislabels.
    aircraft = _aircraft_override() or get_aircraft_title()
    settings["aircraft"] = aircraft
    if aircraft:
        tag = "" if is_primary_aircraft(aircraft) else "  (reference - excluded from baseline)"
        say(f"  Aircraft: {aircraft}{tag}")
    else:
        say("  Aircraft: n/a (SimConnect unavailable - install `pip install SimConnect` to capture)")

    simbrief_route = get_simbrief_route()
    if simbrief_route:
        say(f"  SimBrief route: {simbrief_route}")
        settings["simbrief_route"] = simbrief_route
    else:
        settings["simbrief_route"] = None

    # Capture sim version now while the process is still running
    settings["sim_version"] = get_sim_version()

    started_at = datetime.now()
    say("")
    say(f"  Watching for {TARGET_PROCESS} ...")
    say("  >> RECORDING. Fly your session.")
    say("  >> Press ENTER in this window when you're done to file it.")
    say("  >> (Closing the sim also stops and files it automatically.)")
    say("")

    proc = start_presentmon(pm_path, tmp_csv)
    vram.start()

    # Stop when the user presses Enter (clean - no batch-terminate prompt), or
    # when PresentMon exits on its own because MSFS closed.
    stop_event = threading.Event()

    def _wait_for_enter():
        try:
            input()
        except (EOFError, KeyboardInterrupt):
            pass
        stop_event.set()

    threading.Thread(target=_wait_for_enter, daemon=True).start()

    # SimConnect tracker — passively samples ground speed and altitude every second.
    # Updates shared state used for tail-trim and mid-flight-abandonment detection.
    _last_moving_ts  = [None]   # wall-clock time of last detected ground movement
    _was_airborne    = [False]  # True once SIM_ON_GROUND was ever False
    _ended_on_ground = [True]   # SIM_ON_GROUND at last successful poll
    _recording_wall_start = time.time()
    _phase_log       = []       # list of (wall_clock_time, phase_name) on each transition
    _current_phase   = [None]   # "ground" | "climb" | "cruise" | "descent"

    # Vertical-rate deadband (feet/minute) separating climb / level / descent.
    # Derived from PLANE_ALTITUDE deltas (feet, unambiguous) rather than the
    # VERTICAL_SPEED sim-var whose units vary by library/build. ±150 fpm ignores
    # cruise wobble. Tracked across polls:
    PHASE_VS_FPM = 150.0
    _prev_alt   = [None]
    _prev_alt_t = [None]

    # 1 Hz telemetry sidecar (alt / phase / VRAM / system) — rides on the tracker tick.
    _telemetry_rows = []
    _sys_sampler = _make_system_sampler()

    def _sc_tracker():
        try:
            from SimConnect import SimConnect, AircraftRequests  # noqa: PLC0415
            sm_t = SimConnect()
            aq_t = AircraftRequests(sm_t, _time=0)
            while not stop_event.is_set():
                altitude = None
                try:
                    gspeed    = aq_t.get("GROUND_VELOCITY")
                    on_ground = aq_t.get("SIM_ON_GROUND")
                    altitude  = aq_t.get("PLANE_ALTITUDE")   # feet MSL
                    if altitude is not None and altitude > ALT_SANE_FT:
                        altitude = None          # SimConnect not yet settled; discard garbage value
                    if gspeed is not None and gspeed > AUTO_MIN_SPEED_KT:
                        _last_moving_ts[0] = time.time()
                    if on_ground is not None:
                        if not on_ground:
                            _was_airborne[0] = True
                        _ended_on_ground[0] = bool(on_ground)

                    # Vertical rate from altitude change over real elapsed time.
                    fpm = 0.0
                    if altitude is not None:
                        tnow = time.time()
                        if _prev_alt[0] is not None and _prev_alt_t[0] is not None:
                            dt = tnow - _prev_alt_t[0]
                            if dt > 0:
                                fpm = (altitude - _prev_alt[0]) / dt * 60.0
                        _prev_alt[0] = altitude
                        _prev_alt_t[0] = tnow

                    if on_ground is not None and altitude is not None:
                        if on_ground:
                            new_phase = "ground"
                        elif fpm > PHASE_VS_FPM:
                            new_phase = "climb"
                        elif fpm < -PHASE_VS_FPM:
                            new_phase = "descent"
                        else:
                            new_phase = "cruise"
                        if new_phase != _current_phase[0]:
                            _phase_log.append((time.time(), new_phase))
                            _current_phase[0] = new_phase
                except Exception:  # noqa: BLE001
                    pass

                # Telemetry tick — always recorded (even if a SimConnect read failed),
                # so VRAM/system culprit data survives a momentary SimConnect hiccup.
                try:
                    wall_ms = int((time.time() - _recording_wall_start) * 1000.0)
                    sys_cpu, sys_ram, top_proc, top_cpu = _sys_sampler()
                    _telemetry_rows.append([
                        wall_ms,
                        _current_phase[0] or "",
                        int(altitude) if altitude is not None else "",
                        vram.latest() if vram is not None else "",
                        f"{sys_ram:.1f}" if sys_ram is not None else "",
                        f"{sys_cpu:.1f}" if sys_cpu is not None else "",
                        top_proc or "",
                        f"{top_cpu:.1f}" if top_cpu is not None else "",
                    ])
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(1.0)
        except Exception:  # noqa: BLE001
            pass  # SimConnect unavailable — tracking silently disabled

    threading.Thread(target=_sc_tracker, daemon=True).start()

    try:
        while proc.poll() is None and not stop_event.is_set():
            time.sleep(0.3)
        if stop_event.is_set():
            say("\n  Stopping capture...")
        else:
            say("  MSFS closed - finishing up...")
    except KeyboardInterrupt:
        # Ctrl+C still works as a fallback.
        say("\n  Stopping capture...")
    finally:
        stop_presentmon(proc)
        vram.stop()

    # Small grace period for the CSV to flush.
    time.sleep(1.0)

    if not os.path.isfile(tmp_csv) or os.path.getsize(tmp_csv) < 1024:
        say("  No usable capture was recorded (was MSFS running and in a flight?).")
        say("  Nothing filed.")
        input("\nPress Enter to exit...")
        return

    # --- Part 3: Mid-flight abandonment check ---
    if _was_airborne[0] and not _ended_on_ground[0]:
        say("")
        say("  Flight ended mid-air — data may be incomplete.")
        # Don't block forever if Dean walked away: auto-keep after 60s so an
        # unattended session still files (with the mid-flight note below).
        _answer = [None]

        def _ask_discard():
            try:
                _answer[0] = input(
                    "  Discard this session? (Y/N, auto-keep in 60s): ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                _answer[0] = "n"

        _t = threading.Thread(target=_ask_discard, daemon=True)
        _t.start()
        _t.join(timeout=60)
        answer = _answer[0] if _answer[0] is not None else "n"
        if _answer[0] is None:
            say("  No response in 60s — keeping session automatically.")
        if answer == "y":
            say("  Session discarded — no data filed.")
            logging.info("Session discarded by user (mid-flight abandonment).")
            try:
                os.remove(tmp_csv)
            except OSError:
                pass
            input("\nPress Enter to exit...")
            return
        say("  Keeping session — will note as mid-flight in summary.")
        settings["notes"] = "mid-flight session — manually kept"

    # --- Part 2: Compute tail-trim seconds ---
    if _last_moving_ts[0] is not None:
        last_elapsed  = _last_moving_ts[0] - _recording_wall_start
        total_elapsed = time.time() - _recording_wall_start
        trim_s = max(float(MIN_TAIL_TRIM_S), total_elapsed - last_elapsed - STOP_BUFFER_S)
        if trim_s > 1:
            say(f"  Trimming {trim_s:.0f}s tail (post-landing junk) from capture.")
    else:
        trim_s = float(TAIL_FALLBACK_S)
        say(f"  No movement data — trimming last {TAIL_FALLBACK_S}s (fallback).")

    ft_chron, cpu_chron, gpu_chron = _read_csv_chronological(tmp_csv)
    if not ft_chron:
        say("  Could not read frametimes from the capture. Nothing filed.")
        input("\nPress Enter to exit...")
        return

    ft_chron, cpu_chron, gpu_chron = _trim_head_seconds(
        ft_chron, cpu_chron, gpu_chron, HEAD_TRIM_S)
    say(f"  Trimming {HEAD_TRIM_S}s head (PresentMon init) from capture.")

    ft_trimmed, cpu_trimmed, gpu_trimmed = _trim_tail_seconds(
        ft_chron, cpu_chron, gpu_chron, trim_s)

    if len(ft_trimmed) < 100:
        say("  Too few frames after trim — session too short. Nothing filed.")
        input("\nPress Enter to exit...")
        return

    parsed = compute_stats(ft_trimmed, cpu_trimmed, gpu_trimmed)
    if not parsed:
        say("  Could not compute stats. Nothing filed.")
        input("\nPress Enter to exit...")
        return

    stats, sorted_ft = parsed
    stats["start_trim_s"] = HEAD_TRIM_S
    stats["stop_trim_s"] = round(trim_s, 1)
    frametimes_in_order = ft_trimmed  # chronological for line chart

    phase_buckets = _split_frametimes_by_phase(ft_trimmed, _phase_log, _recording_wall_start)
    if phase_buckets:
        stats["phases"] = _compute_phase_stats(phase_buckets, len(ft_trimmed))

    vram_summary = vram.summarize()
    session_dir, _, _ = file_session(
        tmp_csv, settings, stats, sorted_ft, frametimes_in_order,
        vram_summary, started_at, telemetry_rows=_telemetry_rows)

    # Clean up temp.
    try:
        os.remove(tmp_csv)
    except OSError:
        pass

    say("")
    say("  Session filed:")
    say(f"     {session_dir}")
    say(f"     P99 {stats['p99_ft_ms']}ms · stutter {stats['stutter_pct']}% · "
        f"consistency {stats['consistency_pct']}%")
    if vram_summary.get("available"):
        say(f"     VRAM peak {vram_summary['peak_vram_mb']}MB "
            f"({vram_summary['peak_pct']}% of {vram_summary['total_vram_mb']}MB)")
    say(f"     Open report.html in that folder for this flight's graph.")
    combined = os.path.join(SESSIONS_DIR, "combined_report.html")
    if os.path.isfile(combined):
        say(f"     Combined TLOD vs smoothness graph: {combined}")
    say("")


def _read_frametimes_in_order(csv_path):
    out = []
    try:
        with open(csv_path, "r", encoding="utf-8", errors="ignore", newline="") as fh:
            reader = csv.reader(fh)
            header = next(reader, None)
            if not header:
                return out
            ft_col = _pick_column(header, FRAMETIME_COLUMNS)
            if ft_col is None:
                return out
            ft_i = {h: i for i, h in enumerate(header)}[ft_col]
            for row in reader:
                if len(row) <= ft_i:
                    continue
                try:
                    val = float(row[ft_i])
                except ValueError:
                    continue
                if MIN_VALID_MS < val < MAX_VALID_MS:
                    out.append(val)
    except Exception as exc:  # noqa: BLE001
        logging.warning("Could not re-read frametimes in order: %s", exc)
    return out


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - last-resort guard
        logging.exception("Fatal error")
        print(f"\nUnexpected error: {exc}")
        try:
            input("Press Enter to exit...")
        except EOFError:
            pass
