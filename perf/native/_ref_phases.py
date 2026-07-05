# Dev-only oracle: run the REAL Python phase split + stats over each telemetry flight (reconstructing
# the phase_log from telemetry.csv exactly as the Node port does) so _parity_phases.js can prove the
# port. Also carries the summary.json phases for a reconstruction-fidelity check. Never writes Sessions.
import os, sys, json, csv
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
                    log.append((float(row["wall_ms"]) / 1000.0, ph))
                except (ValueError, KeyError, TypeError):
                    pass
                prev = ph
    return log

out = {}
for s in idx.get("sessions", []):
    folder = (s.get("folder") or "").replace("/", os.sep)
    fdir = os.path.join(SESSIONS, folder)
    tel  = os.path.join(fdir, "telemetry.csv")
    csvp = os.path.join(fdir, "frametimes.csv")
    if not (os.path.isfile(tel) and os.path.isfile(csvp)):
        continue
    sm = json.load(open(os.path.join(fdir, "summary.json"), encoding="utf-8"))["smoothness"]
    ft, cpu, gpu = M._read_csv_chronological(csvp)
    ft, cpu, gpu = M._trim_head_seconds(ft, cpu, gpu, sm.get("start_trim_s") or 0)
    ft, cpu, gpu = M._trim_tail_seconds(ft, cpu, gpu, sm.get("stop_trim_s") or 0)
    plog    = phase_log_from_telemetry(tel)
    buckets = M._split_frametimes_by_phase(ft, plog, 0.0)
    phases  = M._compute_phase_stats(buckets, len(ft))
    out[s.get("session_id") or folder] = {"phases": phases, "trimmed": len(ft),
                                          "summary_phases": sm.get("phases") or {}}
json.dump(out, open(os.path.join(HERE, "_ref_phases.json"), "w"), indent=1)
print("ref phases oracle:", len(out), "telemetry flights")
