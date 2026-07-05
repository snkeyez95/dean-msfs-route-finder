# Dev-only oracle: build the CURRENT-schema summary dict the way file_session does, using the REAL
# Python assembly with the SAME inputs the Node engine gets (committed settings/vram/driver/sim, rounded
# stop_trim_s, telemetry-reconstructed phase_log). Isolates the port from old-schema drift + trim
# rounding, so native-vs-oracle should be exact. Does not write into Sessions.
import os, sys, json, csv
from datetime import datetime
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import msfs_perf_logger as M

SESSIONS = os.path.join(os.environ["APPDATA"], "A Better Route Planner", "Sessions")
idx = json.load(open(os.path.join(SESSIONS, "index.json"), encoding="utf-8"))

def phase_log_from_telemetry(tel_path):
    log, prev = [], None
    with open(tel_path, encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            ph = (row.get("phase") or "").strip()
            if not ph:
                continue
            if ph != prev:
                try:
                    log.append((float(row["wall_ms"]) / 1000.0, ph)); prev = ph
                except (ValueError, KeyError, TypeError):
                    pass
    return log

out = {}
for s in idx.get("sessions", []):
    folder = (s.get("folder") or "").replace("/", os.sep)
    fdir = os.path.join(SESSIONS, folder)
    csvp = os.path.join(fdir, "frametimes.csv")
    if not os.path.isfile(csvp):
        continue
    cm = json.load(open(os.path.join(fdir, "summary.json"), encoding="utf-8"))
    settings, vram = cm["settings"], cm["vram"]
    stop_trim_s = cm["smoothness"].get("stop_trim_s") or 0
    ft, cpu, gpu = M._read_csv_chronological(csvp)
    ft, cpu, gpu = M._trim_head_seconds(ft, cpu, gpu, M.HEAD_TRIM_S)
    ft, cpu, gpu = M._trim_tail_seconds(ft, cpu, gpu, stop_trim_s)
    stats, _sorted = M.compute_stats(ft, cpu, gpu)
    stats["start_trim_s"] = M.HEAD_TRIM_S
    stats["stop_trim_s"] = round(stop_trim_s, 1)
    tel = os.path.join(fdir, "telemetry.csv")
    if os.path.isfile(tel):
        buckets = M._split_frametimes_by_phase(ft, phase_log_from_telemetry(tel), 0.0)
        if buckets:
            stats["phases"] = M._compute_phase_stats(buckets, len(ft))
    now = datetime.fromisoformat(cm["timestamp"])
    summary = {
        "session_id": cm["session_id"],
        "timestamp": now.isoformat(timespec="seconds"),
        "timestamp_display": now.strftime("%b %d %Y %H:%M"),
        "driver_version": cm.get("driver_version"),
        "sim_version": cm.get("sim_version"),
        "settings": settings,
        "smoothness": stats,
        "vram": vram,
        "raw_csv": "frametimes.csv",
        "report": "report.html",
        "notes": settings.get("simbrief_route") or settings.get("notes") or "",
    }
    out[cm["session_id"]] = summary
json.dump(out, open(os.path.join(HERE, "_ref_engine.json"), "w"), indent=1)
print("ref engine oracle:", len(out), "flights (current-schema, same inputs as native)")
