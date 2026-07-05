# Phase 8a writers oracle: run the REAL write_sessions_nav (to a temp dir) + replicate update_index's
# csv-row extraction over the live sessions -> _ref_writers.json. Read-only on the real Sessions.
import importlib.util, os, json, tempfile, re

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('MSFS_PERF_ROOT', os.path.join(os.environ.get('TEMP', HERE), 'p8test'))
os.makedirs(os.environ['MSFS_PERF_ROOT'], exist_ok=True)
spec = importlib.util.spec_from_file_location('mpl', os.path.join(HERE, '..', 'msfs_perf_logger.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

sdir = os.path.join(os.environ['APPDATA'], 'A Better Route Planner', 'Sessions')
idx = json.load(open(os.path.join(sdir, 'index.json'), encoding='utf-8'))
sessions = idx.get('sessions', [])

# nav: write via the REAL function to a throwaway dir, read back, parse the array
work = tempfile.mkdtemp(prefix='p8nav_')
m.SESSIONS_DIR = work
m.write_sessions_nav(sessions)
navtext = open(os.path.join(work, 'sessions_nav.js'), encoding='utf-8').read().strip()
nav = json.loads(re.sub(r'^window\.SESSIONS_NAV\s*=\s*', '', navtext).rstrip(';'))

# csv rows: exactly update_index's extraction
fields = ["session_id", "timestamp", "driver_version", "sim_version", "aircraft", "route", "tlod",
          "olod", "p99_ft_ms", "stutter_pct", "consistency_pct", "avg_fps", "peak_vram_mb",
          "frame_count", "folder"]
rows = [{k: s.get(k, "") for k in fields} for s in sessions]

json.dump({'nav': nav, 'fields': fields, 'rows': rows}, open(os.path.join(HERE, '_ref_writers.json'), 'w', encoding='utf-8'), indent=1)
print('ref_writers: nav entries=%d  csv rows=%d' % (len(nav), len(rows)))
