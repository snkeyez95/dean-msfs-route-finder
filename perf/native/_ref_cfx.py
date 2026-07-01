# Dev-only oracle: run the REAL Python CapFrameX converter over the existing flights and hash each
# output, so _parity_cfx.js can prove the Node port is byte-identical. Never modifies Sessions.
import os, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # perf/
import msfs_perf_logger as M

SESSIONS = os.path.join(os.environ["APPDATA"], "A Better Route Planner", "Sessions")
GPU = "NVIDIA GeForce RTX 3080 Ti"
idx = json.load(open(os.path.join(SESSIONS, "index.json"), encoding="utf-8"))
tmp = os.path.join(HERE, "_cfx_ref_out")
os.makedirs(tmp, exist_ok=True)
out = {}
for s in idx.get("sessions", []):
    folder = (s.get("folder") or "").replace("/", os.sep)
    sdir = os.path.join(SESSIONS, folder)
    src = os.path.join(sdir, "frametimes.csv")
    if not os.path.isfile(src):
        continue
    meta = M._meta_from_session_dir(sdir)
    r = M._capframex_convert_one(src, tmp, meta, GPU)
    if r:
        data = open(r, "rb").read()
        out[s.get("session_id") or folder] = {
            "sha": hashlib.sha256(data).hexdigest(), "len": len(data),
            "name": os.path.basename(r)}
json.dump(out, open(os.path.join(HERE, "_ref_cfx.json"), "w"), indent=1)
print("ref cfx oracle:", len(out), "flights")
