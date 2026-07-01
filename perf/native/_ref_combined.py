# Phase 8a combined-dashboard oracle: run the REAL rebuild_combined_report against a temp Sessions dir
# (real one untouched) -> _ref_combined.html (line-endings normalized to \n).
import importlib.util, os, json, shutil, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('MSFS_PERF_ROOT', os.path.join(os.environ.get('TEMP', HERE), 'p8test'))
os.makedirs(os.environ['MSFS_PERF_ROOT'], exist_ok=True)
spec = importlib.util.spec_from_file_location('mpl', os.path.join(HERE, '..', 'msfs_perf_logger.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

real = os.path.join(os.environ['APPDATA'], 'A Better Route Planner', 'Sessions')
work = tempfile.mkdtemp(prefix='p8comb_')
shutil.copyfile(os.path.join(real, 'index.json'), os.path.join(work, 'index.json'))
m.SESSIONS_DIR = work
m.rebuild_combined_report()
out = open(os.path.join(work, 'combined_report.html'), encoding='utf-8').read()   # text mode: \r\n -> \n
open(os.path.join(HERE, '_ref_combined.html'), 'w', encoding='utf-8', newline='').write(out)
print('ref combined:', len(out), 'chars')
