'use strict';
// Telemetry sys_cpu resilience (v6.13.4): Windows can transiently drop the \Processor(_Total)
// counter from typeperf's header (self-heals next session) — it happened on the 2026-07-17 flight,
// leaving sys_cpu_pct blank for the whole capture while top_proc + RAM recorded fine. The sampler
// now derives sys_cpu from the Idle process (100 − Idle%/ncpu) when the dedicated counter is gone,
// and warns once. This locks that in.
const path = require('path');
const X = require('./lib/extract.js');
const { TelemetrySampler } = require(path.join(X.ROOT, 'perf', 'native', 'telemetry.js'));
const T = X.runner('telemetry sys_cpu resilience:');

// Feed the sampler raw typeperf lines directly through its line parser. ncpu is os-derived; read it
// off the instance so the expected math matches the machine running the test.
function makeSampler(){ const logs = []; const s = new TelemetrySampler(['perf-engine','node'], m => logs.push(m)); return { s, logs, n: s.ncpu }; }
const feed = (s, line) => s._onLine(line);
const q = str => '"' + str + '"';

// PDH-CSV header + one data row. Columns: timestamp, Process(Idle), Process(chrome), [Processor], Memory.
function header({ withCpu }){
  const cols = [ 'PDH-CSV 4.0',
    '\\\\PC\\Process(Idle)\\% Processor Time',
    '\\\\PC\\Process(chrome)\\% Processor Time' ];
  if(withCpu) cols.push('\\\\PC\\Processor(_Total)\\% Processor Time');
  cols.push('\\\\PC\\Memory\\Available MBytes');
  return cols.map(q).join(',');
}
function row(vals){ return vals.map(v => q(String(v))).join(','); }

// ── normal case: the Processor counter is present, used directly ──
{
  const { s, logs, n } = makeSampler();
  feed(s, header({ withCpu:true }));
  // Idle=big, chrome=50, Processor(_Total)=12.5, Mem avail=40000
  feed(s, row(['ts', n*100 - 200, 50, 12.5, 40000]));
  const [cpu, ram, top] = s.latest();
  T('uses \\Processor(_Total) directly when present (12.5)', cpu === 12.5, String(cpu));
  T('no warning logged in the normal case', logs.length === 0, logs.join(' | '));
  T('top_proc still resolves (chrome)', /chrome/i.test(top), top);
}

// ── glitch case: the Processor counter is MISSING → derive from Idle ──
{
  const { s, logs, n } = makeSampler();
  feed(s, header({ withCpu:false }));
  // Idle total across cores = (n-1)*100  → busy = 100 - (n-1)*100/n = 100/n ≈ one core fully busy
  feed(s, row(['ts', (n - 1) * 100, 90, 40000]));
  const [cpu] = s.latest();
  const expected = Math.round((100 - ((n - 1) * 100) / n) * 10) / 10;
  T('derives sys_cpu from Idle when Processor counter is gone', cpu === expected, 'got ' + cpu + ' expected ' + expected);
  T('derived value is sane (0–100)', cpu >= 0 && cpu <= 100, String(cpu));
  T('warns exactly once about the missing counter', logs.length === 1 && /Processor\(_Total\).*Idle/.test(logs[0]), logs.join(' | '));
  // full idle → ~0% busy
  feed(s, row(['ts', n * 100, 0, 40000]));
  T('all-idle derives ~0% busy', s.latest()[0] === 0, String(s.latest()[0]));
}

// ── worst case: no Processor counter AND no Idle column → honest null + a distinct warning ──
{
  const logs = [];
  const s = new TelemetrySampler(['perf-engine','node'], m => logs.push(m));
  // header with neither Processor(_Total) nor Idle
  s._onLine(['PDH-CSV 4.0', '\\\\PC\\Process(chrome)\\% Processor Time', '\\\\PC\\Memory\\Available MBytes'].map(q).join(','));
  s._onLine(['ts', 50, 40000].map(v => q(String(v))).join(','));
  T('no Processor + no Idle → sys_cpu stays null (honest)', s.latest()[0] === null, String(s.latest()[0]));
  T('warns about the blank column + lodctr /R hint', logs.length === 1 && /no Idle column.*lodctr/.test(logs[0]), logs.join(' | '));
}

// ── the real Windows behaviour: Process + Memory survive, only Processor drops ──
{
  const { s, n } = makeSampler();
  feed(s, header({ withCpu:false }));
  feed(s, row(['ts', (n - 1) * 100, 30, 32000]));
  const [cpu, ram, top, topCpu] = s.latest();
  T('RAM still computes when Processor is missing', typeof ram === 'number' && ram > 0, String(ram));
  T('top_proc still computes when Processor is missing', /chrome/i.test(top) && topCpu > 0, top + ' ' + topCpu);
  T('...and sys_cpu is no longer blank (the whole point)', cpu !== null, String(cpu));
}

process.exit(T.done() ? 1 : 0);
