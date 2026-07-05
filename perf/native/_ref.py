# Phase 8a parity oracle: run the REAL Python parse_frametimes over every existing flight's
# frametimes.csv and dump the smoothness stats to _ref.json. _parity.js diffs the Node port against
# this. Dev-only; read-only on Sessions.
import importlib.util, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('MSFS_PERF_ROOT', os.path.join(os.environ.get('TEMP', HERE), 'p8test'))
os.makedirs(os.environ['MSFS_PERF_ROOT'], exist_ok=True)

spec = importlib.util.spec_from_file_location('mpl', os.path.join(HERE, '..', 'msfs_perf_logger.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

sessions = os.path.join(os.environ['APPDATA'], 'A Better Route Planner', 'Sessions')
idx = json.load(open(os.path.join(sessions, 'index.json'), encoding='utf-8'))

out = {}
for s in idx.get('sessions', []):
    folder = (s.get('folder') or '').replace('/', os.sep)
    csvp = os.path.join(sessions, folder, 'frametimes.csv')
    if not folder or not os.path.exists(csvp):
        continue
    res = m.parse_frametimes(csvp)
    if res is None:
        continue
    stats, _sorted = res
    out[s.get('session_id') or folder] = stats

json.dump(out, open(os.path.join(HERE, '_ref.json'), 'w', encoding='utf-8'), indent=1)
print('ref: wrote', len(out), 'flights to _ref.json')
