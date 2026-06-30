# Phase 8a charts oracle: run the REAL report chart helpers over one flight -> _ref_charts.json.
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
csvp = os.path.join(sdir, folder, 'frametimes.csv')

ft, cpu, gpu = m._read_csv_chronological(csvp)
maxpts, meanpts, total = m._chart_frametime_series(ft)
roll = m._rolling_mean_series(meanpts)
summary = json.load(open(os.path.join(sdir, folder, 'summary.json'), encoding='utf-8'))
phases = summary['smoothness'].get('phases')

alt = m._chart_altitude_series(os.path.join(sdir, folder), total)
tel = m._read_telemetry(os.path.join(sdir, folder))
routes = ['1809 KSFO-KRDM', '4021 CYFI-CYYC', 'KMSP-KDFW', 'EGLL', '', '07Y LOWS-EDDF']
out = {
    'folder': s['folder'], 'ft_len': len(ft),
    'svg_ms': m._svg_perf_line(ft, False), 'svg_fps': m._svg_perf_line(ft, True),
    'series_max': maxpts, 'series_mean': meanpts, 'roll': roll,
    'variance': m._variance_bins(ft), 'phase_html': m._phase_bars_html(phases),
    'total_min': round(total, 6),
    'alt': alt, 'alt_len': len(alt) if alt else 0, 'tel_len': len(tel) if tel else 0,
    'routes': {r: m._display_route(r) for r in routes},
}
json.dump(out, open(os.path.join(HERE, '_ref_charts.json'), 'w', encoding='utf-8'))
print('ref_charts: ft=%d series=%d roll=%d  svg_ms=%d bytes' % (len(ft), len(maxpts), len(roll), len(out['svg_ms'])))
