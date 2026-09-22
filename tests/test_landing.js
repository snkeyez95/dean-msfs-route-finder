'use strict';
// v6.22.0 — landing performance (Dean 2026-09-22): touchdown FPM + peak G + groundspeed + rating +
// bounce, from VERTICAL SPEED + G FORCE sampled at frame rate around touchdown. The LandingTracker and
// rateLanding are pure (no SimConnect I/O) so they desk-test with synthetic frame sequences. Also proves
// the landing line reaches the flight debrief and the card reaches the per-flight report HTML.
const fs = require('fs'), os = require('os'), path = require('path');
const X = require('./lib/extract.js');
const T = X.runner('Landing performance:');
const { LandingTracker, rateLanding } = require('../perf/native/simconnect.js');
const { buildDebrief } = require('../perf/native/debrief.js');
const { buildReport } = require('../perf/native/report_html.js');

// Feed a tracker a sequence of [vs, g, onGround, gs, t] frames.
function run(frames){ const lt = new LandingTracker(); for(const f of frames) lt.update(f[0], f[1], f[2], f[3], f[4]); return lt.result(); }
// Build a normal approach→touchdown: N seconds airborne at `vs`, then on-ground, with a G spike a frame later.
function landingSeq(vs, touchG, opts){
  opts = opts || {}; const f = []; const gs = opts.gs != null ? opts.gs : 130;
  f.push([0, 1.0, 1, 5, 0]);                                  // sitting on ground (taxi)
  for(let t=2; t<=40; t+=2) f.push([vs, 1.0, 0, gs, t]);      // 38 s airborne, descending at `vs`
  f.push([vs, 1.0, 1, gs, 41]);                               // TOUCHDOWN (on-ground flips)
  f.push([0, touchG, 1, gs-5, 41.3]);                         // G spike a frame later (within the 2 s window)
  f.push([0, 1.1, 1, gs-20, 43]);                             // settled
  return f;
}

// ── 1. rateLanding thresholds ──
T('1. rateLanding: -40 fpm → Butter', rateLanding(-40, 1.1) === 'Butter', rateLanding(-40,1.1));
T('   -120 fpm → Good', rateLanding(-120, 1.1) === 'Good');
T('   -300 fpm → Firm', rateLanding(-300, 1.2) === 'Firm');
T('   -650 fpm → Hard', rateLanding(-650, 1.3) === 'Hard');
T('   G bump: soft fpm but 1.9 G → Firm', rateLanding(-50, 1.9) === 'Firm', rateLanding(-50,1.9));
T('   G bump: 2.3 G → Hard regardless of fpm', rateLanding(-90, 2.3) === 'Hard');

// ── 2. a smooth landing ──
const smooth = run(landingSeq(-140, 1.25));
T('2. smooth landing captured', !!smooth, JSON.stringify(smooth));
T('   fpm ≈ -140 (from the last airborne frame, not the arrested on-ground frame)', smooth && smooth.touchdown_fpm === -140, smooth && smooth.touchdown_fpm);
T('   peak G grew into the post-touchdown window (1.25, not the 1.0 at contact)', smooth && smooth.peak_g === 1.25, smooth && smooth.peak_g);
T('   groundspeed captured at touchdown (130 kt)', smooth && smooth.touchdown_gs_kt === 130, smooth && smooth.touchdown_gs_kt);
T('   rating Good', smooth && smooth.rating === 'Good');
T('   no bounce', smooth && smooth.bounce_count === 0);

// ── 3. a hard landing ──
const hard = run(landingSeq(-620, 2.4));
T('3. hard landing → Hard', hard && hard.rating === 'Hard', hard && hard.rating);
T('   fpm -620', hard && hard.touchdown_fpm === -620);

