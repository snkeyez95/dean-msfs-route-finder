# Phase 8a settings oracle: real read_settings() over the live UserCfg.opt -> _ref_settings.json
# (also records the resolved USERCFG_PATH so the Node port reads the exact same file). Read-only.
import importlib.util, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('MSFS_PERF_ROOT', os.path.join(os.environ.get('TEMP', HERE), 'p8test'))
os.makedirs(os.environ['MSFS_PERF_ROOT'], exist_ok=True)
spec = importlib.util.spec_from_file_location('mpl', os.path.join(HERE, '..', 'msfs_perf_logger.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

out = {'usercfg_path': m.USERCFG_PATH, 'settings': m.read_settings()}
json.dump(out, open(os.path.join(HERE, '_ref_settings.json'), 'w', encoding='utf-8'), indent=1)
print('ref_settings: path =', m.USERCFG_PATH)
print('  settings =', out['settings'])
