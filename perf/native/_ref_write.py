# Phase 8a write oracle: exercise the REAL write_settings against THROWAWAY temp copies of UserCfg.opt
# (the real file is never touched), hash each result. _parity_write.js diffs the Node port. Read-only
# on the real config.
import importlib.util, os, json, shutil, hashlib, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('MSFS_PERF_ROOT', os.path.join(os.environ.get('TEMP', HERE), 'p8test'))
os.makedirs(os.environ['MSFS_PERF_ROOT'], exist_ok=True)
spec = importlib.util.spec_from_file_location('mpl', os.path.join(HERE, '..', 'msfs_perf_logger.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

real = m.USERCFG_PATH
work = tempfile.mkdtemp(prefix='p8write_')
cases = [(150, 120), (100, 120), (175, 120), (200, 100)]
out = {'usercfg_path': real, 'cases': {}}
for tlod, olod in cases:
    tmp = os.path.join(work, 'UserCfg_%d_%d.opt' % (tlod, olod))
    shutil.copyfile(real, tmp)                       # work on a copy only
    m.USERCFG_PATH = tmp                             # point the real fn at the temp copy
    m.BACKUP_DIR = os.path.join(work, 'bk_%d_%d' % (tlod, olod))
    ok, msg = m.write_settings(tlod, olod)
    content = open(tmp, 'rb').read()
    out['cases']['%d_%d' % (tlod, olod)] = {'ok': ok, 'sha256': hashlib.sha256(content).hexdigest(), 'len': len(content), 'msg': msg}
m.USERCFG_PATH = real
json.dump(out, open(os.path.join(HERE, '_ref_write.json'), 'w', encoding='utf-8'), indent=1)
print('ref_write: real file untouched. cases =', {k: v['sha256'][:12] + (' ok' if v['ok'] else ' FAIL') for k, v in out['cases'].items()})