// ── 4. a bounce: touchdown, brief hop back up, touchdown again ──
const bounceFrames = landingSeq(-300, 1.4).concat([
  [ -50, 1.0, 0, 120, 43.5],   // bounces back into the air (short hop)
  [ -120, 1.0, 0, 118, 45],
  [ -120, 1.6, 1, 115, 46.5],  // second touchdown, firmer G
  [ 0, 1.1, 1, 100, 48],
]);
const bounce = run(bounceFrames);
T('4. bounce detected', bounce && bounce.bounce_count === 1, bounce && JSON.stringify(bounce));
T('   reports the FIRMEST touchdown (-300, not the -120 re-touch)', bounce && bounce.touchdown_fpm === -300, bounce && bounce.touchdown_fpm);

// ── 5. takeoff roll / pre-flight bumps are NOT a landing ──
const taxiOnly = run([
  [0,1.0,1,5,0],[0,1.0,1,10,2],
  [ -50,1.0,0,60,3],[ -50,1.0,0,80,5],   // a brief lift during the takeoff roll (<30 s airborne)
  [0,1.05,1,100,7],                        // back on ground almost immediately
]);
T('5. a brief airborne hop under 30 s is NOT counted as a landing', taxiOnly === null, JSON.stringify(taxiOnly));

// ── 6. never touched down (go-around / capture ended airborne) → null ──
const airborne = run([[0,1.0,1,5,0]].concat(Array.from({length:20},(_,i)=>[-600,1.0,0,180,2+i*2])));
T('6. no touchdown → null result', airborne === null);

// ── 7. the landing line reaches the flight debrief ──
const db = buildDebrief({ stats:{ p99_ft_ms:17.2, duration_seconds:3600 }, settings:{ aircraft:'Citation X',
  landing:{ touchdown_fpm:-142, peak_g:1.28, touchdown_gs_kt:138, rating:'Good', bounce_count:0 } },
  vram:{ peak_pct:80 }, history:[] });
const dbLand = (db.lines||[]).find(l => /Touchdown:/.test(l.text));
T('7. debrief has a Touchdown line', !!dbLand, dbLand && dbLand.text);
T('   …with fpm, G and rating', dbLand && /-142 fpm/.test(dbLand.text) && /1\.28 G/.test(dbLand.text) && /Good/.test(dbLand.text), dbLand && dbLand.text);
// a flight with no landing block → no landing line (older flights)
const dbNo = buildDebrief({ stats:{ p99_ft_ms:17.2, duration_seconds:3600 }, settings:{ aircraft:'Fenix' }, vram:{ peak_pct:80 }, history:[] });
T('   flight without a landing block → no Touchdown line', !(dbNo.lines||[]).some(l => /Touchdown:/.test(l.text)));

// ── 8. the landing card reaches the per-flight report HTML ──
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abrp-land-'));
try {
  const ft = Array.from({length:500}, () => 16.7);
  const settings = { aircraft:'Citation X', tlod:100, olod:120, autofps_active:true,
    landing:{ touchdown_fpm:-142, peak_g:1.28, touchdown_gs_kt:138, rating:'Good', bounce_count:2 } };
  const stats = { p99_ft_ms:17.2, avg_fps:60, frame_count:500, duration_seconds:3600, stutter_pct:0.02,
    consistency_pct:99.8, gpu_bound_pct:40, cpu_bound_pct:60, phases:{} };
  const html = buildReport('2026-09-22_test', settings, stats, { available:true, peak_vram_mb:9000, total_vram_mb:12288, peak_pct:73, avg_vram_mb:8000 },
    ft, ft.slice(), dir, '566.36', '1.8.16.0', []);
  T('8. report HTML has the Landing performance card', /Landing performance/.test(html));
  T('   …shows the fpm, rating and bounce count', /-142/.test(html) && /Good/.test(html) && /2 bounces/.test(html), null);
  // a report with no landing block → no card
  const html2 = buildReport('2026-09-22_test2', { aircraft:'Fenix', tlod:100, olod:120 }, stats,
    { available:false }, ft, ft.slice(), dir, '566.36', '1.8.16.0', []);
  T('   report without a landing block → no card', !/Landing performance/.test(html2));
} catch (e) {
  T('8. report HTML build (landing card)', false, 'threw: ' + (e && e.message));
} finally { try { fs.rmSync(dir, { recursive:true, force:true }); } catch(_){} }

process.exit(T.done() ? 1 : 0);
