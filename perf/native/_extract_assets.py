# Phase 8a: extract the report's static CSS/JS constants straight from the Python engine into
# report_assets.json (committed). Guarantees the Node port embeds byte-identical assets — no retyping.
# Re-run only if the Python constants ever change (they won't, once cut over).
import importlib.util, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('MSFS_PERF_ROOT', os.path.join(os.environ.get('TEMP', HERE), 'p8test'))
os.makedirs(os.environ['MSFS_PERF_ROOT'], exist_ok=True)
spec = importlib.util.spec_from_file_location('mpl', os.path.join(HERE, '..', 'msfs_perf_logger.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

names = ['THEME_BASE_CSS', 'THEME_JS', 'REPORT_CSS', 'REPORT_JS', 'CHART_JS', 'NAV_JS', 'DASH_CSS', 'DASH_JS']
assets = {n: getattr(m, n) for n in names}
json.dump(assets, open(os.path.join(HERE, 'report_assets.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print('report_assets.json:', {n: len(assets[n]) for n in names})
