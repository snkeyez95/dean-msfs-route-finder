# Phase 8a report oracle: call the REAL write_report for the latest flight -> _ref_report.html.
import importlib.util, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('MSFS_PERF_ROOT', os.path.join(os.environ.get('TEMP', HERE), 'p8test'))
os.makedirs(os.environ['MSFS_PERF_ROOT'], exist_ok=True)
spec = importlib.util.spec_from_file_location('mpl', os.path.join(HERE, '..', 'msfs_perf_logger.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

sdir = os.path.join(os.environ['APPDATA'], 'A Better Route Planner', 'Sessions')
idx = json.load(open(os.path.join(sdir, 'index.json'), encoding='utf-8'))
s = idx['sessions'][-1]
folder = (s['folder'] or '').replace('/', os.sep)
fdir = os.path.join(sdir, folder)
summary = json.load(open(os.path.join(fdir, 'summary.json'), encoding='utf-8'))
ft, _, _ = m._read_csv_chronological(os.path.join(fdir, 'frametimes.csv'))
sorted_ft = sorted(ft)
sid = summary.get('session_id') or folder

html_path = os.path.join(fdir, '_ref_report.html')
m.write_report(html_path, sid, summary['settings'], summary['smoothness'], summary['vram'],
               ft, sorted_ft, None, summary.get('driver_version'), summary.get('sim_version'))
json.dump({'folder': s['folder'], 'session_id': sid,
           'driver_version': summary.get('driver_version'), 'sim_version': summary.get('sim_version')},
          open(os.path.join(HERE, '_ref_report_meta.json'), 'w', encoding='utf-8'))
print('ref report:', os.path.getsize(html_path), 'bytes')
