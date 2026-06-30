# Phase 8a coverage oracle: run the REAL compute_coverage + next_gap_for_aircraft over the live
# index.json sessions, dump to _ref_cov.json. Fast (no csvs). Dev-only, read-only.
import importlib.util, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('MSFS_PERF_ROOT', os.path.join(os.environ.get('TEMP', HERE), 'p8test'))
os.makedirs(os.environ['MSFS_PERF_ROOT'], exist_ok=True)
spec = importlib.util.spec_from_file_location('mpl', os.path.join(HERE, '..', 'msfs_perf_logger.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

sdir = os.path.join(os.environ['APPDATA'], 'A Better Route Planner', 'Sessions')
idx = json.load(open(os.path.join(sdir, 'index.json'), encoding='utf-8'))
sess = idx.get('sessions', [])

cov = m.compute_coverage(sess)
counts = {'%s|%s' % (ac, t): n for (ac, t), n in cov['counts'].items()}
out = {
    'counts': counts, 'ac_totals': cov['ac_totals'], 'gaps': cov['gaps'],
    'total_remaining': cov['total_remaining'], 'target': cov['target'],
    'next_gap': {ac: m.next_gap_for_aircraft(cov, ac) for ac in m.COVERAGE_AIRCRAFT},
}
json.dump(out, open(os.path.join(HERE, '_ref_cov.json'), 'w', encoding='utf-8'), indent=1)
print('ref_cov: gaps=%d total_remaining=%d next_gap=%s' % (len(cov['gaps']), cov['total_remaining'], out['next_gap']))
