# Roadmap: Port the TLOD Performance Optimizer into ABRP

## ✈️ v6.19.0 — ADD THE PMDG 777-300ER: fleet + routes + activation + benchmark, no stone unturned (Dean 2026-08-11, plan-approved)
> ✅ BUILT + SHIPPED 2026-08-11. Folder move done (PMDG/737-800 + PMDG/777-300ER — real pkgScanGroups
> verified two groups). Benchmark migration inserts 'PMDG 777' AHEAD of the PMDG entry (first-match-wins);
> sysinfo/prep legacy fallbacks match 777 first; index_writer + report_combined now read benchmark labels
> from ABRP_BENCHMARK env (777 tracks primary + gets its own dashboard card/coverage row); _blCompute
> blends over aircraft WITH data (TLOD-125 pick proven byte-identical on real data); FLEET_DEF B77W+B773,
> SI_ACFT_MAP ingest gate opened, 8h/12h duration buckets, aircraftGroupForType matches the group id,
> fleetSbType replaces the hardcoded A320. tests/test_777_aircraft.js 47/47; full board 27 suites green.
> OWED (Dean): tick "PMDG 777-300ER" in Settings → My Fleet; routes arrive on the next SI refresh.

### Context
Dean bought the PMDG 777-300ER and already moved its two packages (`pmdg-aircraft-77w` +
`pmdg-aircraft-77w-liveries`) out of Community into his aircraft library at
`C:\Users\MultiBotPC\Documents\MSFS\Aircraft\PMDG\`, flat beside the 738's packages. He asked for a
full-implications pass: activation, Aircraft & Utility, fleet/routes, and anything else a new aircraft
touches — "hit it perfect in one go." Exploration (3 agents, verified against his live config + the real
community_routes.json) found the complete blast radius:

- **Activation**: groups are derived by folder scan (`pkgScanGroups`, main.js:882-904 — "a group = any
  folder directly holding ≥1 package"). Flat placement means the 777 would silently JOIN the 738's group
  (one "PMDG" row linking all 5 packages). Fix = folder restructure into `PMDG\737-800\` +
  `PMDG\777-300ER\` (mirrors Fenix). Liveries auto-ride (packages in the same group folder); `groupDeps`
  not needed. `cfg.aircraftActive` is currently `[]` — nothing to migrate. An "add aircraft" function
  effectively already exists: the filesystem + rescan IS the flow; only the subfolder convention was
  undocumented.
- **Fleet/routes**: `FLEET_DEF` (index.html:1146-1158), `SI_ACFT_MAP` (:1136-1141), `SIM_LBL`/`SIM_SB`
  (:1143-1144) are hardcoded, 777-free. `SI_ACFT_MAP` is the INGEST GATE (processPage :2502,
  importSIFile :8207, downloadCommunityRoutes :8274) — the registry, the 20k snapshot, and the shipped
  community_routes.json contain **zero 777 routes** (verified histogram: exactly the 10 narrowbody keys).
  Data only accumulates from the next SI refresh AFTER the code ships. SI uses ICAO designators →
  **`B77W`** is the code (77W is IATA, would match nothing).
- **Perf (the trap)**: `cfg.benchmark.aircraft` PMDG entry matches bare `'pmdg'` →
  `normalizeAircraftTitle` (sysinfo.js:54-67, first-match-wins) labels every 777 flight **'PMDG'** — the
  737's benchmark label — polluting the baseline cells (index.html:4409/4413), coverage (coverage.js:31),
  Scenery leave-one-out z-pools (:4132-4147), Lab controls, and Compare matched cells (:4228). SimBrief
  trap: `matchBenchmarkAircraft` (prep.js:17-24) on a blob containing "PMDG" would write a **737 benchmark
  TLOD to a 777 flight**. Legacy built-in sysinfo.js:64 maps `'777'`→'PMDG' too.
- **Safely handled already**: PMDG WASM cleaner (`pmdg-aircraft-*` wildcard + `work`-folder preserve,
  main.js:1652-1669) and version watcher (prefix scan, liveries excluded, main.js:858-879) cover the 77W
  automatically. The PMDG-737 radio adapter (main.js:2243-2250, `'pmdg' AND /73[7-9]/`) correctly declines
  a 777 title (777 SDK uses different event IDs — a 777 adapter is a separate future project).

Dean's locked answers (AskUserQuestion 2026-08-11): **full 3rd benchmark aircraft** (own label
'PMDG 777', own grid cells — not a reference plane); **ingest B77W + B773** (the -300 non-ER is
realistically flyable with the -300ER); **Claude does the folder move** (MSFS closed; no junctions live).

Design consequence I'll engineer around: with 0 logged 777 flights, a naive worst-of-three blend marks
every TLOD "incomplete" and would BLANK the existing TLOD-125 headline. `_blCompute` must blend over
aircraft WITH data at each TLOD and show the 777 as "collecting 0/12" — the current pick survives while
777 cells fill. Also: benchmark cells only fill on offline, non-AutoFPS, fixed-TLOD flights (the same
quarantine rules as the original 24) — Dean's day-to-day VATSIM+AutoFPS 777 flights are logged/charted
but won't fill the grid; auto-TLOD (`--prep-next`) will offer 777 cells when he SimBriefs a 77W and
launches a capture flight without AutoFPS.

### Build steps

**A. Folder move (filesystem, Dean-approved; MSFS must be closed):**
```
PMDG\737-800\    ← pmdg-aircraft-738, pmdg-aircraft-738-liveries, xbaw-soundset-737
PMDG\777-300ER\  ← pmdg-aircraft-77w, pmdg-aircraft-77w-liveries
```
Verify with a fresh `scan-packages`: two groups `PMDG/737-800` + `PMDG/777-300ER` under parent PMDG.
`cfg.aircraftActive=[]` and `groupDeps` (Fenix-only) untouched.

**B. Benchmark config migration (main.js):** one-time, gated by `cfg.mig777Done`. If `cfg.benchmark`
exists and no entry's match terms intersect `['777','77w']`, INSERT `{label:'PMDG 777',
match:['777','77w']}` **before** the PMDG entry (first-match-wins protects both directions: a 777 title
hits '777' first; a 737 title contains no '777' and falls through to 'pmdg'/'737'). Update
`DEFAULT_BENCHMARK` (main.js:587-595) the same way for fresh installs. `benchCfg()` already flows the
migrated config into the capture child (`ABRP_BENCHMARK`, main.js:2006) and lab-report child (:2169).

**C. Engine label correctness (perf/native):**
- `sysinfo.js` legacy built-ins (:63-65): route `'777'`/`'77w'` → `'PMDG 777'` BEFORE the pmdg/737 line
  (belt-and-braces for env-less contexts).
- `prep.js` `normalizeSimbriefAircraft` (:25-31): add the same 777 → `'PMDG 777'` branch. With the
  migrated config, `matchBenchmarkAircraft` hits '777' before 'pmdg' — the wrong-TLOD trap dies.
- `index_writer.js` `isPrimaryAircraft` (:6-8) + `report_combined.js` COVERAGE_AIRCRAFT consumers
  (:11/:49/:77): read benchmark labels from `ABRP_BENCHMARK` env (fall back to the constants) so a
  'PMDG 777' flight tracks as **primary** and gets its own dashboard aircraft card. coverage.js already
  takes the grid from config — 3 aircraft × 4 TLODs × 3 = 36 total flows through.

**D. Baseline resilience (index.html `_blCompute` ~:4393-4435):** blend worst-of over aircraft WITH data
at each TLOD (skip empty cells rather than voiding the TLOD); coverage strip + Baseline copy show
'PMDG 777 — collecting 0/12'. The TLOD-125 headline must be byte-identical on Dean's real data until a
777 benchmark flight exists (regression-assert this).

**E. Fleet + routes (index.html):**
- `FLEET_DEF` += `{code:'B77W', label:'PMDG 777-300ER', family:'777', def:false}` (def:false avoids the
  getActiveFleet-vs-UI fallback mismatch at :2899-2903 vs :2460 — Dean ticks it once in My Fleet).
- `SI_ACFT_MAP` += `'B77W':'b77w', 'B773':'b77w'`; `SIM_LBL` += `"b77w":"PMDG 777-300ER"`; `SIM_SB` +=
  `"b77w":"B77W"` (SimBrief takes ICAO designators — B77W flows through openSimBrief callers unchanged).
- Duration dropdown (:543-550): add `Under 8h` + `Under 12h` buckets (6h cap would hide long-haul when
  a filter is set).
- `aircraftGroupForType` (:2371-2386): add the group **id/label** to the match haystack (candidates
  `['777','300']` from "PMDG 777-300ER" never appear in `pmdg-aircraft-77w`, but do in the
  `PMDG/777-300ER` group id) — makes the route-card Activate-aircraft button + Launch+Capture warning
  work for 777 routes. Verify 737/Fenix matching is unchanged.
- `_benchCandidates` (:4980-4991): add `'777':'PMDG 777'` to the fam map + its match terms, so a future
  wizard re-run offers the 777 without the free-text path.
- Challenging Approaches free-plan buttons (:7963, :8017): replace hardcoded `SIM_SB['a320']` with the
  first checked fleet code (minor honesty fix).
- LEAVE AS-IS (by design): Scenic 240-min cap (scenic is short-haul themed); default dur-ascending sort;
  snapshot frozen at 20k (Dean's 2026-07-06 decision — 777 routes live in the registry only; snapshot/
  community file won't gain them unless that decision is revisited — flagged in the recap, not changed).

**F. Docs/version:** v6.19.0 (package.json + index.html ×3 + README changelog). SKILL.md: new 'PMDG 777'
label, 3-aircraft/36-flight grid, B77W/B773 route codes, the collecting-cells baseline rule. Memory +
sync-notes.

### Tests (tests/test_777_aircraft.js, new + extend existing)
- `normalizeAircraftTitle` with the migrated benchmark: 'PMDG 777-300ER …' → 'PMDG 777';
  'PMDG 737-800 …' → 'PMDG'; Fenix titles unchanged; env-less legacy fallback: 777 → 'PMDG 777'.
- `matchBenchmarkAircraft` ordering: blob containing BOTH 'pmdg' and '777' → 'PMDG 777' (the TLOD trap).
- Migration: old config gains the 777 entry FIRST; idempotent via mig777Done; fresh-install seed matches.
- `aircraftGroupForType`: B77W → `PMDG/777-300ER`; B738 → `PMDG/737-800`; A320 unchanged (mock groups).
- Consts wiring: FLEET_DEF has B77W; SI_ACFT_MAP maps B77W+B773 → b77w; SIM_LBL/SIM_SB present.
- `computeCoverage` with the 3-aircraft grid: total 36, 'PMDG 777' cells zero-filled; existing 24 intact.
- `_blCompute` on REAL data: TLOD-125 pick byte-identical with the 777 entry added (empty cells skipped).
- Full board `node tests\run_all.js` unpiped, exit 0.

### Verification (live, Dean)
Folder move → Aircraft & Utility shows two PMDG rows; tick 777-300ER → both its packages junction into
Community; MSFS loads it. Settings → My Fleet: tick "PMDG 777-300ER". Route data: next SI refresh ingests
B77W/B773 routes (nothing to re-import — community file has none). SimBrief a 77W plan + Launch+Capture
(no AutoFPS) → auto-TLOD announces "Set TLOD 100 for PMDG 777" (the thinnest 777 cell); flight files with
aircraft='PMDG 777'; Baseline still says TLOD 125 with '777 collecting'. WASM cleaner + version watcher
need no action (verified automatic). Radio Set-standby button correctly absent on the 777.

## 🛰️ v6.18.0 — VATSIM OVERLAY REWORK: UNICOM-gap next-up, standby framing, hover chain, relevant blink (Dean 2026-08-08, plan-approved)

### Context
Dean flew KDTW→KJFK on VATSIM. At the (uncontrolled) departure the overlay correctly showed CTAF, but
"Next up" jumped straight to **KJFK Approach** and never mentioned the **UNICOM 122.800** coverage gap in
between — the same class of bug the v6.17.2 fix was supposed to kill, but a *different shape*: v6.17.2 only
handles a gap between two Centers at the route's tail; this flight had **no Center online at all** enroute
(a fully-uncovered stretch feeding a staffed arrival), which the v6.17.2 gate deliberately excluded. On top
of the bug, Dean wants four overlay changes so it helps him *pre-select standby frequencies* and stops
distracting him: (1) fix the UNICOM-gap next-up so the predicted chain is honest; (2) remove the small
"chatter" text that clogs the panel; (3) add a **hover-expand live ATC-chain preview** (his screenshot is the
route-score chip strip) showing the predicted handoff chain *and where he is in it right now*, without making
the overlay bigger; (4) rework the blink/ding so it only fires for **relevant, ahead-of-the-aircraft** changes
— today a departure-field controller signing on while he's at cruise still pulses/chimes the dot.

Dean's locked answers (AskUserQuestion 2026-08-08): **standby = surface it, he tunes manually** (PMDG/Fenix
ignore the SimConnect radio-write — v6.7.0 already dropped auto-tune; no auto-write); **chatter to drop = the
'why' reasoning line AND the 'Also at KXXX…' line** (keep the ATIS footnote + "you're tuned to X"); **chain
view = the live predicted chain** (ordered, only staffed positions + UNICOM gaps, current step highlighted /
passed steps dimmed — NOT the full offline tier grid).

Model for the build: surgical edits in the 8000-line `index.html` + `overlay.html` + a tiny `main.js` window-
size bump → **Opus**.

### Part A — UNICOM-gap next-up fix (the recurring bug), all in index.html
Root cause (traced): for KDTW→KJFK with no Center online, `latcFreqStack` returns `st.enr=[]`,
`enrouteGap=true`, `tailGap=true`. The insert gate at **index.html:7321** is `if(st.enr.length && st.tailGap)`
→ `0 && true` = false, so no UNICOM enters the sequence. Even if it did, `latcNextUp`'s `!rec.found` branch
(7361–7373) searches **only `leg:'arr'` ATC**, so from the dark-departure CTAF it returns KJFK Approach and
skips the gap. Two coordinated changes:

1. **Broaden the enroute-UNICOM insert gate (line 7321).** Replace with:
   ```js
   if(st.tailGap && (st.enr.length || st.arr.length)) seq.push({kind:'atc', tier:'UNICOM', leg:'enr', callsign:null, freq:LATC_UNICOM});
   ```
   Rationale: `tailGap` (route uncovered at the END) is the true "UNICOM stretch into arrival" signal; require
   *something staffed* (`st.enr.length` a Center somewhere, OR `st.arr.length` a staffed arrival) so it's a
   real intermediate handoff — **a fully-dark route (no Center AND dark arrival) still gets no insert**, keeping
   the planning-aid path and its passing `test_v6128_audit_fixes.js` cases intact. Preserves the v6.17.2
   tail-gap-between-Centers behavior (`st.enr.length` still truthy there). The de-dup guard at 7328–7329 (skip
   the arrival CTAF/UNICOM when it would repeat the just-added enroute UNICOM) stays.

2. **Teach `latcNextUp` to surface the enroute leg first from a dark departure (7361 `!rec.found` branch).**
   Before the arrival-ATC search (`nextAtc`, 7367), when `atDep` (rec is the dark departure field, computed the
   same way as 7371), prefer the first enroute entry:
   ```js
   if(atDep){ const nextEnr=(seq||[]).find(x=>x.leg==='enr' && x.kind==='atc'); if(nextEnr) return Object.assign({}, nextEnr, {downroute:false, noEnr:false}); }
   ```
   Result chain for KDTW→KJFK: at KDTW on CTAF → **Next up: 122.800 UNICOM**; once airborne on UNICOM the entry
   is now matched by the found-path (7345, callsign-null + freq match) so it advances to **KJFK Approach** — the
   exact proactive-standby progression Dean wants. Unaffected paths: rec sitting ON a Center (found-path, the
   v6.17.2 case) and the fully-dark route (no enr entry inserted → falls through to the existing arrival-CTAF
   planning aid).

### Part B — Remove chatter + reframe next-up as a STANDBY slot (overlay.html + index.html payload)
- **overlay.html:** delete the `#why` (`.why`) and `#also` (`.also`) DOM nodes + their JS refs/renders
  (lines 20, 22, 35, 37, 45, 129, 132). Keep `#cur` ("you're tuned to X"), `#atisnote`, `#atis`, `#perf`.
- **index.html `latcPushOverlay` (7650–7664):** stop building/pushing `why` and `also` (drop the `also` loop
  7641–7646 and the `why:`/`also:` payload fields). 
- **Reframe the `#next` line as an explicit STANDBY slot** — mirrors a radio's active/standby pair so it reads
  as "pre-load THIS." Keep the honest `latcNextUpLabel`/`latcNextUpNote` logic but present it as e.g.
  `STANDBY → 122.800 · UNICOM` (or "Later …" when downroute). Small styling: a caps `.k`-style "STANDBY"
  affix on the `.next` line. Big `.freq` stays the active "frequency to be on."

### Part C — Hover-expand live ATC-chain preview (overlay.html + index.html payload + main.js height)
- **index.html:** push a new `chain` array in the overlay payload, built from `latcSeqForNow()` (skip `kind:'atis'`
  entries — the ATIS footnote already covers weather). For each entry emit `{label, freq, state}` where `label` =
  `latcPosLabel(tier,callsign)` (or "UNICOM"/"CTAF" for null-callsign entries), `freq` = `latcFmt(freq)`, and
  `state ∈ {passed,current,next,upcoming}`. Compute state by locating the current `rec` in the sequence (same
  match rule as `latcNextUp` 7345) → that index is `current`, earlier = `passed`, later = `upcoming`; mark the
  `nextUp` entry as `next`. When `rec` isn't in the sequence (dark-dep CTAF), there's no `current`; mark the
  `nextUp` entry `next` and everything before it `passed`. Cap ~12 entries.
- **overlay.html:** add a hidden `.chain` flyout container below the panel. Reveal it on **hover of a small
  handle** inside the panel (a "⛓ flight chain ▾" row) — `mouseenter` shows, `mouseleave` hides — so the base
  panel size never changes; the chain only appears on demand. Render one compact mono chip per entry in flight
  order (top→bottom): freq + label, styled by state — `current` = solid amber, `next` = amber outline, `passed`
  = dimmed (opacity ~.45), `upcoming` = normal grey. Reuse the chip idiom from `vscoreDetailRow` (index.html
  6224–6229) / the briefing card chip (`latcRenderBrief` 6999). Add the chain element to the mousemove
  click-through hit-test (`overPanel` check, overlay.html 164) so hovering it keeps the window interactive.
- **main.js:** bump the overlay window height (`H=250` → ~`430`, main.js:2411) so the chain flyout has room. The
  window is transparent + click-through except over the dot/panel/chain, so the extra height is invisible and
  inert. Dot/panel stay anchored top-right (positions unchanged).

### Part D — Relevant/ahead-only blink & ding (index.html `latcCheckToasts`)
The misfire is the `newController` toast at **index.html:7539** — it diffs the whole route's online set with no
position filter, so a departure-field sign-on pulses/chimes the dot at cruise. Add a relevance gate:
- New helper `latcCtrlRelevantAhead(callsign, pos, depApt, arrApt)`:
  - On the ground (`pos.onGround`) or missing pos/route → **relevant** (don't filter; a new departure controller
    matters pre-taxi).
  - Field position (resolve `latcAirportForCallsign(callsign, LATC.db)`): relevant iff
    `gcDist(ctrlApt, arrApt) <= gcDist(pos, arrApt) + 30` (the field is at/ahead of you toward the destination).
    A departure field at cruise has `gcDist(dep,arr) ≫ gcDist(pos,arr)` → filtered out. The arrival field
    (`dist 0`) and any field ahead → kept.
  - Center / unresolvable: relevant iff it covers a **forward** sample — reuse the `latcNextHandoff` idiom
    (`latcCoveringCtrl` over a few `gcSamples(pos → arrApt)`).
- At 7539, only `latcOverlayToast('newController', …)` for the subset of `nw` that passes the gate (still set
  `LATC._lastCtrl=cur` to the FULL set so a filtered controller doesn't re-alert later). Leaves `isNewRec`
  (7615–7638, driven by the current-position rec — already relevant by construction) and the already-ahead-aware
  `handoff` toast (7544–7555) untouched.

### Files
- **index.html** — Part A (`latcEnrichedSequence` 7321, `latcNextUp` 7361 branch); Part B (`latcPushOverlay`
  7641–7664 drop why/also, standby reframe); Part C (chain array in payload); Part D (`latcCheckToasts` 7539 +
  `latcCtrlRelevantAhead` helper). Version strings ×3 (title ~349, sb-ver ~393, footer ~8279).
- **overlay.html** — remove `.why`/`.also`; STANDBY styling on `.next`; add `.chain` flyout + hover handle +
  hit-test; render the `chain` payload.
- **main.js** — overlay window `H` 250→~430 (2411).
- **package.json** — version 6.17.2 → 6.18.0. **README.md** — changelog entry.
- **tests/** — extend `tests/test_vatsim_depapp.js`; add `tests/test_overlay_chain.js` (chain-state + relevance
  gate). Run `node tests\run_all.js`.

### Verification
- **Desk tests (must pass before ship):**
  - `test_vatsim_depapp.js` NEW case — dark-enroute gap: `st={dep:[],enr:[],arr:[{tier:'APP',callsign:'JFK_APP',freq:...}],enrouteGap:true,tailGap:true}`, `depApt=KDTW`, `arrApt=KJFK` → `latcEnrichedSequence` contains a `{tier:'UNICOM',leg:'enr',freq:122.800}` entry ordered before the arrival APP; and `latcNextUp({found:false,apt:KDTW,callsign:null,freq:<KDTW twr>}, seq)` returns the UNICOM entry (not KJFK Approach). Also assert the **fully-dark** case (`arr:[]` too) inserts **no** UNICOM and the planning-aid CTAF still fires (guard the v6.12.8 cases). Re-run the existing v6.17.2 tail-gap assertions unchanged.
  - `test_overlay_chain.js` — chain-state computation: rec on a Center → that chip `current`, later chips `upcoming`, `nextUp` chip `next`, earlier `passed`; rec = dark-dep CTAF (not in seq) → no `current`, `nextUp` = `next`. Relevance gate: airborne + departure-field callsign behind → filtered; arrival-field callsign → kept; on-ground → everything kept; a Center covering a forward sample → kept.
  - `node tests\run_all.js` **unpiped**, exit 0 (a piped run reported tail's status and let a failure through on 2026-08-01).
- **Live (Dean, VATSIM):** re-fly a dark-enroute departure (or any uncontrolled dep → staffed arrival with no Center) → overlay shows CTAF now, **Next up / STANDBY = 122.800 UNICOM**, then Approach once enroute. Panel no longer shows the 'why'/'Also at' lines. Hover the chain handle → the ordered predicted chain appears with the current step highlighted, without the panel growing. A departure controller signing on at cruise no longer pulses/chimes the dot; an ahead controller still does.
- **Standing rules:** `node tests\run_all.js` before the final commit; `node tools\sync-notes.js` (roadmap changed); then `git add -A && git commit -m "v6.18.0: …" && git push`. Dean runs `release.bat`.

## 🗣️ v6.17.0 — FLIGHT DEBRIEF replaces the static VERDICT (Dean 2026-08-02, plan-approved)

### Context
The per-flight report ends with a VERDICT block (report_html.js:162-224) that grades P99, states the
VRAM ceiling, quotes the worst frame, and classifies the spike pattern. It is accurate but
**context-free**: it never says whether the flight was good *for Dean*, what explains it, or whether
anything needs doing. The useful part of our chat analyses is exactly what it lacks — a rank against
his own history, an attribution (aircraft / AutoFPS behaviour / payware field), and an explicit
"nothing to do" when that's the truth.

Dean's locked answers (AskUserQuestion 2026-08-02): **auto-generated only** (no slot for
assistant-written notes — it must work on every flight forever, including ones never discussed);
**replace** the verdict rather than sit beside it; **short — 3-4 lines**, matching the
plain-language style he asked for.

Honest limit to keep in the copy: rules can rank, attribute and caveat; they cannot notice something
genuinely new. The debrief must never imply more certainty than a template has.

### ⚠️ STEP 1 FIRST — the numbers the verdict quotes are wrong (found 2026-08-02)
The report reads the `phases_ext.json` sidecar, and for any flight whose capture used a ground-truth
end anchor the sidecar **re-trims with the weaker teardown heuristic**, keeping shutdown frames the
capture had correctly cut. Measured: **37 of 51 flights disagree with themselves; all 20 with
`trim_method:'brake'` are affected.** Examples — 2026-08-01_2211 summary max 116.1 ms / 15 spikes vs
sidecar 193.36 / 28 (that's the 193.36 in Dean's screenshot); 2026-07-12_1829 100.12 → 186.19;
2026-06-24_0948 (his steadiest flight ever) 62.36 → 153.85. The Compare view reads the inflated side
too (main.js perf-compare-data prefers sidecar values).

Root cause: `readTrimmedFt()` (backfill_phases.js:35-42) applies only `trimHead` + `trimTeardownTail`
and has no idea the capture used the brake/movement anchor.

**Fix:** reproduce the capture's own trim when it recorded one. `summary.smoothness` carries both
`trim_method` and `stop_trim_s`, and `trimTail(ft, cpu, gpu, seconds)` already exists (phases.js:26).

```js
function readTrimmedFt(dir, summary) {           // summary is already in scope at both call sites
  ... existing read + trimHead ...
  const tm = summary && summary.smoothness && summary.smoothness.trim_method;
  const st = summary && summary.smoothness && summary.smoothness.stop_trim_s;
  if ((tm === 'brake' || tm === 'movement') && st > 0) {
    [ft] = trimTail(ft, [], [], st);             // byte-reproduces the array the capture kept
    return { ft, teardownS: st };
  }
  let tS; [ft, , , tS] = trimTeardownTail(ft, [], []);   // unchanged for older/anchorless flights
  return { ft, teardownS: tS };
}
```
This corrects `max_ft_ms` / `spike_count` / `perceptible_count` **and** the phase split **and** the
report chart for all 20 anchored flights in one change. Bump `VRAM_V` (or add a `TRIM_FIX_V` marker)
so every sidecar recomputes once. Callers: backfill_phases.js:59 (computeExt), :85, :101 (regenReport).

### STEP 2 — index entries need the metric the debrief ranks on
`INDEX_CSV_FIELDS` (index_writer.js:30-33) and the entry literal (engine.js:214-239) carry p99,
stutter, consistency, avg_fps, peak_vram_mb, frame_count — but **not** `frametime_stdev_ms`, which is
the metric that actually discriminates his flights (0.38 → 3.37, where P99 is nearly flat at
17.1-21.6 and ranks on it are noise). Add to both the entry and the CSV field list:
`frametime_stdev_ms`, `spike_count`, `perceptible_count`, `duration_seconds`. The backfill already
opens every `summary.json`, so it can fill them for existing flights in the same pass.

### STEP 3 — NEW `perf/native/debrief.js` (pure, desk-testable)
```js
buildDebrief({ stats, settings, vram, history, sessionId }) -> { word, color, lines: [ {text, tone} ] }
```
`history` = prior non-excluded index entries (chronological). Pure function, **no file I/O, no
imports from report_combined.js** — that module already imports from report_html.js, so the reverse
would create a cycle (keep any shared helper here or in stats.js).

The 3-4 lines, in order:

1. **Grade + where it sits.** Reuse `gradeP99` (report_html.js:18) verbatim for the word/colour, then
   append the rank: *"Smooth · P99 17.56 ms — your 6th steadiest of 47 flights."* Rank on
   `frametime_stdev_ms` among non-excluded history. **Guard: fewer than 5 prior flights → drop the
   rank clause entirely** ("not enough flights to compare yet"), never fake a ranking.
2. **What explains it.** Assembled from what's already in scope: aircraft; AutoFPS settled vs hunting
   (TLOD changes/min from the `autofps_trace.json` sidecar — report_html.js already loads it at :58);
   payware dep/arr (`settings.dep_scenery`/`arr_scenery`); online traffic. Name the worst phase only
   when it is meaningfully worse than that flight's own cruise.
3. **The one thing to watch — or explicitly nothing.** Reuse the existing VRAM thresholds
   (85 / 92 %) so the ceiling advice is unchanged, otherwise the periodic-stutter call, otherwise
   *"Nothing to act on."* A real "nothing to do" is a feature, not filler.
4. **Conditional 4th line, at most one:** a settings change vs the previous flight (compare `gfx_fp`
   with the prior entry; name the changed keys via `gfx_watch.watchValues`/`displayValue` — the same
   labels the Settings A/B card uses), OR a duration caveat when under ~45 min ("short flights read
   rougher — mostly taxi and descent"). Omit when neither applies.

Keep the periodic-stutter classifier (report_html.js:180-216) as-is — it is the most genuinely
diagnostic thing in the current verdict; it folds into line 3 rather than being rewritten.

### STEP 4 — wiring (2 call sites, both nearly free)
- `report_html.js:43` — add a 10th `history` param (defaults `[]`, so an un-updated caller degrades
  to the no-rank variant rather than throwing). Replace lines 162-224 with `buildDebrief(...)`.
- `engine.js:208` — hoist `const idx = readIndex(sessionsDir)` (engine.js:61-68, already in scope)
  above the `buildReport` call and pass `idx.sessions`; then reuse that same object for
  `updateIndex` (:240, currently re-reads) and the combined build (:242). **Net effect: one fewer
  index read than today.**
- `backfill_phases.js:116` — `idx.sessions` is already in scope in the `runBackfill` loop (:124-127);
  pass the slice preceding the current flight. Zero extra I/O.
- Bump `REPORT_V` (backfill_phases.js:29) so every report regenerates once.

### STEP 5 — markup
Keep the outer div shape exactly: `.mv-verdict > div:first-child` (report.css:12) strips the inline
`margin-top/padding-top/border-top`, so a different wrapper renders an unwanted divider. Reuse the
existing inline typography — 10px `.12em` uppercase section label (rename "Verdict" → "Debrief"),
25px/700 headline, 13px mono P99 chip, 12px/1.6 body, 11px sub-lines, `margin-top:9px` between blocks.

### Files
`perf/native/debrief.js` (new) · `report_html.js` (signature + verdict block) · `engine.js` (hoist
index read, pass history, 4 new entry fields) · `backfill_phases.js` (trim fix, pass history, backfill
new index fields, REPORT_V + VRAM_V bump) · `index_writer.js` (INDEX_CSV_FIELDS) · `tests/test_debrief.js`
(new) · version v6.17.0 (package.json + index.html ×3 + README changelog).

### Verification
- **Trim fix first, and prove it:** re-run the backfill, then assert for all 20 `brake` flights that
  sidecar `max_ft_ms`/`spike_count`/`perceptible_count` now EQUAL the summary's, and that raw
  frametimes/telemetry/summary files are hash-identical afterwards (the guardrail used in v6.15.5).
- `tests/test_debrief.js`: synthetic histories — rank correct at n=50; rank clause absent at n<5;
  "nothing to act on" fires on a clean flight; VRAM thresholds match the old verdict's wording at
  84/86/93 %; settings-change line names the right key; short-flight caveat fires under 45 min and not
  over; a flight with no history/no trace degrades without throwing.
- Real-data smoke: build the debrief for 2026-08-01_2211 (expect "Smooth", rank 6 of 47, Fenix,
  AutoFPS settled, VRAM 95.4 % watch-line) and for 2026-07-27_2053 (the Alps flight — expect the
  rough grade and the periodic/overload call).
- `node tests\run_all.js` **unpiped** and check its exit code — a piped run reports `tail`'s status
  and let a failing suite through on 2026-08-01.
- Commit + push per standing rules; Dean runs `release.bat`.

## 🌄 v6.15.0 — SCENIC APPROACHES MODE (Challenging ⟷ Scenic toggle, wind-gated, real routes) (Dean 2026-07-22, plan-approved)

### Context
Dean rarely uses the Challenging Approaches tab and wants to make it worth opening: add a second mode,
**Scenic**, alongside Challenging — community-known gorgeous, runway-specific approaches (often RNAV).
He supplied a 20-airport starter list (`~/Downloads/top-20-scenic-approaches.md`); expand to ~35–40,
each with the specific scenic runway + a VERIFIED magnetic heading. The section keeps its airport-first
browse UI but Scenic mode adds: (a) real-world flights INTO the scenic airport, short/med-haul only,
free-route fallback; (b) a hard WIND GATE — a scenic approach is only shown when current wind favors
its required runway (no meaningful tailwind, ≤5 kt), so you're never sent to fly RNAV 10L in a tailwind.
Dean's locked answers (AskUserQuestion 2026-07-22): **hide** unfavorable-wind airports; **library
short/med first, free-route fallback**; **~35–40 verified**; **favor = tailwind ≤5 kt**.

### Key facts (verified by exploration 2026-07-22, all index.html)
- Curated data: `const CH=[…]` (:1217-1238), 20 entries `{icao,name,city,lat,lon,rwy,approach,diff,cat,
  desc,bestwind,worstwind,inMSFS,note,pay,free,yt,sv}`. Precedent: hardcoded curated aviation reference
  is allowed (SKILL classifies Challenging Approaches + RWY_HDGS as shared reference, NOT a rule-#3
  personal-setup leak).
- Renderers: `buildChSB()` (:7629 left list, applies max-time filter), `renderCD(idx)` (:7708 detail
  card), `chRoutesHTML(ch)` (:7665 — routes arriving at ch.icao from library deps, fleet-flyable, sorted
  by distance_nm, cap 10), `fetchChMetar(ch)` (:7800 live METAR + wind advisory vs ch.rwy), dep select
  `buildChDepSelect()` (:7600). Tab wired at sw() (:1470 `if(t==='challenges')buildChDepSelect()`);
  pane `#pane-challenges` (:647); filter row (:650-661) holds the Max-Time chips.
- Wind primitives (REUSE VERBATIM): `parseWind(m)` (:6273 → `{dir,spd,gust}`), `tailwindComp(icao,rwy,
  dir,spd)` (:6311 → +tailwind/−headwind kt, or null on VRB/no-heading), `bestRwy` (:6290), consts
  `TAILWIND_MAX_KT=5` (:6007). The D-ATIS cross-check (:6543-6552) already implements exactly the gate:
  `tw = tailwindComp(...); favorable = tw!=null && tw<=TAILWIND_MAX_KT`.
- Heading data gap: `RWY_HDGS` (:1159) is US/Europe-weighted and MISSING most scenic ICAOs (NZQN, LPMA,
  LGKR, TNCM…). `fetchRwyData` (:6318, aviationweather.gov) is US-centric and unreliable abroad. →
  Store the heading `h` ON each scenic entry; gate math uses `entry.h` directly, no DB dependency.
- Live wind: `S.metarCache` (:1252, keyed by ICAO, `.rawOb`/`.wspd`/`.obsTime`), batch-filled by
  `fetchMetarBatch` (:6240). VATSIM ATIS: `vatsimAtisData(icao)` (:7309, text only — active rwy via
  `extractRunways`). Free-route synthetic card pattern: `renderFreeRouteResults()` (:3260-3331, builds a
  card from just dep+arr: names, METAR, active runway via `fetchDatis(...,'fr')`, SimBrief/SkyVector).
- Long-haul filter fields: `r.distance_nm` (nm) and `r.flight_length` (ENROUTE minutes; `blockLen()`
  :2836 adds `BLOCK_PAD_MIN=25`). Max-Time chips already give a duration cap to reuse.

### Design decisions (mine, from Dean's answers + the ramifications he asked me to think through)
1. **Build it in the Challenging Approaches section as a Challenging⟷Scenic mode toggle** — his explicit
   request, and every renderer (`buildChSB`/`renderCD`/`chRoutesHTML`/`fetchChMetar`) is reusable as-is.
2. **Scenic data = a separate `CH_SCENIC` array** (not overloading `CH`), same shape + two new fields:
   `h` (verified magnetic heading of the scenic rwy — the wind-gate input) and `scenery` (one-line why
   it's gorgeous). ~35–40 entries expanded from Dean's list; all 737/A320-class fields. Corfu-style
   runway-number slips in his source (his "Corfu 35" is really LGKR 34) get corrected during build.
3. **Wind gate** `scenicFavorable(entry)`: read `S.metarCache[icao]` → `parseWind` → tailwind against
   `entry.h` (copy `tailwindComp` math, but off the stored heading). Favorable iff **calm/variable/light
   (VRB or spd<3) OR tailwind ≤ TAILWIND_MAX_KT**. If a VATSIM ATIS for the field is loaded and names an
   active runway, that OVERRIDES (favorable iff it matches the scenic rwy) — real-world controller choice
   wins; else METAR is the baseline. **Missing METAR ⇒ not-yet-judged, shown greyed "checking wind…",
   not hidden** (a fetch-in-flight airport shouldn't vanish).
4. **Hide unfavorable (Dean's pick)** in `buildChSB` when `S.chMode==='scenic'`. SAFETY: if the gate
   hides everything, show a one-line note "No scenic approaches have favorable winds right now" — never a
   blank pane. (This + the calm=favorable rule keeps the list from going empty on still days — the subtle
   interaction in the raw spec: "hide unfavorable" + "tailwind≤5 only" would have hidden calm-wind
   airports even though calm favors any runway. Fixed by treating calm/VRB as favorable.)
5. **Routes into the scenic airport, short/med-haul, free-route fallback:** `scenicRoutesHTML(entry)` =
   `chRoutesHTML` filtered by arrival===icao (drop the library-dep requirement so scenic airports you have
   any route to still populate) AND `blockLen(flight_length) ≤ cap` (default 240 min, reuse the Max-Time
   chips), sorted shortest first, cap ~8. If none qualify → render the free-route synthetic-card path
   (reuse `renderFreeRouteResults`' builder) with the CH dep-select as origin, so Dean can fly it anyway.
6. **Wind-gating the LIST needs wind for ALL scenic airports up front** → on entering Scenic mode,
   one batched `fetchMetarBatch` over the ~40 scenic ICAOs (comma-joined, ≤400 cap, 30-min cache), then
   `buildChSB`. Re-gate on METAR refresh.
7. **Mode toggle:** `S.chMode` (persist `S.cfg.chMode`, default 'challenging'); a 2-chip `data-chmode`
   pair in the filter row (mirror `setCT`); `setChMode(v)` toggles `.on`, saves, re-batches wind if
   scenic, `buildChSB`. Restore at boot (~:1303 pattern). `buildChSB`/detail pick the source array by mode.

### Ramifications considered (Dean's "really think through it" + his Plan-a-Flight ramble)
- **Plan-a-Flight "Scenic routes" chip (his ramble — analyzed, DEFERRED not built):** technically doable
  (a chip filtering the route list to arrivals whose ICAO is a favorable-wind scenic field, reusing
  `CH_SCENIC` + `scenicFavorable`), and it'd live where Dean actually works. BUT the scenic VALUE is
  airport+runway+approach-centric (the description, the specific gorgeous runway, the wind gate, the
  free-route-if-missing), which doesn't fit a dense route ROW; and Plan a Flight only shows library
  routes, so the free-route fallback he wants wouldn't apply. Verdict: build the two-mode section now
  (self-contained, right home for curated approach content); log the Plan-a-Flight chip as a clean
  phase-2 that reuses this exact data + gate. Not building it avoids bloating an already-busy tab.
- **Heading accuracy is the linchpin** of the whole gate. Each `h` is verified at build (cross-checked,
  not guessed); `rwy_number × 10` is an acceptable ±5-kt-gate fallback (a 5–10° error barely moves the
  cos-based tailwind near the favorable direction), but I'll store real headings.
- **Sparsity:** favorable-wind ∩ short-haul-route ∩ curated could be thin on some days — mitigated by the
  empty-state note + calm=favorable + the free-route fallback (so an airport is never dropped merely for
  lacking a library route).
- **Overlap** with Challenging (LOWI/TNCM/LGSR) is fine — different modes, scenic entry emphasizes views.

### Files / version
index.html only: `CH_SCENIC` array; `S.chMode` + `setChMode` + chip pair in the filter row; mode-aware
`buildChSB`/detail; `scenicFavorable` + batched wind fetch; `scenicRoutesHTML` (duration-capped) +
free-route fallback; boot restore. Version v6.15.0 (package.json + index.html title/sb-ver/footer +
README changelog). No main.js change.

### Verification
- Tests (tests/test_scenic.js, using extract.js `grab()`): (a) `scenicFavorable` math — a wind straight
  down the scenic rwy = favorable; a 180°-opposite ≥6 kt = unfavorable; calm/VRB/<3 kt = favorable;
  missing METAR = null (not-judged); VATSIM-active-rwy match overrides an unfavorable METAR. (b) every
  `CH_SCENIC` entry has a numeric `h` and a `rwy` whose number×10 is within ~20° of `h` (catches a
  fat-fingered heading). (c) duration filter drops a long-haul route, keeps a short one. Plus
  `node tests\run_all.js` full board.
- Live (Dean): Challenging tab → Scenic chip → list shows only favorable-wind scenic approaches with real
  short-haul routes (or a free-route card); flip a card's airport whose wind opposes the scenic rwy →
  it's hidden; toggle back to Challenging → original 20 unchanged.

## ▶️ v6.14.1 — PER-APP AUTO-START TOGGLE FOR COMPANION APPS (Dean 2026-07-22, plan-approved)

### Context
Companion Apps (Quick Launch) opens every app in the list when Dean launches MSFS. For a flight he
wants to fly WITHOUT VATSIM, he currently has no way to stop vPilot from auto-starting short of
deleting it and re-adding it later. He asked for a per-app enable/disable checkbox that PRECEDES the
app row ("unless there's a better way?"). Verdict: his checkbox is the right approach — it mirrors
the existing "close on sim exit" checkbox, keeps the skip state always visible, and is one click to
toggle. Rejected the "auto-tie vPilot to Live-ATC being on" alternative: too implicit (he may want
vPilot without Live ATC or vice-versa); an explicit toggle is safer.

### Key facts (verified by exploration 2026-07-22, all in index.html unless noted)
- Data model: `S.cfg.quickLaunchApps` = array of `{name, path, closeOnSimExit?}` (closeOnSimExit is
  added lazily on first toggle — the same falsy-by-default idiom to reuse).
- Renderer `renderQlAppList()` (:5415); each row built :5420-5427. The "close on sim exit" checkbox
  (:5423) + its handler `toggleCompanionClose(idx)` (:5429) = the verbatim pattern to copy.
- Add: `addQuickLaunchApp()` (:5659) pushes `{name, path}`. Remove: `removeQuickLaunchApp(idx)` (:5671).
- Launch iteration (two skip points):
  1. `quickLaunchAll()` loop (:3981-3985) — `for(const a of apps){ if(!a.path)continue; …launchApp }`.
  2. `launchAndCapture()` pre-filter `comps=(S.cfg.quickLaunchApps||[]).filter(a=>a&&a.path)` (:5045),
     which ALSO feeds the confirm-dialog count (:5049) and the toast (:5086) — one place to filter.
- Config save idiom everywhere: mutate `S.cfg.<field>` → `await window.api.saveConfig(S.cfg)` → re-render.
- `closeOnSimExit` kill path (`main.js` flightReopenApps :1490) is INDEPENDENT of launch — killing a
  never-launched app is a harmless no-op, so no main.js change is required.

### Build (index.html only)
1. **Default-on semantics (zero migration):** treat `a.autoStart!==false` as "enabled/launch". Old
   2-field entries and newly-added ones default ON; only write `autoStart:false` when unchecked.
2. **Leading enable checkbox** in `renderQlAppList()` row (:5420) — a checkbox BEFORE the name (Dean's
   "precedes the app"), `checked` when `a.autoStart!==false`, `onchange="toggleCompanionAutoStart(${i})"`,
   `title="Launch this app with MSFS (uncheck to skip it for a flight)"`. When disabled, dim the row
   (e.g. `opacity:.5` on the name/path) so the skipped state reads at a glance.
3. **`toggleCompanionAutoStart(idx)`** — copy `toggleCompanionClose` verbatim, flip `apps[idx].autoStart`
   using `apps[idx].autoStart = apps[idx].autoStart===false` (so first click on a legacy entry sets
   false), save, re-render.
4. **Skip filter at both launch points:** add `if(a.autoStart===false)continue;` to the `quickLaunchAll`
   loop (:3981) and change the `launchAndCapture` filter to
   `.filter(a=>a&&a.path&&a.autoStart!==false)` (:5045) — the latter automatically corrects the
   confirm-count + toast to only list apps that will actually open.
5. **Version:** v6.14.1 (package.json + index.html title/sb-ver/footer + README changelog).

### Verification
- Live (Dean): uncheck vPilot → its row dims. Quick Launch (and Launch + Capture) → MSFS + the other
  apps open, vPilot does NOT; the Launch+Capture confirm/toast lists only the apps that will open.
  Re-check vPilot → it launches again. Confirm "close on sim exit" still works independently.
- Regression: `node tests\run_all.js` (no logic these suites cover, but run per standing rule #7).
  The skip predicate is a one-liner; a tiny inline assertion (`autoStart!==false` skips only explicit
  false) can be added to a test if wanted, but the launch loops live inside renderer fns not sliced by
  the harness — live-click is the real proof.

## 🎚️ v6.14.0 — CONFIGURABLE ROUTE CAP + SNAPSHOT BACKFILL + ROTATION (Dean 2026-07-21, plan-approved)

### Context
The in-app route registry is hard-capped at 5,000 (two inline `5000` literals in `pruneRegistry()`,
index.html:2452/2454). Dean wants a GUI numeric input in the Route Data Source section to set the cap
himself: increase → registry grows; decrease → trims newest-kept/oldest-out as today. He also asked
whether anything encourages VARIABILITY in which routes are kept. Exploration answer: **no** — every
refresh fetches all ~140+ pages in fixed order, stamps everything seen with last_seen, and cap-prunes
oldest-first with a STABLE tie-break, so effectively the SAME ~5,000 survive refresh after refresh
while the rest of SI's dataset never rotates in. Dean's locked decisions (AskUserQuestion 2026-07-21):
**instant backfill from the 20k snapshot on increase** (not wait-for-refresh) + **rotation at the cap**
(shuffle among equally-fresh routes each prune so the kept mix varies; SimBriefed pairs stay protected).

### Key facts (verified by exploration 2026-07-21)
- pruneRegistry (index.html:2438-2464): 21-day age prune → cap prune sorted ascending by last_seen,
  protected = recentSimBriefRoutes pairs (order-insensitive sorted-join key). Called from the SI
  refresh (:2713) + two community-import handlers (:7841/:7907). 2 MB serialized-size warn at :2462.
- mergeIntoSnapshot (:2466-2480): snapshot = accumulate-only 20k superset, never pruned — the backfill
  source. Snapshot is intentionally frozen at 20k (Dean 2026-07-06 decision, unchanged here).
- Refresh fetches ALL pages regardless of cap and prunes ONCE at the end (:2713) — so a raised cap
  backfills naturally on refresh too; no fetch-loop changes needed.
- Config pattern: `S.cfg.<field>` + `await window.api.saveConfig(S.cfg)` (cookie save :2087-2090 is
  the closest template). main.js save-config merges arbitrary fields — NO main-process changes.
- Registry/snapshot live in routeRegistry.json / routeSnapshot.json (main.js:570-571, atomic writes);
  no cap enforced at load time — an over-cap file trims at next pruneRegistry.
- "New routes" churn reporting at :2717-2727 references the 5,000 cap in user-facing text.

### Build steps (all index.html + version files)
1. **Config + GUI**: `S.cfg.maxRoutes` (default 5000; clamp 500–20,000 — 20k = the snapshot ceiling,
   so the cap can never exceed what backfill could supply). Numeric input row "Max routes to keep"
   in the Route Data Source panel (after #auto-refresh-wrap, ~:703) + Apply button + a result line.
   Handler `onMaxRoutesApply()`: read → clamp → write cfg → saveConfig → then branch:
   - **new cap < current registry count** → call pruneRegistry() immediately + siSaveRegistry +
     renderRoutes; report "trimmed X routes (still in your snapshot)".
   - **new cap > count** → `backfillFromSnapshot()` (step 3) + save + render; report "+X routes
     restored from snapshot" (honest partial message if the snapshot can't fill the gap).
2. **pruneRegistry cap + ROTATION** (:2438-2464): `const cap=Math.max(500,Math.min(20000,
   +S.cfg.maxRoutes||5000))` replaces both literals. Rotation: cap-prune sort key becomes
   **day-granular last_seen (`last_seen.slice(0,10)`) + random tie-break** — routes from the same
   refresh (all same day) shuffle, so a different subset survives each prune; genuinely older routes
   still evict first. Protected-pair shielding unchanged. Make the shuffle injectable
   (`pruneRegistry(rand=Math.random)`) so tests can seed it deterministically.
3. **`backfillFromSnapshot()`** (new, beside mergeIntoSnapshot): candidates = snapshot IDs not in
   the registry that still pass the CURRENT library filter (dep or arr in the user's library — reuse
   the same membership test processPage uses at :2412-2416; skip re-checking aircraft type, already
   filtered at ingest). Order candidates by the same day-bucket+shuffle key (prefer recent, rotate
   within buckets), add `{...r}` copies until the registry reaches cap. Returns count added.
4. **Dynamic user-facing text**: the ":2727 churn line" ("registry at its 5,000 cap") + any other
   5,000 strings in the refresh reporting → use the live cap value. Scale the size warn (:2462):
   threshold = max(2 MB, cap × 1 KB) so a deliberately large cap doesn't nag.
5. **Version/docs**: v6.14.0 (package.json + index.html title/sb-ver/footer + README changelog).
   Roadmap/memory sync via `node tools\sync-notes.js`.

### Tests (tests/ — repo, per the scratchpad-loss rule)
New `tests/test_route_cap.js` using tests/lib/extract.js `grab()` to pull the REAL pruneRegistry /
mergeIntoSnapshot / backfillFromSnapshot out of index.html with a small S/cfg stub:
(a) cap honors S.cfg.maxRoutes (prune to 3000, to 8000-no-op, absent→5000 default, clamp 500/20000);
(b) decrease trims oldest day-bucket first + protected pairs shielded (the KFLL→MMUN regression);
(c) rotation — with a seeded rand, two prunes over 100 same-day routes at cap 50 keep DIFFERENT sets;
with rand fixed, deterministic (injectability proof); older-day routes always evict before newer;
(d) backfill — adds only missing IDs, stops exactly at cap, honors the library filter, copies not
references, honest count when snapshot < gap; (e) full-board regression: `node tests\run_all.js`.

### Verification (live, Dean)
Settings → Route Data Source → set 8,000 → "+~3,000 restored from snapshot" and Plan a Flight
instantly shows more routes; set 3,000 → trim message + count drops; next auto-refresh reports churn
against the new cap and holds it. Watch item (not a blocker): renderRoutes/getRoutes re-filter the
full registry per render — fine at 5k, keep an eye on UI snappiness at 15–20k.


## 🗺️ MASTER REMAINING LIST (consolidated 2026-07-02 — Dean asked "are you tracking all of it")
> The single source of truth for what's left. Every item below has its full blueprint elsewhere in
> this file (section named in parens). Update this list as items complete.

**A. v6 CUTOVER — ✅✅ SHIPPED + LIVE-VERIFIED 2026-07-05. Released via release.bat (GitHub
v6.0.0 + installer 75.5 MB); Dean's installed app updated (footer v6.0.0, log clean, resources
Python-free); Arm Capture from the INSTALLED app spawned the native engine (status file pid +
native_capture.log + main-log spawn line all confirmed), then cleanly killed. phase8 branch DELETED
(fully merged at 8fd613a) — back to one line. PHASE 8 COMPLETE. Final soak = next real flight
(same code path the baseline flight already proved). Rollback: tag v5.9.43-stable + GH v5.9.44.
✅ CLOSEOUT DONE 2026-07-05: standalone Claude_TLOD_OLOD archived (README notice, launchers
renamed ARCHIVED_*, all data preserved) + its "MSFS TLOD Optimizer" session archived; repo
scaffolding removed (commit edb4748 — 27 harness/launcher files deleted, perf-engine.exe untracked
[stays on disk as dev fallback], perf/README rewritten for v6); Sessions_NATIVE_TEST (100MB) +
scratch flight backup (91MB) deleted after verifying the real Sessions copy. Phase 8 fully closed.**
  1. Flip `nativePerfEngine` default ON in main.js (native becomes the engine; remove/park the flag)
  2. Drop Python: remove perf-engine.exe from extraResources + the exe/py spawn branches in main.js
     (KEEP perf/vendor chart libs — reports need them). Wire CapFrameX export to native capframex.js.
  3. Version bump v6.0.0 (package.json + index.html title/footer + README changelog), merge
     phase8→main, Dean runs release.bat, verify update lands + one native capture from the INSTALLED
     app, then delete phase8 branch. Rollback stays: tag v5.9.43-stable + GitHub release v5.9.44.
  4. Benchmark note: 21 flights merged; grid ~19/24 — auto-TLOD keeps guiding the last cells.

**B. BUGS / SMALL FIXES — ✅ ALL DONE 2026-07-05 (commits 005e00d..b29540d on main, ships as
v6.0.1 after Dean's soak flight): B1b clickable Recent Routes + Free Route SNAPSHOT FALLBACK
(archived-route pill); B2 METAR obs-age pills + stale-park in wx sorts + badge tooltip — PLUS a
found fltcat->fltCat casing bug that had zeroed the VFR/IFR base score and pinned the category pill
to VFR; B3 CapFrameX button (live-tested: 21/21 flights converted — first time ever populated);
B4 minors (KLVB empty-body guard, seedPerfLibs staleness, incremental registry save /20 pages).
R2 weather COMPLETE: synthetic ATIS-from-METAR for airports without D-ATIS + datis.clowd.io US
fallback (verified live vs KBOS). Original list:**
  1. Active-flight route protection (Dean's KFLL→MMUN, ROOT CAUSE CORRECTED 2026-07-02 after his
     pushback): the route WAS a real registry card — the 8h auto-refresh fired 10 min after his
     SimBrief click and pruneRegistry() DELETED it (last_seen 29d > 21d cutoff; registry at the 5000
     cap). Fix: (a) ✅ DONE 2026-07-02 (commit ea1c9c1, ships with v6) — pruneRegistry exempts
     recentSimBriefRoutes pairs from BOTH prunes, desk-tested; (b) still queued: clickable Recent
     Routes → reopen route panel, falling back to SNAPSHOT data when the registry no longer has
     the pair (snapshot proved the route existed) (Backlog)
  2. METAR observation-age: show obs age per airport, flag >3h stale, penalize in scoring — Dean's
     confirmed staleness hunch (R2)
  3. CapFrameX export button in Performance tab (native module done + parity-proven; UI awaiting OK)
  4. Low-priority app-review leftovers: incremental registry save during long SI refresh;
     seedPerfLibs never refreshes stale vendor libs (FULL-APP DEEP REVIEW block)

**C. RESEARCH PLANS R1–R5 (blueprints in the RESEARCH & FUTURE PLANS section):**
  ✅ 2026-07-05 SECOND BATCH (commits a6677c3+): R3 STORAGE DONE (Maintenance: Export/Import My
  Setup zip w/ validate-first + pre-import backup, PS5.1-verified; Archive Older Raw Captures —
  gzip-in-place, decompress-verify before swap, keep newest 5, capframex reads .gz transparently,
  7/7 desk-test) + R5 CORE DONE (app icon — route+plane on dark tile, embedded, default-icon warning
  gone; installer.nsh clean-uninstall prompt w/ isUpdated guard, build-verified).
  **R5 remaining:** first-run wizard; README Install/First-run/Uninstall/Backup section.
  R1 SI insurance: quarterly snapshot backups as GitHub release assets + BookmarkDrop (feature #1)
  R2 Weather: METAR obs-age (see B2) + datis.clowd.io US fallback + synthetic ATIS from METAR
  R3 Storage: gzip raw frametimes in place (79% saving measured), transparent .gz readers — POST-v6
  R4 Version-compare insights + verdict card + drift monitor — AFTER the 24-flight benchmark.
     **R4+ (Dean, 2026-07-06, from the TLOD-correlation analysis):** the Baseline "Balanced" pick
     should ALSO weigh (a) GROUND-PHASE stutter/p99 — the proven TLOD discriminator (r=0.67 vs 0.35
     overall; measured 2026-07-06: +25 TLOD ≈ +0.06pp ground stutter, +1.15ms ground p99, ~10.6 MB
     VRAM per TLOD point) and (b) a PERCEPTION-WEIGHTED metric: big-stutter events >100ms per hour
     (the small 33-50ms counts are imperceptible to Dean; the 100ms+ ones are what he feels).
     **NEW idea — experiment tagging:** a per-flight "what changed" tag (NVCP toggle, traffic
     setting, etc. — extends the existing notes field + a Compare group-by) so the logger doubles as
     a general A/B rig beyond TLOD. CPU-wait suspects ranked for future tests: sim version (drift
     monitor's job) > in-sim CPU settings (AI/ground traffic, photogrammetry, glass refresh) >
     driver > NVCP latency toggles.
     **PHASE 9 — "SETTINGS LAB" — FULL IMPLEMENTATION PLAN (approved design, build NOW; feature
     stays dormant behind a gate until the 24-flight benchmark completes).**

### Context
Dean's benchmark machinery (auto-TLOD → capture → baseline math) proved settings questions can be
answered with data (TLOD↔ground-stutter r=0.67). Phase 9 generalizes it: after the 24-flight
benchmark, a "Settings Lab" auto-runs ONE curated settings experiment per Launch+Capture flight,
tags those flights, quarantines them from baseline math, restores settings afterward, and renders
plain-English verdicts. Dean's locked decisions: **checkbox gated (greyed) until coverage.ready;
unchecked = full manual control (nothing runs); alternation = experiment flight, then a plain
baseline-config flight (the plain one doubles as fresh control AND keeps enriching the rolling
baseline — controls need no tagging); 2 experiment flights per setting before a verdict.**

### Key exploration facts (verified 2026-07-06)
- UserCfg.opt {Graphics} holds ~50 editable keys in nested blocks ({VolumetricClouds} Quality 0-3,
  {Traffic} AirportsServicesQuantity/AircraftTrafficQuantity (-1 auto/0-100), RoadQuality/SeaQuality,
  {GlassCockpitsRefreshRate} Quality, {ObjectsLoD} LoDFactor, {Buildings} Quality, …). Values are
  unquoted ints/floats. **Photogrammetry is NOT in UserCfg.opt** → cannot be auto-toggled; handled
  as a MANUAL experiment (Dean toggles in-sim, marks the flight via a Lab dropdown; same tagging).
- settings.js writeSettingsText is TLOD/OLOD-hardcoded (replaceInBlock targets 'LoDFactor',
  ÷100 float format). Generalizing = a keyed editor + per-key format map (~150-200 lines, low risk;
  the TLOD/OLOD path stays byte-identical/untouched).
- Tagging path: capture.js settings object → engine.js writes FULL settings into summary.json (free
  ride) → index entry (engine.js ~140) + INDEX_CSV_FIELDS (index_writer.js:30) + perf-compare-data
  (main.js ~1075) must each ADD the `experiment` field explicitly.
- Exclusions: _blCompute (index.html ~3741/3744) — add `!x.experiment` to BOTH grid and clean
  filters (lab flights must never sway a future re-baseline). Compare dimOpts (~3691) gains
  {v:'experiment'}. Gate: `coverage.ready` already computed (~3767).
- Lab hook: launchAndCapture (index.html ~3893) — prep-next runs first; post-benchmark it returns
  reason:'coverage-complete', which is exactly when the Lab (if enabled) takes over the pre-launch
  write slot. Archiver (archive.js) is flight-agnostic — ZERO zip-system changes needed; lab raw
  captures obey the same newest-5-raw + gzip rules; the tag lives in tiny summary.json (kept
  forever). Setup Export: add lab_state.json to SETUP_FILES.

### Build steps
1. **perf/native/lab.js (new, shipped runtime module):**
   - `EXPERIMENTS` registry: ordered entries {id, label, section, key, format('int'|'lod'),
     testValue, hypothesis, judge:['ground_stutter','spikes','p99','vram']}. v1 queue (from Dean's
     ACTUAL current values): clouds-quality-up ({VolumetricClouds} Quality 1→2; free-visuals test —
     expect smoothness unchanged, watch VRAM/gpu_bound), airport-services-min ({Traffic}
     AirportsServicesQuantity -1→0; taxi-stutter hypothesis), glass-refresh-down
     ({GlassCockpitsRefreshRate} Quality 2→1; PMDG ground mainthread), olod-down ({ObjectsLoD}
     120→100; PG-city mainthread). Manual entry: 'photogrammetry-off' (flag `manual:true`).
   - `writeKeyInBlock(text, section, key, value, format)` — generalized surgical editor modeled on
     writeSettingsText (scope {Graphics}, block regex, count must be 1, reassemble); plus
     `readKeyInBlock`. Reuses prep.js backupUsercfg + readback-verify pattern.
   - State machine in USER_DATA/lab_state.json: {enabled, baselineSnapshot:{key:value at
     activation}, queueIndex, phase:'experiment'|'control', done:{id:count}, log:[]}.
     `labNext(state, usercfgPath, backupDir)`: if phase=experiment → apply queue[i].testValue
     (backup+write+verify), write USER_DATA/_lab_pending.json {id,section,key,value}; if
     phase=control → RESTORE all touched keys to baselineSnapshot (and delete _lab_pending). Flip
     phase; advance queueIndex when done[id]>=2. Drift guard: before applying, readback each
     baseline key — if the on-disk value ≠ snapshot (Dean changed it in-sim), re-snapshot + note.
     Citation-on-SimBrief → skip to control. Un-check/disable → restore everything + clear pending.
2. **capture.js/run_capture.js:** at capture start, read+consume _lab_pending.json (env
   ABRP_LAB_MARKER path) → `settings.experiment = id` (string; full {key,value} into
   settings.experiment_detail). Marker deleted after read (a lab-armed-but-never-flown capture must
   not tag a later flight — mirrors _prep_aircraft handling).
3. **engine.js/index_writer.js/main.js:** add `experiment` to the index entry, INDEX_CSV_FIELDS,
   and the perf-compare-data payload (null/absent for normal flights — older summaries unaffected).
4. **main.js IPC:** `perf-lab-state` (read state+queue for UI) and `perf-lab-next` (invoke labNext;
   returns what it set — surfaced in the launch alert exactly like auto-TLOD's "Set TLOD X").
   Wire into launchAndCapture: after prep-next returns coverage-complete AND S.cfg.labMode → call
   perf-lab-next before launching MSFS (sim must not be running — same constraint as auto-TLOD).
5. **index.html UI (Performance tab, under the toolbar):** "🧪 Settings Lab" panel — checkbox
   (disabled+tooltip until cov.ready; persists S.cfg.labMode), queue list w/ per-experiment progress
   (0/2), "next flight will be: EXPERIMENT clouds-quality-up (Quality 1→2)" or "CONTROL (baseline
   config)", manual-experiment dropdown (photogrammetry-off → writes _lab_pending for next flight),
   and VERDICT cards once an experiment hits 2 flights: per-aircraft-where-possible comparison of
   experiment flights vs the 4 time-nearest untagged baseline flights (same aircraft, any grid TLOD;
   metrics: ground-phase stutter/p99 from summary phases, spike_count, overall p99, peak VRAM) with
   plain wording + "preliminary (n=2)" honesty tag. Exclusions per above; Compare gains the
   experiment dimension.
6. **Version/docs:** bump v6.1.0 (package.json + index.html ×3 + README changelog), memory update.

### What could bite (addressed in design)
Sim reads UserCfg at launch only → Lab runs strictly in the pre-launch slot (Launch+Capture), never
mid-session; in-sim settings changes overwrite UserCfg on exit → drift guard re-snapshots; a lab
value must never leak → control-phase always restores + un-check restores + UserCfg_ORIGINAL backup
chain already exists; armed-but-never-flown → marker consumed at capture start, restore happens on
next labNext regardless; verdict confounds → same-aircraft matching + time-nearest controls +
preliminary tags; AutoFPS future flights → already excluded by their own tag.

### Verification
- Desk-tests (scratchpad): (1) writeKeyInBlock against a COPY of Dean's real UserCfg text — every
  v1 registry key round-trips (write→read→restore byte-identical elsewhere); (2) state-machine sim:
  8 labNext calls walk experiment/control alternation, per-id counts, queue advance, drift
  re-snapshot, disable-restore; (3) exclusion math: synthetic flights w/ experiment tags never
  enter _blCompute grid/clean but appear in Compare's experiment grouping.
- Live (no flying needed): enable Lab with a fake-complete coverage (temp test), run one
  Launch+Capture arm to the gate → verify UserCfg got the experiment value + pending marker, cancel,
  verify restore. Full validation = Dean's first two real lab flights after 24/24.
- `node --check` all touched files; renderer Function-parse; commit + push per standing rules.
✅ PHASE 9 CORE SHIPPED 2026-07-06 as v6.1.0 + Dean's queue revisions (precache-down replaced
airport-services; bidirectional up-variants added). 24/24 desk-tests passed.

## 🧪 PHASE 9b — LAB RESULTS EXPERIENCE (design locked; build as v6.2.0)
> ✅ SHIPPED 2026-07-06 as v6.2.0. Verification: 23/23 synthetic desk-tests (engineered SAVES/
> NO-EFFECT/COSTS/FREE verdicts, gz-identical series cache, apply/un-apply byte-identical, manual
> refusal) + 11/11 real-data smokes (renderer parse, real-Sessions report all-collecting with 0
> files changed, real KORD-KATL series 12 KB in 783 ms w/ ground phase isolated). Live validation =
> Dean's first lab flights after the 24/24 unlock.

### Context
Dean: "the most important is USING the data — easy to understand what impact or no impact things
have; visually pleasing; integrate with Compare; frametime graphs with auto-scaling like we have;
the app should help automate changes; keep the Performance section tidy." This turns the Lab's raw
tags into a designed findings experience. Design decisions locked (Dean delegated: "take charge").

### The four foundational design decisions
1. **Tidy = strip + view.** The always-visible lab panel shrinks to a ONE-LINE status strip
   (checkbox · next-flight · progress dots · "open Lab →"). Full depth moves to a dedicated
   **🧪 Lab** view — 4th toolbar button beside Dashboard/Compare/Baseline (same perfShow* toggle
   pattern, new #perf-lab div). The Performance tab stays clean.
2. **Verdicts are declared against NOISE, not raw deltas** — the honesty core. Every metric delta
   is judged vs ±1σ of that metric across the control set (stats.js `pstdev`, byte-proven).
   "No appreciable difference" becomes a VISIBLE result: the delta bar sits inside a shaded
   "normal variation" band. Verdict enum: FREE (green — nothing worsened >1σ; up-experiments),
   SAVES (blue — smoothness improved >1σ), COSTS (amber — worsened >1σ or VRAM crosses the 90%
   cap), NO EFFECT (grey — all within noise), COLLECTING n/2, AWAITING CONTROL.
3. **"Apply this setting" closes the loop** (the automate-changes ask). FREE/SAVES cards get a
   one-click Apply → lab.js `applyFinding(id, undo)`: writes the value (backup + readback-verify,
   same machinery as labNext), updates the baseline snapshot, records `adoptions:[{id,value,ts}]`
   in lab_state; card gains a "✓ adopted <date>" ribbon + an Un-apply link. Guard: refuses while
   the sim is running (UserCfg is read at sim launch only).
4. **Charts come from the proven report engine, server-side.** No new chart tech: reuse
   report_charts.js `chartFrametimeSeries` (bucketing) + `rollingMeanSeries` (smoothing) + the
   svgPerfLine grid/scale approach in a new multi-series overlay builder. SVGs built in a child
   process, cached, injected by the renderer as strings.

### The Finding Card (one per experiment, stacked in the Lab view)
(a) Verdict banner — color chip + icon + ONE plain sentence ("Raising clouds to 2 cost nothing
measurable — keep it"). (b) Context line — Setting X→Y · hypothesis · flight chips (click →
perfOpenPath the report). (c) **Delta strip** — the at-a-glance impact answer: per judged metric
(ground stutter, ground P99, overall P99, peak VRAM, spikes) a horizontal diverging bar from 0
drawn OVER the shaded ±1σ noise band, direction-aware color (improvement = green whichever sign),
labels like "+0.4ms · within noise" / "−61% ✓"; x autoscaled to max(|delta|, 1.5σ).
(d) **Fingerprint charts** (collapsible, open when verdict ready): TWO small overlays side by
side — "Ground phase only" (Dean's problem area) and "Full flight" — experiment flights in accent
orange vs control flights in grey semi-transparent, **x-axis normalized to % of flight** so
different durations overlay honestly, shared auto-scaled y, 600-pt downsampled smoothed lines,
33.3ms stutter + 16.7ms target reference lines (the existing report's visual language).

### Data pipeline
- **NEW perf/native/lab_report.js** (child-process entry like capframex/archive):
  `buildLabReport(sessionsDir, dataRoot)` → JSON per experiment {verdict, sentence, deltas[],
  flights{exp,ctrl}, svgGround, svgFull}. Controls = 4 time-nearest untagged same-aircraft grid
  flights (same rule as the v1 verdict math in index.html _labVerdict — which this REPLACES).
  σ per metric from the control set via stats.js pstdev.
- **Per-flight series cache:** first Lab render writes `series.json` (~15KB) into each needed
  session folder — bucketed full-flight + ground-phase-only smoothed series, from frametimes.csv
  (**.gz-aware — reuse capframex's gunzip approach**) + telemetry.csv phase windows. Computed
  once, never regenerated if present; survives archiving.
- **SVG theming bridge:** builder outputs the report vars (--grid/--line/--target/--border/
  --text-faint); the Lab view wraps charts in a container div mapping them to app tokens
  (--sep/--acc/--ink3/--ink4 …) so dark/light theme follows automatically.
- **IPCs (main.js):** `perf-lab-report` (spawn child via ELECTRON_RUN_AS_NODE, 120s timeout, JSON
  stdout — mirror the archive.js handler) and `perf-lab-apply` {id, undo} (in-process lab.js,
  isMsfsRunning guard). preload: perfLabReport, perfLabApply.
- **Compare integration (light touch):** when grouped by "Lab experiment", each group header gains
  the verdict chip + "open in Lab →" (renderer reuses the cached lab-report payload).

### Files
- NEW perf/native/lab_report.js (series cache + verdict math + overlay SVG; imports
  report_charts.js chartFrametimeSeries/rollingMeanSeries, stats.js pstdev/percentile/pyRound,
  zlib). Ships via the existing perf/native extraResources filter automatically.
- perf/native/lab.js: + applyFinding(id, undo) + adoptions array in lab_state.
- main.js (2 IPCs) · preload.js (2 entries).
- index.html: 🧪 Lab toolbar button + #perf-lab + perfShowLab() + renderLabView() (finding cards,
  mirrors the Compare/Baseline card style: --bg2/--sep/--r2 panels, mono stat lines) + shrink
  renderLabPanel() to the status strip + remove _labVerdict (superseded) + Compare header chips.
- Version v6.2.0 (package.json + index.html ×3 + README changelog) + memory/master-list update.

### Verification
- Desk-tests (scratchpad): (1) verdict math on SYNTHETIC sessions with engineered deltas — one
  >1σ improvement (→ SAVES), one within-noise (→ NO EFFECT), one worsened (→ COSTS), one
  up-experiment with no cost (→ FREE); (2) series cache built from the real KORD-KATL flight raw
  AND a gzipped copy — identical output, ground-only length sane vs the phase log; (3) SVG
  structurally valid + contains both series + both reference lines; (4) applyFinding round-trip
  on a sandbox UserCfg copy (apply → adopted recorded → undo → byte-identical); (5) node --check
  all + renderer Function-parse.
- Live (no flying): Lab view pre-24/24 renders the locked state gracefully; one synthetic tagged
  flight in a scratch index → full card renders with charts. Commit + push per standing rules.

  R5 Installer/share-readiness: uninstall data prompt, Export/Import My Setup (DO before any
     fresh-machine test), guided first-run, app icon (!), README install section

**D. FEATURE QUEUE (older, still valid):** BookmarkDrop (#1, ties R1) · weather pill filter (#2) ·
share with friends (#3, ties R5). Sharing-only hardening: Store-vs-Steam UserCfg path, typeperf
locale-comma parsing.

**Suggested order:** A (v6) → B1+B2 quick wins → R5 (pre-share) → R3 → benchmark finishes → R4.

> **Build status (2026-06-28):** Phase 0 ✅ relocation + DATA_ROOT split · Phase 1 ✅ embedded
> Performance tab (dashboard-default, ABRP-themed, offline charts) · Phase 2 ✅ bundled
> Python-free `perf-engine.exe` (PresentMon baked in), ABRP arms headless detached captures
> (proven on a real PMDG/175 flight), confirm-close dialog. Shipped through **v5.9.7**.
> **Next: Phase 3** — native background-app close/reopen checkboxes — AND fold in the Phase-2
> "#1" one-click Quick Launch consolidation here (auto-TLOD `--prep-next` → launch MSFS →
> capture → app close/reopen), so `record_clean.bat` retires in ONE clean move (retiring it
> needs the native app-close, hence the merge). Interim: manual **Arm Capture** button works.
> Still owed (turnkey/fresh-install only, Dean runs as admin so non-blocking): "Performance
> Log Users" permission detect. Tabled: hide the embedded report's own ◐ theme toggle.
> **Phase 3 robustness item (found 2026-06-29):** an armed-but-never-flown capture doesn't
> self-terminate — if you arm `--auto` then close the sim *without* taking off, the engine just
> keeps waiting/retrying SimConnect and lingers (and could even misfire on a later landing
> rollout). Add auto-cleanup: the engine (or ABRP) should detect the sim closed with no flight
> started and exit cleanly. Also consider an ABRP "capture armed / recording / idle" status
> indicator + a way to cancel an armed capture.
> **Phase 3 design correction (Dean, 2026-06-29):** Dean does NOT close ABRP mid-flight — he keeps
> it open the entire flight (closing it could disturb the active scenery symlinks). So the
> app close/reopen lives in **ABRP itself** (it stays open and can poll for sim-close to reopen),
> NOT in the engine — simpler than the earlier "engine does it" plan. Engine just captures. The
> detached capture + confirm-close dialog are now minor accidental-close safety nets, not core
> flow. v5.9.8 checkboxes match his original ask (uncheck Plex if someone's watching). qBittorrent
> stays "close-only" because qbPortWeaver (close+reopen) relaunches it.

---

## 🧬 ACTIVE PLAN — Phase 8: native engine transition (2026-06-30)
> **PROGRESS (phase8 branch, main frozen at v5.9.43-stable):** Safety net up (tag + branch pushed).
> **8a PARITY PASSES — all byte-for-byte vs the REAL Python over Dean's 20 flights / live config:**
> ✅ stats math (`perf/native/stats.js`, 20/20 flights, 0 diffs) · ✅ coverage (`coverage.js`, gaps/next_gap
> match) · ✅ settings READ (`settings.js`, UserCfg.opt match) · ✅ settings WRITE (`writeSettingsText`,
> SHA-256 byte-match across TLOD 100/150/175/200, non-destructive — real file untouched). UserCfg pair
> done → native auto-TLOD portable. Harness pattern: `_ref*.py` (imports real engine fns → `_ref*.json`
> oracle) + `_parity*.js` (Node port → diff). **Remaining 8a:** report HTML (write_report/
> rebuild_combined/_svg_perf_line — the big one) + index writers (update_index/sessions_nav). Trim+phase
> split folds into 8b (capture-coupled). Then 8b capture (needs flying). Nothing in the app changed;
> perf-engine.exe still the live engine; main frozen at 5.9.43.

### 🔍 DEEP-REVIEW FINDINGS (Fable adversarial review, 2026-07-01) — fix BEFORE cutover/baseline flight
> **✅ ALL FIXED 2026-07-01 (same day), verified against the Python oracle + a 10/10 mocked desk-test**
> (`armAndWaitForRolling` survives failed initial connects + stale menu connection then detects rolling;
> SimConnect 'close' does NOT end capture, PresentMon exit does; ResilientSampler reconnects + resumes
> + nulls stale reads). Fixes: (1) new `armAndWaitForRolling` — initial connect uses
> `AUTO_START_TIMEOUT_S=1800` (py:3302), 90s applies ONLY to rebuilds; (2) PresentMon-x64.exe added to
> extraResources (note: file is gitignored — build machine must have it, Dean's does); (3) armed-phase
> staleness (15s = py none_streak) + drop → rebuild loop w/ 90s grace; (4) `waitForCaptureEnd(proc)` now
> PresentMon-exit ONLY (py:3845 parity) + new `ResilientSampler` absorbs mid-flight drops and reconnects;
> (5) perf-start-capture kills a prior NATIVE engine by capture_status.json pid (+ clears file) before
> the name-based taskkills; (6) metadata (settings/title/SimBrief/sim_version) moved BEFORE
> startPresentmon, `recordingWallStart` anchored immediately AFTER it (py:3736→3759 order); (7)
> isCaptureRunning also probes capture_status.json pid (badge works in native mode) + run_capture.js now
> writes `native_capture.log` (fresh per session) since the detached process is stdio:'ignore'; (8)
> minors: real aircraft title always beats the _prep_aircraft.txt fallback, samplers spawn with stderr
> 'ignore' (unread pipe can wedge a child), PresentMon 'error' listener ends the wait. Still open from
> the review (accepted): typeperf locale-comma parsing (sharing-only concern, logged in portability),
> the ⚠ never-run-native-parallel-with-Python warning stands.
> **✅ PACKAGING VERIFIED (2026-07-02, commit 8ca6ff8):** local electron-builder build + a runtime
> probe run BY the packaged exe (ELECTRON_RUN_AS_NODE + production NODE_PATH) — caught + fixed one
> real blocker: through2's nested readable-stream 1.x needs top-level `core-util-is`, missing from
> asarUnpack → require('node-simconnect') threw in the packaged app. Added; probe now 7/7 (SunRise=6,
> all native modules, PresentMon found in resources/perf). ⚠ C:\Temp\abrp-build now holds a PHASE8 dev
> build labeled 5.9.43 — don't manually install it; the real release flow will overwrite it.
> **NEXT = Dean's real baseline gap flight via Arm_Native_Baseline_Flight.bat — the LAST v6 gate.**
Ranked; full detail in the review session transcript. All in the capture half (offline half untouched).

## 📚 RESEARCH & FUTURE PLANS (Fable research pass, 2026-07-02 — Dean's 5 concerns)

### R1. SI route-data dependency (single point of failure)
**Research result: no free replacement exists with SI's quality** (real scheduled routes keyed by
aircraft type). OpenFlights route data froze in 2014; AviationStack/Aviation Edge/AeroDataBox have the
data but paywall it at useful volumes; OpenSky (free, non-commercial) only gives ADS-B-derived
estimated dep/arr per callsign — rebuilding schedules from it is a big lift and misses aircraft-type
reliability. **The real mitigation is what we already built:** the 20k never-pruned snapshot +
community_routes.json on GitHub IS the insurance policy — routes change slowly (seasonal), so if SI
access died tomorrow the library stays useful for a year+. **Action items:** (a) treat the snapshot as
first-class: verify it's current before any risky change, consider quarterly manual snapshot exports
kept as GitHub release assets (versioned backups, off-machine); (b) BookmarkDrop (already queue #1)
removes the fragile cookie — do it; (c) if SI ever dies: fall back to snapshot + optional OpenSky
"is this route still flown?" freshness checks (OAuth2 client-credentials since Mar 2026), not a
full re-source.

### R2. METAR staleness (Dean's hunch CONFIRMED) + D-ATIS regions
**METAR bug-class confirmed:** the "Weather updated Xm ago" badge shows FETCH age, not OBSERVATION
age. aviationweather.gov returns obsTime/reportTime per record; ABRP never reads them. Airports that
don't report overnight (common outside the US) display hours-old obs as fresh, and scoreMETAR ranks
them as if current (a 6h-old CAVOK can win "best weather" during a storm). **Fix plan (small):**
(1) store obsTime in metarCache; (2) per-airport obs-age pill in route panels (amber >90min, red
"no recent report" >3h); (3) scoreMETAR adds a staleness penalty or excludes >3h obs from best/worst
weather sorts; (4) tooltip on the wx badge explaining fetch-vs-obs. NOTE: even fresh METARs are
up-to-~1h-old by nature (hourly cycle) — surface, don't "fix".
**D-ATIS research:** US/Pacific is the only region with public D-ATIS APIs. Options: current
atis.info + **datis.clowd.io as a redundant fallback** (same FAA SWIM data, different host — easy
resilience win). atisrelay.com = US-only, API-key, commercial sub — skip. International: NO viable
public API exists (Europe's D-ATIS goes over ACARS datalink; public web = hobby scrapers like the
atis.guru we already scrape). **Best move: synthetic ATIS** — when D-ATIS is missing/failed, generate
an ATIS-style briefing FROM THE METAR (wind, vis, ceiling, altimeter, likely active runway from wind)
labeled "Generated from METAR — no D-ATIS at this airport". Universal coverage, zero new
dependencies, and it makes atis.guru breakage a non-event.

### R3. Flight-log disk space (Phase 7, now QUANTIFIED on Dean's real data)
Measured 2026-07-02: Sessions = **1.5 GB, of which frametimes.csv = 1.4 GB (93%)**; summaries 80 KB,
reports 4.5 MB, telemetry 1.7 MB. gzip on the biggest real capture: **127 MB → 26.6 MB (4.8×, 79%
saved)**. **KEY INSIGHT (corrects the premise):** the rolling-24 baseline does NOT need raw CSVs —
`_blCompute`/Compare/coverage read ONLY index.json + summary.json (tiny, kept forever). Raw
frametimes are needed only for RE-analysis (spike forensics, rebuild-session). Dean's .zip instinct
is right — refined: **gzip each frametimes.csv IN PLACE (per-file .csv.gz, not zip bundles)** so
files stay individually restorable; teach the native readers transparent .gz (Node zlib.gunzipSync —
~5 lines in readChronological, do at/after v6); keep the last ~5 flights raw for instant forensics;
gzip everything older (benchmark flights included — reversible, so the "pin the 24" rule is
satisfied). Never delete, never lossy-slim (gzip already wins without information loss). Projected:
100 flights/yr ≈ 8–10 GB raw → **≈2 GB** steady state. UI: Settings storage stat + "archive now"
button + optional auto policy. Implementation is EASY post-v6 (native owns all readers).

### R4. Driver/sim-version comparison — presentation overhaul (future, data-gated)
Design for when more data exists (currently 1 flight on 1.7.35, ~2 drivers):
- **Insight blurbs** under each Compare metric: one generated sentence per group diff, ALWAYS
  confound-aware — computed from matched cells (same aircraft + TLOD) not pooled means (the fake-2ms
  lesson), with min-n gating: n<3/side → "collecting data — no verdict yet".
- **Verdict card** at top: "Best verified combo: sim 1.7.35 + driver 566.36 @ TLOD 125 — P99 17.1ms,
  99.9% consistency (n=6)". Only declares when: matched cells exist on both sides, effect > noise
  band (e.g. >0.5ms P99, consistent sign across cells), else states what data is missing.
- **Same machinery = drift monitor**: when a new driver/sim version's matched-cell metrics regress
  beyond the band → Performance-tab alert ("driver 592.x is ~1.2ms worse at your baseline TLOD —
  consider rollback or re-baseline"). Reuses the version-change watcher triggers.
- All summary.json-driven (survives raw archival). Build AFTER the 24-flight benchmark completes.

### R5. Installer / fresh-install UX + clean uninstall (pre-share checklist)
Current state: NSIS oneClick:false + dir choice + shortcuts. Gaps found:
- **Uninstall leaves ALL of %APPDATA%\A Better Route Planner** (config, routes, logs, Sessions) — a
  Revo scan would flag it. BUT flight logs are precious — never silently delete. **Design: custom
  uninstaller prompt** (installer.nsh `customUnInstall` macro): "Also remove my data (config, routes,
  FLIGHT LOGS)?" default NO; checked = clean sweep incl. the legacy dean-msfs-route-finder folder.
- **Backup/restore (Dean's own reinstall path): "Export my setup"/"Import my setup"** buttons —
  zip of config.json + routeRegistry/Snapshot.json (+ optional Sessions) to a chosen folder; Import
  = restore on a fresh install. Doubles as the Phase-7 export. Do BEFORE any fresh-machine testing.
- **Guided first-run:** on empty config, a one-time sequenced setup modal: (1) sim detect —
  msfs-detect already auto-finds Steam/Store, just SHOW it with a confirm; (2) scenery library
  folder; (3) SimBrief username; (4) SI cookie (with BookmarkDrop when built); (5) optional aircraft/
  util roots. Each step skippable; end = "you're flight-ready".
- **Polish:** app has NO icon (build warns, default Electron icon everywhere — high-visibility, easy);
  package.json missing author (build warning); unsigned exe SmartScreen note for sharing (known);
  README gets an Install/First-run/Uninstall/Backup section mirroring the wizard.

### 🔍 FULL-APP DEEP REVIEW (Fable, 2026-07-02) — main.js/preload/index.html/scripts — 6 found, ALL FIXED
> Second Fable pass over the whole ABRP app (not the perf engine). Fixed same-session:
> 1. **Non-atomic writes of critical JSON** — config.json / routeRegistry.json / routeSnapshot.json /
>    community_routes.json were bare writeFileSync; a crash mid-write corrupts → load silently starts
>    "fresh" (settings + the never-pruned 20k snapshot lost). New `writeFileAtomic` (tmp+rename) at all
>    9 call sites incl. the migrations + quit-cleanup config write.
> 2. **Remote SI route data entered innerHTML unescaped** (descriptions, airline/callsign, 3 airline
>    dropdowns). With preload exposing launchApp (arbitrary exe), a malicious API response was a
>    theoretical script→exec chain. esc() hardened (+quote escaping) and applied at all 13 sites;
>    option values decode back to originals so filters still match.
> 3. **Auto-publish zombie** — main.js spawned publish.bat hidden/stdio-ignore but the bat ends in
>    `pause` → hung cmd per auto-publish. Now passes 'auto' arg; bat exits instead of pausing.
> 4. **deactivate-scenery missing the isSymbolicLink guard** (unlink-packages/removeJunctionIfLink had
>    it) — could delete a real FILE sharing an activated folder's name. Guard added.
> 5. **PS injection via archive filename** in gsxExtractArchive (double-quoted interpolation into
>    -Command) — now single-quoted with '' escaping (sharing hardening).
> 6. **D-ATIS redirect loop unbounded** — datisGet now caps at 5 redirects.
> **Verified clean:** single-instance lock + app.exit(0) loser path, junction cleanup guards on quit,
> PS 5.1 close/reopen array-literal patterns, list-running-apps single-object JSON handling, log
> redaction, contextIsolation/nodeIntegration, window-open deny→openExternal, auto-refresh mutual
> exclusion (_arRunning + fetch-btn), registry prune/snapshot caps, cache-cleaner MSFS guards, NVCP fs
> ops, scan progress interval cleanup. **Logged, not fixed (low/optimization):** registry only saved at
> END of a full SI refresh (30-60min fetch lost if app closes mid-refresh — re-fetchable; consider
> saving every ~20 pages); seedPerfLibs never refreshes stale vendor libs (copies only if missing);
> update.bat git pull has no local-changes guard (dev-only); release.bat still doesn't re-freeze
> perf-engine.exe (known trap; moot after v6 drops Python).
1. **90s give-up applied to the INITIAL connect** (`simconnect.js openWithRetry` via `capture.js:75`) —
   Python waits **1800s** for MSFS to launch and applies 90s only to *re*connects. Both UI arm flows
   (perfArmCapture "launch MSFS after arming"; launchAndCapture arms ~5s after MSFS launch) mean the
   native engine exits 'no-flight' while MSFS is still loading → **every production capture lost**.
2. **PresentMon-x64.exe not shipped** — lives at `perf/PresentMon-x64.exe`, excluded by `!perf/**`, not
   in extraResources; native has no download fallback (Python did). Packaged native capture always
   fails 'no-presentmon', silently (stdio ignored, no log).
3. **No reconnect/give-up after connect** — `waitForRolling` (capture.js:23) loops forever on a frozen
   `state` if the connection drops menu→flight or the sim closes while armed → ghost engine process
   that never exits and can't be killed by re-arm (see 5). Python self-heals (none_streak rebuild) +
   90s give-up. (One gate run survived menu→flight, so occurrence is intermittent — defense is absent.)
4. **Mid-flight SimConnect 'close' ends the capture** (`waitForCaptureEnd` capture.js:45) — a transient
   socket drop stops PresentMon and files a truncated flight. Python stops ONLY on PresentMon exit
   (sim process death). 'quit' is fine; 'close' must reconnect-with-90s-grace instead.
5. **Native re-arm/double-arm unhandled** (main.js perf-start-capture) — taskkill covers perf-engine.exe
   only; a prior native engine survives (it's an Electron-image process). Re-arming while native is
   RECORDING kills its PresentMon → truncated flight filed to REAL Sessions; stale armed engines
   accumulate ("7 engines" bug reborn). Use capture_status.json's pid to kill by PID.
6. **recordingWallStart still ~5–10s early** (capture.js:86) — anchored before readTitle(≤4s) +
   SimBrief(≤10s) + getSimVersion(2× PS 5.1 spawns) + PresentMon spawn; Python anchors AFTER
   start_presentmon (msfs_perf_logger.py:3759). Every phase transition mis-buckets frames by the skew.
7. **Badge/status dead in native mode** (main.js isCaptureRunning tasklists perf-engine.exe only) +
   zero observability (native capture stdio:'ignore', no log file — Python wrote msfs_perf_logger.log).
8. Minor: `resolveAircraft` drops Citation titles to a stale `_prep_aircraft.txt`; typeperf parsing
   breaks on non-English/locale-comma Windows (sharing concern); no 'error' listener on PresentMon
   child; nvidia-smi/typeperf stderr pipes never drained (use stdio ignore).
   ⚠ Also: never run `_arm_native.js` in parallel with a Python-armed capture — killStrayPresentmon +
   shared `_capture_tmp.csv` + single ETW session means they destroy each other's recording.
✅ Verified clean: asarUnpack dep closure (exactly node-simconnect+13, computed from disk), NODE_PATH
   resolution logic, prep.js backup-before-write + readback verify, baseline launcher targets
   Sessions_NATIVE_TEST only, phases/trim split parity, samplers' stop() idempotent.

### Context
Final phase: replace the frozen Python `perf-engine.exe` with native Node that produces **byte-identical
`Sessions/` output**, so the install is one language, no PyInstaller, no bundled Python, smaller installer.
Dean is (rightly) nervous. **His nervousness is justified for ONE half only** — the live capture
(SimConnect/PresentMon/VRAM), which is both the hardest to get right and only verifiable by real flights.
The analysis half (stats, trim math, report, coverage) is low-risk: his 20 existing flights are a
byte-for-byte test oracle, no flying needed. Constraints (Dean): careful, take our time, **always able to
revert to 5.9.43**, bump to **v6** only when Phase 8 is fully complete; consolidate back to one line after.

### Safety architecture (the whole point)
- **Tag `v5.9.43-stable` at current HEAD (6c2bbc8)** = the rollback anchor. All Phase 8 work on a
  **`phase8` branch**; **main stays frozen at 5.9.43** until the final v6 merge. "Goes horribly wrong" =
  abandon the branch, main untouched (no revert even needed). When proven → merge `phase8` → main, bump
  **v6.0.0**, delete branch (back to one line).
- **The Python engine stays the WORKING engine the entire time** — it is the oracle AND the live fallback,
  removed only at the very end. No big-bang.
- **Every module proven byte-for-byte against the 20 existing flights BEFORE it replaces anything.**
- **Capture (8b) is LAST and needs live flights** → deferred until Dean is flying again. We do the safe
  analysis half (8a) now.

### Decomposition — strangler-fig, safest first (detail in "Native engine transition — Phase 8 spec" below)
**8a — ANALYSIS → Node (NOW, zero flying, fully validatable):**
1. **Stats math** — port `_percentile` (msfs_perf_logger.py:822) + `compute_stats` (1012) + `parse_frametimes`
   (835). **FIRST STEP** = a dev-only parity harness: run the Node port over all 20 `frametimes.csv`
   (trimmed to each summary's recorded `start_trim_s`/`stop_trim_s`), diff every `smoothness` top-level
   field vs the existing `summary.json` within documented rounding. Changes NOTHING in production — pure
   proof the math ports. Parity target confirmed: the 24-field `smoothness` block + 4 `phases` sub-blocks.
2. **Trim + phase split** — `_trim_head_seconds`/`_trim_tail_seconds` (946/931), `_split_frametimes_by_phase`
   (966), `_compute_phase_stats` (990); phases re-derived from `telemetry.csv` where present. Validate the
   `phases` block.
3. **Report HTML** — `write_report` / `rebuild_combined_report` / `_svg_perf_line` (1515) template strings →
   Node; visual + offline-render parity (the 3 chart libs already bundled in perf/vendor).
4. **Index / coverage / recommendation** — `update_index`, `compute_coverage` (2552), `next_gap_for_aircraft`
   (2577) → Node (the Baseline view already faithfully replicates coverage — reuse that).
5. **UserCfg.opt I/O** — `read_settings` (344) / `write_settings` (534) / `backup_usercfg` (521) → Node
   (regex the flat `{Graphics}` block, NOT `{GraphicsVR}`; backup + verify-readback).
   → After 8a: Python's job shrinks to *just* capture (raw CSVs); Node owns all analysis.
**DECISION POINT after 8a:** reassess 8b (the risky capture rewrite) with Dean once he's flying — it's the
only thing gating full Python removal, and the only genuinely risky part.
**8b — CAPTURE → Node (LATER, needs flying):** PresentMon control (spawn + CSV parse) → VRAM (NVML addon
or `nvidia-smi`) → system telemetry → **SimConnect last** (`node-simconnect`: auto-start debounce,
self-healing reconnect, phase split, TITLE normalize) — HIGHEST risk, live-tested, Python kept live until
each passes parity.
> **⚠ 8b TRIM HARDENING (found 2026-07-01, during 8a.report-design):** the current tail-trim
> (movement-based `stop_trim_s` + 22.5s buffer) under-cuts on ~5 flights (06-18 Fenix150, 06-24
> Fenix125, 06-19 PMDG150, 06-26 Fenix150, 06-23 PMDG125), leaving shutdown/menu frames (300–900ms
> spikes) at ~86–100% of the kept window → inflated max/stutter + false spikes on those CHARTS only.
> **Impact is cosmetic: P99/baseline are UNAFFECTED** (verified — even an aggressive retroactive
> re-trim moved P99 by 0.00ms on all 20 flights). A retroactive heuristic can't cleanly separate the
> interspersed menu spikes from real landing frames (tested: chunked-region + edge-guard both messy/
> inconsistent), and 2 of the 5 (06-18, 06-19) predate telemetry so have no movement data anyway.
> **Do it right in 8b:** use the LIVE SimConnect movement/on-ground signal to mark true flight-end and
> cut the tail there (not a fixed buffer). Also: the CYFI-CYYC "front spike" (107ms @ ~1.4min) is a
> REAL early-climb hitch, not a spawn artifact — head-trim (5s) correctly removes only PresentMon init;
> don't over-trim the head. Preview generator `_gen_native.js` now applies head+tail trim before
> buildReport (was a bug showing untrimmed data — Dean caught it).

> **✅ 8a COMPLETE (2026-07-01).** Entire offline/analysis half is native + byte-proven against the 20
> flights AND design-polished per Dean's CapFrameX feedback (real SVG stutter pie, dynamic VRAM-ceiling
> Verdict card, bold ref-line chips, altitude-linked crosshair hover, renamed footer/headers, metric
> bars already carry CapFrameX's Average/1%low/0.1%low trio). Dean signed off on the report visually
> (2026-07-01). **NOT yet wired into the live app** — by design: the Python `perf-engine.exe` stays the
> whole working engine (capture + report) until the single v6 cutover, so "revert to 5.9.43" stays
> trivial. Native modules run only via dev harnesses/`_gen_native.js` today.

> **🔩 8b EXECUTION PLAN + SAFE TEST-FLIGHT PROTOCOL (ready when Dean flies).** Order = safest first,
> Python stays live the whole time as oracle + fallback:
> 1. **VRAM — ✅ FEASIBILITY PROVEN 2026-07-01 (no flight needed).** `nvidia-smi
>    --query-gpu=memory.used,memory.total,driver_version --format=csv,noheader,nounits` on Dean's RTX
>    3080 Ti returns `…,1871,12288,566.36`. Device-level `memory.used` == what NVML `nvmlDeviceGetMemoryInfo().used`
>    reads in Python (the report's ~11.3GB@175 peak is device-wide, not per-process) → peak/avg/pct/driver
>    all derivable. Sampler = poll `nvidia-smi` at 1 Hz during capture, track peak+running-avg. Low risk.
> 2. **PresentMon CSV parse — already proven** (the report's `readChronological`/`parseFrametimes` read
>    this exact format). Only the *live spawn* of `PresentMon-x64.exe` + stop-on-sim-exit is unproven;
>    testable against any running app before a real flight.
> 3. **System telemetry** (1 Hz top non-MSFS process) — Node process enumeration; testable now.
> 4. **SimConnect LAST (riskiest)** via `node-simconnect`: auto-start debounce (wait for ground-roll),
>    self-healing reconnect, phase split, TITLE normalize, AND the **movement/on-ground signal that fixes
>    the tail-trim** (see trim-hardening note above). Only verifiable in a live flight.
> **SAFE VALIDATION = run native capture ALONGSIDE Python on the SAME flight, diff the two summaries.**
> Never replace the Python capture until native matches. Zero risk to logged flights (native writes to a
> scratch dir; Python's real Sessions write is untouched). A native mismatch just means we keep Python.
> **Test-flight instructions for Dean (when ready):** fly any normal benchmark flight as usual (Python
> captures as always); ABRP additionally arms the native capture in parallel; afterwards we compare the
> native summary vs Python's field-by-field. If they match across 2-3 flights per capture sub-module,
> that sub-module retires its Python half. SimConnect is the last to flip. When all pass → v6 cutover
> (drop Python/PyInstaller, merge phase8→main, bump v6.0.0).

> **🔍 FULL AUDIT/QA FINDINGS (2026-07-01) — verified, not assumed.** Re-ran ALL parity harnesses vs
> freshly-regenerated Python oracles: stats byte-for-byte 20/20, UserCfg write SHA-256 match, coverage/
> settings/writers all PASS; the report/charts/combined harnesses "fail" ONLY on the intentional design
> diffs (pie SVG, verdict, phase-row tooltips) — underlying chart SVGs still byte-match Python, no data
> regression. All 20 reports + dashboard build clean; verdict degrades gracefully on null/empty VRAM.
> **🔴 v6-CUTOVER BLOCKERS (must do before native goes live):**
>   1. **Bundle `perf/native/`** — `build.files` has `!perf/**` and extraResources ships only
>      `perf-engine.exe` + `perf/vendor`, so the native JS is NOT in the installed app today. At cutover
>      add a filtered extraResources for `perf/native` shipping ONLY runtime files (stats/coverage/
>      settings/index_writer/report_*.js + report_assets/) — NOT the `_ref*.py`/`_parity*.js`/`_gen_native`/
>      `_preview` dev harnesses. Without this the installed native engine has no code.
>   2. **UserCfg.opt Store-vs-Steam path** — Python hardcodes the Steam path (`%APPDATA%\Microsoft Flight
>      Simulator 2024\UserCfg.opt`, msfs_perf_logger.py:76-78); MS-Store MSFS keeps it under
>      `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\`. Native `settings.js` is
>      already path-agnostic (takes `usercfgPath` as an arg), so the caller (main.js) must resolve
>      Store-vs-Steam and pass the right path. Same Steam-only assumption in the shader-cache cleaner's
>      MSFS SceneCache/cache paths (main.js ~1218) — Store users' MSFS cache wouldn't clear (NVIDIA/D3D
>      still do). Only matters for SHARING (Dean is Steam).
> **NOTE (main branch):** main advanced by ONE doc-only commit (30af617) that brings its README current
> for v5.9.43 — NO app/installer/release change. The freeze still holds: v5.9.43 is unchanged, the
> rollback anchor is the TAG `v5.9.43-stable` (still → 6c2bbc8), and the auto-updater keys off Releases
> (still v5.9.43), not main's HEAD. main's README now matches phase8's, so no v6 merge conflict.
> **🟢 DONE in this audit:** (a) Excluded the 14 MB `community_routes.json` from the installer
> (`build.files` `!community_routes.json`) — the installed app reads USER_DATA / downloads from GitHub and
> NEVER reads the bundled copy (verified in main.js:494-496), so ~14 MB off the installer, zero behavior
> change. (b) README brought current (was titled v5.0.8; missing Performance/Baseline/Maintenance/GSX/
> Aircraft features; had a stale config path `%USERPROFILE%\.dean_msfs_v4.json`). 
> **🟡 RECOMMENDED (await Dean OK — deletions):** (a) delete `perf/native/report_assets.json` (33 KB) —
> DEAD (loader `report_assets.js` reads the split `report_assets/*` files, nothing reads the JSON) and
> already DRIFTED (its REPORT_JS/CHART_JS are stale vs the enhanced split files); regenerable via
> `_extract_assets.py`. (b) clean dev preview artifacts from Dean's Sessions dir
> (`_phase8_native_report.html`, `_phase8_native_dashboard.html`) — my dev output, not flight data.
> **🧭 CapFrameX export (Dean's failed `Convert_to_CapFrameX.bat`):** the bat is orphaned — it does
> `cd %~dp0..` then `py msfs_perf_logger.py --convert-path`, but the .py isn't beside Sessions and it needs
> a full Python+deps install (the thing the port removes); `Sessions/CapFrameX` is empty (never worked).
> **✅ DONE 2026-07-01: native `perf/native/capframex.js`** (port of `_capframex_convert_one`/
> `_meta_from_session_dir`/`_capframex_header_lines`/`_find_session_csvs`/`convert_paths_to_capframex`) —
> byte-for-byte PARITY PASS 20/20 vs Python (`_parity_cfx.js`). Note: its tail-trim (>200ms in last 60s)
> catches the shutdown spikes the summary trim misses — reuse that rule for the 8b tail-trim fix.
> **REMAINING = wire a UI:** the bundled `perf-engine.exe` ALREADY supports `--convert-path` (msfs_perf_logger.py:3635),
> so an ABRP "Export to CapFrameX" button (Performance tab → IPC spawns the bundled exe `--convert-path`)
> works TODAY with zero bundling changes; at v6 swap that IPC to require `capframex.js` directly. Awaiting
> Dean's OK to add the button (touches main.js/preload.js/index.html).
> **⚙ Known/low-priority:** community_routes.json per-refresh re-commit slowly regrows git history (periodic
> `git gc`, or Releases/LFS later); perf-engine.exe unsigned → SmartScreen on shared machines (roadmap
> item); dev parity harnesses now "fail" on intended design diffs — optionally teach them to strip the
> added tooltip/pie markup so real regressions still stand out.

### First concrete step (what we actually do first)
Create `perf/native/stats.js` (Node port of `compute_stats`+`_percentile`+frametime parsing) and a dev-only
`perf/native/_parity.js` harness that reads the 20 existing flights from `%APPDATA%\...\Sessions\`, recomputes
the `smoothness` fields, and prints a per-flight per-field diff vs the committed `summary.json`. **Success =
all 20 match within rounding.** Nothing in `main.js`/the app changes yet — this is pure, reversible proof.

### Verification
- The 20-flight oracle IS the test. Each 8a module: re-derive its `summary.json` fields in Node, diff vs the
  Python-written values, require match within documented rounding (percentiles/stdev to 2 dp, pcts to 1 dp).
- Report HTML: render in-app + offline, compare to the Python report.
- 8b (when flying): a live confirmation flight, plus parity of its summary vs a parallel Python capture, before
  retiring any Python capture path.
- Per-step: `node --check`; harness diff clean; branch builds; main remains at 5.9.43-stable throughout.

### Critical files
- Oracle + port source: `perf/msfs_perf_logger.py` (functions cited above).
- New: `perf/native/*.js` (ports) + `perf/native/_parity.js` (dev harness, read-only on Sessions).
- Later (only as modules pass): `main.js` (spawn Node analysis for the summary; eventually native capture),
  `preload.js`, `package.json`/installer (drop the Python exe at the very end → the v6 moment).
- Read-only oracle data: `%APPDATA%\A Better Route Planner\Sessions\` (20 flights).

## ✏️ ✅ DONE (v5.9.42–43) — Baseline view copy fixes (Dean caught these, 2026-06-30)
Two wording issues in the Baseline view (`renderBaseline` + `_blCompute` in index.html ~3690–3766):
1. **Reconcile "16 clean" with the 18-flight benchmark.** The "How this was built" caption (~3765)
   says "4 excluded" — counted against the 20 total, which clashes with the 18/24 progress strip Dean
   sees. Fix: expose `benchN = grid.length` from `_blCompute`, and reword to: "Built from {cleanN} of
   your {benchN} benchmark flights — {benchN−cleanN} ran on a different GPU driver (your baseline is
   {modalDrv}), left out so it's apples-to-apples. (The Citation and the one-off TLOD-80 test aren't
   part of the 24-flight grid.)" Keeps the limits + VRAM-noise sentence.
2. **Replace the jargon "knee" with plain language.** Mode-card subtitle (~3747) "the knee — the pick"
   → "best balance — the pick"; per-plane line (~3751) "Per-plane knee (before blending)" → "Per-plane
   best balance (before blending)". Internal names (`KNEE_MS`, `perAcKnee`, `knee` key) stay — not
   user-facing. Mirror in SKILL.md ("= the knee =" → "= the best-balance point ="), so chat matches.
Verify: re-run `_blCompute` on live data (expect benchN=18, cleanN=16, diff=2); Function-parse
renderBaseline; ship as a patch bump.

## 🎯 ✅ SHIPPED v5.9.41 — Benchmark + Baseline recommendation tool (2026-06-30)
**Built + validated on live data: Performance → Baseline view = one blended TLOD (worst-of-Fenix-&-PMDG),
clean subset, 3 modes behind an expand, coverage strip matches compute_coverage. Reads TLOD 125 @ 18/24
(PMDG 150/175 n=2 outliers; Fenix knee 150, PMDG binding) — firms up as cells fill. SKILL.md carries the
same spec. Future: sharpens as the last 6 land; AutoFPS↔baseline link later; thresholds are tunable
constants in `_BL`.** Original design notes below.


### Context
The 24-flight fixed-TLOD benchmark (Fenix + PMDG × TLOD 100/125/150/175 × 3) is at 18/24. The point of
it is to learn the single best TLOD for Dean's rig. He is CPU-bound + FSR-FG-capped at 60 fps, so
P99/stutter are nearly flat across TLOD 100→175 — VRAM headroom is the real constraint. **This session
proved the confound trap:** the Compare view's all-aircraft/all-TLOD grouping showed a fake 2 ms "sim
update win" because it pooled early junk (wrong-driver 591.86/610.47 flights, the Fenix-80 out-of-grid
flight, anomalies) against two clean recent flights. The baseline tool MUST compute from a CLEAN subset.

**Dean's decisions (2026-06-30):** build NOW (works on current 18+, firms up as the last 6 land);
display ONE number up front (the blended "Balanced" pick) with an OPTIONAL expand to Smoothest +
Best-visuals; **ONE blended/combined recommendation across Fenix + PMDG — NOT per-aircraft** (those two
are his hardest planes; a baseline safe for both means lighter aircraft just benefit more); exclude the
Citation Sovereign+ (reference) and anything not Fenix/PMDG.

### Where it plugs in (reuse, don't rebuild)
- Data source: `perf-compare-data` IPC (main.js:1026) already returns per flight: aircraft, tlod, olod,
  `sim_version`, `driver_version`, `p99_ft_ms`, `stutter_pct`, `consistency_pct`, `peak_vram_mb`,
  `avg_vram_mb`, route. **No main.js change needed for v1.** (`autofps_active` isn't in the payload yet
  — no AutoFPS flights exist; add it when AutoFPS tagging lands.)
- Metric infra: reuse `_cmpMetrics` + `_cmpMean(rows,k)` (index.html:3590/3606) and the
  `perfShowCompare`/`renderCompare` view pattern (3598–3641) — render into a sibling `#perf-baseline`
  div toggled by a new toolbar button in `renderPerfPane` (3569–3577), next to Dashboard/Compare/Arm.
- Coverage definition: mirror the engine exactly — `COVERAGE_AIRCRAFT=[Fenix,PMDG]`,
  `COVERAGE_TLODS=[100,125,150,175]`, target 3, count a cell only when `p99_ft_ms!=null`
  (msfs_perf_logger.py:106–108, 2552 `compute_coverage`). Replicate faithfully in JS with a
  "keep in sync with compute_coverage" comment (Phase 8 unifies this to Node later).

### The algorithm (native JS, in index.html)
1. **Clean subset:** aircraft ∈ {Fenix, PMDG}; tlod ∈ {100,125,150,175}; `driver_version` == the modal
   driver (566.36 — drop 591.86/610.47); drop `autofps_active` when present. Track + display what got
   excluded and why (driver, out-of-grid, reference).
2. **Per-aircraft, per-TLOD means** over the 3 flights/cell: mean p99, stutter, consistency, peak VRAM
   (averaging 3 routes/cell smooths the route-driven VRAM noise we saw this session).
3. **Combine (the blend):** at each TLOD, take the **binding/worst-of-the-two** across Fenix & PMDG —
   max p99, max stutter, **min** consistency, max peak VRAM — so a passing TLOD is safe for BOTH heavies.
   Only score a TLOD where both aircraft have data; otherwise mark it "incomplete."
4. **Hard limits (tunable constants, shown in UI):** consistency ≥ 99%, stutter ≤ 0.1%, peak VRAM ≤ 90%
   of 12,288 MB (≈11,059). A TLOD "passes" if its combined profile clears all three.
5. **Three modes (combined):** Smoothest = lowest-p99 passing TLOD (≈ floor); Best-visuals = highest
   passing TLOD; **Balanced (the one headline number) = the knee** — highest TLOD whose combined p99 is
   within ~1.0 ms of best AND combined peak VRAM still under the limit. (On Dean's data this should land
   ~TLOD 150, since 175 pushes ~92% VRAM past the 90% headroom line.)

### UI (the new "Baseline" view)
- Toolbar button `🎯 Baseline` in `renderPerfPane`; shows `#perf-baseline`, hides the dashboard iframe
  (mirror `perfShowCompare`). Recomputes on open (implicit "re-run").
- **Headline:** one big "Recommended baseline: TLOD N" + a one-line plain-English why ("keeps both PMDG
  & Fenix smooth with VRAM headroom; lighter aircraft do better").
- **Benchmark progress strip:** "18/24 — cells still needing a 3rd flight: Fenix 125/150/175, PMDG …"
  (JS coverage matching `compute_coverage`). Readiness note while any cell < 3 ("firms up as cells fill").
- **Expand (collapsed by default):** Smoothest + Best-visuals; the per-aircraft Fenix/PMDG knees; the
  supporting per-TLOD table (TLOD · n · p99 · stutter · consistency · peak VRAM · pass?); and the
  caveats (driver used + N excluded, sim-version mix 1.7.27/1.7.35, VRAM is route-noisy at low n).
- Out of scope v1 (noted for later): the AutoFPS link (3 modes → AutoFPS min/target/max), and replacing
  the engine dashboard's coverage table.

### Skill update
Add the recommendation method + thresholds + the clean-subset rule to
`.claude/skills/msfs-flight-analysis/SKILL.md` so "what's my baseline?" in chat matches the GUI (one
documented spec, two surfaces).

### Verification (before release)
- Run the algorithm against the live `perf-compare-data` (20 flights): confirm it (a) excludes Citation,
  Fenix-80, and the 591.86/610.47 flights; (b) per-aircraft/per-TLOD means match a hand-read of
  index.json; (c) produces a sane single TLOD (~150 expected) with the knee logic; (d) degrades
  gracefully at n<3 with the readiness note. Cross-check the headline number against a manual calc.
- `node --check`-style Function-parse of the new renderer fns; launch app → open Baseline → numbers
  render, expand works, excluded-flight count is correct.
- Standard version bump + commit/push.

## 🧽 ✅ DONE — Project house-cleaning + data optimization (2026-06-30)
**~563 MB reclaimed; config saves 926x smaller. Guardrail: flight logs NEVER touched.**
- **Tier 1 (~335 MB):** removed regenerable build cruft — perf/build_pyi work+dist, perf/dist,
  __pycache__ (perf-engine.spec PRESERVED), and stale win-unpacked + 64 old .exe.blockmap in
  C:\Temp\abrp-build (kept latest installer).
- **Tier 2 (~53 MB):** removed stale superseded NON-log data — legacy %APPDATA%\dean-msfs-route-finder
  (old Electron app data) + ~/.dean_msfs_v4.json. **TLOD project (1.2 GB) + all Sessions LEFT
  UNTOUCHED** (contains flight logs; Dean's hard guardrail). Verified active config healthy first.
- **Tier 3 = v5.9.40:** route data (registry 3,268 + snapshot 20,000) split OUT of config.json into
  routeRegistry.json + routeSnapshot.json. save-config 16 MB→18 KB. One-time non-destructive migration
  (write files → strip config), validated lossless against a real config copy. Renderer already used
  si-get/save-* IPC, so transparent.
- **Tier 4 (190→15 MB .git):** `git gc --aggressive --prune=now` — NON-destructive. The bloat was
  mostly UNREACHABLE objects (old rebases/amends); safe prune cleared it. **History rewrite NOT done
  (and not needed)** — it risked breaking the electron-updater's release/tag linkage via force-push,
  for a cosmetic local-only gain. fsck clean, local==origin.
- **Watch (future, not urgent):** community_routes.json (13.8 MB) commits on each route refresh slowly
  re-grow reachable history; periodic `git gc`, or move to Releases/LFS later if it matters.
- **Still Dean's call:** archiving the TLOD standalone project (1.2 GB) once he confirms he's fully done
  with the standalone tool. Then Phase 8 (native engine code-unify) — next discussion.
- **Verify after update:** v5.9.40 migration runs on first launch (logs `[MIGRATE] config.json
  slimmed`); confirm routes still load in Plan a Flight; config.json drops 16 MB→~18 KB.

## 🧹 ✅ DONE (v5.9.39) — Maintenance moved into its own top-level tab (2026-06-30)

### Context
The Settings page has grown into one long scroll of 8 sections. The 3 maintenance tools (Shader Cache
Cleaner, Aircraft WASM Cache, NVCP Backup/Restore) are already grouped under one "MSFS Maintenance"
header there, but they still stack inline and add to the clutter. Dean wants them pulled out into a
**dedicated top-level "Maintenance" tab** in the left nav, placed **after Settings**. Scope = just the
3 cache/backup tools (GSX Pro, Aircraft & Utilities, Sim Integration stay in Settings).

### How the tab system works (confirmed)
- Nav items: `.sb-item` divs with `data-tab="x"` + `onclick="sw('x')"` (index.html ~386–394).
- Panes: `.pane` divs `id="pane-x"` containing `<div class="scroll">…`; active pane gets `.on`.
- `sw(t)` (~1321): toggles active nav item + `.on` pane, runs per-tab init (e.g. `if(t==='perf')
  renderPerfPane()`).
- The 3 maintenance panels live in `#pane-settings` (~688–714): the "MSFS Maintenance" uppercase
  header (688) + shader panel + WASM panel + NVCP panel, sitting between "Apps to close during flight"
  (681) and "GSX Pro" (715).
- `enhanceSettingsSections()` (~3802) makes `#pane-settings` uppercase headers collapsible at runtime;
  it scopes to `#pane-settings` only, so removing the maintenance section just leaves it untouched
  (the orphaned `settingsCollapsed['MSFS Maintenance']` key is harmless).
- Panel element IDs (`cache-result`, `wasm-result`, `nvcp-result`, `nvcp-stamp`) are resolved via
  `getElementById`, so the renderer fns (`clearShaderCache`, `clearWasmCache`, `nvcp*`) keep working
  regardless of which pane the elements live in — the move is safe.

### Changes (all in index.html)
1. **Nav item** — add after the Settings `.sb-item` (~394):
   `<div class="sb-item" data-tab="maintenance" onclick="sw('maintenance')"><span class="sb-ic">&#128295;</span> Maintenance</div>`
   (🔧 wrench; "below Settings" per Dean).
2. **New pane** — insert `<div class="pane" id="pane-maintenance"><div class="scroll"> … </div></div>`
   right after `#pane-settings` closes (~810). Move the shader + WASM + NVCP panels (currently ~689–714)
   into it. Drop the redundant "MSFS Maintenance" uppercase divider (the tab name covers it); optionally
   add one short intro line. Each panel keeps its own `.api-t` title (Shader Cache Cleaner / Aircraft
   WASM Cache / NVIDIA Control Panel Settings) — 3 stacked panels in their own tab reads clean, no
   collapse needed.
3. **Remove** those panels (and the "MSFS Maintenance" header) from `#pane-settings`, so Settings now
   goes "Apps to close during flight" → "GSX Pro" directly.
4. **`sw()` init** — add `if(t==='maintenance')nvcpRefreshStatus();` so the "Last backup" stamp is
   current each time the tab opens (it currently only refreshes on boot).
5. **Banner button** — `openMaintenance()` (~4021) currently does `sw('settings')` + scroll to
   `#cache-result` + `maintAck()`. Change to `sw('maintenance')` + `maintAck()` (no scroll needed; the
   tab shows all three tools). The green version-change banner is global (top of window), unaffected.

### Verification
- `node --check`/Function-parse on the moved block (no syntax break from the cut/paste).
- Launch ABRP: new **Maintenance** tab appears after Settings; clicking it shows exactly the 3 tools;
  Settings no longer shows them and its remaining sections still collapse via `enhanceSettingsSections`.
- Click each button (or at least confirm dialogs open) — IDs still resolve; NVCP stamp shows on tab
  open.
- Trigger the "Open Maintenance" banner path (or call `openMaintenance()` in devtools) → lands on the
  new tab.
- Standard version bump (index.html title/footer, package.json, README changelog) + commit/push.

---

## 🚀 ACTIVE BUILD PLAN — Phase 3 finish + items 1/2/3 + AutoFPS tagging + portability (2026-06-30)

### Context
Close/reopen is done & confirmed (v5.9.19). Dean wants to: finish Phase 3, then items 1–3 + the
AutoFPS-flight handling he raised, **skip item 4** (Settings drag-reorder — stays on todo), and close
out with item 5 (portability audit). Each piece ships as its own release + TL;DR recap.
**Plan-mode note (Dean asked "is plan mode worth it given the playbook?"):** the playbook gives
direction; this pass only concretely designs the not-yet-specced pieces (one-click button, installer
fix, cache trigger) and front-loads their landmines — lean on the playbook for already-specced parts.

### Decisions locked (Dean, 2026-06-30)
- One-click = a NEW **"Launch + Capture"** button (Performance tab). Plain ⚡ Quick Launch stays as-is.
- **Auto-TLOD YES:** the button runs the engine `--prep-next` to pick + write the next benchmark TLOD
  to UserCfg.opt before launch → retires record_clean.bat now. (Auto-TLOD = fixed per-flight TLOD; it
  is NOT AutoFPS.)
- **AutoFPS ≠ auto-TLOD.** Dean finishes the 24-flight benchmark first (no AutoFPS until then).
  AutoFPS flights stay logged/captured/charted, but are TAGGED + excluded from the fixed-TLOD baseline.

### A. Phase 3 finish — "Launch + Capture" button
Preserve the auto-TLOD race order (playbook Phase-2 note): prep-next MUST write UserCfg.opt BEFORE
MSFS reads it.
1. `perf-prep-next` (new IPC: spawn perf-engine.exe `--prep-next`, await exit; **back up UserCfg.opt +
   verify-readback** first).
2. Close checked `flightCloseApps` (reuse `flight-close-apps`).
3. Launch companion `quickLaunchApps` (reuse `launchApp`).
4. Wait ~5s → `launchMsfs`.
5. Arm capture (`perf-start-capture`). Reopen on sim-close = existing watcher.
- **Armed-but-never-flown cleanup + status indicator:** add capture status (armed/recording/idle) +
  Cancel on the Performance tab; ABRP's sim-close watcher signals the engine to exit if no flight
  started (engine lingers otherwise — build-status robustness note).
- Correct the misleading `quickLaunchAll` "another project" comment.
- **⭐ HARD REQUIREMENT — tracker ⇄ auto-TLOD must be ONE source of truth (Dean, 2026-06-30):** the
  24-flight coverage tracker shown in the Performance section and the auto-TLOD set value MUST come
  from the **same engine coverage model** — never a second/divergent calc in ABRP. The auto-TLOD
  step IS the engine's `--prep-next` (same model that renders the tracker), so they agree by
  construction. Aircraft-keying caveat: `--prep-next` picks the thinnest gap *for the aircraft on the
  SimBrief plan*; so the button must (1) read/confirm the same aircraft the tracker keyed its
  recommendation to, and (2) **surface what it actually set** — e.g. "Set TLOD 175 for Fenix" — at
  launch, so Dean visibly sees it matches the tracker (and catches any mismatch, e.g. if he SimBriefed
  a different aircraft than the recommendation). **Acceptance:** for a given aircraft, the tracker's
  next-cell TLOD == the value `--prep-next` writes to UserCfg.opt == what the button reports. If the
  current tracker only shows a single headline cell, surface the per-aircraft next-cell so the
  Fenix-vs-PMDG choice is unambiguous before launch.
- Files: `index.html` (button + orchestrator by `quickLaunchAll`/`perfArmCapture` ~3444/3498),
  `main.js` (`perf-prep-next` IPC), `preload.js`. Retire record_clean.bat once proven.

### B. Item 1 — installer "cannot be closed / Retry" (installer-side = the real fix)
- Add `build/installer.nsh` with `!macro customInit` → `nsExec::Exec 'taskkill /f /im "A Better Route
  Planner.exe"'`; wire via `package.json` `build.nsis.include`. Installer force-closes the running app
  before replacing it — works regardless of the running version (the app-side v5.9.15/17 attempts were
  inherently racy). Keep junctions-on-update-quit reasoning (harmless; relaunch tidies).
- **UNVERIFIED from this seat** — needs one `release.bat` build + install to confirm; flag as such,
  Dean verifies. Risk: a malformed `.nsh` breaks the build → keep to the canonical snippet, no logic.

### C. Item 2 — Companion "close when sim closes" checkbox
- Add `closeOnSimExit` per-app flag to `quickLaunchApps` + a checkbox in the Companion Apps list
  (`renderQlAppList` ~3736) + toggle handler (mirror the `flightCloseApps` toggle pattern).
- On sim-close, extend `flightReopenApps`'s kill step to ALSO kill `quickLaunchApps` where
  `closeOnSimExit` (reuse the kill-after path). Active only when the watcher ran (a Launch+Capture
  flight) — exactly the intended case.
- Files: `index.html`, `main.js` (`flightReopenApps`).

### D. Item 3 — sim/driver version change → OFFER cache cleaner (pulls Phase-6 cleaner forward)
1. **Shader-cache cleaner** (port `Clear_MSFS2024_ShaderCache.bat`, 7 locations per locked-decision #7):
   Settings button → confirm → sim-not-running guard (`isMsfsRunning()` + sunrise/kittyhawk) → clear 7
   folders → report cleared/skipped; pre/post manual steps as on-screen notes. New IPC. (Read the real
   .bat at implement time for exact paths.)
2. **Version trigger:** read `sim_version` (already in summary.json) + capture `driver_version`
   (`nvidia-smi --query-gpu=driver_version` — ABRP already calls nvidia-smi). Persist last-seen in
   config; when newest flight's sim_version or live driver_version differs → **PROMPT** (never silent;
   destructive + manual steps) offering the cleaner.
- Files: `main.js` (cleaner IPC + version capture), `index.html` (button + prompt), `preload.js`.

### E. AutoFPS flight handling (Dean, 2026-06-30)
- **Engine** (`perf/msfs_perf_logger.py`): stamp `autofps_active` per flight — auto-detect AutoFPS in
  the running-process list (engine already enumerates processes for telemetry `top_proc`) + a manual
  override. Logging otherwise unchanged.
- **Performance GUI:** tag AutoFPS flights in dashboard/charts; **exclude from fixed-TLOD
  baseline/coverage**, keep them visible for comparison/general review. Full baseline-exclusion wires
  with Phase 4 (deferred); land the flag + a visible tag now so no AutoFPS flight silently counts.
- Not urgent (post-benchmark) but planned. Ties to the "AutoFPS awareness" future item.

### F. Item 5 — Cross-system portability audit (closeout)
Read-only sweep + fixes: (a) every spawned shell uses `powershell` (5.1) not `pwsh`; (b) data parsing
in Node, not PS-side `ConvertFrom-Json`; (c) no hardcoded user paths/drive letters (use `$env:`,
`userData`, config); (d) bundled deps via `extraResources` + `process.resourcesPath`; (e) first-run
UX with empty seed lists. See [[powershell_51_not_7]] / [[work-discipline-validate-before-ship]].

### Skipped (stays on todo): item 4 — Settings drag-to-reorder sections.

### Suggested order: A (Phase 3 finish) → C (companion close-on-exit, complements A) → B (installer) →
### D (cache cleaner) → E (AutoFPS tag) → F (portability closeout). Each = own release + recap.

### Verification (front-load, REAL runtime, per piece before its release)
- Any spawned PowerShell: validate in real `powershell.exe` (5.1), never pwsh.
- Launch+Capture: prove prep-next writes UserCfg BEFORE MSFS; back up UserCfg.opt + verify-readback;
  confirm the `SAVED/REOPENED` log stays clean.
- Installer fix: build via release.bat, install over a running copy, confirm no Retry prompt (label
  UNVERIFIED until Dean does this).
- Cache cleaner: confirm the sim-not-running guard blocks while MSFS is up; dry-list the 7 folders.
- AutoFPS: stamp on a flight with AutoFPS running; confirm tagged + excluded from baseline.

---

## ✅ DONE — Fix flight-app reopen (root cause PROVEN, 2026-06-29; confirmed v5.9.19)

> **✅ STATUS (2026-06-29): CONFIRMED WORKING in v5.9.18.** Dean's Test B log:
> `closed: … | SAVED 6 reopen target(s)` → `reopen: REOPENED 6 / killed 1 | OK[shortcut]:SABnzbd.exe;
> OK[path]:Plex Media Server.exe; OK[shortcut]:Radarr.exe; OK[shortcut]:Prowlarr.exe;
> OK[shortcut]:Sonarr.exe; OK[path]:qbPortWeaver.exe`. Verified all 6 actually running + Steam
> (kill-after) down. Core close→capture-all→reopen-all→kill-after feature DONE. Remaining (logged in
> Backlog, deliberate not urgent): the 2nd Radarr (multi-instance dedup) and the cosmetic installer
> "Retry" prompt. (Plex Tuner Service rides back with Plex, no separate handling needed.)
>
> --- prior status (kept for history) ---
> **STATUS (2026-06-29, after Dean's v5.9.16 test): REOPEN half is FIXED; a NEW close-capture
> regression remains.** Log: `closed: …(10 apps)… | SAVED 1 reopen target(s)` then
> `reopen: REOPENED 1 / killed 1 | OK[shortcut]:Sonarr.exe`. The reopen correctly relaunched all it
> was given (1) — the Node-owns-data fix works. But the **close only captured 1 of 7** exe paths.
>
> **Cause:** v5.9.16's close reads `$pr.Path` first (`Get-Process` .Path), which **throws
> "access denied" for elevated/service processes** (Plex, the *arr suite) — and because that throw is
> *inside* the per-process capture try/catch, it aborts before the CIM fallback runs, so the path is
> dropped. Only Sonarr's `.Path` was readable → `SAVED 1`. v5.9.13 used `Get-CimInstance
> Win32_Process … ExecutablePath` directly and reliably captured all (`SAVED 6/7`).
>
> **FIX (next build): capture exe path via CIM `ExecutablePath` as PRIMARY, `$pr.Path` only as a
> SEPARATE safe fallback** so neither throw aborts the other:
> ```
> foreach($pr in $procs){
>   $ep=$null
>   try{ $ci=Get-CimInstance Win32_Process -Filter ("ProcessId="+$pr.Id) -EA SilentlyContinue; if($ci){ $ep=$ci.ExecutablePath } }catch{}
>   if(-not $ep){ try{ $ep=$pr.Path }catch{} }
>   if($ep){ Write-Output ('RPATH|'+$ep) }
> }
> ```
> Only the `flight-close-apps` capture loop changes; the Node state write + the (now-working) reopen
> stay. **Success = `SAVED n` equals the number of close-reopen apps, then `REOPENED n` with an
> `OK[...]` per app.** Keep `record_clean.bat` as fallback until observed.

### Context
The "apps close on Arm Capture, reopen when the sim closes" feature has now failed **three** Test-B
runs (v5.9.11→v5.9.15). Each round I shipped a fix that tested green in my terminal and failed on
Dean's machine, burning his tokens and patience. The per-app log I added in v5.9.14 finally caught it:
```
[FLIGHT] closed: ... | SAVED 6 reopen target(s)
[FLIGHT] reopen:  REOPENED 1 / killed 1 | OK[shortcut]:Sonarr.exe
```
Six apps were saved to the state file, but the reopen loop ran **once** (one log entry, no
RUNNING/MISSING/PARSE-FAIL). The state was read back as 1 item instead of 6.

**Proven cause (reproduced in real `powershell.exe`):** in **Windows PowerShell 5.1** — which ABRP
spawns — `@($json | ConvertFrom-Json)` on a 6-element array returns **1** (it emits the array as a
single object, not 6). My synthetic tests passed only because this dev terminal is PowerShell **7**,
where the same code returns 6. So the bug was never in the close (always `SAVED n`) — it was the
PowerShell **read-back** of the JSON state file silently collapsing N→1. The v5.9.13 command-line-args
attempt was a *different* self-inflicted regression (args made `Start-Process` throw); v5.9.14 reverted
that but still rode on the broken read-back.

### Fix — Node owns the data; PowerShell only does OS actions
Stop round-tripping the state through PowerShell's JSON. PowerShell is reliable for *actions*
(Get-Process / Stop-Process / Start-Process / shortcut lookup) but not as a data layer here. Node's
JSON is bulletproof and version-independent.

**`flight-close-apps` handler** (`main.js` ~1051): PS still finds each close-reopen app's exe path and
stops it, but instead of `ConvertTo-Json | Set-Content`, it **emits each captured path to stdout** with
a marker (e.g. `RPATH|<full path>`, one per line). Node collects stdout, extracts the `RPATH|` lines,
and **writes the state file itself** with `fs.writeFileSync(FLIGHT_STATE(), JSON.stringify(paths))`.
Drop the command-line-args capture entirely (unneeded; caused the v5.9.13 regression). Log `SAVED n`
from Node using the parsed count (so the count reflects what Node actually persisted).

**`flightReopenApps()`** (`main.js` ~1022): Node **reads + parses** the state file
(`JSON.parse(fs.readFileSync(...))`) — reliable. Build a PowerShell path-array literal from those
paths using the **exact escaping the kill-list already uses** (`'p1','p2',...`, single-quotes doubled),
and embed it in the reopen `-Command` (the proven `killPs` pattern — no PS file read, no ConvertFrom-Json).
PS then, per embedded path: skip if already running, find a matching Startup shortcut (exact target
path → then target filename), `Start-Process` the shortcut else the path; emit the per-app outcome
(`OK[shortcut|path]` / `RUNNING` / `MISSING` / `ERR`) to stdout for the log. Node `fs.unlinkSync` the
state file after (instead of PS `Remove-Item`).

**Unchanged:** `FLIGHT_STATE()`, the sim-close watcher (`startFlightWatch`), the startup catch-up
(main.js ~141), the close-confirm/`before-quit-for-update` work (v5.9.15), and the Settings UI.

### Critical files
- `main.js` — `ipcMain.handle('flight-close-apps', …)` and `function flightReopenApps()`. Reuse the
  existing single-quote escaping pattern already used for `killPs`/`namesPs`/`reopenPs`.

### Portability — must work on ANY Windows system (Dean, 2026-06-29)
This bug was itself a "works on my machine" trap (PS 7 vs 5.1), so the fix is explicitly built to be
machine-independent:
- **Node owns all JSON** → no dependence on which PowerShell version/quirks the user has. This is the
  core reason the fix is portable, not just correct.
- **Spawn `powershell` (Windows PowerShell 5.1), never `pwsh`** — 5.1 ships on every Windows 10/11 by
  default; `pwsh` (7) is a separate install most users won't have. Confirm every flight-feature spawn
  uses `powershell` (the close/reopen/list-running-apps handlers already do — keep it that way).
- **No hardcoded user paths** — Startup folders via `$env:APPDATA` / `$env:ProgramData`, app data via
  Electron `userData`. The seeded app list is user-editable, not assumed.
- Verification step 1 below MUST run under `powershell.exe` (5.1), not this dev terminal's pwsh.

### Verification (do BEFORE Dean retests — the whole point)
1. **Real 5.1 proof:** run the new reopen PowerShell body via `powershell.exe` (NOT pwsh) with an
   embedded 6-path array, confirm it iterates all 6, honors skip-if-running, and prints 6 per-app log
   entries. This is the exact check that would have caught the bug.
2. **Node round-trip:** unit-confirm Node writes the state file and reads back N paths.
3. **Dean — Test A first (no flight):** check apps → Arm Capture (they close) → close+reopen ABRP →
   catch-up should reopen ALL of them; the log must read `REOPENED 6 …` with an `OK[...]` per app.
4. **Dean — Test B:** full sim-to-menu-and-close; same `REOPENED n` with every app accounted for.
5. Keep `record_clean.bat` as the fallback until a clean `REOPENED n` (n = all) is observed.

## 🧭 NEXT PLAN — Capture status badge + close-confirm + Compare view + engine pass (2026-06-30)

### Context
From the deep review + Dean's feedback. Two independently-shippable tracks: (A) ABRP-side UI needing
NO engine rebuild — a global capture-status badge, a smarter close-confirm, and a new in-app Compare
view; and (B) ONE batched engine-update pass (edit `msfs_perf_logger.py`, re-freeze `perf-engine.exe`
once, Dean flies one confirmation flight). Goal: squeeze more value from the per-flight data and make
"is logging live?" obvious, the right/long-term way.

### Decisions locked (Dean, 2026-06-30)
- **Closing ABRP does NOT stop logging** — the detached capture keeps running + files on sim-close;
  the close-confirm only WARNS. Never lose a flight.
- **Compare = in-app GUI button + charts**, AND keep the `msfs-flight-analysis` chat skill for deep
  dives ("include option 1 for sure, but still leverage the skill as needed").
- **Compare metrics:** P99 frametime, stutter %/consistency %, **avg VRAM, peak VRAM** (FPS dropped —
  pinned at 60 by FSR FG, doesn't discriminate).

### Track A — ABRP-side (no engine rebuild; ship incrementally)
- **A1. Capture status badge** — global, in the title bar beside the green ▶ Launch MSFS, visible in
  every tab. New IPC `perf-capture-status` (main.js) polled ~5s: v1 = active-vs-idle by whether
  `perf-engine.exe` is running. Dim/hidden idle; lit "● Logging" active. Also the visual confirmation
  the auto-quit (B1) worked (badge clears). Rich armed-vs-recording comes via the engine status file
  (B3).
- **A2. Smarter close-confirm** — extend the existing `win.on('close')` dialog (currently MSFS-running)
  to also fire when the capture engine is running, worded: "A performance capture is recording — it
  keeps running in the background and files when you close the sim. Close ABRP anyway?" Logging is NOT
  stopped (locked decision). Reuse `_perfAllowClose`.
- **A3. Compare view** — "Compare" button in the Performance tab → pick a dimension (sim_version /
  driver_version / aircraft Fenix-vs-PMDG / TLOD) → grouped bar/line charts of the 4 metrics. Built
  ABRP-native off the per-flight `summary.json` files (tiny; avg_vram lives there, index.json only
  carries peak) — NOT raw CSVs — so it survives raw-data cleanup (Phase 7 tie-in). Reuse the bundled
  chart libs. **Control for confounds:** let the user hold other dimensions constant (filter by
  aircraft/TLOD) so a sim-version comparison is same-aircraft/same-TLOD, not apples-to-oranges; else
  label the mix. Skill stays for narrative deep-dives. (Note: meaningful sim-version compare needs more
  than the current 1 flight on 1.7.35; Fenix-vs-PMDG + TLOD are useful now.)

### Track B — Engine-update pass (edit py → re-freeze exe → 1 test flight; do together)
> **✅ SHIPPED v5.9.26 (B1+B2+B3).** Re-froze perf-engine.exe (PyInstaller 6.21.0 / spec at
> perf/build_pyi/), validated: new exe runs `--combined` (exit 0) + helper/filter unit-checks pass.
> Live capture path (auto-quit on sim-close, recording-status mid-flight) confirms on Dean's next
> flight. **B4 (version flag) + B5 (texture_quality) DEFERRED** (low value, Dean) — fold into a future
> engine touch to avoid an extra re-freeze.
- **B1. Armed-but-never-flown auto-quit** — engine detects sim-closed-with-no-flight → exits cleanly.
  (v5.9.22 already kills leftovers before arming; this stops them lingering at all.)
- **B2. Log-noise cleanup** — SimConnect data-def retries during load log at ERROR (`ERROR SIM
  def(...)`) and flood the file; suppress until connected (raise the SimConnect library logger level).
  Suppress the "(Press ENTER…)" line under `--headless`.
- **B3. Capture status file** — engine writes a tiny status marker (armed/recording/idle + pid) for
  the badge (A1) to distinguish armed vs recording.
- **B4. Per-flight version flag** — subtly bold/tint a report-table flight whose sim_version differs
  from the rest (low priority; versions change rarely; sim+driver already logged per flight).
- **B5. texture_quality parse** — fill the currently-null field from UserCfg.opt.

### Critical files
- ABRP: `main.js` (`perf-capture-status` IPC + close-confirm), `preload.js`, `index.html` (badge in
  title bar ~343; Compare button + render in the Performance pane; bundled chart libs).
- Engine: `perf/msfs_perf_logger.py` (B1–B5) → re-freeze `perf/perf-engine.exe`.

### Suggested order: A2 (tiny) → A1 (badge) → A3 (Compare) → Track B (engine pass, one rebuild+test).
### Long-term: Phase 7 retention (keep summaries forever, gzip old raw CSVs) is the real answer to
### Dean's "I'll need to clean up files for size" — and Compare reads only summaries, so it's safe.

### Verification
- Badge: arm → lights; cancel/auto-quit → clears; cheap poll.
- Close-confirm: engine running → warns; on proceed, logging CONTINUES and the flight still files.
- Compare: Fenix-vs-PMDG charts match the raw summaries; sim_version compare with a held-constant
  filter reads sanely.
- Engine pass: not testable here (real SimConnect) → Dean flies one confirmation flight post-rebuild;
  log is quiet, flight files, badge shows armed→recording→idle.

## 🎯 Baseline recommendation system — design (Dean's 10k-ft vision, 2026-06-30)
**Lifecycle:** (1) NOW — collect the 24-cell fixed-TLOD map (auto-TLOD keeps filling gaps until done).
(2) AT 24 — analyze + recommend a baseline TLOD per aircraft. (3) ONGOING — monitor + re-baseline on
drift. Auto-TLOD/--prep-next stays active through phase 1; AutoFPS stays OUT of all baseline math.

**The compromise problem:** lowest TLOD = best perf, but we want the sweet spot. **KEY insight from
Dean's data:** he's CPU-bound + FSR-FG-capped at 60fps, so P99/stutter are nearly FLAT across TLOD
100→175 (~17–20ms) — TLOD costs almost nothing in *smoothness* for him; **VRAM (85%→92%) is the real
constraint.** So his recommendation will lean high-TLOD. The tool must weigh smoothness (P99/stutter/
consistency) AND VRAM headroom AND the knee — not smoothness alone.

**Recommendation method (per aircraft, mean over the 3 flights/cell):**
- Configurable thresholds: consistency ≥ ~99%, stutter ≤ ~0.1%, peak VRAM ≤ ~90% (headroom).
- **3 modes** — lead with **Balanced**; the 3-way is an "advanced" expand (respects Dean's "maybe
  overthink"): **1. Smoothest** = lowest P99/stutter (floor TLOD 100). **2. Balanced (DEFAULT, the
  knee)** = highest TLOD whose smoothness is still within ~X% of best AND VRAM has headroom. **3. Best
  visuals** = highest TLOD that doesn't breach the hard limits. Computed per aircraft (Fenix ≠ PMDG
  possibly).

**AutoFPS ↔ baseline (the concrete link):** the 3 modes directly inform AutoFPS bounds — set AutoFPS
**MIN = Smoothest, MAX = Best-visuals, TARGET ≈ Balanced** → AutoFPS operates inside your *validated*
range. AutoFPS flights (tagged, excluded from baseline math) then get COMPARED to the baseline (did it
land near Balanced, or drop lower?). So baseline = the MAP, AutoFPS = driving it dynamically.

**Ongoing monitoring / re-baseline:** keep a rolling window of the most recent N non-AutoFPS flights.
When new fixed-TLOD flights arrive — or sim_version/driver/aircraft-version changes (already stamped
per flight) — diff their metrics vs the baseline cell; a meaningful shift → "performance changed since
your baseline — re-run analysis?" (ties to the "bump your baseline" heads-up). Benchmark machinery
(auto-TLOD/coverage) stays hidden + reversible for a fresh sweep.

**UI evolution:** AT 24-done, the coverage / "fly next" tracker (hideable + reversible) is REPLACED in
the Performance section by the **Baseline panel** — per-aircraft recommended TLOD + the 3 modes + the
supporting metric table + a "re-run analysis" button + the drift/version alert.

**Analysis skill:** `msfs-flight-analysis` gets the SAME recommendation logic (single source of truth)
so "what's my best baseline?" / "did the SU change it?" answer consistently with the GUI tool.

**Build timing:** NOT now — needs the complete 24. Build at 24-done. The cache-cleaner (greenlit) is
the immediate next build.

## 🚪 PHASE 10 — NEW-USER EXPERIENCE: setup wizard + guided baseline + benchmark-for-any-fleet
> (Dean 2026-07-06, plan-approved design. This is R5's finish plus the real architectural work his
> "what if a new user has a different aircraft mix?" question exposed. Ship as v6.3.0.)
> ✅ SHIPPED 2026-07-06 as v6.3.0 (fe76d33). 19/19 desk-tests: coverage byte-identical on Dean's 23
> real flights with the seeded default grid; title/SimBrief normalization identical; 1-aircraft(12)
> + 3-aircraft(24) custom grids; no-username guard; lab n/a-skip + custom refLabels; renderer parse.
> NOT live-clicked: the wizard UI flow itself — Dean can preview safely via Settings → Run setup
> assistant (edits nothing until buttons are pressed; the auto-trigger is guarded by setupDone,
> which the migration sets on any already-configured install). Trip-planner "stale ambiguity" claim
> from exploration was NOT reproducible in code (restoreTripPlan only re-shows the card) — skipped.

### Context
Dean wants a brand-new user to install ABRP, get guided through setup (paths, SimBrief, routes,
fleet), be OFFERED the baseline benchmark ("do you want this → which aircraft → how many flights →
confirm the grid"), and have every part of the app make sense with zero data. Exploration found:
(a) the app is already path-portable (no hardcoded machine paths ship; sim auto-detect works) but
has NO guided moment — setup is implicit blanks + alert() scolding; (b) the benchmark is Dean's rig
in code: ['Fenix','PMDG'] hardcoded in coverage.js/lab.js/lab_report.js/index.html(_BL)/prep.js,
VRAM 12288 in 4 places, aircraft normalization only knows Fenix/PMDG/Citation, and the SimBrief
fallback username is literally 'snkeyez95' (a new user's captures would fetch DEAN's flight plans).
Dean's install must be completely unaffected (migration seeds his current values as the defaults).

### Design decisions (locked)
1. **The wizard lives IN THE APP, not the NSIS installer.** Installers are the wrong place for
   rich UI; in-app can validate live ("Found 62 airports ✓"), be skipped, and re-run any time
   (Settings → "Run setup assistant"). NSIS stays as-is. Trigger: first launch with an empty/
   default config (no cfg.setupDone && no cfg.folder && no cfg.savedRows) → full-pane overlay.
   Every step has Skip; finishing or skipping sets cfg.setupDone so it never nags.
2. **Setup wizard = 6 steps** (reuses existing IPCs — msfs-detect, folder browse, scan, community
   routes download; no new detection code):
   W1 Welcome — what ABRP does in 3 bullets + "about 2 minutes; everything can be changed later".
   W2 Your sim — msfs-detect result shown ("✓ Steam · Community folder found"), confirm/browse.
   W3 Scenery library — browse + immediate mini-scan feedback: "Found N airport folders".
   W4 Your fleet — FLEET_DEF checklist, NOTHING pre-checked for new users ("check what you fly";
      Dean's existing config keeps his selections), + free-text add.
   W5 Routes — two big choices: "⬇ Download Community Routes (recommended — instant, no account)"
      [runs the existing download inline] vs "I use SayIntentions" (collapsible cookie how-to =
      the README steps). Below both: SimBrief username field w/ one-line why (pre-filled plans +
      performance capture). THIS REPLACES the snkeyez95 fallback (see 5a).
   W6 Done — checklist summary + two buttons: [Scan my airports now] [Set up my graphics baseline]
      (the second opens the baseline walkthrough).
3. **Baseline walkthrough = its own 4-step mini-wizard** (from W6, from the Performance tab's
   empty state, and from a Baseline-view button):
   B1 The offer — "Want ABRP to find your ideal graphics settings? It measures real flights and
      recommends one TLOD that keeps your heaviest planes smooth. You just fly; the app sets the
      test value before each flight." Yes / not now.
   B2 Aircraft — pick 1–3 from My Fleet ("your heaviest / most-flown"); each pick gets auto
      match-terms from its FLEET_DEF codes (editable "Advanced" field). Anything NOT picked
      automatically becomes a reference aircraft (logged, never counted — generalizes the
      Citation rule).
   B3 The plan — TLOD steps default [100,125,150,175] (Advanced-editable), flights per step
      2 or 3 (default 3), LIVE total: "2 aircraft × 4 TLODs × 3 = 24 flights". VRAM ceiling
      auto-detected ("your card: 12,288 MB → 90% safety ceiling") — no more hardcoded 3080 Ti.
   B4 Confirm — writes cfg.benchmark; coverage strip + auto-TLOD + Baseline view + Lab gate all
      run from it immediately.
4. **cfg.benchmark — the architectural core** (single source, engine + renderer):
   `{ aircraft:[{label:'Fenix',match:['fenix','a318','a319','a320','a321']},{label:'PMDG',
   match:['pmdg','737','738','739']}], tlods:[100,125,150,175], perCell:3, vramCapMb:null }`
   - main.js: on load, if cfg.benchmark missing → seed EXACTLY the above (Dean's current grid) =
     zero behavior change for him. Passed into prep/coverage/lab IPC calls; renderer reads it and
     builds _BL from it (VRAM_CAP resolves: cfg value → max total_vram_mb across summaries → 12288).
   - coverage.js: computeCoverage(sessions, grid?) / nextGapForAircraft(...) take an optional grid
     arg, defaulting to today's constants (byte-compatible when omitted).
   - Normalization: sysinfo.normalizeAircraftTitle + prep.normalizeSimbriefAircraft check the
     user match-terms FIRST, then the legacy built-ins (Dean's titles resolve identically).
   - lab.js isRef: aircraft not in benchmark labels (replaces /^(Fenix|PMDG)$/). lab_report.js
     GRID_AC/GRID_TL/vram fallback from the same config (passed via env into the child).
   - Baseline copy templated: "your benchmark plane(s) — X & Y" instead of literal PMDG & Fenix;
     blend = worst-of-ALL-selected (Math.max/min over N, works for 1); "24/24" literals → computed
     cov.total (mostly already is; fix the stragglers found at index.html ~3863/3889).
   - Lab experiment applicability: at activation, any experiment whose CURRENT baseline value
     already equals its testValue is marked "not applicable on your settings" and skipped (fixes
     the Dean-keyed testValues for other users without redesigning the queue; fully-relative
     experiments stay a future item).
5. **Full-app review fixes (new-user lens):**
   a. simbriefUser(): fallback becomes cfg.simbriefUser ONLY; no name → prep-next returns a clear
      "set your SimBrief username" hint (launch alert + Settings link); run_capture.js drops the
      'snkeyez95' literal (env var must be present or SimBrief fetch is skipped with a note).
   b. Empty states become guides (reuse the existing card style): Plan a Flight w/ 0 routes →
      "Download Community Routes / set up SayIntentions" buttons; My Airports w/ no folder →
      browse hero + "run setup assistant" link; Performance w/ 0 flights → existing card + "Set up
      my baseline" button; Approaches w/ empty library → one hint line.
   c. Trip Planner stale-ambiguity leftover: clear the restored disabled state on fresh session.
   d. Tooltips verdict (Dean asked): the existing ~54 title tooltips + .fnote lines are ENOUGH —
      no new hover-bubble system. The wizard + empty-state guides carry the teaching; hover
      bubbles would duplicate them. (Confirms Dean's instinct.)
   e. README: Install / First-run / Setup-assistant / Baseline sections replacing the dev-era
      setup.bat instructions as the primary path (installer download is the headline, bat = dev).
6. **Out of scope now:** relative Lab experiment values, per-aircraft normalization UI beyond the
   match-terms field, installer-side UI, localization, Store-vs-Steam UserCfg path (still Steam;
   logged), video/tour content.

### Files
- index.html — wizard overlay + baseline walkthrough + _BL-from-config + empty-state guides +
  templated Baseline copy + Settings "Run setup assistant" button (bulk of the work).
- main.js — cfg.benchmark seed/migration, pass grid into perf-prep-next / perf-lab-* / lab_report
  child env, simbriefUser fix, gpu-total helper (reuse vram.js query) if needed.
- perf/native/coverage.js, prep.js, sysinfo.js, lab.js, lab_report.js, run_capture.js — optional
  grid/match params w/ today's constants as defaults.
- README.md; version v6.3.0 (package.json + index.html ×3 + changelog); memory/master-list.

### Verification
- **Byte-compat first (Dean's install must not move):** desk-test computeCoverage/nextGap with
  seeded default grid vs current constants over Dean's real index.json → identical output;
  normalization: every aircraft title in his 23 summaries resolves identically; _BL built from
  seeded config === today's literals (same Baseline numbers).
- New-user desk-tests: custom 1-aircraft and 3-aircraft benchmark configs → coverage totals
  (1×4×3=12, 3×4×2=24), blend math over N, lab isRef honors custom labels, inapplicable-experiment
  skip, unknown-aircraft title falls through to reference.
- Wizard live test: setup-export first (safety), then temporarily move config.json aside, launch
  dev app → wizard appears, walk all steps incl. Community-Routes download + skip paths, verify
  written config; restore Dean's real config after (setup-import if anything goes wrong).
- node --check all; renderer Function-parse; commit/push per standing rules; Dean release.bat.

## ⚡ v6.3.2 — SILENT AUTO-UPDATE + ONE-DIALOG LAUNCH+CAPTURE (Dean 2026-07-06, plan-approved)
> ✅ SHIPPED 2026-07-06 (64369cb). All presence/parse checks pass. BONUS fix: post-benchmark
> "coverage already complete" no longer triggers a second confirm (normal Lab-takeover state —
> would have interrupted EVERY flight after 24/24). ⚠ EXPECTATION: the first SILENT update is the
> release AFTER this one — the next release.bat still updates via the old interactive path.

### Context
(1) After a release, Dean's update ritual is: open app → wait for banner → click "Restart & Install"
→ click through the NSIS wizard's next buttons. The wizard appears only because quitAndInstall() is
called with no args (interactive install); electron-updater runs the SAME assisted installer
silently with /S + auto-relaunch when called quitAndInstall(true, true). (2) Launch + Capture shows
TWO blocking dialogs on the happy path: the pre-flight confirm (a real decision — keep) and a final
"Clean flight launching 🚀" alert that is pure information yet must be dismissed (index.html
~4374). A third confirm only appears when auto-TLOD can't set (rare, genuine decision — keep).

### Design
A. UPDATE — silent on load, with a countdown + safety guards:
   - main.js 'install-update' (~1803): quitAndInstall(true, true) → silent NSIS + auto-relaunch
     (kills the wizard even for the manual button path). autoDownload/autoInstallOnAppQuit stay on.
   - NEW tiny IPC 'msfs-running' (wraps existing isMsfsRunning()) + preload entry.
   - index.html onUpdateDownloaded (~1340): instead of button-and-wait —
     GUARDS first: if capture armed/recording (existing capture-badge state), MSFS running
     (new IPC), or an SI refresh in progress → keep today's banner+button (and it still installs
     on quit via autoInstallOnAppQuit). Never yank the app out from under a flight or a fetch.
     Otherwise: banner shows "⟳ v{ver} ready — restarting to update in 8s… [Update now] [Later]"
     with a live countdown → auto-calls installUpdate(). Later cancels the countdown, leaves the
     classic button, installs on next quit anyway.
   - Dev mode (update.bat message) unchanged. Result: release.bat → Dean opens app → it updates
     and relaunches itself, zero clicks (or one "Later" if he's mid-something).
B. LAUNCH+CAPTURE — exactly one blocking dialog:
   - Keep confirm #1 (the real go/no-go), text lightly updated ("…you'll get a small summary note;
     MSFS launches ~5 s after OK").
   - Keep the rare TLOD-failed confirm (#2) — genuine decision.
   - Final alert (#3) → NON-BLOCKING toast: new flightToast(html, ms≈12000) — a bottom-centered
     card styled like gsxToast but multi-line (setLine + apps/companions/capture status). No
     dismissal needed; MSFS launch no longer waits on a click.
### Files
index.html (update handlers ~1328-1346 + banner ~365; launchAndCapture ~4336-4379; flightToast),
main.js (quitAndInstall args; msfs-running IPC), preload.js (msfsRunning). Version v6.3.2 ×3 +
README changelog.
### Verification
- node --check + renderer Function-parse; desk-sim of countdown/guard logic (pure function test:
  guard states → auto vs banner).
- quitAndInstall(true,true) is standard electron-updater; REAL proof = Dean's next release cycle:
  after THIS release.bat, the following release should install silently (this one still uses the
  old path — flag that expectation to Dean).
- Launch+Capture: Dean's next benchmark flight sees ONE confirm + toast (no final alert).

## 📖 README USER GUIDE (Dean 2026-07-06, plan-approved — docs-only, no version bump)
> ✅ SHIPPED 2026-07-06 (35a55cc). TOC + Quick Start + per-tab Guide + Common Workflows; merged
> Community/Manual-Import dupes; fixed stale .dean_msfs_v4.json registry path + My Fleet anchor
> collision. Live at the repo front page.

### Context
Dean: "update the readme on git to include some instructions and describe features and functions
for a new user. A general guide." The README is strong on REFERENCE (cookie setup, registry
mechanics, weather scoring) but has no guide — nothing walks a person through the tabs or the
core workflows. A full UI inventory of all 10 tabs + title bar + banners was captured (exact
labels) so the guide matches the app.

### Structure (single README.md, restructured)
1. Header + one-paragraph pitch + **Table of Contents** (anchor links).
2. **Quick Start** — install → Setup Assistant → first flight in ~5 numbered steps.
3. **Install & First Run** — existing section, kept.
4. **NEW: The Guide** — one subsection per tab, user language, exact UI labels, each ending with
   the workflow it serves: Dashboard (stat cards, map, clickable Recent Routes) · My Airports
   (Browse→Scan Now, table columns incl. GSX pills + activate checkboxes, +Add ICAO, ignore) ·
   Plan a Flight (3 library-mode chips, ✱ Fresh routes, ✈ Free Route, filters/sorts, the expanded
   route card: METAR w/ plain-English advisories, D-ATIS, active runway, Activate scenery,
   Open in SimBrief, ⚡ Launch + Capture; Trip Planner sub-section w/ ambiguity flow) ·
   Challenging Approaches · My Fleet · Aircraft & Util (junction bundles — why Community stays
   slim) · Companion Apps · Performance (the arc in plain English: capture → benchmark grid →
   Baseline recommendation → Settings Lab findings + Apply; Arm Capture vs Launch + Capture) ·
   Settings (section-by-section, incl. Run setup assistant / Edit benchmark plan) · Maintenance
   (5 tools incl. Export/Import My Setup + Archive Raw Captures).
5. **Common workflows** box: "Fly your first route", "Find your ideal graphics settings",
   "Added new scenery?" (rescan + GSX auto-install), "Moving to a new PC" (Export My Setup).
6. Reference sections kept below the guide: SI Cookie Setup · Community Routes (MERGE the
   duplicative "Manual Route Import" section into it) · Route Registry · Weather table · My Fleet
   codes · Updating · File Structure · Debug Log · Known Issues · Changelog · Credits.

### Files / rules
README.md only. Docs-only — NO version bump (precedent: README title commits). Exact UI labels
from the inventory (e.g. "Both airports in library", "✱ Fresh routes", "🎯 Arm Capture"). Plain
English throughout — written for a simmer who has never seen the app, not for Dean.

### Verification
TOC anchors match headings (GitHub anchor rules: lowercase, dashes); every UI label spot-checked
against index.html; markdown lint by eye (tables render, no broken code fences); commit + push.

## 🛬 SCENERY IMPACT — dep/arr ground split + 3rd-party tag (Dean 2026-07-07, plan-approved design)
> ✅ PHASE A SHIPPED 2026-07-07 as v6.3.8 (4aea29c). 5-phase split (dep_taxi/climb/cruise/descent/
> arr_taxi) fully replaces "ground"; each phase carries frametime + VRAM; dep/arr ICAO + 3rd-party ✳
> flags; per-flight report + dashboard surfaces; Lab re-pointed to both taxis independently (arrival-
> only fingerprint, cache v2); sidecar backfill (14 real flights, originals byte-unchanged) + on-launch
> self-heal. Tests: 14 split edge cases + 23 Lab + 19 phase10 + real backfill. Dean's dashboard + index
> flags refreshed live (26 flights touch payware; CYYZ/EHAM/KATL/KJFK/… flagged correctly). Real data:
> arr_taxi p99 > dep_taxi every flight; arr_taxi VRAM = flight peak (CYYZ 11730, EHAM 11214). PHASE B
> (self-serve ranking) stays the deferred follow-up below.

### Context
Dean noticed his stutters cluster on arrival taxi into heavy payware (FlyTampa CYYZ, EHAM) and asked:
can ABRP flag when a flight's dep/arr airport is 3rd-party scenery he owns, and eventually rank which
sceneries hurt performance most? He asked me to Sherlock it hard — viable or just noise? Findings:
(1) the "ground" phase is ONE combined bucket (dep taxi + arr taxi lumped) — so today he CANNOT tell
which end was rough. (2) It's recoverable AND backfillable: the phase timeline is chronological
(ground→climb→cruise→descent→ground), so dep-ground = ground before first climb, arr-ground = ground
after last descent; existing flights' telemetry.csv reconstructs it. (3) The scenery library
(S.selICAOs) is renderer-only; the detached capture engine is walled off from it (same isolation as
the benchmark config, which has a proven env-pass workaround: ABRP_BENCHMARK). (4) A per-airport
"impact score" at n=1-3/airport with reboot/aircraft/traffic/weather confounds = mostly noise. So:
build the DESCRIPTIVE foundation now (honest, backfilled, zero baseline impact); gate the SCORE as an
earned follow-up. Nothing here touches baseline math or logged raw data — purely additive metadata.

### DECISIONS LOCKED (Dean 2026-07-07, after 3 clarifying rounds)
- **Scope now = Phase A only.** Phase B (self-serve GUI ranking) DEFERRED (roadmap todo below); the
  analysis skill answers comparative scenery questions in the interim.
- **Fully REPLACE "ground"** → canonical 5-phase model: **departing taxi / climb / cruise / descent /
  arrival taxi**. No combined "ground" bucket. Baseline recommendation reads OVERALL metrics (not
  ground) so it's unaffected; the ONLY single-"ground" consumer is the Lab (re-pointed below; it's
  dormant till 24/24 so no live verdicts to disturb).
- **Both taxi ends tracked INDEPENDENTLY** (Dean): arrival-only discards payware DEPARTURES; worst-of
  hides which end. The airport is the unit — accrues samples every time it's flown OUT OF and INTO.
- **BOTH metrics per phase** (Dean): each of the 5 phases carries **frametime (p99, stutter, avg,
  frame_count) AND VRAM (peak, avg)**. VRAM-per-phase is NEW — from telemetry.csv's per-second vram_mb
  within each phase window. VRAM + frametime = the culprit-identifying pair.
- **Existing 24 flights: SIDECAR, originals never touched** — `phases_ext.json` per session holds the
  recompute; summary/frametimes/telemetry unmodified (honors the flight-log guardrail). A reader
  normalizes old (summary 4-phase + sidecar) and new (summary 5-phase) to one shape.

### PHASE A — build steps
1. **5-phase split + per-phase VRAM** — perf/native/phases.js: replace the ground bucket in
   splitFrametimesByPhase (~:35-51) with `dep_taxi` (leading ground run before first non-ground, incl.
   takeoff roll) + `arr_taxi` (trailing ground run after last non-ground, incl. landing rollout);
   interior ground (go-around) dropped. Min-frame gate so a 20 s taxi doesn't emit a noisy p99.
   computePhaseStats (~:55-73) emits frametime stats for all 5. NEW: a per-phase VRAM pass over
   telemetry.csv (peak/avg vram_mb per phase window, same first-climb/last-descent boundaries) →
   vram_peak/vram_avg on each phase. Canonical keys everywhere: dep_taxi, climb, cruise, descent,
   arr_taxi.
2. **Dep/arr ICAO at source** — sysinfo.js getSimbriefRoute (~:70-91) already parses clean
   `<origin><icao_code>`/`<destination><icao_code>`; store `settings.dep_icao`/`arr_icao`.
3. **3rd-party flags** — pass `ABRP_THIRDPARTY_ICAOS` env from main.js (built from savedRows: ICAOs with
   a real match — method auto/manual/guess, excluding noise/unmatched) → engine reads it (mirror the
   ABRP_BENCHMARK env pattern) → `settings.dep_scenery`/`arr_scenery` into summary + index entry. Flag
   reflects CURRENT library (note: no flight-time library history).
4. **Sidecar backfill for the 24 existing flights** — migration recomputes per flight the 5-phase split
   (frametime via phaseLogFromTelemetry + frametimes.csv; VRAM via telemetry.csv) + dep/arr ICAO +
   3rd-party flags → writes NEW `phases_ext.json` in the session folder. ORIGINALS UNTOUCHED. Idempotent.
   New captures write the 5-phase model straight into summary.json.
5. **Re-point the Lab (only 'ground' consumer)** — lab_report.js METRICS: replace the ground_stutter/
   ground_p99 pair with dep_taxi + arr_taxi metrics reported INDEPENDENTLY (Dean), keep peak VRAM.
   metricsFromSummary reads the new phase keys (+ sidecar for old flights). Re-run the Lab desk-tests.
6. **Surfaces:**
   - report_html.js per-flight report: show all 5 phases; the two taxi rows show p99 + stutter + peak
     VRAM + the airport ICAO with ✳ if 3rd-party (pass dep_scenery/arr_scenery into buildReport).
   - report_combined.js dashboard route column: ✳ next to a 3rd-party ICAO (baked flag; old flights via
     an on-launch index backfill from savedRows in main.js, or renderer overlay).
   - main.js perf-compare-data (~:1149): add dep_taxi_* / arr_taxi_* (p99, stutter, vram_peak),
     dep_icao/arr_icao, dep_scenery/arr_scenery per flight (reads sidecar for old flights).
   - **Update .claude/skills/msfs-flight-analysis/SKILL.md**: document the 5-phase model + per-phase
     VRAM + dep/arr ICAO + 3rd-party flags, so "which payware airport has the worst arrival taxi VRAM/
     frametime" is answerable from structured data now (the interim before Phase B).
   - Framing rule: ✳ = neutral "you own 3rd-party scenery here" (addressable), NOT "this is the problem."

### Files (Phase A)
perf/native/phases.js (5-phase + per-phase VRAM), sysinfo.js (dep/arr icao), engine.js (pass-through +
telemetry-VRAM wiring), lab_report.js (re-point metrics), report_html.js + report_combined.js
(surfaces), main.js (env pass + index/flag backfill + compare-data fields), scratchpad sidecar-backfill
migration, SKILL.md. Version bump; README changelog. Rules: node --check + renderer Function-parse;
NEVER modify logged summary/frametimes/telemetry (sidecar only); back up index.json before the flag
backfill; re-run Lab desk-tests; commit + push.

### Verification (Phase A)
- Split correctness on REAL flights: recompute dep_taxi/arr_taxi from 2026-07-07 CYYZ + EHAM; confirm
  dep+arr taxi frame counts ≈ old combined ground (± documented trim skew, minus interior ground), and
  arr_taxi p99 on CYYZ ≫ dep_taxi (matches spike forensics). Per-phase VRAM: arr_taxi peak on CYYZ ≈ the
  flight peak (VRAM peaked on arrival).
- 3rd-party flags: CYYZ (FlyTampa), EHAM, KATL true; a default airport false — via savedRows.
- Guardrail: assert originals (summary/frametimes/telemetry) byte-unchanged after backfill; only
  phases_ext.json created.
- Lab: desk-tests pass with re-pointed dep/arr-taxi metrics; verdict card shows both ends.
- Live: per-flight report shows 5 phases + taxi VRAM + ✳; dashboard route ✳ on payware; ask the skill a
  comparative scenery question and confirm it uses the new fields.

### 📋 PHASE B "Scenery Impact" self-serve ranking — PROMOTED + plan-approved (Dean 2026-07-08) — ship v6.4.1
Build now (Dean: "so I don't have to rely on Claude to break down the data"). Renderer-only; all data
already flows through perf-compare-data (Phase A + R4). Scout-confirmed plumbing.

**Context.** Dean's stutters cluster on arrival taxi into heavy payware (FlyTampa CYYZ, EHAM). A "🛬
Scenery" view ranks which airports cost the most ground performance so he can self-serve. THE HARD PART
is the confound: taxi metrics are dominated by the AIRCRAFT (FenixDisplay.exe / PMDG WASM), not the
scenery — a payware airport flown mostly with the Fenix looks bad because of the Fenix. And arrival taxi
is systematically heavier than departure taxi. Both are cancelled by scoring each airport's per-end taxi
metric against that SAME (aircraft, end)'s own baseline, leave-one-airport-out.

**Design decisions (locked).**
- New **"🛬 Scenery" perf view** — 5th toolbar button beside Dashboard/Compare/Baseline/Lab; clone the
  perfShowCompare pattern (index.html:3885) → `perfShowScenery()` → `#perf-scenery` div (add after
  #perf-lab, index.html:3774) + `'perf-scenery'` into `_perfHideViews` (:3780) + a button (:3764).
- **Confound killer = per-(aircraft,end) z-score, leave-one-out.** A "sample" = one airport-end of one
  flight: dep end uses `dep_icao`+`dep_taxi_stutter/_p99/_vram`; arr end uses `arr_icao`+`arr_taxi_*`.
  For airport X, metric M, and each (aircraft A, end E) X was flown in: baseline pool = clean (A,E,M)
  samples at airports ≠ X; `z = (mean(X's A/E samples) − mean(pool)) / _pstdev(pool)`, valid only when
  the pool has ≥3 samples. Aggregate the valid z's (equal weight) across the (A,E) combos → the airport's
  impact z per metric. This removes BOTH the aircraft confound AND the dep-vs-arr-phase confound, and
  leave-one-out stops a dominant payware airport from hiding inside its own baseline.
- **Rank on taxi STUTTER + taxi VRAM** (Dean's two: what he feels + his constraint); p99 shown, not
  ranked. `felt_stutter_hr` is WHOLE-FLIGHT (can't attribute to one end) → excluded from per-airport,
  noted in the caveat.
- **Impact chip** (reuse the _LABV `{c,bg,t}` shape): combined z = max(z_stut, z_vram). n<3 samples OR no
  valid z → **COLLECTING n/3**; z<1 → **LOW** (within normal ground variation); 1≤z<2 → **MEDIUM**; z≥2 →
  **HIGH**. Only positive z (heavier than elsewhere) is impact; negative → LOW.
- **Cover ALL airports** (a heavy default hub can be the culprit); `star(icao)` ✳ marks the payware ones
  (addressable). A "payware only" toggle (default off).
- **Clean set** = `!experiment && !excluded && !autofps_active`. INCLUDE all aircraft (reference planes
  too) — the per-aircraft baseline already neutralizes the plane, so including the Citation just adds
  scenery samples with its own baseline (reasoned deviation from the old "exclude reference" note; noted
  in UI). Baseline keyed by the flight's normalized `aircraft` label directly (no _BL dependency).
- **Honesty caveat** (always shown): ranks ground (taxi) cost vs your typical ground for the SAME plane
  (cancels the aircraft); fresh-boot VRAM state, live traffic, and weather also move these numbers, so
  n<3 is preliminary and small gaps aren't meaningful.

**Build steps.** All in index.html: (1) toolbar button + #perf-scenery div + _perfHideViews entry;
(2) `perfShowScenery()` → `_scnData` → `renderScenery()`; (3) `_scnAgg(flights)` — build samples, the
leave-one-out per-(aircraft,end) baselines, per-airport aggregate z + n + aircraft set + means, ranked
desc (collecting last); reuse `_cmpMean`/`_pstdev`/`_maxN`; (4) `renderScenery()` — header + caveat,
payware-only toggle, ranked rows (`star(icao)` + `frAptName(icao)||icao` + city, n, aircraft chips,
taxi-stutter mean + "+Xσ", taxi-VRAM mean + "+Xσ", impact chip), empty state ("no ground data yet — fly
some flights") + collecting states. SKILL.md: document the view + the leave-one-out per-aircraft z-score
method so chat answers match. Version v6.4.1 (package.json + index.html ×3 + README changelog).

**Verification.** Desk-test `_scnAgg` (scratchpad): synthetic flights where (a) a payware airport heavy
on ARRIVAL taxi with one aircraft ranks HIGH; (b) the SAME heaviness explained purely by a heavy plane
(that plane is heavy everywhere) does NOT rank the airport high (per-aircraft baseline cancels it — the
core test); (c) a default airport near its aircraft's norm ranks LOW; (d) an airport with n<3 or no
elsewhere-baseline → COLLECTING; (e) VRAM-only heaviness drives impact via z_vram; (f) leave-one-out: a
single dominant payware airport still scores (isn't hidden in its own baseline). Live: open 🛬 Scenery →
CYYZ/EHAM rank high, a default hub appears, payware-only toggle works, n<3 shows collecting. Renderer
Function-parse; commit + push.

## 📦 WRAPPER-FOLDER SCENERY → LINK INNER PACKAGES (Dean 2026-07-08, plan-approved) — the REAL KLAS fix
> Supersedes the KLAS case in the section below. Screenshots (2026-07-08) proved KLAS is NOT two
> sibling folders — it is ONE library folder `KLAS FlyTampa` (no manifest.json of its own) that WRAPS
> two real MSFS packages: `flytampa-airport-klas-las-vegas` + `flytampa-city-las-vegas`. MSFS only
> loads a package whose folder sits DIRECTLY in Community with its own manifest.json (confirmed:
> forums — "no manifest → seen as a simple folder"; MSFS does not recurse into a wrapper). So the
> v6.3.13 junction of the WRAPPER into Community is ignored by MSFS — KLAS never loads. Fix: detect a
> wrapper and symlink its INNER package folders directly into Community, flattened (Community/
> flytampa-airport-klas-las-vegas → library/KLAS FlyTampa/flytampa-airport-klas-las-vegas). Fully
> general (any wrapper-packaged addon); no KLAS hardcoding.

### Design decision (Dean deferred to me): UNIFIED, not split
One KLAS row / one checkbox that links BOTH inner packages automatically — Dean's "check one → both",
mirroring the aircraft dependency model (tick A320 → its packages ride along). Keeps My Airports as an
airport list (one row per ICAO) and leaves the ignore list, ✳ marker, GSX, and manual-ICAO code
untouched (all key off r.folder = the wrapper display name / ICAO — scout-confirmed unaffected).
DEFERRED follow-up (Dean's split idea): an expandable per-package toggle under the row so the FlyTampa
CITY/photogrammetry pack can be disabled independently — a real VRAM/perf lever (arrival-taxi VRAM is
his peak). Log it; build only if he wants the knob after the core fix lands.

### Reuse (all primitives exist — scout-confirmed)
- `pkgIsPackageDir(dir)` (main.js:712) — has manifest.json? Wrapper walk pattern = `pkgScanGroups`
  (main.js:745). Manifest presence is the package test (one level deep is enough for FlyTampa).
- `link-packages` (main.js:779) / `unlink-packages` (main.js:791) already take `{name, abs}` with
  DECOUPLED src/dest + the isSymbolicLink removal guard — they natively handle nested sources. The
  aircraft group model (`linkGroupWithDeps`/`togGroup`, index.html:2038/2126) is the template.

### Build steps
1. **main.js `scan-folder` (:216)** — additionally return `pkgMap` = {folderName: [innerPkgNames]} for
   every WRAPPER (folder with no own manifest whose immediate subfolders have manifests); normal
   packages absent/[]. Uses `pkgIsPackageDir`. Additive field — scan-folder is scenery-only, no other
   consumer. Cheap (existsSync per folder; one readdir for wrappers).
2. **main.js `activate-scenery` (:644)** — evolve the v6.3.13 `folders` param to `items:[{name,rel}]`:
   `dest=path.join(communityFolder,name)`, `src=path.join(libraryFolder,rel)` (rel may be
   `folder/innerPkg`; path.join normalizes the '/'), rest of the symlink/created/skipped/errors loop
   unchanged. Keep `folders`/dep-arr fallbacks for safety.
3. **index.html `procFolders` (:1508)** — set `row.pkgs = pkgMap[f] || []` ([] = normal, link the
   folder itself; non-empty = wrapper, link each inner). Persists via savedRows for free.
4. **index.html load-time backfill + seamless migration** — after S.allRows loads from savedRows, for
   rows missing `pkgs`, call scan-folder on S.folderPath once and map `pkgMap` onto them (mirrors the
   resolveUnknownAirports on-load enrichment). MIGRATION: for any row that is now a wrapper AND whose
   OLD wrapper-name junction is still in `activeJunctions` (v6.3.13 state), swap it — remove
   Community/<wrapper> (isSymbolicLink-guarded) and link the inner packages, updating activeJunctions
   (drop wrapper name, add inner names). So Dean's KLAS auto-corrects on update, staying "active",
   with zero clicks and no stale wrapper junction left behind.
5. **index.html helpers + call sites** — `rowPkgItems(r)` = `r.pkgs?.length ?
   r.pkgs.map(n=>({name:n,rel:r.folder+'/'+n})) : [{name:r.folder,rel:r.folder}]`; `rowLinkNames(r)`
   = names of those. `togA` / `doActivateScenery` / `doDeactivateScenery`: build `items =
   rows.flatMap(rowPkgItems)`, activate via `activateScenery({items,libraryFolder,communityFolder})`,
   deactivate via `deactivateScenery({folders:names,...})`; add res.created+res.skipped (dest names) to
   activeJunctions, remove names on deactivate. Checkbox `sel` (renderApts :1598) and route
   `allLinked` (:3586) become `rowLinkNames(r).every(n=>junctions.includes(n))`. activeJunctions now
   holds ACTUAL Community dest names → `cleanupActivationsOnQuit` (main.js:856) already removes exactly
   those, unchanged.

### Files
main.js (scan-folder pkgMap; activate-scenery items), index.html (procFolders pkgs; load backfill+
migration; rowPkgItems/rowLinkNames; togA + route activate/deactivate + checkbox/status). Version bump
(package.json + index.html ×3 + README changelog). CLAUDE.md Known Issues line updated. NO change to
link-packages/unlink-packages/deactivate-scenery/cleanup (they already do the right thing).

### Verification
- Desk-test (scratchpad, extends test_scenery_multifolder.js): (a) wrapper detection — a temp
  `KLAS FlyTampa/{airport,city}` each with a manifest.json, plus a normal `KMIA/manifest.json` →
  assert pkgMap wraps KLAS into [airport,city], KMIA absent/[]; (b) rowPkgItems — wrapper row → two
  items with rel `folder/inner`, normal row → one item rel=folder; (c) activate-scenery items→abs — a
  temp library with the nested layout + a `folders:[{name,rel}]` call → assert TWO junctions land in
  Community as the INNER names pointing at the nested sources, wrapper NOT linked; (d) migration swap —
  seed activeJunctions with the wrapper name + a stale Community/<wrapper> junction → assert backfill
  removes it and links the two inner, activeJunctions ends with inner names only.
- Live (Dean): update → KLAS auto-migrates (Community now shows flytampa-airport-… + flytampa-city-…,
  NOT KLAS FlyTampa), My Airports KLAS stays checked, and MSFS 2024 finally loads KLAS payware. A
  normal airport (KMIA) still links its single folder. Uncheck KLAS → both inner junctions gone.
- Function-parse index.html; node --check main.js; commit + push.

## 🔗 SAME-ICAO MULTI-FOLDER SCENERY ACTIVATION (Dean 2026-07-08, plan-approved) — shipped v6.3.13
> ⚠ Shipped, but based on a WRONG read of KLAS (assumed two sibling folders; it's a wrapper — see the
> WRAPPER-FOLDER section ABOVE, which supersedes the KLAS case). The find→filter change is still a
> valid general improvement for a genuine two-sibling-folder ICAO; the wrapper section builds on top.
> Small, self-contained fix. index.html + one main.js handler. Fully general (no KLAS hardcoding —
> honors CLAUDE.md rule #3). Ships as a version bump.

### Context
Dean's KLAS is his only airport with TWO scenery folders (airport + city/photogrammetry), and both
resolve to icao='KLAS'. Exploration (2026-07-08) proved activation only ever links ONE of them:
every activation path selects the folder with `S.allRows.find(r=>r.icao===icao)` — the FIRST matching
row — so the second KLAS folder is never symlinked into the Community folder. Worse, in My Airports
the checkbox is per-FOLDER for its checked state (`junctions.includes(r.folder)`, index.html:1598) but
per-ICAO for its action (`togA(icao)`, :1611), so the second KLAS row's checkbox is permanently
un-checkable (clicking it re-links the first row, which already exists → skipped). Intent: activating
KLAS must symlink BOTH folders; removing must tear down BOTH. Data model is one row per folder
{folder,icao,method,selected} (index.html:1513) — so "all folders for an ICAO" = filter, not find.

### The fix (find → filter, everywhere activation resolves a folder)
1. **main.js `activate-scenery` (:644)** — accept an optional `folders` array (mirrors
   `deactivate-scenery` :667, which already loops an array). Build the link list as: `folders` when
   present (`folders.map(f=>[null,f])`), else the legacy `[[dep,depFolder],[arr,arrFolder]]`. Rest of
   the loop (exists-check → `fs.symlinkSync(src,dest,'junction')` → created/skipped/errors) unchanged.
   Backward-compatible; `deactivate-scenery` needs NO change (already array-based). preload needs NO
   change (`activateScenery:(o)=>invoke('activate-scenery',o)` forwards any shape).
2. **My Airports `togA(icao,checked)` (index.html:1743)** — replace `const row=...find(...)` with
   `const rows=S.allRows.filter(r=>r.icao===icao&&r.selected!==false)`; `const folders=rows.map(r=>r.folder)`.
   Activate: `activateScenery({folders,libraryFolder:S.folderPath,communityFolder})`, then add BOTH
   `res.created` AND `res.skipped` to `activeJunctions` (skipped-tracking self-heals a legacy
   one-folder-linked state so both checkboxes converge). Deactivate: `deactivateScenery({folders,...})`,
   then `activeJunctions=activeJunctions.filter(f=>!folders.includes(f))`. No renderApts change needed —
   per-folder `sel` (:1598) now converges because both folders enter/leave activeJunctions together.
3. **Routes panel (index.html:3576-3644)** — `sceneryBtnHtml`: `.find()`→`.filter()` into `depRows`/
   `arrRows`; status ✓ when EVERY folder of that side is linked (`rows.every(r=>junctions.includes(r.folder))`),
   ◎ otherwise; folder-name line shows `rows.map(r=>r.folder).join(', ')` (so KLAS visibly lists both).
   Change the button onclicks to pass ICAOs only — `doActivateScenery('${dep}','${arr}','${acTypeEsc}')`
   / `doDeactivateScenery('${dep}','${arr}')` — dropping the embedded folder strings (also removes the
   pre-existing apostrophe-in-foldername escaping risk). `doActivateScenery(dep,arr,acType)` and
   `doDeactivateScenery(dep,arr)` re-derive folders internally: `const folders=[...filter(dep),
   ...filter(arr)].map(r=>r.folder)` and pass the array. Aircraft-bundle linking (linkGroupWithDeps)
   stays as-is.
4. **CLAUDE.md Known Issues** — update the "KLAS duplicate folders … leave as-is" line to note both
   folders now link together.

### Files
index.html (togA ~1743, sceneryBtnHtml/doActivate/doDeactivate ~3576-3644), main.js (activate-scenery
~644 only). Version bump (package.json + index.html ×3 + README changelog). NO preload change.

### Verification
- Desk-test (scratchpad): (a) folder-expansion — mock S.allRows with two KLAS rows + one KMIA row →
  assert togA('KLAS') yields folders=[both KLAS], togA('KMIA')=[one]; (b) activate-scenery handler over
  a temp libraryFolder/communityFolder with a `folders:[A,B]` array → assert TWO junctions created (or,
  if junction creation needs admin in the test shell, assert the handler iterates both and returns
  created/skipped covering both — logic-level).
- Live (Dean): My Airports → check KLAS → BOTH folders appear as junctions in Community, and BOTH KLAS
  checkboxes show checked; uncheck → both removed. Then a route card with KLAS as dep or arr → Activate
  links both, Remove clears both. Confirm a single-folder airport (e.g. KMIA) still links exactly one.
- Function-parse index.html; node --check main.js; commit + push.

## 📊 R4 — VERSION INSIGHTS + DRIFT MONITOR + FELT-STUTTER WEIGHTING (Dean 2026-07-08, plan-approved) — ship v6.4.0
> The whole R4 cluster in one pass (Dean chose: full cluster + a proper >100ms metric). Reuses the
> Lab's ±1σ noise-band verdict engine, the version-change watcher, the banner surface, and the
> per-flight data already in perf-compare-data. Mostly renderer wiring + one capture-side metric.

### Context
Baseline recommends a TLOD; Compare groups flights by dimension. Neither yet (a) tells you whether a
DRIVER/SIM version actually changed performance (honestly, vs noise), (b) warns when a new version
regresses, or (c) weighs the metrics Dean actually FEELS. Dean is CPU-bound + FSR-FG-capped, so overall
p99/stutter are nearly flat across TLOD — the real discriminators are TAXI-phase stutter (proven r=0.67)
and big "felt" stutters. Data reality (flag to Dean, not a blocker): benchmark 23/24, ~1 flight on the
new sim + few drivers → verdict/drift will read "collecting data" until more version cells fill; we build
the framework now so it lights up automatically. Everything is min-n gated and confound-aware (matched
cells, never pooled means — the "fake 2ms" lesson).

### Part 1 — the >100ms "felt stutter" metric (capture + sidecar backfill)
Engine counts frames >33ms (stutter_pct) and >50ms (spike_count) only — nothing at 100ms. Dean: only
100ms+ is perceptible. Add it, mirroring the existing spike pattern; Python is gone (v6) so stats.js is
the sole engine and the change is purely additive.
- **perf/native/stats.js (~:9-11, :89-98)** — add `PERCEPTIBLE_FRAMETIME_MS=100.0`; in the count loop
  `if(v>100.0)perceptible++;`; emit `perceptible_count` in `smoothness` (next to spike_count). New
  flights carry it first-class.
- **perf/native/backfill_phases.js (computeExt)** — the v6.3.8 sidecar already reads each old flight's
  trimmed frametimes.csv; also count >100ms → `perceptible_count` in phases_ext.json. Idempotent;
  ORIGINALS UNTOUCHED (flight-log guardrail). Backfills the 24 existing flights.
- **main.js perf-compare-data (~:1187-1237)** — add `felt_stutter_hr` = (perceptible_count [summary for
  new flights, else sidecar]) / (summary.duration_seconds/3600) — same read-fallback shape as the taxi
  fields; duration_seconds is a core field present on all summaries. Also pass raw `perceptible_count`.

### Part 2 — fold taxi + felt-stutter into the Baseline "Balanced" pick (R4+)
`_blCompute` (index.html ~:3891-3915) profiles each cell on overall p99/stutter/cons/pvram ONLY. Add the
discriminators Dean feels, transparently + tunably (no fragile composite):
- Cell profile gains `taxiStut` = max(dep_taxi_stutter, arr_taxi_stutter) mean, and `feltHr` = mean
  felt_stutter_hr. Blend across aircraft = worst-of (max).
- `_BL.LIM` gains lenient, SHOWN, tunable `taxiStut` + `feltHr` caps that join the `pass` gate — so a
  high-TLOD pick with clearly worse felt/taxi stutter can't "pass" even when overall p99 is flat (this is
  exactly where TLOD shows up for a CPU-bound rig). Balanced knee logic otherwise unchanged.
- Supporting per-TLOD table shows taxi-stutter + felt/hr columns; add a plain note when a LOWER TLOD is
  meaningfully smoother on taxi/felt ("TLOD 150 is balanced, but 125 has fewer felt stutters on arrival
  taxi — pick it if you feel stutters"). All "collecting data" until PER_CELL met.

### Part 3 — version verdict card + per-metric insight blurbs (Compare + Baseline)
Reuse the Lab verdict vocabulary (`_LABV` palette index.html:4000; ±1σ `within=|delta|<=sigma`
lab_report.js:236-259; `_labDeltaRow` bar :4071). Renderer has no pstdev → add a tiny inline stdev helper.
- **Compare (renderCompare ~:3806-3863)** — when dim ∈ {sim_version, driver_version}: (a) a TOP VERDICT
  CARD (mirror the existing `dim==='experiment'` chip block placement ~:3829-3840) comparing the two
  version groups on MATCHED cells (respect the existing aircraft+tlod holds ~:3806-3809), verdict
  BETTER/WORSE/NO-DIFFERENCE/COLLECTING vs ±1σ with a plain sentence + n; (b) per-metric INSIGHT BLURBS
  inside the `_cmpMetrics` loop (~:3844-3863), one line under each metric's bars: delta vs noise band.
  Add `felt_stutter_hr` (+ taxi-stutter) to `_cmpMetrics` so they're groupable/visible.
- **Baseline (renderBaseline ~:3943-3957)** — after the headline card, a version-insight line off the
  existing `d.sims` seam (:3920/3988) + the modal-driver exclusion: if the clean set spans >1 sim/driver,
  surface the same matched-cell verdict ("your 1 flight on sim 1.7.35 isn't enough to compare yet" →
  firms up later).
- Confound rule everywhere: aggregate per matched (aircraft,tlod) cell, min-n≥3/side or "collecting";
  never pooled means.

### Part 4 — drift monitor (banner)
The version watcher (`checkMaintenanceVersions` index.html:4824, `get-maintenance-versions` main.js:1471,
`S.cfg.maintLastSeen`) tells us a driver/sim CHANGED, but the alert must be DATA-driven (you haven't flown
the new version yet at change-time). So: on load, `driftCheck(flights)` compares the newest distinct
driver/sim vs the baseline (modal) on matched cells with ≥3/side; if the newer version regresses beyond
±1σ on a smoothness metric (overall p99 / taxi stutter / felt-hr) → show an amber `drift-banner` (clone
`maint-banner` markup :370-374, `var(--acc)`): "driver 592.x is ~1.2ms worse at TLOD 150 (Fenix) vs your
baseline 566.36 — consider rollback or re-baseline", action → Baseline/Compare tab (`sw(...)`). Dismissible;
store `cfg.driftDismissed` keyed by the version pair so it doesn't nag. Stays silent ("collecting") until
enough post-change flights exist — which is the honest behavior given Dean's current data.

### Files
perf/native/stats.js (+perceptible_count), perf/native/backfill_phases.js (+sidecar perceptible_count),
main.js (perf-compare-data +felt_stutter_hr/perceptible_count). index.html (_BL profile+limits+table+note;
renderCompare verdict card+blurbs+metrics+stdev helper; renderBaseline version insight; driftCheck +
drift-banner + dismissal; wire driftCheck into load ~:1300s). .claude/skills/msfs-flight-analysis/SKILL.md
(felt-stutter metric + version-verdict + drift, so chat matches). README changelog; version v6.4.0
(package.json + index.html ×3).

### Verification
- Desk-tests (scratchpad): (1) perceptible_count — synthetic frametimes with known >100ms frames → exact
  count + felt/hr from duration; (2) version-verdict math — matched cells, ±1σ: n<3/side → COLLECTING,
  clear beyond-band win → BETTER, within band → NO DIFFERENCE, confound guard (pooled would fake a delta,
  matched cancels it); (3) drift check — a synthetic newer-driver cell worse beyond band → banner fires;
  within band → quiet; <3 samples → quiet; (4) baseline Balanced with taxi/felt gate — a TLOD passing
  overall but failing felt/taxi cap is excluded; the lower-TLOD note triggers.
- Guardrail: assert the 24 originals byte-unchanged after the perceptible backfill (only phases_ext.json
  grows the field).
- Live: Compare by driver/sim → verdict card + blurbs render (mostly "collecting" today, honest);
  Baseline shows the version-insight line; force a synthetic regression to see the drift banner; node
  --check + renderer Function-parse; commit + push.

## 📈 v6.11.0 — AUTOFPS TLOD TRACE + VATSIM TRAFFIC DENSITY + ENVELOPE RECOMMENDATION (Dean 2026-07-12, plan-approved)
> ✅ BUILT + PUSHED 2026-07-12 (commit edea26d; awaiting Dean release.bat). All steps shipped as
> designed. Tests: test_autofps_trace.js 35/35 (REAL KBOS→CYYZ log → 452 samples / med 200 / min 125 /
> 81% at cap; trim-guarantee window test; midnight span; GPU-Z-absent lines; lockstep; backfill on a
> copied real session) + test_traffic_envelope.js 21/21 (all five verdict paths + wiring) + regression
> board green (capture/trim/backfill/phases/compare/lab/R4 + full VATSIM set; 3 STALE test expectations
> repaired: test_backfill now reads REPORT_V from source, test_dash_recent derives newest-from-index,
> test_liveatc_fixes updated to the "AutoFPS"-no-number contract). REAL-DATA PROOF: live-Sessions
> backfill created the KBOS→CYYZ autofps_trace.json; its regenerated report carries the green TLOD
> step line + "AutoFPS (eff. 200, 125–200)" chip; non-AutoFPS reports emit tlod:null (unchanged); raw
> logs byte-untouched. LIVE-VERIFY OWED (Dean's next AutoFPS+VATSIM flight): TLOD + traffic lines on
> the new flight's chart, vatsim_traffic column populating, envelope card leaves "collecting 1/2" →
> verdict at the 2nd traced flight. NOTE: envelope card reads flights via perf-compare-data
> (autofps_tlod_* fields) — traffic sampling needs the sim's lat/lon (new SimConnect def fields, brake-
> field pattern, unproven live until the next capture).

### Context
Dean's first tagged AutoFPS flight (KBOS→CYYZ) proved AutoFPS's own log carries the one thing ABRP can't
see — the ACTUAL dynamic TLOD every ~10s (plus OLOD/AGL/FPM/GPU%/VRAM%) — and a one-off parse showed it
parked at his 200 ceiling for 80% of the flight. Build BOTH halves: (1) draw the real TLOD line on the
per-flight report chart (frametime + altitude) so "AutoFPS (dynamic)" becomes a visible trace; (2) turn
the trace into analytics — an "AutoFPS envelope" card in the Baseline view that learns where AutoFPS
parks and recommends a better min/max TLOD range (Dean: "if I bump the ceiling to 800, find where it
parks"). PLUS: sample live VATSIM nearby-traffic count during capture (Dean picked idea #2) so arrival
stutters can be correlated with traffic pouring in. Rejected: GPU% chart line (#3 — CPU-bound, no value),
weather tags (#5 — too nitty-gritty). **Dean's hard requirement: do NOT repeat the chart-tail mistake —
the TLOD/traffic lines must respect the same trimmed chart window as the frametime series (no post-
landing / sim-quit samples drawn).**

### Key exploration facts (verified 2026-07-12)
- Chart x-basis: frametime = summed-frametime minutes from head trim (report_charts.js:73-93); ALTITUDE
  uses `(wall_ms − HEAD_TRIM_S·1000)/60000` filtered to `[0, totalMin+0.5]` where totalMin comes from the
  TAIL-TRIMMED chartFt (report_charts.js:174-186, report_html.js:93-95). **The altitude convention IS the
  no-teardown guarantee** — any series filtered to that window can't show quit spikes. TLOD + traffic
  lines copy it exactly.
- Chart.js config lives in perf/native/report_assets/chart.js — altitude dataset :18-26, `yAlt` axis
  :73-76, tooltip altAt :49-55. New datasets/axes mirror this pattern; CHART payload built at
  report_html.js:103-105.
- `recordingWallStart` (absolute epoch anchor) exists at capture.js:146 and is passed to fileSession
  (engine.js:93) but is NOT persisted — the sidecar must store it (`recording_wall_start`) so external
  wall-clock log lines map to chart time as `epoch − recording_wall_start − head_trim`. Backfill of old
  flights aligns on `summary.timestamp` (second-resolution, a few s early — fine for a 10s step line).
- AutoFPS log: `%APPDATA%\MSFS_AutoFPS\log\MSFS_AutoFPS<yyyymmdd>.log`, `LODController:UpdateVariables`
  lines every ~10s: `Mode:FSR3 FPS:60 … TLOD:196 TLODRng:… OLOD:120 AGL:763 FPM:-785 GPU:59% VRAM:75%`
  — regex proven on Dean's real log (453 samples parsed). NO frametime data in it (FPS only).
- Capture engine already has https access (sysinfo.js:100-118 fetches the full VATSIM feed today) + a
  1 Hz telemetry loop (capture.js:163-186); TELEMETRY_COLUMNS engine.js:20 (gspeed_kt = the append-a-
  column template; CSV writer is positional — push array and column list must stay in lockstep).
- SimConnect data def (simconnect.js:93-99) has NO lat/lon — add `PLANE LATITUDE`/`PLANE LONGITUDE`
  (FLOAT64, Degrees) BEFORE the brake def w/ matching positional reads in the handler (:105-110), state
  (:101) and ResilientSampler.latest() (:177-184) — same additive pattern the brake field used (v6.6.1).
- **Traffic radius = 40 nm** (research: vPilot's default aircraft draw/injection distance is 40 nm, so
  counting pilots within 40 nm ≈ counting what vPilot actually injects into the sim). `TRAFFIC_NM=40`.
- Baseline card seam: renderBaseline index.html:4277-4356; headline card ends :4292 (envelope card slots
  right after); _blCompute quarantines AutoFPS at :4236/:4239 (stays!); perf-compare-data sidecar-read
  pattern main.js:1271-1310, fields emitted :1314-1332.

### Build steps
1. **NEW perf/native/autofps_log.js** (pure, desk-testable): `findLogs(dir, t0, t1)` (daily files;
   handles a flight crossing midnight = two files), `parseTrace(text, t0, t1)` → samples
   `[{t (epoch s), tlod, olod, agl, fpm, gpu, vram, fps}]` via the proven UpdateVariables regex
   (defensive: skip non-matching lines; empty → null), `traceStats(samples)` → `{tlod_med, tlod_p10,
   tlod_p90, tlod_min, tlod_max, pct_at_cap (share of samples within 2 of the trace max), n}`.
   Default log dir `%APPDATA%\MSFS_AutoFPS\log` (env `ABRP_AUTOFPS_LOG_DIR` override).
2. **Sidecar at file time — engine.js fileSession (~:161-169, beside report write):** when
   `settings.autofps_active`, parse the log window `[startedAt, now]` and write
   `autofps_trace.json` = `{v:1, recording_wall_start, samples:[[t_rel_s, tlod, olod, agl, vram]…],
   stats:{…}}` (t_rel_s = epoch − recordingWallStart, so consumers never re-derive the anchor).
   Missing/unparseable log → no sidecar, never an error. Raw logs untouched (sidecar = derived,
   regenerable — same guardrail as phases_ext.json).
3. **VATSIM traffic sampler (capture.js):** when the capture-start probe found vPilot/VATSIM, start a
   30s feed fetch loop (reuse sysinfo.js's https pattern; feed updates ~15s — never fetch at 1 Hz;
   trim to pilots' lat/lon only). Each 1 Hz tick: count pilots within `TRAFFIC_NM=40` of own ship
   (own lat/lon from the extended SimConnect def) → new LAST column `vatsim_traffic` in
   TELEMETRY_COLUMNS (engine.js:20) + row push (capture.js:184, lockstep position). At fileSession,
   compute `settings.vatsim_traffic_peak/avg` from telemetryRows (additive summary fields). Offline /
   fetch-failed / no-fix → blank cells. simconnect.js gains lat/lon per the brake-field pattern.
4. **Chart lines (report):** report_charts.js gains `chartTlodSeries(sessionDir, totalMin)` (reads
   autofps_trace.json; x = `(t_rel_s − HEAD_TRIM_S)/60` **filtered to [0, totalMin+0.5] — the trim
   guarantee**) + `vatsim_traffic` in readTelemetry and a `chartTrafficSeries` using the exact
   chartAltitudeSeries windowing. report_html.js packs `CHART.tlod` + `CHART.traffic` (+ an
   "AutoFPS eff. median N" chip when stats exist). report_assets/chart.js adds a TLOD step-line
   dataset (stepped:true, own hidden right axis, accent color) + a faint traffic line (own axis) +
   tooltip lines ("TLOD 200 · traffic 34"), both mirroring the altitude dataset/axis pattern —
   display gated on data presence so non-AutoFPS/offline flights render byte-identical.
5. **Backfill (backfill_phases.js):** for indexed flights with `autofps_active` and no
   autofps_trace.json, attempt the parse from surviving daily logs using `summary.timestamp +
   duration` as the window (few-second anchor slop is fine at 10s cadence); bump REPORT_V
   ('autofps-trace') so reports regen once — Dean's KBOS→CYYZ log still exists, so that flight gets
   its line immediately. Log gone → skip silently (label stays, no line).
6. **Analytics (half 2):** main.js perf-compare-data emits `autofps_tlod_med/p90/max, autofps_at_cap_pct`
   via the :1271-1310 sidecar-read pattern. index.html Baseline view gains an **"AutoFPS envelope"**
   card after the headline card (:4292), computed over `autofps_active` flights (the fixed-TLOD
   quarantine at :4236/:4239 is UNTOUCHED — this is a separate consumer): floor rec = the existing
   Balanced pick; ceiling logic per flight-set (needs ≥2 AutoFPS flights, else "collecting — n/2"):
   • median at_cap_pct ≥70% AND those flights stay smooth (p99 within ~1ms of baseline, felt/hr under
   the _BL limit, peak VRAM ≤90% cap) → "AutoFPS parks at your ceiling with headroom — try raising
   Max TLOD (+25/+50)"; • at_cap_pct ≤20% → "ceiling isn't limiting — current range is right";
   • else → "range looks right"; always show observed effective median/range + per-flight chips.
   Iterative by design: Dean raises the cap → next flights show the new parking spot → card re-guides.
7. **Version/docs:** v6.11.0 (package.json + index.html ×3 + README changelog), SKILL.md (autofps_trace
   sidecar + traffic column + envelope method), memory/master-list.

### Verification
- Desk (scratchpad test_autofps_trace.js + test_traffic_envelope.js): parse Dean's REAL KBOS→CYYZ log →
  known stats (med 200, 453 raw samples, cap-park ~80%); **window test = the trim guarantee: synthetic
  trace with post-landing/quit samples beyond the chart window → excluded from the series** (the
  chart-tail lesson, explicitly); midnight-spanning synthetic (two files); missing/malformed log → null,
  no sidecar, report renders unchanged; TELEMETRY_COLUMNS↔row-push lockstep assertion; envelope logic
  synthetic cases (park-at-cap+smooth → raise; rarely-at-cap → fine; 1 flight → collecting; rough-at-cap
  → no raise); 40nm count math on a synthetic feed (in/out/edge + dateline).
- Regression: full VATSIM+perf board (the 146-assertion set) + node --check all touched + renderer parse.
- Real-data: run backfill on the live Sessions copy → KBOS→CYYZ gets autofps_trace.json + a TLOD line on
  its regenerated report; originals byte-untouched; non-AutoFPS reports byte-identical.
- Live (Dean's next AutoFPS+VATSIM flight): chart shows TLOD stepping 125→200 + traffic line; telemetry
  gains the column; Baseline shows the envelope card (collecting until 2 flights).

## 🧪 v6.12.0 — SETTINGS A/B (passive Lab replacement) + LIVE OVERLAY PERF STRIP (Dean 2026-07-14, plan-approved)
> ✅ BUILT 2026-07-14 as v6.12.0 (Dean: "Let's build it now"; name locked = "Settings A/B").
> Shipped as designed: gfx_watch.js (10-key watch list w/ explicit label maps — clouds 1=Medium
> live-calibrated, numeral always shown beside label; gated sections report -1=Off; PrimaryScaling
> read from {Video} not {Graphics}; fingerprint excludes TLOD), capture.js full-block snapshot +
> settings.gfx_fp + autofps_cfg {min,max,target} from MSFS2024_AutoFPS.config (IFR/VFR-profile +
> ActiveGraphicsMode aware — verified vs Dean's real file: 125/800/60 FSR3), engine/index_writer
> gfx_fp, perf-compare-data + gfxWatch metadata + retroactive avg_gpu_busy/avg_cpu_busy/gpu_bound
> (real-data smoke: 33/33 flights populate; 0 snapshots pre-ship → honest empty state), 🧪 Settings
> A/B view replaces the Lab (lanes fixed/autofps, runs by fingerprint, _labDeltaRow ±1σ cards,
> verdicts incl. FREE UPGRADE on gpu-busy-up-within-noise, TLOD↔VRAM dot chart, watch legend;
> renderLabPanel/labToggle/perfShowLab/renderLabView/labApply + launchAndCapture perfLabNext call
> REMOVED — lab.js/lab_report.js + their IPCs stay dormant), live overlay perf strip (live_stats.js
> CSV tail 60s window; vram.js +utilization.gpu; autofps_log tailLatest; perf_live.json atomic 5s;
> main.js overlay-state payload.perf staleness-gated 15s; overlay.html one mono .perf line).
> Tests: test_settings_ab.js 50/50 (real UserCfg round-trip, fp stability/TLOD-exclusion/Enabled
> toggle, real AutoFPS cfg, tail chunked/partial/truncation, verdict matrix, lane split, cap-change
> card, legend) + 19 regression suites green (247 assertions). LIVE-VERIFY OWED (Dean's next
> flight): summary carries graphics/gfx_fp; perf strip appears in the overlay while recording +
> vanishes at file time (he'll judge density — be ready to trim fields); then change one setting →
> next flight → COLLECTING 1/2 card. Original plan below for reference.

### Context
Dean is entering an AutoFPS-heavy era, and the Settings Lab fundamentally clashes with AutoFPS (the
Lab WRITES settings pre-launch and needs experiment/control alternation; AutoFPS drives TLOD/clouds
itself — they confound each other, already documented at v6.11.1). His ask: replace the Lab with a
**passive observer** — "just watch what I do." Snapshot MSFS's UserCfg.opt graphics settings every
flight ("silent data"), auto-detect when HE changes something (clouds, render scale, traffic…), and
present before/after A/B cards with the Lab's ±1σ delta-bar presentation he likes. His driving goal:
**find settings that push his half-idle GPU harder to better balance against the maxed CPU main
thread, WITHOUT adding VRAM** (his real ceiling — proven by the TLOD-800 flight: 95% VRAM for zero
smoothness gain). Plus: a minimal RTSS-style live perf readout in the VATSIM overlay.
Dean's locked decisions (AskUserQuestion 2026-07-14): **replace the Lab outright** (code stays
dormant in git); cards = before/after per detected settings change (his words: "a good a/b
comparison"); **single snapshot at capture start** (he'll avoid mid-flight settings changes — no
end-of-flight re-read); live metrics go in the **VATSIM overlay, minimal footprint** ("too big would
ruin the experience"), NOT the app header; current-TLOD in the strip only if cheap (it is — AutoFPS
log tail); AutoFPS log data OK as a soft dependency (metrics present only when AutoFPS ran).

### Key facts (verified by exploration 2026-07-14)
- capture.js L97-102 already reads UserCfg at capture start via settings.js readSettings — but only
  6 fields (tlod/olod/upscaling/frame_gen/target_fps/fg_multiplier). lab.js L54-67 already has the
  generalized `readKeyInBlock`/`_gfxSplit` for ANY {Graphics} key. **Nothing snapshots the full
  block — that's the gap.**
- stats.js computeStats (L80-109) ALREADY emits `avg_gpu_busy_ms`, `avg_cpu_busy_ms`,
  `gpu_bound_pct`, `cpu_bound_pct` into summary.smoothness (from PresentMon's per-frame
  MsCPUBusy/MsGPUBusy) — **never surfaced** in index/compare payload. Surfacing them is retroactive
  free (perf-compare-data re-reads summary.json anyway, main.js L1340-1352 pattern).
- autofps_trace.json sidecar (v6.11.0) already gives per-flight effective-TLOD med/p90/max +
  at_cap_pct in the compare payload — the "AutoFPS-unique metric" Dean asked about, zero new work.
- Lab presentation to reuse: index.html `_labDeltaRow` (L4523, diverging bar over shaded ±1σ band),
  `_LABV` verdict palette (L4452), card layout in renderLabView (L4542).
- New-field pipeline: capture.js settings obj → engine.js index spread (L201-219) → INDEX_CSV_FIELDS
  (index_writer.js L30) → perf-compare-data payload (main.js L1378-1400).
- vram.js already polls nvidia-smi at 1 Hz during capture; adding `utilization.gpu` to the query is
  a free column. capture_status.json is the proven engine→app file channel.

### PART A — Graphics snapshot per flight (the "silent data")
1. **New `readAllGraphics(text)`** (in lab.js beside readKeyInBlock, or settings.js): parse the flat
   {Graphics} block into a `{ "Section/Key": number }` map (~50 keys, ~1.5 KB). Enumerate Dean's real
   UserCfg.opt at build time to fix exact key names (read-only).
2. **capture.js**: `settings.graphics = readAllGraphics(...)` at the existing read site (L97). Whole
   map lands in summary.settings automatically (engine.js L184).
3. **Curated WATCH registry — MINIMAL (Dean 2026-07-14: "don't think so big"; cards ONLY for these;
   focus = GPU-heavy/VRAM-light levers he'd actually test).** New module `perf/native/gfx_watch.js`:
   `[{section, key, label, kind, labels?}]`. The list, from his REAL UserCfg (current values noted):
   PrimaryScaling (1.0 → shown as "Render scale 100%", float), VolumetricClouds/Quality (1),
   VolumetricLights/Quality (1), SSAO/Quality (1), SSR/Quality (1), ContactShadows/Quality (1),
   Shadows/Size (1536, raw), Water/FFTSize (512, raw), WindShield/Quality (1), Particles/Quality (1).
   EXCLUDED deliberately: Texture Quality (VRAM), Terrain/ObjectsLoD (machine-driven/VRAM), Traffic
   (CPU), Buildings/Trees (VRAM+CPU), precaching. Dean vetoes/trims the list at build.
   **⚠ LABEL CALIBRATION IS A HARD REQUIREMENT (Dean: "you got one backwards once"):** every enum key
   carries an EXPLICIT numeral→in-sim-label map in gfx_watch.js — no assumed 0-indexing. LIVE
   datapoint locked 2026-07-14: UserCfg `VolumetricClouds Quality 1` while AutoFPS displayed
   "Clouds: Med" → clouds scale is 0=Low/1=Medium/2=High/3=Ultra. At build: one-time calibration
   pass — Dean reads the in-sim labels for each monitored key once, table locked; cross-check the
   AutoFPS open-source enums where they overlap. Non-enum keys (Size/FFTSize/Scaling) display raw
   values/percent, no label guessing.
   **Fingerprint = hash over ONLY the monitored keys** (TLOD excluded — machine-driven). Full-block
   snapshot is still stored silently in summary (cheap insurance), but a change OUTSIDE the monitored
   list gets only a quiet one-line footnote on the timeline — NO card (Dean's scope-down).
   **UI legend (Dean's ask):** the bottom of the Settings A/B view lists the monitored keys +
   current values as a small reference table — "what's being watched, so I remember."
4. **Index entry** gains `gfx_fp` (short hash) via the engine.js spread pattern; full map stays in
   summary only (keeps index.json lean). **perf-compare-data** lifts the curated subset per flight
   (`gfx:{...}`) + `gfx_fp` from summary (same re-read it already does for avg_vram_mb).
5. Old flights have no snapshot → the A/B timeline simply starts at the first post-ship flight
   (payload `gfx:null` → excluded from grouping). No backfill possible (data never existed).
6. **AutoFPS config snapshot + TLOD↔VRAM (Dean 2026-07-14: "if I drop AutoFPS max to 700, we'll see
   it — TLOD v VRAM").** The AutoFPS TLOD envelope lives in `%APPDATA%\MSFS_AutoFPS\
   MSFS2024_AutoFPS.config` (keys `minTLod`/`maxTLod`/target FPS), NOT UserCfg — the graphics
   snapshot alone would MISS a cap change. So when the capture probe detects AutoFPS, ALSO read that
   config (simple XML `<add key= value=>` — trivial regex) → `settings.autofps_cfg = {min, max,
   target}` into summary + payload. **The AutoFPS-lane fingerprint = gfx fingerprint + maxTLod/
   minTLod**, so dropping Max 800→700 starts a new run and gets a change card like any setting.
   **AutoFPS-lane cards add TLOD/VRAM metrics** (all already in the payload since v6.11.0): trace
   tlod_max ("peak TLOD actually reached"), tlod_med, at_cap_pct, peak+avg VRAM — so the 800→700
   card reads directly: "Max TLOD 800→700 · peak TLOD 800→700 · peak VRAM 11.6→10.9 GB · P99
   within noise". **Plus a small TLOD↔VRAM panel** in the AutoFPS lane: per-flight dots (x = trace
   tlod_max, y = peak_vram_mb) with the 90%-of-card line drawn — the visual answer to "what does the
   cap cost in VRAM". Seeds RETROACTIVELY from existing AutoFPS flights (trace tlod_max stands in
   for the historic cap: 200 / 800 / 800 already on file); the cap SETTING itself is only known from
   ship date forward. (Trace samples are [t,tlod,olod,agl,vram] — a per-sample within-flight scatter
   is possible later; v1 = per-flight dots.)

### PART B — GPU/CPU balance metrics surfaced (retroactive)
perf-compare-data payload adds `avg_gpu_busy_ms`, `avg_cpu_busy_ms`, `gpu_bound_pct` (from
summary.smoothness, nullable — some early flights lack GPU-busy columns). Derived in renderer:
**gpu/cpu balance ratio** (`avg_gpu_busy/avg_cpu_busy`) — Dean's "is the gap changing" number.

### PART C — The Settings A/B view (replaces the Lab UI)
1. **Grouping (renderer, no child process):** sort payload flights chronologically; drop
   excluded/experiment flights; **split fixed vs AutoFPS flights into separate lanes** (never pooled
   — different regimes). Within a lane, group consecutive flights sharing `gfx_fp` into RUNS. Each
   run boundary = a **change card**: "Jul 14 — Volumetric clouds 2→3" (multi-key changes list each).
2. **Card content** (reuse `_labDeltaRow` + `_LABV` verbatim): before-run vs after-run means with
   ±1σ noise band from the before-run pool (renderer pstdev helper exists since v6.4.0). Metrics:
   P99 · stutter% · felt/hr · peak VRAM · avg VRAM · **avg GPU busy** · **GPU/CPU ratio** ·
   (both-sides-AutoFPS only) **effective TLOD med + at-cap%**. Verdict chip wording tuned to the
   goal: e.g. FREE UPGRADE = "GPU took the work, VRAM flat, smoothness held". n<2 per side →
   COLLECTING n/2. Card footer: aircraft mix + traffic mix of each side (honesty line).
3. **Lab retirement:** 🧪 toolbar button + view becomes "🧪 Settings A/B"; renderLabPanel strip,
   labMode checkbox, cov.ready gate, verdict-vs-controls machinery and the launchAndCapture
   perfLabNext call are REMOVED from the UI/flow (lab.js/lab_report.js stay in repo + installer,
   dormant — zero maintenance). No gate: A/B works from the first snapshot-carrying flight.
   No fingerprint SVG overlays in v1 (delta bars only; SVGs = possible later polish).

### PART D — Live overlay perf strip (RTSS-style, minimal)
Per the agent design (full detail in imperative-drifting-rain-agent-a7f9c2948ec60c544.md):
1. **New `perf/native/live_stats.js`** — `LiveFrametimeTail`: incremental tail of the growing
   PresentMon CSV (saved byte offset, partial-line remainder, header once, reset on truncation),
   60s ring of [wall, ft, cpuBusy, gpuBusy]; snapshot → {ft_avg, ft_p99, cpu_busy_avg,
   gpu_busy_avg}. Reuses stats.js column pickers/percentile. ~300 rows/5s tick — sub-ms.
2. **vram.js**: query becomes `memory.used,utilization.gpu` (summarize() untouched — byte-identical
   VRAM outputs); new `latestUtil()`.
3. **autofps_log.js**: new `tailLatest(logDir, maxAgeS=60)` — read last 4 KB of today's daily log,
   reverse-scan LINE_RE for current TLOD (+ midnight-rotation fallback). Null when absent/stale.
4. **capture.js**: 5s `publishLive()` interval while recording → atomic write (tmp+rename)
   `perf_live.json` in USER_DATA: `{v, ts, ft_avg, ft_p99, cpu_busy_avg, gpu_busy_avg,
   gpu_util_pct, vram_pct, tlod}` (all nullable). Cleared/unlinked at capture end.
5. **main.js**: inside the existing `overlay-state` relay handler, attach `payload.perf =
   readPerfLive()` (ts age >15s → null). **Zero new IPC; renderer untouched** — latcPoll's 5s
   cadence is the clock.
6. **overlay.html**: one compact mono `.perf` line at the panel bottom, fields skipped when null:
   `18.4ms · p99 27.1 | CPU 9.2 / GPU 15.7ms | GPU 84% · VRAM 77% | TLOD 514`. Panel height +1 line
   only (Dean: minimal footprint). Known scope limit: overlay exists only in VATSIM Live mode.
   Dean 2026-07-14: "might be too busy, too much data — I'll check on my next flight" → be ready to
   trim fields after his first live look. (Movable dot shipped separately as v6.11.6 — not in this
   plan's scope anymore.)

### Files
perf/native: capture.js, settings.js or lab.js (readAllGraphics), NEW gfx_watch.js, NEW
live_stats.js, vram.js, autofps_log.js, engine.js (gfx_fp spread), index_writer.js (CSV field).
main.js (compare payload fields + readPerfLive in overlay-state). index.html (Settings A/B view
replacing Lab UI; grouping + cards; remove labNext call). overlay.html (.perf line).
.claude/skills/msfs-flight-analysis/SKILL.md (graphics snapshot + gpu-balance fields + A/B method).
README changelog + version v6.12.0 ×4. Memory update.

### Verification
- Desk: readAllGraphics round-trip on a COPY of Dean's real UserCfg (every monitored key found,
  values match readKeyInBlock singly); fingerprint stability + TLOD-exclusion; synthetic
  run-grouping (change→card, mixed lanes never pool, excluded/experiment dropped, n<2 collecting);
  LiveFrametimeTail vs parseFrametimes on a chunk-appended CSV (partial rows, truncation reset);
  tailLatest incl. past-midnight; card math honors the _labDeltaRow contract. Full regression board.
- Real-data smoke: perf-compare-data over his ~33 flights → avg_gpu_busy/gpu_bound populate on
  telemetry-era flights (retroactive), gfx:null on all pre-ship flights, view renders "watching
  begins with your next flight" empty state.
- Live (Dean): next flight → summary.settings.graphics present; perf_live.json ticking every 5s;
  overlay shows the strip while recording, hides ≤20s after capture ends; filed summary byte-class
  identical to a control (capture undisturbed). Then change clouds one notch → next flight → a
  change card appears as COLLECTING 1/2 → firms at 2 flights.

## 🏗️ PERFORMANCE v7 BLUEPRINT — PARKED (Dean 2026-07-12: "park it in the roadmap")
> The full redesign of the Performance section. Dean enjoys the analytics; nothing is lost — this
> reorganizes the VIEW layer around the questions he asks instead of the eras the features shipped in.
> Trigger: whenever Dean says the analytics feel "a bit much" again, or before adding the next big
> Performance feature (build the cohort engine first so the new feature lands on the right base).

### Why (from the 2026-07-12 audit)
- Data layer is CLEAN + single-sourced (frametimes/telemetry/summary + phases_ext/autofps_trace
  sidecars + index; perf-compare-data is the shared artery) — DO NOT touch it.
- View layer grew by era: 6 views across benchmark → fixed-baseline → AutoFPS eras. Older views
  don't know the era changed (the Lab ran a clouds experiment under AutoFPS — 2026-07-12 collision).
- Comparability rules ("which flights count") are copy-pasted filters in ~5 places (_blCompute,
  coverage, driftCheck/_verdictPair, _scnAgg, _afpsEnvelope, lab_report controls) — a new tag must be
  hand-added to each; the Lab missed autofps_active exactly this way.
- Three verdict engines reimplement the same ±1σ matched-cell math (Compare version card, Baseline
  drift banner, Lab verdict cards).
- Two rendering worlds: static regenerated HTML (report.html/combined_report.html in iframes) vs
  live renderer views.

### The shape: 3 views + 1 engine
1. **COHORT ENGINE (build FIRST — the foundation).** One pure module: given a question, select the
   honest comparable flight set (same aircraft / mode fixed-vs-autofps / traffic context / no
   experiments / matched cells / modal driver) and DECLARE the cohort on every result ("based on 6
   comparable flights: Fenix · AutoFPS · VATSIM"). Every view asks it; no view rolls its own filters.
   New tags become one-line additions respected everywhere. Kills the Lab-didn't-know-AutoFPS bug
   class permanently. Desk-test = byte-parity vs today's scattered filters over the real index.
2. **FLIGHTS** (absorbs Dashboard + per-flight report iframes): live flight list, click = native
   in-app analysis. Headline = **Granite Score** (backlog item — stability ~45% / 1%-low ~25% /
   felt-stutter+spike penalty ~20% / headroom ~10% → 🟢 Granite / 🟡 Minor / 🔴 Unstable, components
   always visible); chart (frametime+altitude+TLOD+traffic) + 5-phase below. report.html remains as
   the exportable/archival artifact only.
3. **INSIGHTS** (absorbs Compare + Scenery, adds the missing view): Compare (group-by-anything, as
   today) · Scenery (leave-one-out z ranking, as today) · **TIMELINE (new)**: metrics over calendar
   time with sim-update + driver-change seams drawn as vertical lines ("did SU6 hurt me" = a picture).
4. **ADVISOR** (merges Baseline pick + AutoFPS envelope + drift banner + Lab verdicts into ONE
   mode-aware recommendation surface): fixed-TLOD answer (TLOD 125, held as reference + drift watch)
   and AutoFPS answer (floor/ceiling envelope) side by side; ONE ±1σ verdict engine; one drift alarm.
5. **EXPERIMENTS (Lab reborn, LAST — it's parked while Dean flies AutoFPS anyway):** an experiment =
   a declaration "flights WITH X vs matched controls WITHOUT X" (X = a setting, AutoFPS on/off, RTSS,
   spike-protection, fresh reboot — anything taggable). Cohort engine supplies controls and REFUSES
   confounded designs (e.g. clouds A/B while AutoFPS cloud auto-increase is on) instead of silently
   running them. Existing Lab verdict math survives; it just gets honest inputs.

### Preserved explicitly (Dean's condition)
Every metric (P99/stutter/felt/VRAM/phases), all comparatives, BOTH baseline brains (fixed +
AutoFPS envelope), scenery ranking, drift detection, spike forensics, CapFrameX export, coverage
history (archived as "how the baseline was earned").

### Delivery: strangler-fig (each step ships alone, like Phase 8)
cohort engine (parity-proven) → Granite Score + native FLIGHTS view → TIMELINE → ADVISOR merge →
EXPERIMENTS rebirth. v7-scale arc, not a weekend. Nothing breaks mid-way; static HTML keeps working
until its replacement ships.

## Backlog — general ABRP to-dos (log every little thing here as it comes up)
- **🔗 Fenix installer "phantom update" triggered by ABRP aircraft-junction re-creation (Dean 2026-07-21,
  diagnosed end-to-end).** Fenix installer repeatedly shows "Update v2.4.0.4720" (the SAME version already
  installed, April 15) for the A320/A319-321 BASE packs (not liveries — that guess was wrong). PROVEN
  benign no-op: before/after fingerprint = identical version, byte-for-byte identical size (A320 2076
  files / 4,052,199,107 bytes), files untouched (April-15 mtimes, not rewritten). ROOT CAUSE isolated by
  Dean's experiment: update-with-junction-up → installer satisfied; deactivate → "not installed";
  RE-ACTIVATE (fresh junction) → re-flags all 2076 files. So RE-CREATING the ABRP aircraft symlink is the
  trigger — the installer ties its "verified/current" state to the specific folder/reparse-point, and a
  fresh junction (new creation stamp) makes it no longer recognize its own deployment → full re-verify.
  Fenix lives in Documents\MSFS\Aircraft\Fenix (library), symlinked into Community\fnx-aircraft-320 etc.
  on activation; the updater deploys THROUGH the junction (writes land in the library). a32x-common
  "not owned or available" = red herring (update completes fine). POSSIBLE FIX (Dean asked): a
  "keep aircraft linked between sessions" option so ABRP doesn't tear down aircraft junctions on quit —
  persistent junction → installer never re-flags → nag stops (and saves re-activating each session).
  Need to confirm whether ABRP currently auto-removes aircraft junctions on quit (cleanupActivationsOnQuit
  — scenery does; check if aircraft do too) vs Dean deactivating manually. Harmless either way; build the
  toggle only if Dean wants it.
- **✅ FIXED v6.13.18 (2026-07-20) — arrival stuck on Center, wouldn't hand down to Approach.** Dean
  inbound KDTW, 30nm out, tuned to CLE_48_CTR, DTW_F1_APP online + covering — overlay stayed on Center.
  NOT a polygon failure (probed: DTW TRACON covers to ~40nm NW, he was inside at 30nm). ROOT CAUSE: the
  active-radio FLOOR in recommendFreq (index.html ~6987) — floorI = furthest pref-index covering position
  matching your active freq, loop starts there so the rec "only moves forward." Airborne pref is
  ['TWR','APP','CTR','FSS'] (ascending tier), so on CLIMB forward=higher index (correct: don't fall back
  to Tower). But on ARRIVAL you descend Center→Approach→Tower = DECREASING index, and the floor pinned
  floorI at CTR, skipping APP entirely. FIX: apply the floor only when `onGround || isDepField` (ground
  taxi + climb-out); on the airborne arrival descent (!onGround && arr is field of interest) floorI stays
  0 so top-down naturally picks Approach when in its TRACON, Tower when near+low. Departure floor fixes
  (stuck-on-Delivery-after-pushback, stuck-on-Tower-at-3700ft) preserved (isDepField=true on climb).
  test_vatsim_depapp.js: TDD'd — new arrival-descent case FAILED on old code (ZMA_CTR), PASSES after
  (MCO_APP); 23/23. Full board 15 green, ATC matrix (which exercises the dep floor) still clean.
- **✅ FIXED v6.13.17 (2026-07-20) — Live ATC arrival: false "offline" + ATIS hogging next-up.** Dean
  inbound KDTW on Cleveland Center while DTW_F1_APP(126.225)+DTW_E_DEP(132.025) online: (1) panel said
  "KDTW's TWR/APP are offline" — false; they were online, just not covering him yet. recommendFreq why
  now "aren't/isn't covering you here" (the walked top-down branch). (2) "Later" showed KDTW_ATIS as the
  next-up; latcNextUp now SKIPS atis-kind entries → points at the next controller (Approach); a dark
  arrival falls through to CTAF/UNICOM (ATIS not lost). (3) NEW arrival-ATIS FOOTNOTE (atisNote payload
  + overlay.html .atisnote element + in-app card arrAtisNote) shown airborne when the arr field is the
  field of interest — low-key, not the lead. ("Two Approach" = DTW_E_DEP mislabel, already fixed
  v6.13.14 — ships together.) test_vatsim_depapp.js +4 next-up cases (21/21); full board 15 green, matrix
  clean. Awaiting release.bat + live re-verify.
- **✅ FIXED v6.13.15 (2026-07-20) — handoff overlay alert lingered too briefly.** Dean saw the "~3 min
  from Chicago Center" handoff toast but it "went away too quickly." Cause: latcCheckToasts fired the
  handoff toast (index.html:7266) with NO ms arg → overlay.html default 14s (overlay.html:147), and it
  only fires ONCE per handoff (_handoffKey guard). Bumped to 30000ms. The dot keeps pulsing (unread)
  after collapse, so a missed alert stays flagged. Not desk-testable (overlay = DOM/IPC); Dean verifies
  live. POSSIBLE FOLLOW-UP if 30s still gets missed: a second, closer-in reminder (~2 min / ≤10nm).
- **✅ FIXED v6.13.14 (2026-07-20) — LIVE-ATC DEPARTURE vs APPROACH.** Added latcTermRole (callsign
  last-segment _DEP/_APP) + latcPosLabel; fieldPos takes a per-leg termRole (dep→DEP, arr→APP, fall
  back to the other if only it's online); recommendFreq's APP pick prefers the role matching isDepField;
  all label render sites (rec, next-up, brief chips, also-list, others, verify — overlay + card) use
  latcPosLabel so a _DEP reads "Departure". NEW test_vatsim_depapp.js 17/17 (helpers + real-polygon
  KMIA-dep→MIA_DEP / KMCO-arr→MCO_APP / lone-_APP fallback); full board 15 suites green incl. the 45k
  ATC matrix still clean. Awaiting release.bat + Dean live re-verify at a field with split DEP/APP.
  Original report:
- **🐛 LIVE-ATC: DEPARTURE vs APPROACH not distinguished — recommends _APP when departing (Dean
  2026-07-20, live at KORD).** On a KORD departure with BOTH CHI_B_DEP 128.575 AND CHI_Z_APP 119.000
  online, the overlay's "Next up" said CHI_Z_APP (Approach) — should have been CHI_B_DEP (Departure).
  ROOT CAUSE (verified in code): VATSIM gives DEP and APP the SAME facility code (5), and
  `LATC_TIER={…5:'APP'…}` (index.html:6574) collapses both into one 'APP' tier — ABRP has NO concept
  of Departure; latcTierLabel even labels _DEP as "Approach". So with both online it just picks one
  (grabbed the _APP). FIX: disambiguate by CALLSIGN SUFFIX (_DEP vs _APP), not facility code — on the
  DEPARTURE leg/climbout prefer a `_DEP` controller for the terminal handoff (fall back to _APP); on
  ARRIVAL prefer `_APP` (fall back to _DEP); only-one-online works both (top-down, unchanged). Threads
  through: fieldPos (6639 dep vs 6640 arr — pass a preferred-suffix per leg), recommendFreq terminal
  pick (~6899 APP tier), latcFreqStack dep vs arr sequence (~6771), latcNextUp (~7081); + a label
  helper so a _DEP position reads "Departure" not "Approach". TEST (VATSIM desk suite): dep field w/
  both _DEP+_APP online → dep sequence + next-up pick _DEP; arr field w/ both → pick _APP; only _APP
  online → both legs use it. Renderer-only. See [[work-discipline-validate-before-ship]].
- **✅ v6.13.11 — frametime chart: per-series toggle chips + VRAM line + busiest-core line (Dean
  2026-07-18, awaiting release.bat).** Every charted line got a clickable chip (show/hide, persisted
  in localStorage 'cfxSeriesHidden'); NEW VRAM(MB, every flight, from telemetry) + busiest-core %
  (AutoFPS flights, from the trace's new v2 6th field = AutoFPS log's `Dom:NN%(#N)` — the bottleneck
  core, since overall sys_cpu spreads across cores and reads idle). autofps_log LINE_RE captures Dom;
  writeSidecar bumped v:1→v:2 (6-field tuple [t,tlod,olod,agl,vram,dom]); backfill regenerates v1→v2
  traces when the AutoFPS log survives (REPORT_V 'vram-cpu-lines' → one-time report regen). Both new
  lines DEFAULT HIDDEN. chartVramSeries/chartDomSeries in report_charts. 26/26 test_chart_lines +
  real-data smoke (LBPD-LFMD: 847/847 samples carry Dom, busiest-core to 81% while overall CPU ~30%,
  VRAM peak 11790 matches summary). Dean picked "busiest-core (Dom)" over per-frame MsCPUBusy.
- **✅ AutoFPS FEEDBACK — REPORTED + ANSWERED by ResetXPDR (AVSIM, 2026-07-18/19). Both points are
  now settled by the author; do NOT re-raise.** Dean posted the LBPD-LFMD recap + log; Reset replied:
  (1) VRAM hunting — REFUTED our mechanism with a log breakdown (fuller reply, AVSIM pg 294). At 96%
  AutoFPS only HOLDS (caps TLOD at current, but FPS<target can still lower it); it only REDUCES at 98%.
  Of the 35 LTD hits: **32 were Holds, only 3 were Reduces.** Tracing the 3 reduces in Dean's log, the
  TLOD drop caused SPECIFICALLY by VRAM Reduce was just 20 / 60 / 100 (two of three had FPS already
  below target, so TLOD was falling anyway); **every other TLOD reduction in the flight was FPS-driven.**
  So our "the VRAM limiter is hunting against the wall = the cause of the cruise sawtooth" framing was
  OVERSTATED — we read 35 LTD flags as 35 reductions when 32 were benign holds. Reset's real diagnosis:
  the cruise TLOD swings were **periodic scenery streaming overloading the CPU (not GPU) → FPS under
  target → FPS-driven TLOD cuts** — i.e. episodic CPU load via the FPS mechanism, NOT the VRAM guard.
  Fix = lower TLOD Max (Dean already did, 600→500). LESSON: don't equate an LTD/VRAM-limited sample
  count with reductions — most are holds (matters for how we word the envelope card's "% VRAM-limited"
  below). Reset is STILL making two changes FROM Dean's report: (a) replace the vague **LTD** log/UI
  term with **HLD** / **RED** (hold vs reduce) so state is legible; (b) TEMPER reduction size, possibly
  NON-LINEARLY, to cut overshoot (Dean's "drops deep into the 300s" observation). (2) CPU-driven TLOD
  drop — Reset REFUTED our "own-goal" read: he found our exact log example, noted it was preceded by a
  burst of (non-periodic but FPS-reducing) frametime spikes, and the ~⅓ TLOD cut stopped the frametime
  rot immediately + recovered to a lower sustainable TLOD → app responded appropriately. TLOD
  reductions DO alleviate CPU-driven drops too (his VR experience; most common on the ground at complex
  airports). So point (2) is closed as correct-behavior, not a bug. Standing ask from Reset: if a REAL
  periodic-spike episode hits a future flight, drop that log on his GitHub with a one-liner so he can
  confirm the recovery fix holds. See [[reset_report_style]].
  ✅ STANDING ASK FULFILLED (AVSIM pg 294, ~2026-07-20): Dean posted a KASE→KSEA Citation flight
  (TMax 700, offline) where periodic-spike detection fired FOR REAL at normal settings — ABRP's own
  full-flight periodicity pass independently confirmed 5 episodes @ 0.98–1.02s cadence, std 0.00–0.04s.
  Reset acknowledged (comment 5798345): "I received your log on github… will respond on github."
  ⏳ AWAITING Reset's GitHub reply on a NEW bug the flight exposed: **SRed accumulates then never
  releases in level cruise** — SRed built to 384 during the VRAM-overflow climb (Vred @98–99%), then
  froze; TLOD pinned at 316 (700−384) for ~80 min of cruise despite VRAM back to 74–78% + GPU ~44%
  (ample headroom). Open questions Dean raised for Reset: is recovery VS-scaled (so VS≈0 cruise → ~0
  recovery)? and should spike accumulation be suppressed while VRAM limiting is active (both limiters
  reacted to the same overflow; the VRAM one released, the spike one didn't). Watch GitHub for his fix.
- **AutoFPS envelope card — real example ready (parked feature, roadmap v6.11.0 §6):** the LBPD-LFMD
  flight is a textbook "you spent 39% of airborne time VRAM-limited at Max TLOD 600 — try 500" case
  for the parked envelope-recommendation card. Build when Dean wants it.
- **🔍 FULL VATSIM/OVERLAY AUDIT (Fable, 2026-07-16) — CLOSED items shipped as v6.12.8 (8e2f51c),
  OPEN items below.** Method: Dean's copy/paste audit prompt → 45,056-cell ATC combination matrix
  (KMIA→KMCO + LGAV→LGKR, invariants I1–I10 over real polygons), alert poll-sequence stress A1–A8,
  overlay O1–O7, VATSIM surface V1–V8 + probes.
  ⚠ **THE SCRATCHPAD WAS WIPED the same night — the ENTIRE ~57-file regression board is GONE**
  (test_vscore/test_recommend/test_tracon/test_vatglasses/test_briefing/test_handoff/test_polygon/
  test_autofps_trace/test_lab/… built up over weeks), along with the audit harnesses. Confirmed
  absent from every session dir under the claude temp tree. The audit RESULTS stand (they were run
  and reported), but nothing below can be re-run today, and future VATSIM/perf changes currently
  ship with NO regression net. LESSON: the session scratchpad is temp, not storage — an earlier note
  promising "re-runnable harnesses" there was wrong.
  🔶 OPEN DECISION (Dean): house tests in the repo (e.g. `tests/`, excluded from the installer via
  build.files `!tests/**`) so they survive. This reverses the standing "tests go in the scratchpad,
  never the repo" rule — a rule this loss disproved. Tonight's audit harnesses are reconstructable
  from the session transcript; the older ~57 are not, and would need rebuilding as they're needed.
  ✅ CLOSED (v6.12.8): (1) airspaceCovers now merges '-SUFFIX' segments for MAPPED prefixes — NY_CTR
  read "outside" over Pennsylvania (KZNY-W invisible behind NY→KZNY); BIRD/OBBB/GULF/VABB provably
  lost real area too; feeds rec + briefing + route score + handoffs. (2) Boundary-graze chime storm —
  the instant alert path (found-flip) now also requires the ONLINE SET to have changed; proven 10
  chimes in 10 polls at the MCO TRACON edge before, 0 after; real sign-on/sign-off still instant.
  (3) Uncontrolled fallback tier honest (UNICOM vs CTAF) + latcNextUp gates on !found — dark dep
  field w/ staffed arrival now shows "Later: <arr ATC>"; CTAF aid can't offer the freq you're on.
  (4) Toast-created overlay with Live OFF self-closes (_overlayWanted in main.js) — no lingering
  grey dot after an offline-capture "logging started" toast.
  🔶 OPEN — release + live verify: [RUN] release.bat (v6.12.8; installed app several versions
  behind). [LIVE-VERIFY next VATSIM flights] no boundary chime spam; segment fix claims a Center on
  a US NE leg; "Later: …" at a dark dep gate; no stray dot after an offline capture.
  🔶 OPEN — suspected, low, fix only if observed / when touching these files: (a) cursor resting
  motionless in the panel rect through the 20s auto-collapse leaves the overlay clickable until the
  next mousemove (one eaten sim click, self-heals); (b) overlay_pos restore guard protects the
  window's LEFT 80px but the dot is RIGHT-anchored — a monitor-width shrink within ~280px can
  restore the dot off-screen (workaround: delete overlay_pos.json); (c) nits: handoff-toast sub is
  esc()'d then textContent-rendered (double-encode on pathological callsigns) + header "N
  controllers online" count doesn't exclude 199.998 placeholders.
  ✅ VERIFIED CLEAN for the record (don't re-audit): all matrix invariants (never an offline freq,
  never UNICOM while covered, monotonic, deterministic, 0 throws incl. edge battery), alerts
  A2-A4/A6-A8, vscore bounds + 1st/2nd-order removal monotonicity + end-to-end badge, observer-CID,
  VATSIM-ATIS non-expiry, radio write click-gated only, tracon null-vs-false, atomic airspace cache,
  overlay unread/audio/escaping/perf-strip, wild callsigns, 8.33 tol, dup-freq non-regression;
  recommendFreq 0.105ms @ 90 controllers (runs 4×/5s poll — measured harmless, no memo needed).
- **AutoFPS PERIODIC-SPIKE INTEGRATION IDEAS (from the AVSIM thread review 2026-07-14, pages 289-292;
  ResetXPDR's 0.5.2.0-test builds — Dean is on test14):** AutoFPS now reads the RTSS frametime buffer
  (last 1024 frames) and detects PERIODIC spike sequences = the MSFS graphics-engine-overload
  signature (spikes repeating at 0.7–1.8s cadence with tiny interval σ; confirmed by a 2s TLOD-pause
  "own-goal" verification so its own TLOD ramps don't self-trigger; Prot then reduces TLOD at 4× the
  sensitivity step until spiking stops; recovery only ≥1.5nm away + above Alt TLOD Base + level/
  climbing). Log+ lines: `ServiceController:DetectPeriodic` carries Total/Periodic Spikes,
  AvgInterval+StdDev, SteadyAvg/Std, SpikeFreeAvg/Std, SpikeAvg/Std, Detected; `LODController:RunTick`
  carries the verification + "Automatic periodic spike TLOD reduction activated"; UpdateVariables
  gains `SRed:NNN` (spike TLOD reduction) + trailing `LTD` (limited) — **ABRP's LINE_RE verified OK
  against all new formats 2026-07-14**. Integration candidates (none built):
  1. **✅ Periodicity classifier BUILT 2026-07-14 as v6.12.1** (perf/native/periodicity.js: 10s-chunk
     local median baselines, 1.8× relative spikes coalesced <0.35s, periodic runs = ≥4 spikes at
     0.7–1.8s cadence w/ interval std ≤ max(0.16s, 10%); engine.js writes smoothness.periodic_stutter
     on new flights; backfill (REPORT_V 'periodic-stutter') classified all 33 real flights into
     sidecars + regenerated all reports w/ the verdict line — significance gate: red call-out only at
     ≥6-spike worst episode or ≥8 periodic total, brief runs = "too short to call", ≥5 one-off spikes
     = explicit "aperiodic — TLOD would not have helped"; perf-compare-data emits periodic_episodes/
     periodic_spikes; SKILL.md documented. 18/18 desk tests + 8 regression suites green; raw-file
     hash guardrail proven. REAL FINDINGS: Fenix EGLL 06-13/06-14 (pre-rBAR-fix) = textbook positives
     (354/659 periodic spikes @~1.2s — the exact AVSIM kevinfirth signature); same route post-fix
     06-15 = aperiodic; KLAS arr-taxi = aperiodic (confirms the CPU-streaming diagnosis); EGGD-EHAM
     07-07 (the pre-reboot rough flight) = 19 spikes @1.03s at 63min.)
  2. **Parse DetectPeriodic/SRed events from AutoFPS Log+ into the trace sidecar** → chart marker +
     envelope-card note "AutoFPS spike protection capped TLOD at X this flight" (same infra as
     autofps_trace.json backfill).
  3. **ExitAppAfterFlightSession config key (test10) + IFR/VFR command-line args** → feeds the parked
     launch-time-AutoFPS-envelope item: ABRP could fully own the AutoFPS lifecycle per flight.
  KNOWN GAP (deliberately NOT built, Dean 2026-07-16): gfx_watch.readAutofpsCfg captures only
  {min,max,target}; **Sens (FpsTolerance) is not captured** and the A/B AutoFPS-lane fingerprint keys
  only on min-max (target isn't fingerprinted either). So a Sens or target change passes silently —
  no card. Cost to fix is ~3 lines; DECLINED because the gain was zero at the time: only 1 flight has
  an autofps_cfg snapshot (v6.12.0 onward) so the "before" side could never reach n=2, AND Reset's
  VS-trend update landed simultaneously with Dean's Sens 3→5 change, confounding any verdict. Build
  only if Dean ever wants to deliberately A/B AutoFPS tuning with the AutoFPS version held constant.
  REVIEWED Test14-18 (2026-07-14): nothing further applicable to ABRP. Test15 skip-1 = ADOPTED
  (v6.12.2); Test15's 0.3s floor = deliberate divergence (we keep 0.7-1.8s for the ~1Hz signature
  Dean feels; his data sits at 0.9-1.35s). Test16 (MSFS-must-be-active before TLOD reduction) = his
  fix for the alt-tab false-positive — a LIVE-CONTROL gate, N/A to our retroactive analysis. Test17
  early-exit = live-loop perf shortcut, N/A offline; rest = RTSS-read mechanics / UI / build. Don't
  re-review below Test18 unless a note mentions frametime SCORING, not RTSS plumbing.
  Cautions from the thread: detection targets a NARROW signature (kevinfirth's "tabletop" sustained
  frametime problems are NOT detected — by design); false-positive on window-switching during
  preflight reported (ankh21, unresolved) — TLOD floored + stuck on ground; on strong rigs it only
  triggers at TLOD ~1000 (VRAM exhausts first on Dean's 12GB — his VRAM limiter at 96/98% fires long
  before engine overload), so for Dean Prot = insurance for Fenix-at-heavy-payware cases.
- **LIVE-ATC + REPORT FIXES BUNDLE — ✅ BUILT + SHIPPED v6.10.8 (2026-07-12, commit 5850025; awaiting
  Dean release.bat). Regression board GREEN: 146 assertions / 10 suites, 0 fail (new test_liveatc_fixes.js
  22/22 + parser 31 + recommendation 53 + polygon 40). (Dean's KBOS→CYYZ VATSIM flight 2026-07-12 — 5 bugs
  caught live; a low-ATC-coverage flight in the dense US northeast surfaced these; #3/#4/#5
  share one root theme = make the recommendation POSITION-AWARE relative to the flight's own dep/arr,
  not "what's online near/on route"):**
  1. **AutoFPS report labeling** — tagging CONFIRMED working live (capture log `CONTEXT: vatsim +
     AutoFPS`; MSFS_AutoFPS.exe → capture.js `low.includes('autofps')`). Gap is report-side: an
     autofps_active flight's logged `tlod` is only the LAUNCH value (AutoFPS drove it dynamically), so
     the per-flight report + dashboard should show TLOD as "dynamic (AutoFPS)" + badge the flight,
     not a misleading static number. (Baseline quarantine already correct.) Check if the report even
     surfaces autofps_active today (suspect only Compare does).
  2. **Runway turn-off misparse** — `extractRunways` (index.html ~5955): the `DEP` cue from "DEPTG
     RWY 9" sits within the 30-char proximity window of "RWY 33R", so 33R (only "APPROVED FOR TURN OFF
     AFTER LDG") gets grabbed as a 2nd departure runway. FIX: skip a runway token if the ~25 chars
     AFTER it contain TURN\s?OFF / EXIT / CLSD / CLOSED. Test: KBOS Info Z → dep[9], arr[4R,4L], 33R
     excluded. Applies to real D-ATIS + VATSIM ATIS (same parser).
  3. **"may cover you top-down — verify" false positive** — recommendFreq (~6536) processes
     controllers[] only (NOT atis[], so it's not KBOS_ATIS). The `verify` list = ALL unplaceable
     controllers network-wide, so a DISTANT unlocatable CTR/FSS (SLC/DEN/ATL online, nowhere near
     Boston) triggers "N ATC may cover you — verify" at KBOS. Same noise on the enroute-UNICOM text
     ("2 ATC we can't place… precise airspace comes in a later update" — dev-ish, odd). FIX: only
     surface a position in the "may cover you" hint if we can at least roughly locate it AND it's
     within a plausible top-down range of the field; a position we can't locate at all makes no
     coverage claim. Clean uncontrolled wording ("No ATC in your area — UNICOM 122.800"). Most nuanced.
  4. **CTAF field selection + alert spam** — nearField = onGround || nearDist≤20nm (LATC_NEARFIELD_NM),
     NO altitude gate + nearest-of-ALL-airports. In the dense northeast you're always within 20nm of
     SOME field, so it never releases to enroute UNICOM and flaps between nearest-field CTAFs (KBOS→
     KLWM→…), and the overlay auto-expands/chimes on every change = spam. Dean's spec (better than my
     AGL-only idea): **CTAF only at your DEP/ARR airports.** FIX: field-of-interest = nearest of
     {dep,arr} from filed/SimBrief route (not nearest-any-field); CTAF only when near+low at THAT field
     (≤~10nm && agl<~4000 || onGround); else UNICOM. No route known → nearest + the AGL gate as
     backstop. PLUS overlay re-alert hysteresis (change must hold ≥2 polls before it re-expands/chimes).
     Also confirmed CORRECT behavior: Canada (CYTZ/CYYZ) → 122.800 UNICOM not CTAF (US K/P + AU Y only
     get field CTAF — Dean's own LGKR rule; working as designed).
  5. **ATIS-first scoping** — confirmed w/ live feed (KBOS_ATIS online 135.000, CYYZ_ATIS offline): the
     ATIS-first banner grabbed the only online ATIS on the route (KBOS, departure) and showed it AFTER
     landing at CYYZ. FIX: dep ATIS only when at/near departure; arr ATIS only when approaching/at
     arrival; NEVER the far field's ATIS. Same position-vs-endpoints foundation as #4.
  All index.html-only except #1 (also report_html.js/report_combined.js). Desk-test each (#3 hardest);
  ship as one live-ATC+report cleanup pass on Dean's next release.bat. See [[work-discipline-validate-before-ship]].
- **Smoothness / "Granite" Score badge (from the 2026-07-12 AutoFPS-intelligence chat review, LOW /
  UX-polish):** a single glanceable per-flight grade composited from metrics ABRP ALREADY computes —
  frametime stability (~45%), 1% low / consistency (~25%), spike + felt-stutter penalty (~20%),
  headroom/VRAM margin (~10%) — mapped to 🟢 Granite / 🟡 Minor stutters / 🔴 Unstable. Pure math on
  existing summary.json fields (NO capture change); surface on the per-flight report + dashboard.
  Honesty rule: keep the component metrics visible — don't hide behind a black-box number. One of two
  keepers salvaged from Dean's late-night "intelligent auto-tuner" concept chat; the rest of that
  concept (frametime-first scoring, CPU/GPU/VRAM bottleneck ID, phase split, segmented baselines,
  learned per-aircraft profiles) ABRP ALREADY implements — the chat independently re-derived ABRP.
- **Launch-time AutoFPS envelope (from the 2026-07-12 AutoFPS-intelligence chat review):** the one
  salvageable piece of the "ABRP drives the auto-tuner" idea. PROVEN 2026-07-12 by live test: AutoFPS
  (MIT-licensed C#/WPF by ResetXPDR; config at %APPDATA%\MSFS_AutoFPS\MSFS2024_AutoFPS.config, keys
  minTLod/maxTLod/targetFps*/etc.) reads its config ONLY at startup — a mid-flight file edit is
  ignored (tested: maxTLod 240→180 in the file, GUI stayed 240, no log reaction), and it exposes no
  live API/IPC. The TLOD envelope is live-mutable ONLY via AutoFPS's own GUI slider, so hands-free
  REAL-TIME control would require fragile UI-automation of its window (rejected). BUT since config IS
  read at boot, ABRP can — at Launch+Capture, BEFORE it starts AutoFPS — write the right min/max TLOD
  (+ Fixed target FPS) into the AutoFPS profile the flight will use, chosen PER-AIRCRAFT from ABRP's
  own baseline data (e.g. PMDG min125/max200, Fenix 125/220, GA 100/300). AutoFPS then boots with
  ABRP's data-derived envelope. Non-fragile (touches a text file at startup only — no memory hacking,
  no live coupling). NOT mid-flight adaptive. Needs: ABRP owns/sequences the AutoFPS launch + a
  per-aircraft→AutoFPS-profile mapping (IFR/VFR/User1-4). REJECTED alternatives (all dead-ended same
  session, keep for the record): (a) real-time config or UI feed — config not live-read, UI-automation
  too fragile + still FPS-targeted not smoothness-targeted; (b) forking AutoFPS to retarget its LOD
  loop to frametime SMOOTHNESS — MIT allows it and the source is all there (LODController.cs is the
  loop, MemoryManager.cs the writer), but a fork inherits the reverse-engineered memory-offset
  treadmill in C#, re-derived every SU, diverging from upstream + a Microsoft-ToS gray area — NOT worth
  it; the leverage move if the real-time smoothness dream is wanted is a FEATURE REQUEST to ResetXPDR
  for a "frametime-consistency target mode" (he already maintains the offsets). See [[optimize-code-and-data]].
- **SPIM→SPJC ICAO-recode alias (found by the 2026-07-11 vscore real-data harness, LOW priority):**
  Lima Jorge Chávez recoded SPIM→SPJC in 2020; OurAirports (→ airport_db.json) still keys it SPIM,
  so SPJC routes get the "…" VATSIM pill and a live SPJC_W_TWR can't be attributed. Impact today:
  1 registry route + the odd Peru event. Fix when touched: a tiny ICAO alias map (SPJC→SPIM) in
  latcAirportForCallsign/the DB loader. Other missing ICAOs (RJTI heliport, CYFI, KJKA, MHPR, UZTT)
  are legitimately below the medium+large DB cut — expected, not fixable without bloating the DB.
- **vscore real-data harness = scratchpad/test_vscore_real.js (2026-07-11, 12/12 vs the LIVE
  network):** invariants (bounds/badge/components/enum+callsign), direction-consistency,
  monotonicity (64 controller-removals never raised a score), live TWR ground truth, geometry edges
  (dateline/sample-cap/southern-hemisphere/dep==arr), callsign audit (96% field positions + 23/23
  APPs placeable), perf 0.7ms/pair, no-ghost-credit audit. Re-run after any scoring change — it
  fetches the live feed, so results vary with network activity (assertions are activity-independent).
- **✅ BASELINE COMPLETE — 24/24 (Dean 2026-07-08).** The last cell (PMDG @ TLOD 175, KCVG-KATL) is in.
  Settings Lab now unlocks; R4 version tools have real data. Baseline recommendation is on solid data.
- **VATSIM overlay chime = aviation "seatbelt bong" (Dean 2026-07-08) — DONE** in overlay.html (C6→G#5
  bing-bong via WebAudio, replacing the generic beep). Keep the aviation theme for any future cues.
- **✅ TAIL-TRIM FIXED (2026-07-08, 7ad02f2 Part A + c893e6c Part B) — movement-agnostic + retroactive.**
  Part A: phases.js `flightEndIndex`/`trimTeardownTail` detect the shutdown teardown burst directly from
  frametimes (trailing >200ms run in the last 120s that never recovers to a sustained normal run) — no
  reliance on parking brake / full stop / on-ground, so a mid-taxi quit is cut correctly; engine.js
  capture path uses it (replaces the movement-based stopTrimS). Part B: backfill_phases.js re-trims
  EVERY logged flight into the phases_ext.json sidecar (trim_v:'teardown': corrected max_ft_ms/
  spike_count/perceptible_count + re-trimmed taxi phases) + regenerates report.html from the trimmed
  data; main.js perf-compare-data prefers the corrected sidecar values; SKILL updated. Raw logs
  byte-untouched. Real KCVG-KATL: headline max 376.59ms → 219.55ms (the 219.55 is a genuine in-flight
  hitch, correctly kept). 9/9 (A) + 16/16 (B) desk-tests. ⚠ UNRELEASED — on main with the VATSIM WIP;
  ships with the v6.6.0 monolith (or pull into its own release if Dean wants the trim fix out sooner).
  Original note kept for history:
- **Tail-trim under-cut — fresh clean example (Dean 2026-07-08):** the 24/24 flight (PMDG175 KCVG-KATL)
  shows max 376ms — but ALL 6 frames >150ms sit at 96-100% of the flight (377ms@99.8%, plus 893ms &
  1259ms @100% = sim shutdown/menu teardown while sitting at the gate); stop_trim_s was only 5s. P99
  19.65 / stutter 0.06% are pristine — purely cosmetic max/spike inflation. Confirms the 8b trim-
  hardening plan (mark flight-end from on-ground/engines-off, or drop >200ms in the last 60s like the
  CapFrameX export already does). Now that baseline is done + native engine owns capture, this is doable.
- **✅ vPilot detection → auto-enable VATSIM Live mode (Dean 2026-07-08) — BUILT (unreleased, ships with
  v6.6.0 monolith).** index.html: cfg.vatsim.autoStartVpilot (default off) + a VATSIM-settings toggle
  "Auto-start Live mode when vPilot is running"; isVpilotRunning/vpilotWatch/startVpilotWatch/
  stopVpilotWatch/vSetAutoVpilot reuse the Companion-Apps listRunningApps detection on a 20s poll (only
  while enabled). EDGE-TRIGGERED: starts Live ATC when vPilot launches, stops the watcher's own session
  when vPilot closes; a MANUAL Live-on (latcToggle(on) w/o the auto flag → _vpilotAutoOn=false) is never
  fought. 19/19 desk-test (full Function-parse + 8 state-machine transitions + process-name matching).
  ⚠ Live behavior verifies with Dean running vPilot (feeds the still-live-unverified VATSIM V1 path). No
  version bump. Follow-up idea if wanted: an in-sim overlay toast when it auto-starts.
- **✅ Drag-and-drop reorder of the LEFT NAV menu items (Dean 2026-07-08) — BUILT (unreleased, ships
  with v6.6.0 monolith).** index.html: applyNavOrder/initNavDnd/_navSaveOrder/_navAfterEl — HTML5 drag
  on the .sb-item nav entries, order persisted in cfg.navOrder, restored on load; a tab NOT in the saved
  order (future new tab) falls to the bottom automatically; sw()/panes key off data-tab so DOM reorder
  is safe. 12/12 desk-test (full-script Function-parse + reorder-algorithm cases incl. new/removed tabs
  + insertion-point math). ⚠ NOT bench-tested for live drag feel (needs Electron preload to boot) —
  Dean confirms on launch. No version bump (frozen at 6.5.0 until the v6.6.0 finalize).
- **✅ Fresh-user configurability audit (Dean 2026-07-08) — DONE (unreleased, ships with v6.6.0).** Swept
  the app for setup coded to Dean. Found ONE real leak: FLIGHT_APPS_SEED pre-populated a new user's
  "apps to close during flight" list with Dean's media stack (SABnzbd/Plex/Radarr/Sonarr/Prowlarr/
  qBittorrent/Steam) — violated rule #3. FIXED: seed is now [] (new users build via "Detect running
  apps"; empty-state already guides them); Dean's install untouched (seedFlightApps only seeds when no
  saved array exists, and his config has one). 5/5 desk-test. RULED OUT (already config-driven or
  correctly shared for all users): VRAM cap (resolves config→max total_vram→12288 fallback), benchmark
  grid / fleet / scenery folder / SimBrief user (Phase 10 config-driven), Companion Apps (starts empty),
  RWY_HDGS + Challenging-Approaches (shared aviation reference/curated content, same value everyone —
  not a personal-setup leak). Original note:
- **Fresh-user configurability audit (Dean 2026-07-08).** Review functions still coded to Dean's setup
  that a new user couldn't easily change, and make them configurable/guided. KLAS wrapper handling is
  already GENERAL (v6.3.14 — any wrapper addon); My Fleet is config-driven; benchmark grid is
  config-driven (Phase 10). Remaining candidates to audit: hardcoded Companion/close-apps seed list,
  any Dean-specific paths/assumptions, the Challenging-Approaches curated list, RWY_HDGS coverage, and
  anything in the setup wizard that assumes his hardware. Tie into Phase 10 new-user + the portability
  audit ([[powershell_51_not_7]]).
- **✅ REFRAMED → its own plan section above (SAME-ICAO MULTI-FOLDER SCENERY ACTIVATION).** Was
  logged as a "same-ICAO conflict warning"; Dean clarified 2026-07-08 he wants activation to actually
  link BOTH folders (KLAS is his only two-folder airport), not just warn.

- **❌ BOOKMARKDROP — NOT FEASIBLE as a bookmarklet (Dean verified 2026-07-07, SHELVED).** SI's
  `p2_session_id` cookie (p2.sayintentions.ai) is **HttpOnly: true** (Dean's DevTools screenshot),
  so JavaScript / any bookmarklet CANNOT read it via document.cookie — dead on arrival. The GOAL
  (kill the manual DevTools copy) IS achievable two ways if ever revisited: (A) BEST = in-app SI
  login via an embedded Electron BrowserWindow → read p2_session_id from ABRP's OWN session
  (session.cookies.get — HttpOnly is no barrier to the owning browser), persistent partition enables
  near-automatic monthly renewal, browser-independent; (B) Firefox-only = read cookies.sqlite
  directly (Firefox stores cookie values UNENCRYPTED; Dean is on Firefox) — but breaks on Chrome/Edge
  (App-Bound Encryption) so not shareable. Dean 2026-07-07 chose to SHELVE and keep the manual
  DevTools copy-paste (works fine, cookie lasts ~a month). Cookie flow for reference: raw value →
  config.siCookie via saveSICookie() (index.html:1912) → sent as `Cookie: p2_session_id=<val>` to
  p2.sayintentions.ai (main.js:526); validate a fresh cookie by reusing siFetchPage({page:1,cookie}).

- **Clear-standby-memory pre-capture — MEASURE, don't build (Dean 2026-07-07, low priority).** The
  reboot that smoothed his EGGD-EHAM flight freed ~6GB, but on his 64GB rig RAM was never the limit;
  the real reboot wins were background-CPU contention + clean VRAM state (neither fixed by a standby
  purge). So a standby-list clear is the weakest third of a reboot for HIM. If curious: A/B a couple
  PMDG-175 flights with a pre-launch standby purge vs without, judge past the noise band, only build
  if it proves out. Closing background apps (Companion Apps list) hits his real bottleneck better.

## 📻 LIVE VATSIM FREQUENCY HELPER — POLISHED BUILD PLAN (Fable review 2026-07-08; supersedes the raw
## spec below, which is KEPT as the reference for V2/V3 detail)

### Context
Dean flies VATSIM observation with vPilot and fumbles which frequency to be on (live ATC vs CTAF vs
122.800 unicom). ABRP will watch his live position, watch who's online on VATSIM, apply VATSIM's
top-down ownership rules, and say "you should be on LON_CTR 127.100" — with one click to load it into
the COM1 STANDBY (never active; vPilot transmits only when Dean swaps). Differentiated: vPilot shows a
raw list; ABRP curates THE right frequency now.

### Review verdict on the original spec (below): logic right, delivery wrong
Kept: top-down substitution as the core (never "nearest controller"); CTAF = the FIELD's tower freq
(Dean's correction), 122.800 only enroute; polygon upgrade path; standby-only writes; overlay idea.
Fixed in this polish: (1) it bundled five risky subsystems into one release — now staged V1/V2/V3,
each live-testable on a real VATSIM session; (2) architecture now locked (main-process SimConnect);
(3) closed the "nearest airport needs a GLOBAL airport DB" gap (AI[] has only ~54 airports); (4) made
controller→airport callsign matching concrete (LAS_TWR ≠ KLAS); (5) radio-set gotcha: use
COM_STBY_RADIO_SET_HZ (plain Hz, 8.33-kHz-safe) not the BCD event; (6) datafeed hygiene (observers,
placeholder freqs, missing visual_range, clean stop).

### Locked architecture (all stages)
- **Live loop = MAIN process**, a SECOND named SimConnect client "ABRP-LiveATC" via node-simconnect
  (pattern proven by scratchpad/where_am_i.js). Safe alongside vPilot AND the capture engine — the sim
  serves many clients; this never touches the capture engine's connection or PresentMon. Reads at ~1 Hz:
  PLANE LATITUDE/LONGITUDE, PLANE ALTITUDE, PLANE ALT ABOVE GROUND, SIM ON GROUND, GROUND VELOCITY.
  Main caches the latest sample; renderer polls it via IPC `live-position` every ~5 s while live mode is
  on. Lifecycle: user toggles Live mode ON → connect (retry every 60 s if sim absent, status shown);
  sim quits or app quits → loop stops + status OFF. Off by default; zero overhead when off.
- **VATSIM datafeed** (https://data.vatsim.net/v3/vatsim-data.json, CORS-open) fetched DIRECTLY by the
  renderer (same as aviationweather.gov) every 30 s while live mode is on. Controller hygiene: drop
  facility===0 (observers) and frequency 199.998 (placeholder); coverage radius = visual_range, with
  per-tier defaults when 0/missing (CTR 400 nm, APP 150, TWR 50, GND 20, DEL 10).
- **Global airport DB (new, closes the gap):** slim OurAirports-derived JSON in USER_DATA —
  medium+large airports: {icao, lat, lon, twr_freq (from frequencies.csv TWR/CTAF rows)}. Downloaded
  once via the downloadCommunityRoutes() pattern (index.html:6298) from OurAirports' public CSVs,
  parsed+slimmed in ABRP; Settings button to refresh. Used for nearest-airport, CTAF lookup, and
  controller-distance sanity. AI[]/gcDist reused where they already serve.
- **Recommendation engine = renderer, pure function** `recommendFreq(pos, controllers, airportDB)` →
  {freq, callsign, label, why, tier} — pure so it desk-tests exhaustively without a sim.

### The top-down algorithm (V1, concrete)
1. Phase from position: onGround → GROUND; else AGL<3000 ft AND within 12 nm of dep/arr/nearest
   airport → AIRPORT ENVIRONMENT; else ENROUTE. (Tunable consts.)
2. Airport of interest: nearest DB airport on ground / in airport environment (SimBrief dep/arr as a
   tiebreaker); none when enroute.
3. Candidate controllers for that airport: callsign prefix matches the ICAO OR its US 3-letter form
   (KLAS→LAS) — plus a distance sanity check (controller lat/lon within its tier radius of the field).
   (V2 replaces this heuristic with VATSpy's official callsign→airport mapping.)
4. Top-down pick: target tier by phase (GROUND→DEL<GND<TWR; AIRPORT ENV→TWR<APP; ENROUTE→CTR). Take the
   LOWEST online tier at/above the target that covers the position (V1 coverage = distance ≤ radius);
   if none up through CTR covers you → uncontrolled: AIRPORT ENV/GROUND → CTAF = the field's tower freq
   from the DB; ENROUTE → 122.800. Always also list the runner-up controllers with distances (guidance,
   not gospel — the caveat line states coverage is approximate until V2 polygons).

### V1 — ✅ SHIPPED v6.5.0 (2026-07-08). Built as specced; ONE schema correction proven live: the VATSIM
### datafeed gives controllers NO lat/lon (only visual_range), so only field positions with airport-code
### callsigns (LAS_TWR→KLAS, EGLL_GND) can be geo-located → full top-down among DEL/GND/TWR/APP works;
### Center + TRACON-callsign positions (LON_CTR, LON_APP, NY_APP) can't be placed in V1 and go to a "verify
### which covers you" list (V2 polygons fix this — the whole point of V2). Airport DB builds from
### OurAirports (5,276 apts, spot-checked KLAS/EGLL/CYYZ/EHAM). 11/11 recommendation desk-tests. LIVE-VERIFY
### OWED (needs Dean flying VATSIM): ABRP-LiveATC SimConnect connect + position stream in the MAIN process
### (node-simconnect is asarUnpack'd + probe-loaded before, but MAIN-process load is unproven — LiveATC._open
### guards it and shows "ENGINE ERROR" if it fails) and the COM_STBY_RADIO_SET_HZ transmit loading COM1 standby.
### Original V1 spec: new "📻 Live ATC" tab: main.js live loop + IPCs (`live-atc-start/stop`,
`live-position`, `live-set-standby`); nav tab after Performance (sb-item + sw() pattern,
index.html:400/1399); panel = big current-recommendation card (freq, who, plain-English why, e.g.
"LON_CTR covers EGLL top-down — Tower is offline") + nearby-controllers list + status pill
(OFF/CONNECTING/LIVE/SIM NOT RUNNING) + [Set standby] button + settings (auto-set-standby toggle OFF by
default, poll interval). Standby write: transmitClientEvent COM_STBY_RADIO_SET_HZ (Hz; 8.33-safe),
fallback COM_STBY_RADIO_SET (BCD) — STANDBY ONLY, never active, logged. Airport-DB downloader + Settings
refresh. Version v6.5.0.
## 🛰️ VATSIM COMPANION — FULL BUILD (decision-locked, Dean Q&A 2026-07-08) — supersedes V2/V3 above
> **DELIVERY — REVISED 2026-07-08 (Dean delegated: "do what's healthiest").** Originally "one big
> monolithic v6.6.0 when the WHOLE companion is done." REVISED because a stack of tested, UNRELATED
> fixes (end-trim A+B, nav drag-reorder, vPilot→LiveATC link, fresh-user seed) piled up behind VATSIM
> work that can't be finished until Dean flies. So those FOUR shipped as an **interim v6.5.1**
> (commit d33b2af — Dean runs release.bat; Live ATC V1 rides along visible-but-opt-in). The VATSIM
> COMPANION COMPLETION (stages 4b/5/6 below) still targets **v6.6.0** as its own release. Going
> forward: tested, self-contained work can ship in interim patch releases; VATSIM stays bundled for
> v6.6.0 since its remaining stages need live flying to validate. Commit to main freely (commits don't
> trigger auto-update — only release.bat + a GitHub Release does).
> **REMAINING for v6.6.0:**
> • **Stage 4b — SimAware TRACON: ✅ DONE 2026-07-08 (commit 1684bc2).** Approach positions now placed by
>   real TRACON polygon (N90/SCT/BOS_E/NY_APP auto-resolve; V1's "verify" list shrinks). SOURCE (the V1
>   404 solved): the per-facility repo has NO single file — the combined build is a GitHub RELEASE ASSET:
>   `https://github.com/vatsimnetwork/simaware-tracon-project/releases/latest/download/TRACONBoundaries.geojson`
>   (1264 polygons; feature props id + prefix[]). main.js airspace-data downloads+parses it into
>   prefix→geometry[] (arrays — a big TRACON is split across sub-area features sharing one id), cached
>   sv:2 (older cache re-downloads). Renderer traconCovers = longest-prefix-first callsign match + point-
>   in-polygon; recommendFreq APP tier = TRACON polygon → airport circle fallback. 23/23 desk-test vs real
>   data (scratchpad/test_tracon.js). VATSpy Center polygons were already Stage 4a.
> • **Stage 4b — VATGlasses (sub-sector ownership): DEFERRED as its own focused piece.** It's the single
>   hardest + region-limited layer (per-country sector JSON w/ combination/ownership logic); the tiered
>   traconCovers/airspaceCovers seam leaves a clean slot to add it as the finest tier later (VATGlasses →
>   SimAware TRACON → VATSpy FIR → circle). Told Dean; build only if he wants all three now.
> • **Stage 5 — route briefing: ✅ DONE 2026-07-08 (commit 7aed4e0).** Pre-flight frequency stack in the
>   Live ATC tab (shows once Live mode is on, before the sim connects). Route = filed VATSIM plan by CID
>   (from _vFeed.pilots) else most-recent SimBrief (recentSimBriefRoutes). Renderer engine: gcSamples
>   (great-circle slerp) + latcBriefRoute + _latcOnline + latcFreqStack (dep field DEL→GND→TWR→APP → online
>   Centers the great-circle crosses in order via the Stage 4a/4b polygons, deduped + gap-flagged → arr
>   APP→TWR→GND) + latcRenderBrief card. Enroute = great-circle-approximate (labelled). 18/18 desk-test
>   incl. a REAL-DATA smoke (KBOS→KJFK through live VATSpy+SimAware polygons).
>   **✅ ROUTE-AWARE HANDOFF PROMPTS DONE 2026-07-08 (commit 6eff9a8).** Airborne, scan ahead along the
>   route (latcNextHandoff: first different online CTR/APP within 80 nm) → prompt once ~6 min out (or ≤30
>   nm if gs unknown) via the 'handoff' overlay toast; de-dup key fires once per upcoming controller +
>   clears on switch. 14/14 test (state machine + real-polygon terminal handoff to N90 @19nm inbound JFK).
>   **⚠ COVERAGE FINDING + FIX (from the handoff test):** airspaceCovers only tried K+prefix (KZNY) but US
>   Centers are SEGMENTED — KZNY(oceanic)/KZNY-W(domestic)/KZNY-BDA — so domestic ZNY was covered by
>   nothing. FIXED: match base + any '-SUFFIX' segments (memoized per prefix). KNOWN LIMITATION (data, not
>   fixable): VATSpy boundaries are ARTCC *display* regions with gaps at US terminal areas/coastlines
>   (JFK/LGA/EWR are in NO FIR polygon) — mitigated by design: that's exactly where the Stage 4b TRACON
>   layer covers, so terminal handoffs are CTR→APP (N90 etc.) not CTR→CTR at the field.
> • **Stage 6 — finalize (PARTIALLY DONE):** ✅ README guide written (commit 211edf0 — Live ATC section +
>   Features bullet + Common Workflow + Settings note; docs-only, no bump). ✅ Consolidated test pass on
>   main green (main.js + renderer parse; 4b 23/23; 5 18/18). No SKILL update applies (VATSIM is a live
>   tool, not a chat-analyzable dataset; msfs-flight-analysis stays perf-only). **REMAINING to cut v6.6.0:
>   the version bump (package.json + index.html ×3 + README changelog) + release.bat — HELD until Dean
>   flies a VATSIM validation flight, because the companion's core (freq picking, standby-set, overlay,
>   briefing vs a real filed plan) is live-only and shouldn't ship to a release unproven.** Optional
>   VATGlasses still deferred.
> **STATUS: VATSIM companion is FEATURE-COMPLETE + bench-proven (Stages 1-5) + documented. The only gates
> to v6.6.0 are Dean's live validation flight, then the bump + release.** Next actions are Dean's: fly
> VATSIM to validate (whenever he can) → report issues → fix + bump v6.6.0 + release. Bench alternatives
> if he wants more now: VATGlasses (3rd polygon layer) or the route-aware handoff-prompt refinement.

### Locked decisions (from 3 rounds of Q&A)
- **Dean's style = OBSERVE/MONITOR** (flies as a pilot via vPilot — has aircraft + position — but
  listens more than talks). So the product is AWARENESS-first ("what's happening + what should I be
  tuned to monitor"); radio-set = a fast way to MONITOR, opt-in, not a talk-assistant.
- **VATSIM CID = STORED** (optional Settings field, read-only). Unlocks: confirm he's connected, pull
  his FILED flight plan (route/altitude/squawk/callsign) from the datafeed `pilots[]` (matched by
  cid), connection-lost detection. All datafeed/METAR/ATIS reads are PUBLIC (no auth).
- **Every function = its own ON/OFF toggle** in a NEW "VATSIM" Settings section (Settings is crowded —
  give it its own uppercase section like the others; each overlay element + each feature independently
  toggleable). Config under `cfg.vatsim = {enabled, cid, overlay:{freqChange,newController,handoff,
  connectionLost,loggingStarted}, sound:{...per-type, default all false}, autoSetStandby:false,
  weatherButton:true, ...}`.
- **Header = compact status + quick toggle** (across all tabs): e.g. "VATSIM · LIVE · monitor LON_CTR
  127.100" with a click to enable/disable Live mode. (Capture-status badge already in the header;
  overlay mirrors "logging started" in-sim so he doesn't alt-tab.)
- **MSFS = borderless/windowed** → overlay works. Overlay = a SECOND transparent, frameless,
  alwaysOnTop, skipTaskbar, setIgnoreMouseEvents(click-through) BrowserWindow, TOP-RIGHT, ~5–10s fade.
  Hidden in exclusive fullscreen (documented). Content = toggleable toasts: freq-change / new-controller
  / handoff-approaching / connection-lost / logging-started. Alerts = visual toast + OPTIONAL per-type
  sound (default OFF).
- **Route briefing source = filed VATSIM plan (via CID) if connected, ELSE SimBrief.** Auto pre-flight
  + refresh enroute. Output = the FIRs/TRACONs/airports the route crosses + who's online + a FREQUENCY
  STACK (DEL→GND→TWR→DEP→CTR…→APP→TWR→GND) to pre-load. Fits his plan-first workflow.
- **Weather-card "VATSIM" button** (per route/weather card, independent of Live mode — works while
  PLANNING): GREYED unless that field's VATSIM ATIS is online (a datafeed `atis[]` entry for the ICAO).
  When online + clicked → REPLACES the card's ATIS/active-runway block with VATSIM's (active arr/dep
  runway from `text_atis`, info letter, transition level) + shows the VATSIM METAR; the resulting
  active runway flows into the SimBrief filing exactly as the current active runway does (VERIFY how
  openSimBrief passes runway today and reuse it).
- **VATSIM METAR** = metar.vatsim.net/{ICAO} (VATSIM's injected weather, SEPARATE from aviationweather
  .gov). Used by the weather button + briefing.
- **ATIS parse:** datafeed `atis[]` = {callsign:"EGLL_ATIS", atis_code:letter, text_atis:[lines]}.
  Reuse `extractRunways()`/`interpretDatis()` (index.html) on the joined text_atis lines to pull the
  active dep/arr runway. (Confirmed live: text_atis carries "…APPROACH RWY 18. DEP RWY 36…".)
- **Polygons = ALL THREE** (Dean): VATSpy Data Project (FIR/ARTCC boundary GeoJSON + callsign→FIR map)
  for CTR + SimAware TRACON polygons for APP + VATGlasses (sub-FIR sector ownership) where covered.
  Point-in-polygon (ray-cast, pure/desk-testable) REPLACES the V1 distance-circle in recommendFreq.
  **VATGlasses is the single HARDEST piece + region-limited** → strict TIERED fallback: VATGlasses
  (if it covers the point) → VATSpy/SimAware polygon → distance circle. Data downloaded + cached in
  USER_DATA via the airport-DB/community-routes pattern, per-AIRAC, Settings "refresh airspace data"
  button. This is what finally lets Center/TRACON-callsign positions (LON_CTR, NY_APP) be auto-picked
  instead of V1's "verify" list.
- **Radio-set** (done in V1): COM_STBY_RADIO_SET_HZ = universal SimConnect event, not per-plane LVARs.
  LIVE-TEST on Fenix/PMDG whether their custom RMP visually reflects it (sim COM state changes either
  way, which is what vPilot reads); per-plane LVAR fallback only if a plane ignores it (future).
- **Extras (all toggleable):** connection sanity ("Live mode on but you're not connected" / "connected
  as BAW123" via CID), assigned-squawk reminder (flight_plan.assigned_transponder), voice/text/
  receive-only controller flag (from callsign/ATIS), new-controller-online toast, handoff prompts
  (needs polygons). Event/traffic awareness = optional later.

### Build stages (internal — ALL ship in the one v6.6.0 release)
1. **Foundation:** `cfg.vatsim` schema + defaults; the "VATSIM" Settings section (all toggles + CID
   field); header compact status + quick toggle; wire LATC (V1) to read the toggles.
2. **Weather-card VATSIM button:** datafeed `atis[]` fetch (proxied like the feed), ATIS runway parse
   (reuse extractRunways), VATSIM METAR fetch, per-card button (greyed when no ATIS), replace-on-click,
   SimBrief-runway flow-through.
3. **Overlay window:** main.js 2nd BrowserWindow (transparent/frameless/click-through/top-right) + a
   small overlay HTML; IPC to push toasts; toggleable toast types; logging-started mirror; optional
   sound.
4. **Polygon coverage engine:** download/parse VATSpy + SimAware + VATGlasses; ray-cast point-in-polygon
   (pure module, desk-tested); tiered coverage; replace the circle in recommendFreq so CTR/APP auto-pick;
   connection-sanity + squawk + voice/text flags.
5. **Route briefing:** parse filed-plan-or-SimBrief route → FIR/TRACON/airport crossings (via the
   polygons) → frequency stack UI (pre-flight, in the Live ATC tab) + live handoff prompts.
6. **Finalize:** v6.6.0 bump, README + SKILL, one big test pass, release.bat.

### Files
main.js (overlay BrowserWindow + lifecycle; IPCs: vatsim-atis, vatsim-metar, vatsim-pilot(by cid),
airspace-data download/refresh, overlay-toast push; polygon parse can live in a new
perf/native-style pure module e.g. `vatsim/airspace.js` for desk-testability). preload (bridges +
overlay-toast listener). index.html (VATSIM Settings section; header status+toggle; weather-card
button; route-briefing UI; recommendFreq upgraded to polygon coverage; overlay content builder).
NEW overlay.html (tiny). cfg.vatsim persisted.

### Verification
- Desk: ray-cast point-in-polygon (pt inside/outside a known FIR GeoJSON — e.g. a London point in
  EGTT, a US point out); ATIS runway parse reuses the extractRunways tests on real text_atis; route
  FIR-crossing test on a known filed route; recommendFreq w/ polygon coverage (CTR auto-picked when the
  point is inside its FIR, not just within a circle); tiered fallback (VATGlasses→VATSpy→circle).
- Live (Dean, borderless, flying VATSIM): overlay renders top-right + fades; header status live; freq
  recs match reality incl. a top-down Center case; Set-standby loads COM1 standby on his Fenix/PMDG;
  weather-card VATSIM button greys/enables correctly + its runway reaches SimBrief; connection detection
  via CID; airspace-data refresh works.
- node --check + renderer Function-parse each session; commit to main (NO release) until stage 6.

### 🛬 v6.6.1 — LIVE-VALIDATION FINDINGS (Dean's LGAV→LGKR flight, 2026-07-08)
> Live test of the v6.6.0 companion on VATSIM (PMDG 737, Athens). **HUGE PASS on the core:** header +
> Live ATC tab went LIVE (auto-started by vPilot), 81 controllers; top-down PERFECT ("LGAV's DEL is
> offline — LGAV_N_GND covers you top-down" → Ground 121.755); full route briefing correct (Ground
> 121.755 → Tower 118.625 → Approach 132.975 → Center LGGG 129.675 → Corfu CTAF 120.850); distant
> positions (Sydney etc.) correctly in the "verify" list. Recommendation engine + briefing + Center
> coverage + CTAF fallback ALL validated live. TWO fixes for v6.6.1:
> 1. **STANDBY WRITE doesn't drive the PMDG.** [Set COM1 standby] shows "✓ Loaded 121.755" (send didn't
>    throw) but the PMDG 737 standby didn't change (stayed 124.850). COM_STBY_RADIO_SET_HZ isn't
>    affecting the PMDG's custom radio. Fix: find the right mechanism for PMDG (per-plane LVAR / PMDG
>    custom event, or the BCD COM_STBY_RADIO_SET fallback) AND verify the Fenix separately (may differ).
>    The recommendation itself is correct — only the aircraft write fails. Also confirmed: the ATIS
>    button fixes (46697a5) aren't in his running build yet (unreleased) — bundle with these.
> 2. **SEQUENCE-AWARE RECOMMENDATION + UNIFIED "NEXT UP" (Dean's standby rethink + missing Tower prompt +
>    the CLIMBOUT-skips-Approach finding — all ONE root).** The recommendation model is "pick the LOWEST-
>    tier online controller whose coverage area you're in" — PERFECT at the gate (top-down DEL→GND nailed
>    it), but it has NO concept of PROGRESSION up/down the chain. Proven live (Dean, LGAV climbout): at
>    6nm airborne, freshly handed Tower→Approach and correctly on 132.975, ABRP had already flipped to
>    ENROUTE phase and recommended Center 129.675 — SKIPPING Approach entirely. Cause: phase =
>    onGround?ground : (near&&<12nm&&agl<3000?airport:enroute) — a 737 blows past agl 3000/12nm within a
>    mile, so it snaps to enroute (pref ['CTR','FSS'], APP not even a candidate) → Center. Just widening
>    LATC_ENV_AGL/NM is NOT enough: in 'airport' phase top-down picks the LOWEST covering tier = Tower
>    (still in range) even after you've climbed past it. The real fix is SEQUENCE AWARENESS: track where
>    you are in the Ground→Tower→Approach→Center progression (climb) / reverse (descent) and advance WITH
>    the aircraft, holding Approach through the terminal climb, only moving to Center once genuinely
>    enroute. **KEY (confirmed on the VATSIM map + in data 2026-07-08): SimAware HAS the Athens Approach
>    polygon (id "LGAV", name "Athinai Approach") and traconCovers('LGAV_W_APP') resolves to it — so the
>    tool KNOWS Dean is inside Approach's coverage but the enroute phase never checks. Clean fix = make APP
>    a candidate whenever its polygon (or circle fallback) covers you, and use APP-POLYGON-EXIT as the
>    precise Approach→Center boundary (better than any altitude threshold). Also: Tower is placed by a 50nm
>    airport CIRCLE — far too big (keeps "covering" you deep into the climb); Tower coverage should be
>    small/near-field so top-down doesn't stick on Tower after you've climbed past it.**
>    Same model then also drives the missing Tower prompt on the ground + the look-ahead standby.
>    Symptoms unified: handoff prompt gated `!p.onGround` + only scans CTR/APP geographically (misses the
>    DEL→GND→TWR→DEP field progression → no Ground→Tower prompt taxiing out); auto-set-standby loads the
>    CURRENT rec not the next; and the recommendation itself skips Approach on climb. FIX = drive BOTH off the
>    latcFreqStack sequence (briefing + standby + prompts unified):
>    - Persistent **"Next up: <freq> <pos>"** line on the recommendation card = the next entry in the
>      sequence after the current rec (on the ground: Ground now → Next up Tower). Covers the
>      ground Ground→Tower case where a precise "approaching the runway" trigger is unreliable.
>    - **Look-ahead standby:** standby holds what you swap to NEXT. LiveATC SimConnect also reads COM
>      ACTIVE FREQUENCY; auto-set logic = if active==current rec → set standby to the NEXT sequence
>      entry, else set standby to the current rec. Advances GND→TWR→APP→CTR… (optionally ATIS first).
>      NEVER auto-set ACTIVE (safety: vPilot transmits on active).
>    - Keep timed handoff TOASTS where the transition is detectable (airborne CTR/APP geographic).
>    "Next"/sequence order comes from latcFreqStack (the briefing IS the sequence).
> Both need Dean flying to validate → v6.6.1.
> 3. **CTAF must be VATSIM-AWARE, not real-world US (Dean caught 2026-07-08, LGKR arrival).** The tool
>    suggests CTAF = the field's TOWER frequency at an uncontrolled airport (Dean's original real-world US
>    model). But on VATSIM, uncontrolled fields use the universal **122.800 unicom** GLOBALLY — CTAF as a
>    real frequency only exists in the VATSIM divisions that have rolled it out (US/VATUSA, and now
>    VATPAC/Australia — visible in vPilot's "CTAF is now live in VATPAC" MOTD). Proven: `.ctaf LGKR` in
>    vPilot returns "No AIP data" (Greece has none) → 122.800 is correct. So ABRP's briefing showing
>    "CTAF 120.850" for LGKR is WRONG for VATSIM Europe; the enroute UNICOM 122.800 it showed when Center
>    signed off was RIGHT. FIX: uncontrolled fields default to 122.800 unicom EVERYWHERE; use the
>    field-specific CTAF (tower freq) ONLY for VATSIM CTAF regions (US K/P prefix; Australia Y-prefix for
>    VATPAC). Corrects the roadmap's earlier "CTAF = airport tower freq" note (that was real-world US, not
>    VATSIM). Reaction to a controller SIGNING OFF → fall to unicom was validated correct live.
> Minor: LGMG_TWR (Megara, near Athens) landed in "verify" (not in the airport DB / didn't geo-locate).

### 🛬 v6.6.1 — PARKING-BRAKE END-TRIM LAYER (Dean 2026-07-08, LGKR arrival)
> ADD a 2nd layer to the teardown trim: parking-brake as a high-confidence flight-end anchor, PRIORITY
> over the frametime heuristic when present; frametime-burst stays the FALLBACK (mid-taxi quit / no
> brake). Dean: "keep what we have and also add a fallback to prioritize if parking brakes are set, but
> still protect against holding to cross per ATC where I do set the brake." DESIGN:
> - **Capture:** add BRAKE PARKING POSITION (or PARKING BRAKE indicator) to the capture SimConnect data
>   def (simconnect.js/capture.js) → record in telemetry (1Hz) / phase-log. NOTE: future flights ONLY —
>   existing logs have no brake data (frametime layer still covers them; NO retroactive brake trim).
> - **Trim (phases.js):** find the LAST parking-brake-SET with NO resumed flight after it (no airborne /
>   no sustained taxi) = the arrival park (high confidence). If present → anchor the end there and trim
>   the shutdown from there. If absent (quit mid-taxi, brake never set) → fall back to today's
>   trimTeardownTail (unchanged).
> - **ATC-hold guard (Dean's ask):** a brake-set only counts as flight-end if flight doesn't resume after
>   it — so hold-to-cross-a-runway with brake set (then release + taxi/takeoff) is ignored; only the FINAL
>   park counts. Same "never recovers" logic as the teardown, applied to the brake timeline.
> - **RECOMMENDED (Dean to confirm): KEEP the normal parked-at-gate frames** (real smooth data) and trim
>   only the shutdown burst after the park — don't chop at the brake-set. Original issue was the spike,
>   not the quiet gate frames.
> - Needs a validation flight (capture the brake + confirm trim uses it). Build in the v6.6.1 batch.

### 🚀 v6.6.1 — CONSOLIDATED IMPLEMENTATION PLAN (post-validation-flight; Dean confirmed 2026-07-09)
> **BUILD PROGRESS (2026-07-09):** ✅ B VATSIM-aware CTAF (commit 5f1fcb4, 6/6 test). ✅ A-CORE
> recommendation holds Approach through the climb — realistic Tower coverage (near-field+low) + no rigid
> altitude gate (commit 3351642, 9/9 test vs real Athens airspace: gate→Ground, 3nm/2000ft→Tower,
> 35nm/6000ft-in-polygon→APPROACH not Center, enroute→Center, Corfu→UNICOM). ✅ D parking-brake end-trim
> layer, priority over teardown heuristic, ATC hold-and-cross guard (commit dd35658, 17/17 test incl. the
> exact hold-and-cross scenario + old-flights-untouched guardrail — testable cold at the gate, no flight
> needed). ✅ C standby write now HONEST — reads COM1 standby back and verifies against target, no BCD
> fallback (would mistune 8.33kHz freqs like 132.975), surfaces confirmed/unconfirmed on both the manual
> button and the background auto-set path (commit bc833cb, 19/19 test incl. the exact PMDG
> reported-success-but-didn't-move case). ✅ A-REST DONE (commit 2d32a51, 19/19 test built from Dean's
> real LGAV→LGKR data) — ATIS-first enriched sequence (latcEnrichedSequence, reuses Stage-5
> latcFreqStack), "Next up" card line (latcNextUp — fixes the exact Tower→Approach gap Dean hit live),
> look-ahead standby (main.js reads COM ACTIVE FREQUENCY:1; latcAutoTarget advances standby once you've
> swapped onto the current rec, skipping ATIS via latcNextActionable, NEVER writes active), and
> latcCoveringCtrl/latcNextHandoff aligned to the same Approach circle-fallback as the main rec.
> **ALL FOUR PIECES (A/B/C/D) COMPLETE.** Full consolidated VATSIM suite: 119/119, zero regressions.
> ✅ VERSION BUMPED v6.6.1 — Dean tests cold at the gate (no flight needed): C (standby honesty) + D
> (parking-brake trim) both testable spawned at a gate near live ATC. A-rest (sequence/next-up/
> look-ahead) needs a short taxi to exercise the Ground→Tower transition.

### 🔍 v6.6.2 — INDEPENDENT QA AUDIT (Fable, 2026-07-09) — 6 found, ALL FIXED (commit 409d942)
> Full sweep of everything since the 2026-07-02 audit (VATSIM companion stages 1-5+4b, trim work,
> v6.5.1 batch, v6.6.1 batch). Triggered by Dean's live crash right after the v6.6.1 update.
> 1. **UPDATE-RELAUNCH CRASH (Dean hit it):** 'second-instance' fired on the DYING instance during
>    quitAndInstall auto-relaunch — win destroyed but lock still held → win.isMinimized() threw
>    "Object has been destroyed" (main.js:186); the new instance then failed the lock and exited, so
>    the error could eat the relaunch too. Fixed: isDestroyed guard + try/catch.
> 2. **LOOK-AHEAD STANDBY REGRESSION:** rec stays Ground all taxi → after swapping to Tower at the
>    hold-short, latcAutoTarget regressed standby back to Ground. Fixed: furthest-match — advance from
>    max(rec index, active-radio index) in the sequence (hold-short on Tower → standby=Approach).
> 3. **VATSIM ATIS silent revert:** applied VATSIM ATIS expired via the 5-min datis cache → next
>    re-render silently restored real-world D-ATIS. Fixed: vatsim-flagged entries never auto-expire.
> 4. **Overlay re-created mid-quit** by a late overlay-toast IPC after before-quit destroyed it.
>    Fixed: handler refuses when _cleanupDone.
> 5. **XSS: info.letter (atis_code off the network feed) unescaped into innerHTML.** Fixed (all other
>    feed sinks verified esc'd: callsign rows, chips, rec.why, overlay uses textContent).
> 6. **Efficiency:** latcSeqForNow rebuilt the sequence (great-circle × point-in-polygon) up to 3×
>    per 5s poll. Memoized on feed-ts+route.
> **NOTED, NOT FIXED (watch live):** (a) polygon-edge oscillation could flap the freq-change toast +
> auto-standby writes when hovering a boundary — add hysteresis (require 2 consecutive polls) if Dean
> observes flapping; (b) vpilotWatch spawns PowerShell every 20s while enabled (opt-in, acceptable;
> skip-scan optimizations are unsafe — they break the edge-trigger that protects manual toggles);
> (c) sequence matcher uses first-match on duplicate frequencies across legs (benign: Math.max with
> the rec index covers the realistic cases); (d) renderLiveAtc rebuilds its innerHTML every 5s poll
> (pre-existing; fine at this scale). Tests: 15/15 QA suite + 119/119 regression. v6.6.2 SHIPPED.

### 💀 v6.6.3 — THE ZOMBIE FIX (2026-07-09, commit 126eb5b) — the finding the audit MISSED
> Dean: "same error even after release.bat" + 4 ABRP background processes with ABRP closed. LIVE
> EVIDENCE nailed it: installed exe STILL 6.6.0 (neither release ever installed!); zombie main
> (--updated, 10:55) + an overlay RENDERER + the chime's AUDIO service (11:05). ROOT CAUSE: the in-sim
> overlay is a real invisible BrowserWindow → 'window-all-closed' never fires when the main window
> closes with the overlay open (any session where a toast fired) → the app NEVER QUITS → windowless
> zombie that (a) holds the single-instance lock (every launch pokes it → IT throws the old-code
> destroyed-window dialog = "same error"), (b) holds the exe file lock → NSIS silent updates FAIL with
> no message (disk stayed 6.6.0 through v6.6.1 AND v6.6.2 releases). One bug, three symptoms; v6.6.2's
> second-instance guard treated a symptom. FIXES: (1) main.js win.on('closed') destroys the overlay +
> nulls win → clean exit; (2) build/installer.nsh customInit taskkills any running/stuck ABRP before
> install (the previously-dropped installer hardening, now proven needed; renderer-side still guards
> updates mid-capture). Zombie tree killed live (PIDs verified not capture/backfill children).
> LESSON for future audits: any new BrowserWindow must be audited against 'window-all-closed' — an
> invisible window silently changes app lifecycle. Dean: release.bat → open app (6.6.0) → silent-update
> straight to v6.6.3 (carries 6.6.1+6.6.2+6.6.3 in one hop) → verify footer v6.6.3 → cold-gate test.
> ✅ CONFIRMED LIVE: Dean updated cleanly to v6.6.3 — update pipeline unblocked.

### ✅ A–Z FULL-CODEBASE AUDIT CLOSEOUT (Fable, 2026-07-09, commit 2d80c75)
> On top of the morning delta audit (v6.6.2) + zombie fix (v6.6.3), a full sweep of the WHOLE repo:
> **Dynamic:** entire regression board run — 34 test suites / ~415 assertions ALL GREEN (every VATSIM,
> perf-engine, trim, lab, scenery, GSX, phase, METAR/D-ATIS suite in the scratchpad). One STALE TEST
> repaired (test_simconnect_fixes still called the pre-backstop 2-arg waitForCaptureEnd — product code
> was correct, test_hang_backstop 5/5 covers the current signature; also proved the new brake field
> didn't disturb the sampler contract — section A 4/4).
> **Static (lifecycle class, the zombie's lesson):** exactly 2 BrowserWindows, both now with complete
> lifecycle stories; every main-process child spawn has timeout+kill; every renderer interval has a
> clear/lifetime story; LiveATC reconnect timers guarded by `stopped`; _flightWatch self-clears.
> **Write integrity:** all config-critical writes via writeFileAtomic (FLIGHT_STATE transient reopen
> list intentionally plain — loss-tolerable); sidecars/series regenerable by design.
> **Hygiene:** repo clean (zero strays); 23 perf modules + main + preload parse clean.
> **Cleanup applied:** latcStackForNow — one memoized frequency-stack build shared by the briefing
> card + enriched sequence (was rebuilt up to 4×/5s poll; now once per 30s feed update). Unreleased,
> rides with the next bump.
> **Still-open watch items (unchanged, need live observation):** polygon-edge flapping → hysteresis if
> Dean sees it; vpilotWatch 20s PS spawn (opt-in, acceptable); PMDG standby write mechanism (v6.6.1's
> honest verify will report the truth at the cold-gate test — a per-plane custom event is the follow-up
> if unconfirmed). NEXT: Dean's cold-gate test of the v6.6.1 features (standby honesty, Next-up,
> ATIS-first, brake trim), now actually on his machine via v6.6.3.

### 🛩️ v6.6.4 — EDDF COLD-GATE TEST RESULTS + LIVE ATC POLISH (2026-07-09, built; awaiting Dean release.bat)
> Dean ran the cold-gate test at EDDF on VATSIM. **PASSED LIVE:** recommendation + top-down (watched DEL
> sign off → dropped to Ground), Next-up, ATIS-first banner, route briefing (EDDF→LTFJ), overlay toast,
> honest verify, AND the standby WRITE on the default G1000 Cessna (122.035 loaded fine — machinery is
> correct). **CONFIRMED:** PMDG (and by extension Fenix) run custom radios that IGNORE the standard
> SimConnect COM_STBY_RADIO_SET_HZ event even when powered — so the manual Set AND the look-ahead (both
> WRITE the standby) can't work on study-level aircraft; everything read/display works on any aircraft.
> **ONE bug caught:** look-ahead standby didn't advance when Dean tuned active up the chain. Root cause =
> the freq-match tolerance was 1kHz, too tight for 8.33kHz VATSIM channels (the sim reports a tuned channel
> up to ~4.17kHz off its label). **FIXES BUILT (12/12 desk-test):** (1) LATC_FREQ_TOL const 0.005 MHz
> (5kHz) replacing all the `<0.001` matches in latcAutoTarget/latcNextUp/latcNextActionable; verifyStandby
> (main.js) widened 1000→5000 Hz too; (2) NEW diagnostic line on the card — "ABRP reads your radio — active
> X · standby Y · look-ahead would load Z" — makes a stuck standby visible next flight (reveals read-null
> vs match-fail); (3) latcAtisFreq(icao, role) prefers _D_ATIS at the dep field / _A_ATIS at arr (Frankfurt
> split was showing whichever came first). Version v6.6.4 (package.json + index.html ×3 + README). NEXT =
> Dean release.bat → one short taxi test; the readout tells us if 5kHz fixed it or the active-read isn't
> populating. Parking-brake trim (D) still validates on his next real flight (default aircraft drives the
> brake sensor; PMDG/Fenix may not → teardown fallback covers them).

## 📻 v6.7.0 — PIVOT: DROP AUTO-TUNE, MAKE THE OVERLAY THE PRODUCT (Dean 2026-07-09, plan-approved)
> ✅ BUILT (commit 80c53d1; awaiting Dean release.bat + live-verify). Write path fully removed; overlay.html
> rewritten (bare dot → 20s auto-expand + chime + pulse); main.js overlay eager-created on Live mode +
> overlay-show/overlay-state/overlay-set-ignore (click-through toggled via mousemove hit-test); index.html
> latcPushOverlay() each 5s poll; diagnostic simplified to read-only "you're tuned to X → next Y"; settings
> "Pop panel open on new freq" + "Chime on new freq" (default on). 73/73 VATSIM tests green, parses clean,
> zero orphan refs. LIVE-VERIFY OWED (Dean, borderless VATSIM): dot in Live mode, auto-expand+chime+pulse
> on a new rec, click toggles, click-through passes sim clicks except over the dot/panel.

### Context
Live testing confirmed the standby-WRITE can't work on Dean's real aircraft: the PMDG and Fenix both
run custom radios that ignore the standard SimConnect set-frequency event (and the Fenix doesn't even
publish its standby to the standard variable — read stale 124.850 vs RMP 122.800). The Cessna proved our
write code is correct; the study-level aircraft are simply unreachable that way. So Dean is **abandoning
auto-set entirely** — no per-aircraft "walk the knob" build — and shifting the tool's value to what's
genuinely excellent: **recognizing the situation and recommending the right frequency**, surfaced through
a **persistent in-sim overlay** he can glance at and expand. We KEEP the frequency READ (active reads
fine on every aircraft — vPilot needs it) to show "you're tuned to X → next is Y". Nothing transmits or
tunes; ABRP becomes an awareness/monitor companion.

### Dean's locked decisions (2026-07-09 Q&A)
- **Overlay dot = bare** (no always-on label), but **auto-expands for 20 seconds whenever a NEW frequency
  is recommended** (chime + expand), then **collapses back to the dot and the dot PULSES** so a missed
  alert is still visible. Click the dot anytime to expand/collapse. Same behavior for entering a new ATC
  coverage area mid-flight (it's the same "recommendation changed" edge).
- **Keep the in-app Live ATC tab** as the pre-flight planning + settings surface; only remove the write
  controls (Set-standby button, auto-set checkbox, its setting).
- Overlay is borderless/windowed MSFS only (already documented); exclusive-fullscreen hides it.

### Part A — REMOVE the standby-WRITE path (inventory confirmed by exploration)
Delete (write-only, no read consumer):
- **main.js**: `EVT_STBY` const (~1943), the `mapClientEventToSimEvent(EVT_STBY,'COM_STBY_RADIO_SET_HZ')`
  call (~1966), `setStandby()` (~1995-2003), `verifyStandby()` (~2004-2017), and the `live-set-standby` +
  `live-verify-standby` IPC handlers (~2023-2024). **KEEP** the READ: data defs `COM STANDBY/ACTIVE
  FREQUENCY:1` (1961/1964) + readback into `pos.comStandbyMhz`/`comActiveMhz` (1972-1973) + `live-position`.
- **preload.js**: `liveSetStandby`, `liveVerifyStandby` (66-67). KEEP `livePosition`.
- **index.html**: `latcVerifyStandbySoon` (~6452), `latcApplyAuto` (~6476-6484), `latcSetStandby`
  (~6493-6503), `latcToggleAuto` (~6504); the `latcApplyAuto()` call in `latcPoll` (~6422); the card's
  Set-standby button + auto-set checkbox + `latc-setmsg` span (~6557-6562, remove their flex wrapper too);
  the `autoSetStandby` settings row (~6024) and config default (~5998); `LATC.lastSetHz`/`autoSet` state
  (~6053). **KEEP** `latcAutoTarget()` (~6458-6475, READ-only) — repurposed as the pure-display
  "you're on X → next Y" helper. Simplify the diagnostic readout (~6563-6576): drop the now-dead
  `sbUnreliable`/`standbyIssue` branch; **show ACTIVE read only** ("You're tuned to 121.805 · Delivery →
  next 121.705 Ground") and drop the standby number (unreliable on custom aircraft, no longer diagnosable).
- **Copy fixes** (stale after removal): card footer "Standby only — ABRP never transmits…" (~6584) and the
  off-state / header help text that says "one click to load into COM1 standby" (top of Live ATC pane +
  ~6535) → reword to "reads your position + who's online and tells you the frequency to be on" (no set).

### Part B — PERSISTENT, INTERACTIVE OVERLAY (the new core)
Today the overlay (`overlay.html` + main.js `overlayEnsure` ~2046-2066) is a transient push-only toast
window, created lazily on first toast, `setIgnoreMouseEvents(true,{forward:true})` globally, destroyed on
app close (zombie-fix `win.on('closed')` ~174-184 + `_cleanupDone` guard ~908). Evolve it:
- **main.js**: create the overlay EAGERLY when Live mode turns on (call `overlayEnsure()` from a new
  `live-atc-start` path or a dedicated `overlay-show` IPC), destroy/hide it when Live mode turns off; keep
  the zombie-fix teardown + `_cleanupDone` untouched. Enlarge the transparent window enough to hold the
  expanded panel (e.g. ~360×220) but keep it transparent — only the dot/panel is painted. Add
  **`overlay-set-ignore`** IPC → `overlayWin.setIgnoreMouseEvents(bool, {forward:true})` (toggle
  click-through so only the dot region is clickable). Add **`overlay-state`** IPC → `webContents.send`
  the live recommendation payload to the overlay. Keep the existing `overlay-toast` path for the
  coverage/logging events.
- **preload.js**: add `overlaySetIgnore(bool)`, `overlayState(o)` invoke bridges + `onOverlayState(cb)`
  listener (mirror the existing overlay-toast trio ~72-74).
- **overlay.html**: redesign. Bare **dot** anchored top-right; a hidden **panel** that expands
  (reuse the `.show` fade + the `beep()` C6→G#5 chime already present). `mouseenter` on the dot →
  `overlaySetIgnore(false)`; `mouseleave` → `overlaySetIgnore(true)` (move events already forwarded via
  `{forward:true}`, so hover fires even while click-through). Click dot → toggle expand. `onOverlayState`
  renders the panel: **ATIS-first line if at the departure gate**, the **current recommended freq +
  callsign + tier + plain "why"**, the **Next-up** freq, and **"You're tuned to X"** from the active read.
  On a **new-recommendation flag** in the state payload → auto-expand + chime + hold 20s → collapse →
  add a `pulse` CSS class to the dot until the next expand/click.
- **index.html**: in `latcPoll()` (~6422), after computing `rec` (via `latcCurrentRec()` /
  `latcNextUp` / `latcAtisFreq` / `latcAutoTarget`), push the full live state to the overlay every 5s via
  `overlayState({rec, nextUp, atisFirst, activeMhz, isNewRec})`. Detect `isNewRec` with the SAME change
  edge `latcCheckToasts` already computes (the `freqChange` key = `latcFmt(rec.freq)+'|'+rec.callsign`,
  ~6428-6430) so the auto-expand fires exactly when the recommended frequency changes. Keep
  `latcCheckToasts()` for the other overlay events. Remove the `latcApplyAuto()` call.

### Part C — Settings, sound, copy
- Remove the "Auto-set COM1 standby on change" row (~6024) + `autoSetStandby` default (~5998).
- **Chime on a new recommended frequency defaults ON** (Dean wants the audio alert as core) — add a
  `sound.freqChange` key (default true) driving the overlay auto-expand chime; other sound cues stay
  off-by-default and configurable. Overlay per-type toggles + master `overlay.enabled` stay.
- README changelog + version **v6.7.0** (package.json + index.html ×3). memory/master-list update.

### Files
main.js (remove write IPCs/methods; eager overlay + `overlay-set-ignore` + `overlay-state`), preload.js
(swap write bridges for overlay bridges), overlay.html (dot + expandable panel + live-state render +
auto-expand/pulse), index.html (delete write path + controls + settings row; push overlay state from
latcPoll; simplify diagnostic to active-only; copy fixes). README + version.

### Verification
- Static: `grep` confirms zero remaining callers of `liveSetStandby`/`liveVerifyStandby`/`latcApplyAuto`/
  `latcSetStandby`/`latcToggleAuto`; `node --check main.js`; renderer Function-parse; re-run the VATSIM
  desk-suite (tracon/briefing/handoff/recommend) — recommendation logic is untouched, all must stay green.
- Live (Dean, borderless VATSIM): Live mode ON → a dot appears over the sim; loading at a gate → chime +
  auto-expand 20s showing ATIS-first + recommended freq + next-up + "you're tuned to X" → collapses to a
  pulsing dot; clicking the dot toggles the panel; entering new coverage in flight re-fires it; the
  in-app tab has NO Set-standby button/checkbox and nothing transmits; Live mode OFF → dot gone.

## 🧭 v6.9.0 — POST-BENCHMARK STRATEGY: fly-how-you-like + ONLINE-TRAFFIC TAG (Dean 2026-07-10, plan-approved)
> ✅ BUILT (2026-07-10, awaiting Dean release.bat). capture.js one-shot tasklist probe at recording
> start → settings.online_traffic ('vatsim'/'batc'/'vatsim+batc') + settings.autofps_active (finally
> WRITES the long-planned tag); engine.js index-entry spreads; index_writer CSV fields; main.js compare
> payload (online_traffic default 'offline', autofps_mode 'autofps'/'fixed tlod'); _blCompute grid
> quarantine (VALUE check — payload default is the string 'offline'); _verdictPair drops autofps + cell
> key aircraft|tlod|traffic (plain key when comparing the online_traffic dim itself); coverage.js skips
> tagged; Compare dims + AutoFPS dim; SKILL.md documented. BACKFILLED w/ .bak-v690 backups: 2026-07-09_1121
> → vatsim, 2026-07-06_2237 → batc (stays excluded); ⚠ SCEL-SAEZ flight tags 'vatsim' BY HAND when it
> files (flew on the pre-tag build). 15/15 desk-tests incl. REAL-DATA: pick still TLOD 125, coverage
> still 24/24 after backfill. NOTE: test_lab.js has 3 PRE-EXISTING stale failures (Dean's post-ship Lab
> queue reorder — expectations name clouds-quality-up first); product fine; repair the test whenever.

### Context — the 10,000-ft clinical review Dean asked for
Dean's new reality post-24/24: day-to-day at the recommended TLOD 125, flies VATSIM most flights
(sometimes BATC, rarely; occasionally neither), bumps TLOD manually on light aircraft. He wants the
tools to keep up WITHOUT changing how he flies, and wants observations like "VATSIM's performance
cost is X, mostly on the ground". Clinical verdict: **the system was architected for exactly this
evolution — tags + quarantine + Compare grouping + the 5-phase ground split already exist. Exactly ONE
thing is missing: the flight's ONLINE-TRAFFIC CONTEXT is not recorded.** Everything else needs no
change and none is forced:
- **Expected flight types & how each is handled:** (a) VATSIM + capture (his majority) → needs the tag;
  (b) offline + capture → baseline-comparable as today; (c) BATC (rare) → tag, same mechanism;
  (d) Lab experiment flights (any context) → already quarantined; exp-vs-control share the traffic
  confound so it mostly cancels — leave the Lab alone; (e) light-aircraft flights at bumped TLOD →
  off-grid TLODs never enter benchmark cells, Compare groups by tlod — already handled, no change.
- **Ground traffic is the biggest exposure** (his hypothesis, agreed): dep_taxi/arr_taxi metrics
  already exist per flight — Compare grouped by the new tag answers it with ZERO new analytics.
- **What NOT to build (explicitly rejected as premature):** a second "VATSIM-aware" baseline/TLOD
  recommendation (revisit only if 20-30+ tagged flights show a meaningful delta); new views; Lab
  changes; any auto-recalibration. The TLOD 125 recommendation's job is done and static — its ongoing
  value is DRIFT detection after driver/SU changes, which the tag keeps honest.

### Build (small, mirrors the experiment-tag pipeline exactly — map verified 2026-07-10)
1. **Detect + tag at capture start** — perf/native/capture.js (~:95, beside the _lab_pending
   consumption): ONE one-shot process probe (`tasklist` via spawnSync, same pattern as main.js
   isMsfsRunning :847) matching image names case-insensitively: vpilot* → 'vatsim', beyondatc* →
   'batc' (both → 'vatsim+batc'; neither → field omitted) into `settings.online_traffic`, AND
   autofps/msfs*autofps* → `settings.autofps_active=true` (Dean 2026-07-10: will fly AutoFPS
   occasionally — this tag was DESIGNED long ago and is already READ by _blCompute :4156 / _scnAgg
   :3874 / compare payload :1263, but nothing ever WRITES it; the same probe closes that gap).
   Detection at RECORDING start (this block runs after the rolling trigger), NOT at arm/spawn time —
   vPilot/AutoFPS often start after ABRP arms, so env injection from main.js would mis-time; the
   engine probes itself. Verify BATC + AutoFPS real exe names via list-running-apps when Dean next
   runs them (match 'beyondatc'/'autofps' substrings defensively).
2. **Persist** — engine.js:172 index-entry spread gains `...(settings.online_traffic?{online_traffic:
   settings.online_traffic}:{})`; index_writer.js:30-32 INDEX_CSV_FIELDS gains "online_traffic" before
   "folder". summary.json gets it free via settings.
3. **Transport** — main.js perf-compare-data (~:1262): `online_traffic: s.online_traffic||'offline'`
   (accurate once the 2 known VATSIM flights are backfilled; all other logged flights were offline).
4. **Quarantine (keeps baseline + drift honest):**
   - index.html _blCompute grid filter (:4153): add `&&!x.online_traffic&&!x.autofps_active`
     (benchmark cells stay offline-fixed-TLOD apples-to-apples; a VATSIM or AutoFPS PMDG@125 flight
     can no longer sway the pick — AutoFPS's logged tlod is only the start cap, not what rendered).
   - driftCheck/_verdictPair: include the traffic context in the matched-cell key (aircraft|tlod →
     aircraft|tlod|traffic) so drift stays ALIVE on his VATSIM-heavy flying (VATSIM-vs-VATSIM across
     drivers is like-for-like) instead of starving for offline cells — and a stack of online flights
     on a new driver can't fake a regression. AutoFPS flights are FILTERED OUT of drift entirely
     (dynamic TLOD = no comparable cell).
   - coverage.js in-grid filter (:26-28, beside excluded): skip online_traffic + autofps_active
     flights (keeps any future re-baseline sweep clean; cosmetic today).
   - Scenery view (_scnAgg :3874): LEAVE AS-IS (per-aircraft z-baseline stays self-consistent as the
     pool shifts VATSIM-heavy; excluding would starve it). Note the caveat in SKILL.md.
5. **Compare dimensions** — index.html dimOpts (:4070): add `{v:'online_traffic',t:'Online traffic'}`
   (groups vatsim / batc / offline — THE "VATSIM on vs off" answer, incl. the per-taxi-phase metrics
   already in _cmpMetrics) and `{v:'autofps_mode',t:'AutoFPS'}` (payload maps autofps_active →
   'autofps'/'fixed tlod' for readable group labels — answers "does AutoFPS actually fly smoother
   than my fixed 125", the old roadmap's killer comparison).
6. **Backfill (Dean-approved hand-edit, same precedent as the excluded flag):** set
   `online_traffic:'vatsim'` on 2026-07-09_1121 (LGAV-LGKR) in index.json + summary top-level; same
   for the SCEL-SAEZ flight once it files (it records on the pre-tag build). Retro-tag the excluded
   BATC flight 2026-07-06_2237 as 'batc' (stays excluded). Back up index.json first.
7. **Docs** — SKILL.md: the tag, the on/off comparison method (matched cells, min-n, ground-phase
   focus, "collecting" honesty), the Scenery caveat. README changelog; version v6.9.0 ×4; memory.

### Verification
Desk: synthetic index entries → _blCompute excludes online + autofps flights from grid/clean; drift
cell key splits offline/vatsim and drops autofps; compare payload emits 'offline'/'fixed tlod'
defaults; tasklist probe parses vpilot/beyondatc/autofps names (mock spawnSync).
Tag ride-along: node --check all touched; renderer parse; re-run lab/coverage suites (excluded-flag
suites are the template). Live: Dean's next VATSIM flight files with online_traffic:'vatsim' in
summary+index; Compare → group by Online traffic shows vatsim vs offline groups; Baseline pick
unchanged (still TLOD 125 from the 24 offline flights). Guardrail: backfill edits index.json + summary
top-level only, with backups — never raw CSVs.

## 🛫 v6.8.0 — IN-SIM TOOLBAR PANEL — ❌ ABANDONED + REMOVED (Dean 2026-07-10, commit 94bca12)
> **DEAD. Do not chase this.** Built as a POC (2209bd1 Stages A+B, icon fix c6f8065), then Dean
> abandoned it and it was REMOVED in v6.9.1 (94bca12 "remove abandoned in-sim toolbar panel").
> Verified 2026-07-16: main.js has NO http server, no port 8177, no /latc/state route, and there is
> no ingamepanel/ folder. The ✅ notes below are STALE (they predate the removal) — kept only as the
> historical record of what was tried. The desktop overlay (overlay.html) is the shipping surface.
> If the in-sim panel is ever revisited, the EFB-app path is the alternative (see Stage C notes).

## 🛫 (historical) v6.8.0 in-sim toolbar panel POC — original plan below
> ✅ STAGES A+B BUILT (2026-07-10, commit-only, NO version bump — release gated on Dean's POC).
> A: main.js caches the overlay-state payload (before the overlay-window early-return) + loopback HTTP
> server (port cfg.latcPanelPort||8177; GET /latc/state JSON w/ 15s staleness + GET /panel self-contained
> dark HTML that polls 5s, waiting-state, flash on isNewRec); starts in live-atc-start, stops before-quit;
> renderer latcPushOverlay no longer gated on overlay.enabled (panel needs the push even with the desktop
> dot hidden). Desk-test 9/9 (scratchpad/test_latc_panel_server.js — runs the REAL main.js block: bind
> 127.0.0.1, fresh/stale/none states, /panel HTML, 405/404 guards).
> B: NEW ingamepanel/abrp-ingamepanels-liveatc/ — fork of the proven Maximus toolbar-window template
> (same base as SimAware/Cockpit-Companion panels): prebuilt .spb vendored UNCHANGED (binds internal
> names CustomPanel/PANEL_CUSTOM_PANEL/icon filename — never rename), CustomPanel.js simplified to a
> dumb iframe → http://localhost:8177/panel (load on panelActive, blank on panelInactive), dark CSS,
> ABRP radio-waves icon (same filename), manifest retitled, layout.json regenerated via
> ingamepanel/gen_layout.js (FILETIME dates; MSFS validates sizes — rerun after ANY package edit).
> ingamepanel/README.md = POC install steps + validation checklist + Maximus attribution (template has
> NO license: fine for Dean's personal POC; before public distribution rebuild the .spb from XML via
> the SDK's fspackagetool or get license clarity — logged as a Stage-C gate).
> **NEXT (Dean's POC):** copy ingamepanel/abrp-ingamepanels-liveatc → Community folder; run ABRP with
> the new main.js (start.bat from source, or let it ride into the next release — server is inert until
> Live mode); fly the checklist (icon appears / live data ≤10s / updates / EXCLUSIVE FULLSCREEN / FPS /
> drag-resize). Then Stage C (settings rows, install button via cfg.communityFolder, port-aware JS,
> README, v6.8.0 bump).

### Context
Dean asked whether the Live ATC intelligence could live INSIDE MSFS 2024 — in the EFB tablet or the
in-flight top-center toolbar — instead of only the external desktop overlay (which dies in exclusive
fullscreen). Research answer: **the EFB is NOT the only way.** Two viable paths, both running in MSFS's
built-in web engine (Coherent GT), both fed by ABRP over localhost:
1. **Toolbar in-game panel** (the "center menu" option) — a thin package in the Community folder adds a
   toolbar icon that opens a window; the window is an iframe pointing at a page ABRP serves on
   localhost. Proven pattern (SimAware panel, Navigraph, HankHank10 Cockpit Companion all do exactly
   this). UI iterates instantly (it's ABRP-served HTML — no package rebuild, no sim restart). CAVEAT:
   2020-style panels in 2024 are somewhat finicky (SU updates have broken some; styling templates are
   the old 2020 ones) — hence POC-first.
2. **EFB app** (official 2024 SDK) — native tablet app, JS/JSX/TypeScript + npm toolchain, appears in
   the EFB for all aircraft. More polished but heavier build, network access undocumented, every UI
   tweak needs a package rebuild. **DEFERRED** — the upgrade path if the toolbar panel proves flaky,
   and both consume the same ABRP data service, so nothing built for #1 is wasted.
**DECISIONS (Dean 2026-07-09):** toolbar panel FIRST (POC), EFB app deferred; if the panel proves out,
KEEP BOTH surfaces (desktop dot overlay stays for windowed users + as the chime source — Coherent may
not play WebAudio; each toggleable). ABRP stays the single brain; the panel is a dumb display.

### Architecture (the one clever bit)
main.js ALREADY caches everything needed: the `overlay-state` IPC (main.js ~2043) receives the full
pre-formatted recommendation payload from `latcPushOverlay()` every 5s poll. So:
**ABRP gains a tiny loopback HTTP server; the sim panel is an iframe to it. Zero renderer changes.**
- `GET /latc/state` → JSON: the cached overlay-state payload + `ts` (stale >15s ⇒ treated as offline).
- `GET /panel` → a self-contained dark-themed HTML page (served from main.js, no external assets) that
  polls `/latc/state` every 5s and mirrors the Live ATC card: status line, ATIS-first banner, big
  frequency, callsign/label, plain-English why, "Next up", "you're tuned to X", flash-on-new-rec.
- Server: node `http`, bound to **127.0.0.1 only**, port `cfg.latcPanelPort` (default **8177**),
  started lazily when Live mode turns on (stopped on app quit; `_cleanupDone`-guarded like the overlay).
  Panel shows "Waiting for ABRP — turn on Live mode" when fetch fails or `live:false`.

### Stage A — ABRP data + panel service (bench-testable, no sim)
- main.js: cache the payload in the existing `overlay-state` handler (`_latcLastState={payload,ts}`);
  add `latcPanelServer` (start/stop + the two GET routes above; everything else 404; GET-only).
  Start it inside `live-atc-start`, stop on `before-quit`. Log one line with the URL.
- The `/panel` HTML lives as a template string in main.js (or a small `panel.html` read at boot) —
  styling mirrors overlay.html's dark look; no chime (desktop overlay keeps sound duty); a subtle
  amber flash on `isNewRec`.
- Desk-test: start server directly in a node harness, feed a fake payload, `curl /latc/state` +
  `/panel`, assert JSON shape + HTML poll loop present + stale-payload ⇒ offline state.

### Stage B — POC toolbar panel package (the sim unknown; Dean validates)
- New repo folder `ingamepanel/abrp-ingamepanel-liveatc/`: minimal 2020-style in-game panel package —
  `manifest.json`, `layout.json` (generate with a tiny node script — it's just a file/size listing),
  `html_ui/InGamePanels/AbrpLiveAtc/` (panel .html/.js/.css + toolbar icon svg) whose content is ONE
  iframe → `http://localhost:8177/panel`. Model on the maximus/jopeek template (iframe pattern
  confirmed); keep the shell dumb so it never needs updating.
- POC install = manual: copy the folder into Dean's Community folder (`cfg.communityFolder` — same one
  his scenery junctions load from; if the icon doesn't appear there, try the other of
  Community/Community2024 — logging which works IS part of the POC).
- **Dean's validation checklist (in a normal VATSIM session):** (1) toolbar shows the ABRP icon;
  (2) panel opens + shows live data ≤10s; (3) recommendation updates as he taxis/tunes; (4) panel
  still visible in EXCLUSIVE FULLSCREEN (the whole point); (5) rough FPS sanity with the panel open
  (the capture engine can measure a with/without pass later if it feels heavy); (6) panel drag/resize
  behavior acceptable. VR out of scope.

### Stage C — polish + distribution (only after B validates)
- Settings → VATSIM section: "Install in-sim panel" button (copies the package into the Community
  folder — reuse the msfs-detect/communityFolder plumbing, main.js ~1061; plain folder copy, no
  junction) + remove/update on version change; port setting; panel on/off row.
- Enrich the payload if wanted (e.g. "Also in range" list — one-line add in latcPushOverlay).
- README (install + fullscreen note), version bump v6.8.0, memory/master-list update.
- If the toolbar panel proves flaky across SUs → revisit the EFB app SDK path (same data service).

### Files
main.js (payload cache + HTTP server + start/stop wiring), NEW ingamepanel/abrp-ingamepanel-liveatc/*
(manifest, layout generator script, panel shell), scratchpad desk-test for Stage A; Stage C: index.html
(settings rows + install button), README, version ×4. Renderer recommendation code: UNTOUCHED.

### Verification
Stage A: node harness — fake payload in, correct JSON/HTML out, loopback-only bind asserted, stale ⇒
offline. Stage B: Dean's in-sim checklist above (the POC gate). node --check main.js + renderer parse;
VATSIM suite stays green (no logic changes). Release only after B passes — until then everything is
commit-only (no version bump), so the installed app is unaffected.

### 🎛️ PARKED (not abandoned): per-aircraft radio WRITE for PMDG/Fenix ("option C")
> Web research (SPAD.neXt PMDG-737 guide, MobiFlight FSUIPC/PMDG Event IDs, PMDG_NG3_SDK.h, Axis&Ohs FMC
> addon) CONFIRMS PMDG/Fenix radios ARE externally drivable — but NOT via a direct "set frequency" event.
> The mechanism: read the aircraft's own data feed for the CURRENT freq, then send a sequence of
> incremental KNOB-CLICK events (PMDG custom events, base THIRD_PARTY_EVENT_ID_MIN=0x00011000, mouse-wheel
> params) to "walk" the display to the target. Per-aircraft (PMDG scheme ≠ Fenix scheme), can break on
> aircraft updates — a genuine mini-project each. DECISION (Dean 2026-07-09): PARKED as a future option;
> NOT building now. The recommendation (core value) works on every aircraft, and the honest "tune manually"
> UX means the pilot is never misled. Smaller earned spin-off if ever wanted: PMDG data-feed READ only
> (accurate "you're on the right freq ✓" + rock-solid look-ahead detection) — far easier than the write.
> vPilot (no 3rd-party API) and Navigraph (real-world data, Charts API unavailable to external apps) are
> both dead ends here — the VATSIM datafeed + the sim's COM read already supply everything.

**Context.** Dean's LGAV→LGKR validation flight (PMDG, live on VATSIM) proved the companion's core works
end-to-end (connect + auto-start, top-down at the gate, route briefing, overlay + handoff render IN-SIM,
CTAF-when-uncontrolled, teardown trim on a real exit: 691.9ms shutdown spike cut, real 221.6ms hitch
kept). It also produced a tight punch list. v6.6.1 fixes it + folds in the already-committed 14s overlay
(80d1f32) + ATIS-button fixes (46697a5). Mostly renderer + a little capture; two items (C, D) can only be
finished/validated on the next flight. Version bump v6.6.1 (package.json + index.html ×3 + README).

**A. SEQUENCE-AWARE RECOMMENDATION + ATIS-first + look-ahead standby + Tower prompt (renderer; the big
one; bench-testable).** Today the rec is "lowest online tier whose coverage you're in" — perfect at the
gate, but jumps to Center at 3000ft (skips Approach) and would stick on Tower's oversized 50nm circle.
- *Realistic per-tier coverage* — recommendFreq (index.html ~6221) + LATC_RADIUS (~6051): Tower covers
  only near-field + low (~7nm AND agl<~4000ft), not 50nm; Approach covers when inside its TRACON polygon
  (traconCovers — we HAVE "LGAV"/"Athinai Approach") or a moderate circle fallback; Center via FIR polygon
  (airspaceCovers). DROP the rigid 12nm/3000ft phase gate that excludes APP (LATC_ENV_*); airborne,
  consider TWR/APP/CTR by real coverage and pick the lowest containing you → holds Approach through the
  climb (inside the polygon), moves to Center only on polygon EXIT.
- *ATIS-first (Dean confirmed):* enriched sequence = dep ATIS (if a VATSIM ATIS exists, via vatsimAtisData)
  → GND/TWR/APP → enroute CTRs → arr ATIS → APP/TWR/GND → CTAF, built off latcFreqStack. At the dep gate
  (on ground, ATIS available, not yet on the ATC freq) the rec surfaces ATIS as "start here"; arrival ATIS
  before Approach. ATIS = a tune-to-active suggestion; ABRP still only writes standby.
- *Look-ahead standby (Dean confirmed):* add COM ACTIVE FREQUENCY:1 to the LiveATC data def (main.js
  ~1938) + a com-active field on the pos sample; rework latcApplyAuto (~6297): if COM1 active == current
  rec → set standby to the NEXT enriched-sequence entry, else set standby to the current rec. NEVER set
  active. Advances ATIS→GND→TWR→APP→CTR… (reverse on arrival).
- *"Next up" + Tower prompt:* rec card always shows "Next up: <freq> <pos>" (next sequence entry); the
  freqChange overlay toast (latcCheckToasts) now fires on the real transitions the reworked rec produces
  (covers the missing ground Ground→Tower prompt). Fix latcCoveringCtrl/latcNextHandoff to use the SAME
  coverage as the rec so the airborne handoff toast doesn't skip a circle-placed Approach (it said Center).
- *Desk-test:* pure rec + sequence + next-up vs real LGAV polygons + synthetic controllers — gate→Ground
  (ATIS-first when present), climb inside LGAV polygon→Approach (not Center, not stuck-Tower), exit→Center,
  descent re-enter→Approach; next-up = next entry; standby math (active==rec → next).

**B. VATSIM-AWARE CTAF (renderer; small; bench-testable).** recommendFreq CTAF fallback (~6267) uses the
field tower freq (US real-world) — wrong for VATSIM Europe (should be 122.800). Use the field CTAF
(apt.twr) ONLY for VATSIM CTAF regions (US /^[KP]/, VATPAC /^Y/); else 122.800. Desk-test: LGKR→122.800,
a US K-field→its tower CTAF, an Australian Y-field→its CTAF.

**C. PMDG/Fenix STANDBY WRITE (main.js; best-effort now, validate/iterate live).** setStandby (~1973)
sends COM_STBY_RADIO_SET_HZ; GUI reported success but the PMDG radio didn't move. Can only be finished
live. Build: (1) read COM STANDBY FREQUENCY back and report "✓ loaded" ONLY if it actually changed (kills
the false success — honest immediately); (2) if Hz didn't take, try BCD COM_STBY_RADIO_SET fallback; (3)
structure for a per-plane PMDG/Fenix custom-event/LVAR path as the follow-up. Validate next PMDG + Fenix
flight; may need a v6.6.2 tweak for the exact mechanism. This is the one item that can't be bench-proven.

**D. PARKING-BRAKE END-TRIM LAYER (capture + trim; Dean confirmed CUT AT the brake; needs a flight).**
- *Capture:* add 'BRAKE PARKING POSITION' (Bool) to the capture data def (perf/native/simconnect.js) +
  record per telemetry sample (new column, alongside onGround/gspeed). Future flights only.
- *Trim (perf/native/phases.js):* PRIORITY — if brake data exists, find the LAST parking-brake-SET with NO
  resumed ground movement (gspeed>~2kt)/airborne after it and CUT THERE (discard post-park fiddling +
  shutdown — Dean's choice). GUARD: a brake-set followed by movement (release + taxi to cross per ATC) is
  skipped; only the final settled park counts. FALLBACK: no brake data / never set / unverifiable → current
  trimTeardownTail unchanged. Existing logged flights untouched (no retroactive brake; teardown correction
  stays for them).
- *Fenix caveat (Dean flagged):* custom aircraft may not drive the standard BRAKE PARKING SimVar →
  detection fails → teardown fallback covers it. Per-aircraft, learned on flights.
- *Desk-test:* synthetic telemetry — brake+quit→cut at brake; brake→release→taxi→park→quit→cut at FINAL
  park (hold ignored); no brake data→teardown fallback; assert existing flights unaffected.

**E. Minor:** LGMG_TWR (Megara) fell into "verify" — airport DB is medium+large only. Low priority.

**Verification (release).** Bench: desk-test A/B/D on real VATSpy+SimAware data (scratchpad pattern used
for tracon/briefing/handoff); node --check + renderer Function-parse; re-run the VATSIM suite (tracon 23 /
briefing 18 / handoff 14) for no regression. Live (Dean's next flight): C moves the PMDG/Fenix radio (or
honestly reports it didn't); A holds Approach through the climb + advances standby ATIS→GND→TWR→APP→CTR +
the Tower prompt fires on the ground; D cuts at the park. Commit incrementally to main; bump v6.6.1 +
release.bat when the bench pieces are in.

### Raw V2/V3 source notes (kept for build reference)
- VATSpy: github.com/vatsimnetwork/vatspy-data-project (FIR boundaries GeoJSON + callsign→FIR).
- SimAware TRACON: github.com/vatsimnetwork/simaware-tracon-project (approach polygons).
- VATGlasses: github.com/lennycolton/vatglasses-data (sub-FIR sectors + top-down ownership; region-by-
  region — CANNOT be the only source; VATSpy/circle beneath). All need a periodic AIRAC refresh job.

### Verification
- **Desk (no sim):** recommendFreq test matrix — ground w/ GND online → GND; ground w/ only TWR → TWR
  (top-down); ground w/ only CTR covering → CTR; ground, nobody → CTAF = field tower freq; enroute
  nobody → 122.800; enroute CTR covering → CTR; observer + 199.998 filtered; LAS_TWR↔KLAS matching;
  radius defaults when visual_range=0. Airport-DB slimmer on the real OurAirports CSVs (spot-check
  KLAS/EGLL/CYYZ freqs). Renderer parse + node --check.
- **Live (Dean, one VATSIM observation flight):** position pill goes LIVE; recommendation matches what
  he'd manually pick at gate/taxi/climb/cruise (especially a top-down case: field TWR offline, CTR
  online); [Set standby] loads COM1 standby and vPilot transmits ONLY after he swaps; sim quit → loop
  stops clean; capture engine unaffected if a logged flight runs simultaneously.

- **⭐ RAW SPEC (reference for V2/V3 detail) — LIVE VATSIM FREQUENCY HELPER (Dean 2026-07-07, big idea, feasibility CONFIRMED).** Dean flies
  VATSIM observation w/ vPilot and fumbles which freq to be on (live ATC vs CTAF vs 122.800). Build a
  live in-sim panel: (1) POSITION via SimConnect — a CONTINUOUS connection (new "live mode", unlike
  capture's on-demand one; proved readable: PLANE LAT/LON/ALT + SIM ON GROUND + phase). (2) ATC via
  the VATSIM datafeed (data.vatsim.net/v3/vatsim-data.json, public JSON, 15s refresh) — each online
  controller has callsign, frequency, facility (DEL/GND/TWR/APP/CTR), lat/lon, visual_range(nm).
  (3) RECOMMENDATION LOGIC — TOP-DOWN AWARE (the core; Dean stressed this). VATSIM hierarchy
  DEL<GND<TWR<APP<CTR: a controller owns their position PLUS every lower tier that isn't independently
  staffed. So it is NOT "nearest controller" — it is: for the user's airspace+phase, find the
  target tier (ground→DEL/GND/TWR; dep/arr→TWR/APP; enroute→CTR), then pick the LOWEST online tier
  that OWNS that airspace; if the specific tier is offline, walk UP to the next online tier covering it
  (top-down substitution). A staffed lower position always beats the higher for its own airspace;
  top-down only fills gaps. Ex EGLL: DEL off + TWR on → TWR covers clearance/ground; TWR+APP off +
  LON_CTR on → Center covers the whole field top-down. Coverage = distance(user,ctrl) <= visual_range
  (a heuristic, NOT exact sector polygons — good guidance, fuzzy at sector edges; the datafeed has no
  polygons). ONLY when nothing up to & including CTR covers the user is it uncontrolled → CTAF/unicom
  per the CTAF block below.
  **(3b) COVERAGE ACCURACY UPGRADE via boundary polygons (Dean 2026-07-07 — fixes the fuzzy-edge/
  crossover problem).** Real airspace shapes make "am I in this controller's area" a point-in-polygon
  test instead of a range circle. TIERED (each optional, falls back to the layer below):
  · FALLBACK: visual_range circle (global, crude, always works).
  · BIG WIN: **VATSpy Data Project** (github.com/vatsimnetwork/vatspy-data-project) — GeoJSON FIR/ARTCC
    boundary polygons + callsign→FIR map, global, per-AIRAC → point-in-polygon for CTR; + **SimAware
    TRACON** (github.com/vatsimnetwork/simaware-tracon-project) — approach/TRACON polygons for APP.
    Both official + worldwide + moderate effort.
  · BEST (where covered): **VATGlasses** (github.com/lennycolton/vatglasses-data) — sub-FIR sector JSON
    that ALREADY models top-down ownership + sector combination (it already answers "who owns this
    point given who's online") — read its answer vs reinvent. CAVEAT: region-by-region coverage (UK
    etc. great, gaps elsewhere) → CANNOT be the only source; needs VATSpy/circle beneath. All three
    need a periodic AIRAC data-refresh job (like community routes). Top-down LOGIC (3) is unchanged —
    polygons just feed it precise coverage.
  (4) AUTO-SET STANDBY via SimConnect COM_STBY_RADIO_SET
  event (node-simconnect transmitClientEvent) — STANDBY ONLY (never active, never interrupts a live tx;
  vPilot reads the sim's COM so a swap-to-active tunes VATSIM), OPT-IN toggle. Panel shows "you should
  be on LON_CTR 127.100 (covers you at FL340)" + nearby controllers by relevance + one-click Set
  standby. CAVEATS: VATSIM-only (not SayIntentions baseline flights); visual_range is a heuristic not
  a sector polygon (present as strong guidance + show the list, not gospel); poll datafeed ≤ every
  15-30s. Proven probe: scratchpad/where_am_i.js reads live position via node-simconnect (needs
  NODE_PATH=project node_modules; sim must be running). This is a differentiated feature — vPilot only
  shows a raw list; ABRP would curate "the right freq NOW" + tune it.
  **(5) IN-SIM OVERLAY (Dean 2026-07-07):** transient toast ON the sim when standby changes — a SECOND
  Electron BrowserWindow that's transparent + frame:false + alwaysOnTop + skipTaskbar +
  setIgnoreMouseEvents(true) click-through, positioned over MSFS; reuse the flightToast styling, fade
  in ~4-5s then out. WORKS in borderless/windowed MSFS (common setup); EXCLUSIVE fullscreen hides any
  external window (document the requirement). SimConnect legacy on-screen Text API would survive
  fullscreen but is deprecated/flaky in MSFS 2024 — test as a bonus, don't rely on it.
  **CTAF (CORRECTED by Dean 2026-07-07 — my "122.800 always" was WRONG):** VATSIM rule is: at/near a
  larger (towered) airport with no ATC, pilots use **CTAF = that airport's TOWER frequency** (that's
  where the field's traffic is); switch to **122.800 unicom only after departure / enroute**. So the
  no-ATC answer is position-dependent, NOT a constant. Logic: (a) controller covers you → controller;
  (b) no controller BUT in the airport environment (on ground, or initial climb/approach within
  ~10-15nm of the field + below pattern/transition alt) → CTAF = the airport's tower freq; (c) no
  controller + enroute → 122.800. This DOES need per-airport tower-freq data — source = **OurAirports
  frequencies.csv** (free, open, ICAO-keyed, TWR freqs GLOBAL — fixes the "US-only CTAF" worry; ~30k
  rows, bundle or fetch). Alt source: SimConnect facility-data freq request from the sim's own nav
  (elegant, no external DB, but heavier API + uncertain node-simconnect support — treat as nice-to-have).
  The "airport environment vs enroute" boundary (~10-15nm + pattern alt) is a tunable constant.

## 🛬 STALE-D-ATIS → WIND-CROSSCHECK RUNWAY (Dean 2026-07-08, plan-approved design)
> Ship as a small index.html-only patch (docs bump only, no engine touch). Reuses existing fns —
> `fetchDatis`, `bestRwy`, `getRunways`, `parseWind`, `zuluAgeMin`. datis.clowd.io US fallback is
> ALREADY wired (main.js:1008-1013) — nothing to add there.

### Context
The EGCC route card showed a **7h 25m-old** scraped D-ATIS runway as if authoritative. Research
confirmed there is NO reliable redundant real-world D-ATIS source for UK/EU (ACARS datalink only;
atis.guru is the sole public scrape, and it's what we use — stale/fragile). So the fix can't be
"find a fresher D-ATIS." Dean's key insight (2026-07-08): don't THROW AWAY the stale D-ATIS runway
(it uniquely encodes the dep/arr split, preferential/noise config, multiple runways, and the runway
commercial traffic actually favors — none of which raw wind knows). Instead, **cross-check the
last-good D-ATIS runway against the current METAR wind: keep it while the wind still fits; only when
the wind has genuinely swung behind it (a real tailwind) do we default to the wind-derived runway.**
Physics fit: a runway REVERSAL (05↔23) is a ~180° shift → a big tailwind → caught; a PARALLEL swap
(27L↔27R, same heading) is wind-invisible → correctly left on the D-ATIS (which is exactly the
noise/schedule case we WANT to keep trusting). Honest blind spot (documented, not oversold): the
wind check CANNOT see non-wind changes — runway closures/NOTAMs, construction, timed noise swaps —
but it's still strictly better than blindly trusting a 7h-old runway, and no cheaper source can.

### Locked decisions (Dean 2026-07-08)
- **Staleness threshold = 3 h** (reuse the existing METAR_STALE_MIN=180 pattern; add
  DATIS_STALE_MIN=180). Under 3h → trust D-ATIS outright, behavior UNCHANGED.
- **On genuine contradiction → DEFAULT to the current-METAR/wind runway** (not show-both), labeled as
  an estimate. "Genuine contradiction" uses a REAL-WORLD tolerance, not best-into-wind: a tower
  switches the active only when the **tailwind component exceeds ~5 kt** — so TAILWIND_MAX_KT=5
  (tunable const). A light off-wind/crosswind is NOT a contradiction → keep the D-ATIS.
- Calm/variable wind (VRB or spd<3) → NEVER override; keep the D-ATIS (calm never invalidates a
  runway). No runway-heading data for the airport (not in RWY_HDGS + live fetch empty) → keep the
  D-ATIS + age note (can't check).

### The logic (extend fetchDatis at index.html ~5581, where D-ATIS currently overrides the field)
Before writing `RWY <rwyTxt> · D-ATIS`, when the block has a runway AND `zuluAgeMin(info.time) >
DATIS_STALE_MIN` AND wind is usable:
1. Parse current wind: `const w = parseWind(S.metarCache[icao]?.rawOb)`. If !w or VRB or w.spd<3 →
   keep D-ATIS (append " · Nh old" amber note). Done.
2. For EACH runway token the D-ATIS lists (info.runways — already an array), look up its heading via
   `getRunways(icao)` and compute the tailwind component (= negative headwind, reusing bestRwy's own
   angle math: `angle = min(diff,360-diff)`, `tail = -Math.round(spd*Math.cos(angle·π/180))`). If NO
   heading for a token, treat it as "can't judge" (don't let it trigger a swap on its own).
3. **Contradiction test:** the D-ATIS is contradicted only if EVERY judgeable listed runway has
   tailwind > TAILWIND_MAX_KT (5). If any listed runway is still acceptable (tailwind ≤5) → NOT
   contradicted → keep D-ATIS, soft note: `RWY X · D-ATIS · Nh old — still fits current wind`.
4. **On contradiction →** default to the wind runway: `const best = bestRwy(icao, w.dir, w.spd)`
   and render `RWY <best> · ⚡ est. from wind (HHMMZ)` with a one-line why:
   `D-ATIS Nh old showed RWY <stale> — wind now favors <best>; verify on ATIS.` (side-aware verb via
   the existing isArr → Landing/Departure wording at 5585-5589). Amber styling like the age tag.
- Fresh D-ATIS (<3h) path is byte-unchanged. The missing-D-ATIS synthetic-from-METAR branch
  (5549-5573) already exists and is untouched — this only changes the "have a stale runway" branch.

### Files
- index.html ONLY: fetchDatis (~5511-5589) — the stale-crosscheck branch + DATIS_STALE_MIN /
  TAILWIND_MAX_KT consts near METAR_STALE_MIN (~5155). Verify the Free-Route / Trip-Planner cards
  route through this same fetchDatis (they share `rwy-*` element IDs) — if a twin path overrides
  separately, mirror the branch there. README changelog + SKILL.md one-liner so chat matches.
- main.js: NONE (datis.clowd.io US fallback already present).

### Verification
- Desk-sim the decision fn (pure): (a) fresh D-ATIS → unchanged; (b) stale + wind aligned → keep +
  "still fits"; (c) stale + wind reversed (05 stale, wind 230/15 → ~15kt tailwind) → swap to 23 +
  conflict note; (d) stale + light off-wind (≤5kt tailwind) → keep; (e) calm/VRB → keep; (f) parallel
  swap invisible to wind → keep (correct); (g) no RWY_HDGS heading → keep + age note.
- Live: reproduce the EGCC 7h case (or force a stale time) → confirm the card shows the wind runway +
  conflict note when wind contradicts, and the reassuring "still fits" note when it doesn't.
- Function-parse index.html; commit + push per standing rules.

### Deferred (not this patch)
- Live ADS-B / real-traffic runway inference (OpenSky/ADSB-Exchange) — the only source that truly
  OBSERVES the active runway (handles the non-wind blind spot, dep/arr, preference). Bigger lift +
  live-traffic-availability dependent; log as the follow-up if the wind cross-check proves too coarse.
- VATSIM live ATIS runway (only when a controller is online) — folds into the VATSIM freq-helper idea.

- **✅ SCRAPPED — BookmarkDrop (see the ❌ entry above; shelved 2026-07-07, HttpOnly cookie).**

- **✅ PARTLY RESOLVED v6.3.1 — (b) honest counter SHIPPED (new + rotated-out reported; live count
  tracks _siNewSeen). (a) snapshot cap: Dean DECIDED 2026-07-06 to keep 20,000 ("plenty of
  variability for a cookie-less user") — snapshot set is intentionally frozen; auto-publish stays
  quiet by design (skip log now explains + points to publish.bat). Original note:**
  (a) routeSnapshot.json is at its 20,000 cap — mergeIntoSnapshot stops archiving NEW route IDs
  once full ("not adding more until user exports", index.html ~2260), so the never-pruned insurance
  archive has quietly stopped growing. Fix: raise MAX to 30,000 (+~7MB JSON, trivial) and/or tie to
  R1 quarterly GitHub-release exports. (b) At the 5,000 registry cap, "N routes added" is NET
  (after−before = always 0) even though new routes rotate in during every refresh (verified: all
  5,000 entries last_seen <24h; processPage adds freely, pruneRegistry trims oldest back to cap).
  Fix: track genuinely-new IDs during the refresh and report "X new · X rotated out" instead.

- **✅ FIXED v6.2.1 (same day) — GSX bundled-profile UPDATE gap (found 2026-07-06, real case):**
  gsxPlaceFile in main.js: name-match anywhere in the GSX tree → hash-compare → update in place
  (bak'd) only when bundled is newer; local-newer never clobbered; renderer scans uncached folders
  regardless of installed status. 7/7 desk-test incl. KJFK replay. Dean's KJFK .ini also manually
  updated same day (old kept as .bak-2026-07-06). Original note: the auto-install skips any
  airport whose profile filename already exists in Virtuali\GSX\MSFS (gsxInstalled = name match), so
  a scenery UPDATE bundling a NEWER profile never refreshes the installed copy. Proven: iniBuilds
  KJFK scenery (added 2026-07-06) bundles kjfk-24-inibuilds.ini dated 2026-07-02; Dean's installed
  copy is 2025-05-25 and hash-DIFFERENT (.py identical). Fix: when a bundled profile name matches an
  installed one, hash-compare; if different AND the bundled file is newer, copy it (back up the old
  one, e.g. .bak or timestamped) + toast "GSX profile for X updated from scenery". Cache note:
  gsxScanCache skips re-walks only for airports NOT installed — installed airports are skipped
  before the cache, so the update check needs its own cheap pass (name-match hits only).

- **resolveUnknownAirports noise (2026-07-05, minor):** renderer logs "resolveUnknownAirports error
  KLVB: Unexpected end of JSON input" at startup — an unknown-airport lookup returns an empty/broken
  body and the JSON parse throws. Harmless (caught + logged) but noisy; add an empty-body guard and
  skip quietly. Pre-existing, not v6-related.

- **Active-flight route protection + clickable Recent Routes (Dean, 2026-07-02 — root cause
  CORRECTED after Dean's pushback).** Dean found KFLL→MMUN as a REAL registry route (fresh filter),
  SimBriefed it 13:41Z; the 8-hour auto-refresh completed 13:51Z and pruneRegistry() DELETED the
  route (last_seen June 3 = 29 days > the 21-day cutoff; registry also pinned at the 5000 cap) —
  it vanished from Plan a Flight mid-session while he was flying it. The never-pruned SNAPSHOT
  retains 4 KFLL↔MMUN JetBlue routes (that's the proof). My first diagnosis ("ephemeral Free Route
  search") was WRONG. Fix, two parts: (a) pruneRegistry() exempts pairs present in
  recentSimBriefRoutes (30 entries) and sessionSimBrief from BOTH the 21-day and 5000-cap prunes —
  those are exactly the routes Dean is actively flying; (b) make the dashboard "Recent Routes"
  strip clickable — re-opens the full route detail (weather, D-ATIS, runways, SimBrief), sourcing
  from the registry and FALLING BACK TO SNAPSHOT data when the registry no longer has the pair.

### ✅/❌ Decisions (Dean, 2026-06-30, "clean up the phase")
- ✅ **Companion "close on sim exit" — DONE v5.9.30.** ❌ Installer .nsh — Dean hasn't seen the Retry
  prompt in recent updates, so the v5.9.17 app-side fix took hold; dropped. ❌ Navigraph dev creds —
  Dean passed. ❌ Settings drag-to-reorder — dropped. B4/B5 engine bits — parked (low value).
- ✅ **Cache-cleaner-on-version-change — DONE (v5.9.31–v5.9.37).** Shipped: shader-cache cleaner
  (all NVIDIA roots incl. LocalLow + ComputeCache, D3DSCache, Steam, MSFS cache; two-reboot guidance;
  MSFS-running guard) + per-aircraft PMDG/Fenix WASM cleaners (work-folder preserving) + the
  version-change watcher. **v5.9.37** broadened the watcher to 4 triggers: nvidia-smi **driver** →
  shader; Steam appmanifest **sim build** → shader+both WASM; **PMDG** aircraft version (manifest.json,
  liveries excluded, library path from config) → PMDG WASM; **Fenix** version → Fenix WASM. First run
  seeds silently. Verified directories/regex/work-preservation + the aircraft-version reader against
  Dean's actual system (PMDG 4.0.52, Fenix 2.4.0.4720) + the flightsim.to tool + NVIDIA docs.
- ✅ **NVCP backup/restore (Phase 6 / locked-decision #6) — DONE (v5.9.38).** Ports
  backup_nvidia_settings.bat + restore_nvidia_settings.bat as Settings → MSFS Maintenance buttons.
  Backs up nvdrsdb0/1.bin (global 3D + all game profiles incl. MSFS) from C:\ProgramData\NVIDIA
  Corporation\Drs → USER_DATA\nvidia_settings_backup (timestamp-archives previous); restore copies back
  (reboot to apply); "last backup" stamp. Pure fs, admin-aware. **Dean to live-test the Back up button**
  (verify the two .bin land in the backup folder) — mirrors how the cleaners were proven.
- 🧭 **AutoFPS handling — PLAN (build when Dean starts AutoFPS, post-baseline).** Tag + exclude from
  fixed-TLOD baseline, still log/chart. Design:
  - **Tag:** engine stamps `autofps_active` (auto-detect the AutoFPS process — it already enumerates
    processes for telemetry top_proc; need the exe name) + a manual ABRP "flying AutoFPS" toggle as
    backup. Default false.
  - **Ramifications:** (a) the logged `tlod` becomes only the START/cap, not what rendered — label it
    "dynamic"; (b) Launch+Capture auto-TLOD (--prep-next) is pointless under AutoFPS (it overrides) →
    the "flying AutoFPS" toggle should SKIP prep-next; (c) exclude from coverage + the 24-cell baseline
    + the fly-next recommender; (d) Compare should treat AutoFPS as its own group.
  - **Value from the logs:** (1) validates AutoFPS itself — is it actually smooth (P99/stutter/cons) at
    your target FPS; (2) **AutoFPS vs fixed-TLOD comparison** (the killer one — Compare "AutoFPS" vs
    your baseline groups: better smoothness? at what VRAM/visual cost?); (3) VRAM behavior under
    dynamic LOD; (4) spike forensics still apply. **Future:** sample the dynamic TLOD over the flight
    (needs AutoFPS to expose it via LVAR) → learn the real-world effective-TLOD range.
  - **Framing:** the fixed-TLOD baseline is the MAP; AutoFPS drives it dynamically. Finish the baseline
    first, then AutoFPS becomes the daily driver and the logs verify it lands well on the map.


### 🔬 Plan-a-Flight / weather / routes audit (2026-06-30, polish phase)
Nothing broken — solid overall. Opportunities, by area:
- **METAR (aviationweather.gov):** well-built (chunks 300/cap 400, merges only after all chunks so a
  partial failure never blanks, keeps last-good cache on total failure, 30-min refresh + on-open).
  **Single source** — add a fallback (e.g. NOAA / checkwx / aviationweather TAF endpoint) for outage
  resilience. **Optimize:** re-derives the airport scope by scanning the WHOLE routeRegistry (≤5k) on
  every 30-min fetch — cache the scope, recompute only when library/registry changes.
- **D-ATIS:** US/Pacific (K/P) → atis.info JSON (solid). **International → atis.guru HTML SCRAPE
  (fragile — silently breaks if their markup changes).** CYFI having none is EXPECTED (tiny
  non-towered field; no D-ATIS exists anywhere for it) — not a bug. Consider: a secondary intl D-ATIS
  source, and/or surface "D-ATIS only exists at larger towered airports" so a blank reads as normal.
- **Routes (SayIntentions, ~15k):** good fields (airline, callsign, aircraft, dep/arr, flight_length,
  distance_nm, times_seen=reliability, description). Strong filters (fleet/mode/dir/aircraft/duration/
  region/airline/search) + sorts (incl. clever weather best/worst). **✅ DONE v5.9.28 — region filter
  expanded** to all 8 world regions (data-driven REGION_PREFIXES). Still cookie-dependent (BookmarkDrop
  queued).
- **Weather resilience — REASSESSED (lower value than it first looked).** A METAR "fallback source"
  doesn't truly de-risk: aviationweather.gov IS NOAA, and nearly every free METAR source (VATSIM metar,
  tgftp, etc.) is NOAA-derived — so an outage takes them all down together. aviationweather.gov is the
  standard + very reliable, and the code already keeps last-good data on failure. Independent providers
  (checkwx/avwx) need API keys. → **Low priority; not worth the API-key plumbing for marginal de-risk.**
  The realer fragility is the **intl D-ATIS atis.guru HTML scrape** (silent breakage), but free intl
  alternatives are thin. Cheap win available: clarify in-UI that "D-ATIS exists only at larger towered
  airports" so a blank reads as normal (CYFI confusion).
- **METAR scope cache — REASSESSED: skip (premature optimization).** The full-registry rescan is ≤5k
  iterations every 30 min — negligible CPU, not a hot path. Per [[optimize-code-and-data]]: flag, don't
  force. Not worth the added state/invalidation complexity.
- **FR24 API:** paid (credit tiers), historical+live positions/airline/airport metadata, but **no
  flight schedules yet** (coming) and overlaps the existing FlightAware "verify" link. Low priority
  for route planning; could add live/historical "is this route actually flown" verification at cost.
- **Navigraph APIs (the more interesting one):** **Navigation Data API is FREE for devs** (end-user
  needs a Navigraph sub — Dean has one via SimBrief). Could give authoritative airport/runway/
  procedure (SID/STAR) data → a better, less-fragile "Active Runway" + approach panel than the
  atis.guru scrape. **Charts API is NOT available to ABRP** (granted only to in-sim/in-process apps).
  SimBrief API already used by the engine. → Worth exploring Navdata API for runway/procedure data.
- **Optimize (ongoing, [[optimize-code-and-data]]):** cache the METAR scope; getRoutes() re-filters the
  full registry on every render (fine at 5k, watch as it grows); badge poll 7s + flight watcher 6s are
  acceptable; raw frametimes.csv growth → Phase 7 retention.


### 🔎 Deep-review findings — flight 2026-06-29_2214 (Fenix/175 KPHL-KBOS, v5.9.21 Launch+Capture)
Flight data is excellent (p99 17.46ms, 99.9% consistency, 201,916 frames, clean trims head 5s/tail
22.5s, 4-phase split). Auto-TLOD verified CORRECT (set 175 for Fenix = genuine thinnest gap; matched
the tracker). METAR (aviationweather.gov, 394/405 cached, fltCat present) + D-ATIS (atis.info,
KBOS/KPHL hasData=true) both working. Findings:
- **✅ DONE v5.9.22 — single-engine guard.** Multiple armed-but-never-flown engines (from earlier Arm
  Capture tests) ALL fired on this takeoff → 7× "Rolling/RECORDING", 6× "Nothing filed" +
  `_capture_tmp.csv` permission collisions; one won and filed cleanly. `perf-start-capture` now
  taskkills any existing `perf-engine.exe` + orphaned `PresentMon-x64.exe` before arming. (Roadblock
  #3 "one capture path only" — now enforced.)
- **Armed-but-never-flown auto-exit (engine-side) + capture status indicator + Cancel** — the guard
  stops the pile-up, but an armed engine still lingers between arm and flight, and could misfire on a
  later flight. Engine should detect sim-closed-with-no-flight and exit; ABRP shows armed/recording/
  idle + a Cancel. (Was Section-A deferred; now PROVEN harmful — raise priority.)
- **Engine log noise** — SimConnect data-def retries during flight-load are logged at **ERROR**
  (`ERROR SIM def(...)`), flooding the log; they're benign ("flight may still be loading"). Downgrade
  to debug/suppress until connected. Also the `(Press ENTER to start capture manually...)` line prints
  even under `--headless` (no console) — suppress when headless.
- **sim_version JUMP 1.7.27.0 → 1.7.35.0** (this flight is the first on 1.7.35; the other 23 are
  1.7.27). Real SU update — validates the cache-cleaner-on-version-change trigger + the "bump your
  baseline" heads-up; benchmark now spans two sim versions (1 flight on the new one).
  **Clarified (Dean, 2026-06-30):** sim_version + driver_version are ALREADY logged per flight (in
  summary.json/index.json) — the gap is **DISPLAYING them per flight** in the dashboard flight table
  and **flagging** any flight whose version differs from the rest (so the lone 1.7.35 stands out). Plus
  the SU-detected surface ("may not be baseline-comparable; consider clearing shader cache + re-base").
- **🧰 ENGINE-UPDATE PASS — bundle the engine-side fixes into ONE rebuild + ONE test flight** (don't
  re-freeze perf-engine.exe repeatedly). Cluster: armed-but-never-flown auto-exit; log-noise (SIM-def
  ERROR → debug, suppress headless ENTER print); per-flight version display + version-mismatch flag in
  the report; `texture_quality` parse. Edit `msfs_perf_logger.py`, re-freeze, Dean tests one flight.
  (The capture status indicator/Cancel is ABRP-side and can ship independently.)
- **VRAM headroom surfacing** — peak 92% (11.3/12.3 GB) at TLOD 175. Show a VRAM-headroom indicator
  /warning (thin margin near the top of the sweep).
- **CPU-bound insight** — 100% CPU-bound, GPU only 7.29ms busy. Surface "CPU-bound — GPU has headroom"
  as a takeaway (explains why TLOD 175 still holds 60fps via FSR FG 2x @ target 30).
- **`texture_quality: null`** — engine couldn't parse texture quality from UserCfg.opt. Minor parse
  gap; capture it for completeness.
- **Weather redundancy = none today.** METAR single-source (aviationweather.gov), D-ATIS single-source
  (atis.info). Add a fallback METAR source (e.g. NOAA/checkwx) so a source outage doesn't blank
  weather. (D-ATIS already degrades to METAR "Check ATIS" when atis.info lacks an airport.)

- **✅ DONE v5.9.19 — Fresh Routes — defer hiding until app close.** `openSimBrief()` adds the city pair to
  `recentSimBriefRoutes` immediately, so a just-SimBriefed route disappears from **Plan a Flight**
  the moment you leave and return — you can't reference its details while flight planning.
  **Decided (Dean):** don't hide on the SimBrief click; commit the pair to `recentSimBriefRoutes`
  on **app close** (before-quit / window close) so it stays visible all session and only starts
  hiding next launch. (Detail: memory `fresh_routes_removal_timing.md`.)
- **Settings: drag-to-reorder sections + persisted order.** Headers are now collapsible (v5.9.9).
  Next: make them draggable so Dean can pull commonly-used categories to the top, order saved in
  config. Needs wrapping each section (header+body) into one draggable element — more involved than
  collapse. Then consider the same collapsible/draggable theme in other menu sections.
- **Cross-system portability audit (Dean, 2026-06-29) — for sharing ABRP with others.** Since the
  reopen bug was a PS 7-vs-5.1 "works on my machine" failure, sweep the app for anything that assumes
  Dean's specific setup before sharing: (a) all spawned shells use `powershell` (5.1, default on every
  Windows) not `pwsh`; (b) any PowerShell that parses data does it in Node, not PS-side
  `ConvertFrom-Json` (the landmine that just bit us); (c) no hardcoded user paths / drive letters /
  installed-tool assumptions (use `$env:`, `userData`, config); (d) bundled deps (perf-engine.exe,
  PresentMon, chart libs) ship via `extraResources` and resolve by `process.resourcesPath` when
  packaged; (e) first-run UX on a machine with none of Dean's apps installed (empty seed list is fine).
  Tie-in: the existing roadmap items on code-signing/SmartScreen + "Performance Log Users" permission.
- **Auto-offer cache cleaner on sim/driver version change (Dean, 2026-06-29).** When the logging
  detects a new `sim_version` (already stamped per flight) or a new GPU driver version, surface the
  MSFS shader-cache cleaner (the Phase 6 Settings tool ported from `Clear_MSFS2024_ShaderCache.bat`).
  An SU or driver update invalidates the shader cache, so stale cache → stutters + recompilation —
  cleaning right after a version bump is exactly when it helps. **Prompt, don't silently auto-run:**
  clearing is destructive-ish, needs the sim not running, and has manual pre/post steps (disable
  NVIDIA shader cache, reboot, re-enable) per locked-decision #7. Ties into Phase 6 (cleaner
  mechanism) + the "bump your baseline" heads-up (already watches `sim_version` jumps). May need to
  also stamp `driver_version` per flight if not captured today (NVML is already loaded for VRAM).
- **✅ DONE v5.9.19 — Multi-instance app reopen (Dean, 2026-06-29) — Radarr + Radarr-4K.** Shipped via
  approach (a): reopen launches ALL Startup shortcuts whose target matches each saved exe path (not
  one), validated in real PS 5.1. Known edge (acceptable): an app with more Startup shortcuts than
  running instances would over-launch — uncommon, revisit only if it bites. Original note: Dean runs TWO Radarr
  instances off the **same `Radarr.exe`** (differ only by Startup shortcut / `--data` folder:
  `Radarr.lnk` vs `Radarr-4K.lnk`). The reopen saves apps by **exe path + de-dups** (`new Set`), so
  the two collapse to one saved entry and only ONE relaunches. Fix deliberately (with real PS 5.1
  validation, per [[work-discipline-validate-before-ship]]): either (a) don't de-dup — capture each
  instance and relaunch via ALL matching Startup shortcuts (shortcuts differentiate instances), or
  (b) capture each instance's command line/args and relaunch per-instance (careful: args broke
  v5.9.13 — would need the robust path+args approach, not bare `-ArgumentList`). Affects only
  multi-instance apps; single-instance apps are unaffected by this gap.
- **Companion Apps: per-app "close when sim closes" checkbox (Dean, 2026-06-29).** In the Companion
  Apps section, add a persistent on/off checkbox per companion (e.g. Navigraph Charts, vPilot) so a
  companion ABRP launches can also be auto-closed when MSFS exits. Reuses the Phase-3 sim-close
  watcher + the "kill-after" close machinery (`flightReopenApps` already kills the kill-after list on
  sim close). Just needs a `closeOnSimExit` flag per companion in config + feeding those into the
  watcher's kill list. Separate from the perf "apps to close during flight" list — this is about the
  companions Dean *launches*, closing on sim exit.
- **Flight app reopen — STILL BROKEN through v5.9.15; real fix in the Active Plan above.** History:
  v5.9.13 added command-line-args relaunch (regressed — args made Start-Process throw); v5.9.14
  reverted to shortcut/path + per-app logging; both still failed because the PowerShell 5.1
  `ConvertFrom-Json` read-back collapsed the N-app state file to 1. Fix = Node owns the state data
  (see "⛳ ACTIVE PLAN" above). Keep the recovery lessons: skip apps already running (Notifiarr 5454
  clash), and only relaunch apps that were actually closed — never a blanket "launch all Startup
  shortcuts."

*Complete port roadmap, both halves mapped, decisions locked, rollout = phase by phase.
Every file in the TLOD project has now been read first-hand (2026-06-27). No code is written
until Dean gives the go.*

## Guiding principle: PORT, don't rebuild

This is a **relocation**, not a rewrite. The Python engine moves as-is; it keeps capturing,
computing, and **generating Dean's existing HTML reports** (built from in-code Python string
constants — `write_report()` :1609, `rebuild_combined_report()` :2069 — so moving the file
preserves them). The only report change: swap the 3 chart-lib `<script>` URLs (Chart.js 4.4.1 /
hammer.js / chartjs-plugin-zoom, lines 1828–1830) from CDN to bundled local copies. **No data
loss** (17-flight `Sessions/` copied + verified, never moved blind). **No functionality breaks.**
**No big-bang** (standalone tool runs until each phase is proven).

**HARD RULE (Dean, 2026-06-27):** the original `Claude_TLOD_OLOD` folder is **untouched** for the
entire port — copy-only, additive. Dean keeps using the standalone tool in parallel the whole time.
Nothing there is moved, modified, renamed, or sunset until **Dean confirms the ABRP port works**.
The Closeout (archive/retire) happens only after that explicit confirmation.

## Locked decisions (Dean, 2026-06-27)
1. **Reports embedded inside ABRP** ⇒ bundle the 3 chart libs locally (offline-safe).
2. **Bundle the engine into the installer** (Python + PresentMon) — turnkey, shareable.
3. **Data home = `%APPDATA%\A Better Route Planner\Sessions\`** — survives updates, writable.
4. **Rollout = phase by phase**, each its own ABRP release, each with a TL;DR recap
   (*what changed · what to check · is `release.bat` needed*).
5. **Visuals = embed the existing HTML reports as-is** — preserves Dean's proven zoomable
   charts, zero risk. A native re-skin stays open as a later option (the data contract allows
   it without touching the engine), but is explicitly **not** part of the initial port.
6. **NVIDIA tools = port only the NVCP backup/restore**, as a GUI button in ABRP **Settings**
   (backs up + restores the global + MSFS-2024 Control Panel settings; handy at driver-update
   time). The Windows-Update driver block is **dropped**; the rollback guide is **archived** as
   a reference doc. None of the admin driver-rollback workflow is wired into ABRP.
7. **Shader-cache cleaner = port into Settings as a GUI button** (from Dean's desktop
   `Clear_MSFS2024_ShaderCache.bat`). Clears 7 cache locations (NVIDIA DXCache/GLCache/NV_Cache,
   Windows D3DSCache, Steam shadercache/2537590, MSFS SceneCache + cache). Destructive but safe
   (caches regenerate) — so it **confirms first**, guards on MSFS/sunrise/kittyhawk not running
   (reuse `isMsfsRunning()`), reports cleared/skipped, and shows the manual pre/post steps as
   on-screen notes (disable NVIDIA shader cache first, reboot + re-enable after) rather than
   automating them.
8. **Engine host = Python-first → native Node (committed end goal)** (Dean deferred the call to me).
   Reuse the proven engine now for zero functionality loss; reimplement natively later, proven
   byte-for-byte against the Python output via the data contract before switching. Single-language,
   fresh-install-friendly end state, safely. Transition outline drafted (→ `native-engine-transition.md`).
9. **Reframe — keep functionality, shed scaffolding.** "Port" was just to avoid starting from
   scratch; we drop the `.bat` wrappers, the PresentMon download dance, temp-file handoffs, and
   duplicate SimBrief fetches, and auto-enable the one-time capture permission — ABRP orchestrates
   natively. No lost functionality; original folder untouched until the port is confirmed.

## Reframe (Dean, 2026-06-27): keep the functionality, not the scaffolding
Dean loosened the "port" framing: the point is **retain + improve functionality**, not copy every
file. The literal-port idea was only to avoid starting from scratch. We're free to shed cruft, fix
inefficiencies, and choose what integrates best in a clean ABRP install (incl. a fresh-system
reinstall). Still bound by: **no lost functionality**, the original folder untouched until the port
is confirmed, and **no drastic change without Dean's sign-off** — so big forks below are surfaced,
not silently taken.

**Scaffolding to shed (functionality kept, implemented natively in ABRP):**
- **All the `.bat` launchers** — `record*`, `prep`, `tools/*`, `Convert_to_CapFrameX`. They exist
  only to find Python and run the script with a flag (and self-minimize). ABRP's main process
  spawns the engine with flags directly, so **none of the `.bat`s port** (kept as reference only).
  The `record_clean` app close/reopen *function* is already going native (Phase 3) — that's the
  model for everything: take the behavior, reimplement in ABRP, drop the wrapper.
- **PresentMon discovery/auto-download** (GitHub API dance) — dead weight once PresentMon is
  bundled. Collapse to "use the bundled exe," keep download only as a last-ditch fallback.
- **Inter-process temp handoffs** — `_prep_aircraft.txt` exists only because `record_auto.bat` runs
  prep-next and `--auto` as two separate Python processes. If ABRP orchestrates, it passes the
  aircraft in-memory/as an arg — the temp file disappears. Same for `_capture_tmp.csv` (→ proper
  temp dir).
- **Duplicate SimBrief fetches** — ABRP already fetches SimBrief for flight plans; the engine
  fetches again for route+aircraft. Fetch once, share.
- **The one-time "Performance Log Users" manual step** — ABRP runs as admin, so setup can do the
  `net localgroup` add itself (one click), instead of a README chore. Cleaner fresh install.

### Strategic decision (Dean deferred to me, 2026-06-27): engine host
**Decision: Python-first → native Node (one language) as a COMMITTED end goal** (not optional).
Rationale: Dean's hard constraint is no broken functionality, and he leans native long-term. We
reuse the proven Python engine now (relocate + freeze + `--headless`) so functionality is retained
immediately AND it becomes the **validation oracle**; because the data contract is the stable seam,
the native rewrite is then **proven byte-for-byte against the Python output before switching**. That
reaches the clean single-language, fresh-install-friendly end state Dean prefers *without* risking
the behavior that already works. A promptable transition doc is drafted below ("Native engine
transition"). Options considered:
- **Python-first, Node-native later (recommended).** Reuse the proven engine now (relocate + freeze
  + `--headless`) to retain functionality fast and safely; the **data contract
  (`index.json`/`summary.json`) is the stable seam**, so ABRP's UI doesn't care which engine writes
  it. Later, reimplement the engine natively in Node piece by piece for the cleanest single-language
  install — no Python, no PyInstaller, no `_MEIPASS`, smaller installer, ideal for a fresh-system
  reinstall. Best blend of speed/safety now + clean end-state.
- **Go Node-native now.** Reimplement the engine in ABRP's own language from the start. Feasible:
  PresentMon is an external exe (CSV parsing is trivial in JS); SimConnect has a real npm package
  (`node-simconnect`); VRAM via `nvidia-smi --query-gpu=memory.used` (ABRP already calls nvidia-smi)
  or an NVML addon; report HTML is just templating. Cleanest install, but a real rewrite of the
  capture loop, SimConnect auto-start debounce, trim, stats, phase split, and spike forensics —
  higher upfront effort + risk of behavior drift from the battle-tested Python.
- **Stay Python (frozen), no rewrite.** Simplest plan; accept a heavier bundled-Python installer.

### Native engine transition — Phase 8 spec / promptable outline (draft; → `native-engine-transition.md`)
*Goal:* replace `msfs_perf_logger.py` with a native Node implementation inside ABRP that produces
**identical `Sessions/` artifacts**, validated against the Python engine, with zero functionality
loss. *Method:* strangler-fig — build native modules behind the same flags/IPC, swap one at a time,
keep Python as fallback until each passes parity. **The data contract is both the spec and the test
oracle.**

**Validation harness (the safety net):** re-run the native stats over the existing 17
`frametimes.csv` and **diff `summary.json` field-by-field** against the Python-produced ones (match
within rounding); then a live back-to-back flight. A capability only retires its Python counterpart
once parity passes.

**Module map (Python → Node), ordered easiest/safest first:**
1. **Stats + trim** (`compute_stats`, head/tail trim) — pure math (percentiles, consistency, stutter,
   1%/0.1% low, cpu/gpu-bound). Direct JS port; highest-confidence parity. **Do first.**
2. **Report HTML** (`write_report`, `rebuild_combined_report`, the CSS/JS constants) — template
   strings; port verbatim to keep Dean's exact visuals. Easy.
3. **Index/nav writers** (`update_index`, `write_sessions_nav`) — JSON/CSV. Easy.
4. **PresentMon control** — spawn the bundled exe with the same flags via `child_process`; stop via
   CTRL_BREAK / `--terminate_on_proc_exit`. Easy.
5. **UserCfg.opt read/write** — regex the flat `{Graphics}` block (NOT `{GraphicsVR}`), surgical
   `LoDFactor` edit, backup + verify-readback. Must match the Python regex semantics exactly. Medium.
6. **VRAM** — NVML node addon, or 1 Hz `nvidia-smi --query-gpu=memory.used,memory.total` (ABRP already
   calls nvidia-smi). Validate peak/avg vs pynvml. Medium.
7. **System telemetry + AutoFPS auto-detect** — busiest non-MSFS process at 1 Hz (Node process
   enumeration). Medium.
8. **Coverage / prep-next / spike forensics / CapFrameX export** — logic ports; spike thresholds
   must match. Medium.
9. **SimConnect** (auto-start debounce, self-healing reconnect, phase split, TITLE normalize) via
   `node-simconnect`. **Highest risk — do LAST, needs live testing.** Keep Python live until this
   passes parity.

## Full first-hand inventory (every file read, incl. the whole engine, 2026-06-27)

### What the project actually is (expert summary)
A single ~3,600-line Python tool that uses Intel **PresentMon** to capture per-frame timing
while MSFS runs, samples **VRAM** (NVML) and 1 Hz **system telemetry** (psutil top-process),
auto-starts via **SimConnect** (waits for the aircraft to roll), reads/writes **TLOD/OLOD** in
`UserCfg.opt`, and files each flight as `frametimes.csv` + `summary.json` + a self-contained
`report.html`, rolled up into `index.json`/`index.csv` + a `combined_report.html` dashboard.
Beyond logging it also has real intelligence: a **coverage model** (Fenix/PMDG × TLOD cells,
target 3 each, floor TLOD 100) that drives a "fly next" panel and SimBrief-driven auto-TLOD
(`--prep-next`); **spike forensics** (`--spike-report`) that classifies stutters CPU/GPU/present/
external and joins telemetry; **reference-aircraft** handling (the Citation is logged but kept
out of the baseline); and **CapFrameX export**. Reports default to a dark CapFrameX-style theme
with a light toggle.

**Core (the logging product):** `msfs_perf_logger.py`, the launchers, `test_plan.json`, the
`Sessions/` tree, `sessions_nav.js`, `usercfg_backups/`, the `msfs-flight-analysis` skill.
**Ancillary (port selectively):** NVCP backup/restore (→ GUI), CapFrameX interop +
`--simcheck` (engine flags, low-priority UI), `list_running_apps`/`restore_apps` (fold into the
app close/reopen feature). **Out:** the WU-driver block (dropped), stale manual-era docs +
driver-rollback guide (archived).

**Two charting facts that matter:** the **combined dashboard is pure inline SVG — no internet
needed**; only the **per-flight `report.html` line charts** pull the 3 CDN libs (Chart.js 4.4.1
/ hammer / zoom, lines 1828–1830). So bundling just those 3 files makes everything render
embedded + offline. **Transient writes** I confirmed in-code: besides `Sessions/`, logs, and
`usercfg_backups/`, the engine writes `_capture_tmp.csv` and `_prep_aircraft.txt` next to itself
— so the writable `DATA_ROOT` must cover those too, not just `Sessions/` (see split + packaging).

### Engine entry points — the single integration surface
ABRP drives the engine entirely through CLI flags (confirmed in `main()` :3459–3582, read in
full), so the UI never touches engine internals. Full set (★ = missing from the handoff doc):
`--auto`, `--prep-next`, `--next-test`, `--combined`, `--rebuild-session ID`, `--rebuild-all`
(:3480), `--spike-report ID [N]`, **★`--simcheck`**, **★`--convert-path …`**,
**★`--export-capframex [ID|all]`**, `--aircraft NAME` (modifier), and no-flag = manual capture.
Anchor confirmed first-hand: `SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))` (:57);
the `MSFS_PERF_ROOT` env hook is **not yet applied** (documented only) — so the code/data split
is real work, not already done. Engine is now ~3,600 lines (the handoff's "2,300" was June-18).

### The NVIDIA driver A/B side-quest (mostly out; backup/restore kept)
`tools/backup_nvidia_settings.bat` + `tools/restore_nvidia_settings.bat` copy two `.bin` files
(`nvdrsdb0/1.bin`) between `C:\ProgramData\NVIDIA Corporation\Drs` and a backup folder — that's
all the NVCP global + MSFS profile settings. Dean wants **just this** as a Settings GUI feature
(Phase 6). The rest of the side-quest — `tools/block_wu_gpu_driver.bat` (Windows Update registry
policy) and `docs/2026-06-13-driver-rollback-guide.md` — is **not** ported: the WU-block is
dropped, the guide is archived under `perf/docs/` as reference. The existing `nvidia_settings_backup/`
`.bin`s stay as-is; ABRP's feature writes fresh backups into `userData`.
**Admin note:** reading/writing `C:\ProgramData\NVIDIA\Drs` needs admin. Dean runs ABRP as
Administrator, so `main.js` can copy directly; for a non-elevated/installed run, the action must
detect the lack of rights and prompt to elevate (don't fail silently).

### Other tools (all just engine flags — port along automatically)
`record.bat` (manual), `record_auto.bat` (`--prep-next` → `--auto`), `record_clean.bat`
(clean-flight + app close/reopen), `prep.bat` (`--next-test`), `tools/simcheck.bat`
(`--simcheck`), `tools/list_running_apps.bat`, `tools/restore_apps.bat`,
`Sessions/Convert_to_CapFrameX.bat` (`--convert-path`). `test_plan.json` = TLOD sweep
80→300 @ OLOD 120.

### ⚠ Launcher-tree gotcha (a real triple-check item)
`prep.bat`/`record_*.bat` self-locate with `cd /d "%~dp0"` (root); **`tools/*.bat` use
`cd /d "%~dp0\.."`** — they assume `tools/` sits exactly one level under the engine. So the move
must **transplant the tree intact** (engine at `perf/` root, `tools/` directly under it). Do
**not** reshuffle the launcher layout, or the `..` math breaks. (Handoff §1 flagged this; now
confirmed in every `.bat`.)

## Proposed ABRP folder structure
```
DeanMSFS_v2/
├── perf/                        ← the TLOD tree, moved INTACT (don't reshuffle)
│   ├── msfs_perf_logger.py
│   ├── test_plan.json
│   ├── record.bat / record_auto.bat / record_clean.bat / prep.bat
│   ├── tools/                   ← stays one level under the engine (keeps %~dp0\.. valid)
│   ├── docs/                    ← the .md references
│   ├── vendor/                  ← NEW: PresentMon-x64.exe + the 3 chart-lib .js files
│   └── driver-tools/            ← (only if decision B = carry along) nvidia bats + backups
└── …existing ABRP files
```
- **Data lives elsewhere** — `userData\Sessions\` (writable; survives updates). Engine points
  there via the `MSFS_PERF_ROOT`/`DATA_ROOT` split; `perf/` holds only code + read-only assets.
- **When installed**, `perf/` ships via electron-builder `extraResources` (real files Python /
  the frozen exe can run), never inside the read-only `app.asar`.

## The one real code touch: split code from data
Locked decisions split the engine (read-only) from its data (writable). The single-anchor design
assumes they're together, so add a **behavior-neutral** split: `DATA_ROOT` (env-driven →
`userData`) vs `ASSET_DIR` (rides with the exe). Unset env ⇒ identical to today, so the
standalone tool is unaffected.
- **Writable `DATA_ROOT` set (confirmed in-code):** `Sessions/`, `msfs_perf_logger.log`,
  `usercfg_backups/`, **and the transient `_capture_tmp.csv` + `_prep_aircraft.txt`** the engine
  writes next to itself today. The PresentMon auto-download dest is moot once we bundle it.
- **Read-only `ASSET_DIR` set:** the frozen exe, `test_plan.json`, bundled `PresentMon-x64.exe`,
  the 3 chart-lib `.js` files.
- **Why this is mandatory, not optional:** under PyInstaller the anchor (`__file__`) resolves to
  a temp `_MEIPASS` extract dir, so any SCRIPT_DIR-relative write would land in an ephemeral,
  wiped-on-exit folder. The split + bundled PresentMon are what make the frozen exe actually work.

## Phased plan — each phase ends with a TL;DR + release call

**Phase 0 — Relocate (the careful part).** Read the engine line-by-line first (it has grown and
already out-ran its own handoff on flags). Transplant the tree intact into `perf/`; add the
`DATA_ROOT`/`ASSET_DIR` split. **Copy** all 17 flights to `userData\Sessions\`, confirm
`index.json` reads all 17 back, keep the original as backup (don't delete). Verify the relocated
tool still runs standalone with identical reports. *Recap:* internal only. *Check:* 17 flights
list at new path; a standalone capture still files. *Release:* **none** (nothing user-facing).

**Phase 1 — Embedded Performance tab.** New tab reads `index.json`; embeds `report.html` +
`combined_report.html` (local chart libs) inside ABRP. *Check:* charts render in-app + offline,
identical to browser. *Release:* **`release.bat`**.

**Phase 2 — Bundle + trigger captures.** Freeze engine → `perf-engine.exe` (PyInstaller, with
`nvidia-ml-py`/`SimConnect`/`psutil`); bundle PresentMon + chart libs; spawn handler so Quick
Launch = launch MSFS **and** capture. Detect the one-time "Performance Log Users" permission.
*Check:* a Quick Launch flight records and appears in the tab. *Release:* **`release.bat`**
(build now runs the PyInstaller step first).
- ⚠ **Preserve the launch ORDER (the auto-TLOD race).** `--prep-next` reads the SimBrief aircraft,
  picks the thinnest coverage-gap TLOD, and writes `UserCfg.opt` — and that write MUST land *before*
  MSFS starts and reads the file. The existing 5s Quick-Launch delay (companions now, MSFS +5s) is
  exactly what guarantees it. When ABRP owns the sequence it must keep the order: **run prep-next →
  wait → launch MSFS → engine `--auto`.** Lose the order and auto-TLOD silently stops. (This is the
  real reason for the 5s delay; ABRP's current code comment about "another project" is misleading —
  correct it.)

**Phase 3 — Background-app close/reopen, native (your original ask).** ⭐ Per-app checkboxes in
`config.json`, ABRP-owned; "Detect running apps" reuses `Get-Process | Where {$_.Path}`.
Preserve close+reopen / close-no-reopen (qBittorrent) / kill-after-sim (Steam). *Check:* unticking
an app leaves it running; reopen still works. *Release:* **`release.bat`**.

**Phase 4 — TLOD/OLOD control + coverage tracking.** Surface current TLOD/OLOD; pick next from
`test_plan.json` (wraps `--next-test`); back up `UserCfg.opt`; refuse while sim runs
(`isMsfsRunning()`). Surface the **coverage / "fly next" tracker** (the 24-flight benchmark =
Fenix+PMDG × TLOD 100/125/150/175 × 3; reference aircraft like the Citation auto-excluded).
- **Benchmark-complete handling (Dean-triggered, NOT auto).** When Dean says the 24 are done, the
  coverage / "fly next" panel can be **removed/hidden on his signal** — a deliberate toggle, not an
  auto-hide-on-completion. Make it **reversible** (he may re-baseline after a driver or sim update),
  and decoupled from logging: hiding the tracker must NOT stop normal flight logging. Open question:
  does hiding it also quiesce the auto-TLOD `--prep-next` (just log whatever he flies) — see Q below.
*Release:* **`release.bat`**.

**Phase 5 — Spike forensics (optional).** Buttons for `--spike-report` / `--convert-path` /
`--export-capframex`, or leave to the analysis skill. *Release:* **`release.bat`** if shipped.

**Phase 6 — Settings utilities (independent quick wins, decoupled from the engine port).** Two
small Settings features, each a `main.js` IPC handler exposed via `preload.js`; could ship early.
  - **NVIDIA NVCP backup/restore.** Two buttons + a "last backup" stamp: **Back up** copies
    `nvdrsdb0/1.bin` from `C:\ProgramData\NVIDIA\Drs` into `userData\nvidia_settings_backup\`
    (timestamp-archiving any previous); **Restore** copies them back and prompts a reboot. Handle
    the admin case (Dean runs as admin; otherwise detect + prompt to elevate). *Check:* backup
    writes both `.bin`s; restore puts them back; clear "reboot to apply" note.
  - **MSFS shader-cache cleaner** (from `Clear_MSFS2024_ShaderCache.bat`). One button that, after
    a **confirm** and a **sim-not-running guard** (`isMsfsRunning()` + sunrise/kittyhawk check),
    empties the 7 cache folders and reports cleared/skipped. Pre/post manual steps (disable NVIDIA
    shader cache first; reboot + re-enable after) shown as on-screen notes. Destructive-action
    confirmation is mandatory (it deletes files, even if they regenerate).
  *Release:* **`release.bat`**.

**Phase 7 — Data retention & archival (storage that scales).** Raw `frametimes.csv` is the only
heavy artifact (50–120 MB each, ~500 MB now, unbounded). Two-tier retention so history is never lost:
- **Tier 1 — keep forever, never archived:** every flight's `summary.json` + `report.html` + its
  `index.json` entry (all tiny). Dashboard, history, and baseline analysis stay 100% intact
  regardless of archival.
- **Tier 2 — raw capture (`frametimes.csv`, optionally `telemetry.csv`): retention policy.** Keep
  raw for the **most recent N flights (default 24)**; older raw files are **gzipped in place**
  (`frametimes.csv.gz`) — compressed, NOT deleted (~5–10× on this columnar text, so ~500 MB →
  ~50–100 MB).
- **Pin the benchmark:** the 24 Fenix/PMDG raw captures are **protected from archival until Dean
  signals the benchmark complete** (ties to the benchmark-complete signal). Reference (Citation) +
  AutoFPS flights archive under the normal rolling rule.
- **Transparent restore:** teach the CSV readers to open `.gz` so `--spike-report` /
  `--rebuild-session` work on archived flights automatically (decompress on demand); plus a manual
  "restore raw" button.
- **Dean's .zip ask + backup twist:** one-click **"Export flight(s) to .zip"** (a single flight, a
  date, or the whole `Sessions/` tree) to a chosen folder — doubles as the irreplaceable-data backup.
- **Storage view + opt-in:** Settings shows `Sessions/` size, raw-vs-archived split, projected
  savings; archival runs as a **manual button** with an optional **auto-policy toggle** ("keep raw
  for last N"). **Nothing auto-deletes** — archive = compress, reversible. Archives live in
  `userData` by default; optional relocation to an external/backup drive keeps `userData` lean.
*Release:* **`release.bat`**.

**Phase 8 — Native engine transition (FINAL — the one-language end state).** Runs **last**, only
after Phases 0–7 are live and functioning as expected on the proven Python engine. Reimplement the
engine natively in Node per the **"Native engine transition — Phase 8 spec"** above (extracted to
`native-engine-transition.md`): port module-by-module easiest-first, **prove each one byte-for-byte
against the Python output before retiring it**, SimConnect last (riskiest, live-tested). Net result:
one language, no bundled Python, no PyInstaller freeze, smallest/cleanest fresh-system install. The
data contract means ABRP's UI and your `Sessions/` data never notice the swap. *Release:*
**`release.bat`** per module group as parity passes — never a big-bang. This is the phase your
question was pointing at: the under-the-hood swap that happens once everything else just works.

**Closeout — Sunset the standalone TLOD project.** (Gated only on the **Python** port being
confirmed — independent of Phase 8, so it can happen well before the native rewrite.) Paste-prompt
for the TLOD session to archive the old folder read-only (not delete), retire duplicated launchers,
mark its README "superseded by ABRP." Tailored to what actually moved.

## Future / down-the-road (post-benchmark — NOT for the initial port)
Captured for direction; not built until the 24 are done and Dean asks. Nothing here is nerfed —
the benchmark machinery stays available (hidden, reversible) so a new baseline can be learned.
- **Re-baseline capability.** Keep coverage/auto-TLOD/`--prep-next` intact behind the hide toggle.
  Starting a fresh sweep (e.g. new TLOD cells, or after a sim/driver change) re-activates the
  "fly next" recommender and the auto-TLOD-before-launch flow.
- **"Bump your baseline" heads-up.** A proactive nudge when conditions shift — e.g. a `sim_version`
  jump (already stamped per flight) plus data suggesting a higher TLOD is now smooth. Foundation
  exists: per-flight `sim_version`, the knee computation, and the analysis skill already flags a
  `sim_version` jump as the prime suspect for a performance shift. Would surface as a Performance-tab
  alert ("SU update detected — recent flights smoother; consider re-baselining").
- **AutoFPS awareness (important data-integrity item).** Once the baseline is set, Dean will likely
  run **AutoFPS**, which changes TLOD *dynamically in-flight* to hold a target FPS. So an AutoFPS
  flight is NOT a fixed-TLOD data point — the TLOD read from `UserCfg.opt` at launch is only the
  starting cap, not what rendered. Such flights must be **flagged and excluded from the fixed-TLOD
  baseline** (same pattern as reference aircraft today), while still loggable for general tracking.
  Detection (decided): **auto-detect AutoFPS in the running-process list** (the engine already
  enumerates processes for the telemetry `top_proc`) and auto-tag the flight, with a **manual
  override toggle as a safety net**. Needs a new `autofps_active` field on the session record +
  baseline/coverage filters that honor it.

## Roadblocks & expert improvements (found by reading the whole codebase)

### Must-handle roadblocks (would bite blind)
1. ⚠ **The engine assumes an interactive console (the big one).** In `--auto`, the Enter-watch
   thread calls `stop_event.set()` *after* `input()` returns — and on a closed stdin (a headless
   spawn) `input()` raises EOF immediately, so **capture would stop the instant it starts.** Today
   it works only because `record_auto.bat` runs in a (minimized) console with real stdin.
   **Decided: headless.** Add a small **`--headless`** flag (to the ABRP copy only — original
   untouched) that skips the Enter-watch and stops purely on sim-exit (`--terminate_on_proc_exit`).
   Additive + behavior-neutral when the flag is absent. Also audit the trailing
   `input("Press Enter to exit…")` calls in the other spawned modes for the same EOF-on-no-stdin
   trap (guard or skip them under `--headless`). Verify in the Phase-2 freeze POC.
2. ⚠ **De-risk the PyInstaller freeze EARLY.** Build a throwaway `perf-engine.exe` and verify a
   real flight captures **VRAM (pynvml/nvml.dll) + SimConnect (SimConnect.dll) + PresentMon** before
   building any Phase 2 UI around it. These native deps are the classic "works in Python, dies
   frozen" failure; may need `--collect-all`/`--hidden-import` and DLL bundling. This POC is the
   single best risk-reducer in the whole plan.
3. **One capture path only.** When ABRP starts spawning captures (Phase 2), its Quick Launch must
   **replace** the old `record_*.bat` entry, not run alongside it — two PresentMon ETW sessions
   collide (`--stop_existing_session` means the 2nd kills the 1st). Migration guard needed.
4. **Defender / SmartScreen.** A fresh unsigned `.exe` that spawns PresentMon (ETW frame tracing)
   can trip SmartScreen/Defender — fine locally (maybe an exclusion), but if Dean ever shares ABRP,
   code-signing becomes relevant.

### Subtle improvements (additive, low-risk — fold in as we go)
- **Spawn the capture DETACHED** so closing ABRP mid-flight never kills logging (preserves the
  established "activate → Quick Launch → close ABRP while MSFS loads" flow). This is the real
  safety mechanism behind Dean's close-confirm dialog.
- **"Sim is running — confirm close?" dialog** (Dean's ask): on ABRP close while `isMsfsRunning()`,
  warn + confirm (don't hard-block — closing during load is his normal flow).
- **Theme-match the embedded reports.** The reports already use CSS variables; inject ABRP's
  palette so the embed matches ABRP's look (its orange accent vs the report's blue) **without
  touching the charts**. Preserves his visuals, makes it feel native.
- **Lazy-load the Performance tab.** Render a fast native flight list from `index.json`; embed the
  heavy `report.html` only when a flight is opened (raw reports are large).
- **Backup/export Sessions button.** The flight history is the irreplaceable payload — a one-click
  "export my flight data" (zip to a chosen folder) is cheap insurance now that it lives in `userData`.
- **Storage hygiene.** Raw `frametimes.csv` is ~500 MB and grows 50–120 MB/flight. Show a storage
  stat and offer "keep raw data for the last N flights" (summary.json + report.html stay tiny; raw
  CSV is only needed for `--rebuild-session`/`--spike-report`). Engine could gain a `--prune` flag.
- **Schema versioning.** When ABRP adds fields (`autofps_active`, etc.), bump `index.json` `version`
  and keep back-compat readers — the engine already self-heals `index.csv` headers; mirror that care.

## Triple-check list (the things most likely to bite)
1. **Move the tree intact** — don't reshuffle `tools/` (breaks `%~dp0\..`).
2. **`DATA_ROOT`/`ASSET_DIR` split must be byte-neutral** when the env var is unset (standalone
   unaffected).
3. **PyInstaller freeze** — NVML (VRAM) + SimConnect are the classic "works in Python, dies in
   the frozen exe" failures; verify both from `perf-engine.exe`.
4. **Chart libs offline** — after CDN→local swap, run `--rebuild-all` and confirm per-flight
   line charts render with the network off (dashboard SVG bars already need no internet).
5. **17-flight copy verified before touching the original**; raw `frametimes.csv` (~500 MB) stay
   out of git + the installer.
6. **External paths stay put** — `UserCfg.opt`, `%TEMP%\msfs_closed_apps.txt`, the Windows
   Startup folder (record_clean reopen logic). Never repoint these.
7. **Read the real engine first** — it's ~3,600 lines and already exceeded its handoff's flag
   list; trust the code, not the doc, at Phase 0.

## Acceptance criteria (clean port = all true)
- All `Sessions/` data readable at `userData\Sessions\`; `index.json` lists all 17 flights.
- Reports still generate, look identical, render embedded + offline.
- Manual + auto capture, clean-flight close/reopen, `prep.bat` stepping all still work.
- The `msfs-flight-analysis` skill reads the data at its new path.
- ABRP spawns `perf-engine.exe`, embeds reports; `userData` data survives an app update.
- No feature regressed vs. the standalone tool.

## What happens next
All decisions are locked; the roadmap is complete and parked in plan mode. The first build step
whenever Dean says go is **Phase 0** — a first-hand line-by-line engine read, the intact-tree
move into `perf/`, the behavior-neutral code/data split, and the verified 17-flight copy (with
the original kept as a backup). Each phase ends with its TL;DR recap. (Phase 6, the NVIDIA
backup/restore, is independent and could be pulled forward as an early quick win if wanted.)


---

## 📻 PER-AIRCRAFT RADIO WRITE — ✅ PMDG ADAPTER BUILT + BENCH-PROVEN (Fable, 2026-07-11, commit 6e2b2ed; unreleased, no bump)
> Built as designed, PMDG-only v1: LiveATC reads TITLE, maps the PMDG knob events (#70358/#70359),
> writeStandby = closed-loop knob walk (bursts → fresh 1 Hz re-read → re-plan; LEARNS knob polarity +
> channel step 25 vs 8.33 kHz; pilot-interference abort; honest verify; self-disables per session on
> failure; caps sized for 8.33 radios — 12-click inner bursts / 26 rounds / 260 clicks). Renderer:
> click-gated "Set standby (PMDG 737)" button on the Live ATC card, shown only when main.js reports
> the loaded aircraft writable; never called from the poll; active frequency untouchable. Pivot-guard
> test updated to the new contract (28/28) + test_pmdg_adapter.js (21/21, incl. planner math + registry
> gating); board 39/39. Fenix stays read-only (MobiFlight-gateway design below, parked). **OWED LIVE:
> Dean cold-gate test — PMDG at a gate, Live mode on, click Set standby, watch the RMP walk + ✓ verify;
> also try radio unpowered (expect honest failure) and turning the knob mid-walk (expect abort).**
> Original design below. Supersedes the "🎛️ PARKED (option C)" note above with concrete,
> header-verified mechanics. Plain-English verdict first:
> **PMDG = genuinely buildable, natively, with ZERO new dependencies.** Everything needed was
> verified against Dean's OWN installed SDK header (PMDG_NG3_SDK.h in his 738 package) and the
> bundled node-simconnect's type definitions — no guessing.
> **Fenix = requires a third-party gateway (MobiFlight WASM module) for BOTH read and write** —
> a real dependency Dean would install into Community, plus LVAR names that must be confirmed on
> his install. Park it unless the PMDG adapter proves the concept and Dean wants more.
> **The "read-only spin-off" is MOOT for PMDG and no cheaper for Fenix:** PMDG already publishes
> COM active AND standby to the standard sim variables (proven live at EDDF — ABRP read his
> standby 124.850 correctly; only the WRITE is ignored), and the PMDG SDK data feed doesn't even
> carry COM standby (verified: the struct has only ADF_StandbyFrequency). On the Fenix, reading
> the standby needs the same WASM gateway as writing it — so there is no cheap read-only win.
> Skip the spin-off; build the PMDG write directly if this goes ahead.

### How it works (PMDG 737) — the "walk the knob" mechanism, made concrete
The PMDG radio ignores the sim's SET event, but its cockpit controls are drivable by custom
SimConnect events — the same way SPAD.neXt and home-cockpit hardware do it. Verified constants
from Dean's own header:
- `THIRD_PARTY_EVENT_ID_MIN = 0x00011000` (69632)
- COM1 radio knobs: `EVT_COM1_OUTER_SELECTOR = +726` (the MHz/whole-number knob) and
  `EVT_COM1_INNER_SELECTOR = +727` (the kHz/decimal knob)
- One knob click = one event with parameter `MOUSE_FLAG_WHEEL_UP = 0x4000` (turn up) or
  `MOUSE_FLAG_WHEEL_DOWN = 0x2000` (turn down)
- node-simconnect wiring (verified in the bundled .d.ts): `mapClientEventToSimEvent(id, '#70358')`
  (the `#` prefix means "raw event number") + `transmitClientEvent(...)` sent to the user aircraft
  with highest group priority. This runs over the EXISTING LiveATC SimConnect client — no new
  connection.

**The algorithm (closed-loop, not blind):**
1. Read the CURRENT standby from `COM STANDBY FREQUENCY:1` (already in the LiveATC data
   definition; proven to read correctly on the PMDG).
2. Compute the knob clicks needed: whole-MHz delta on the outer knob (wrapping 118→136), then
   the decimal delta on the inner knob in the radio's channel steps (25 kHz, or 8.33 kHz
   channels when enabled).
3. Send the clicks in short bursts (~5 clicks, ~50 ms apart), RE-READ the standby between
   bursts, and correct course from the fresh reading — a feedback loop, never a fire-and-forget
   click count. This self-heals any missed/double click.
4. After the walk, verify the standby matches the target within the existing LATC_FREQ_TOL
   (5 kHz). Verified → "✓ loaded 121.755". Not verified after 2 correction rounds → honest
   failure ("couldn't drive the radio — tune manually"), and the adapter marks itself
   unreliable for the rest of the session (no repeat spam, no false promises).

### Architecture — a per-aircraft "adapter" registry (the safe-degradation core)
- New small module (e.g. `vatsim/radio_adapters.js` or inline in main.js LiveATC): each adapter
  declares `match` (normalized aircraft title terms, reusing the Phase-10 match machinery),
  `canWrite()`, and `writeStandby(hz)`. v1 ships exactly ONE adapter: PMDG 737 (`pmdg`,`737`,`738`).
- No adapter matched → the UI never shows a write button at all (today's read-only behavior,
  unchanged). Adapter matched but verify fails → honest failure + session disable. A PMDG update
  that renumbers events (their SDK has kept these IDs stable for years, but still) lands in the
  SAME verify-fail path — the feature degrades to today's read-only behavior, never mistunes.
- UI: ONE small "Set standby (PMDG)" button on the Live ATC card + overlay panel, visible ONLY
  when the active aircraft matches an adapter. ⚠ This deliberately reverses a slice of the
  v6.7.0 "read-only pivot" — the pivot-guard test (scratchpad test_standby_verify.js, rewritten
  2026-07-10) asserts the write path is GONE and must be updated in the same change, or it will
  correctly scream.

### Fenix (Stage 2, OPTIONAL — honest cost/benefit)
- The Fenix runs its radio logic in an external process and does NOT accept the standard SET
  event; its standby isn't even published to the standard sim variable (read stale — proven
  live). The community path is Fenix's own LVARs (S_*/E_*/N_* scheme) driven through the
  **MobiFlight WASM module** — a free, widely-used Community add-on that exposes LVAR
  read/write + `execute_calculator_code` to external SimConnect apps over client data areas
  (which node-simconnect supports: mapClientDataNameToID / requestClientData verified present).
- Build shape if ever wanted: require the MobiFlight module installed (detect; link from
  Settings), register as client `ABRP`, read the RMP standby display var, drive the RMP encoder
  vars in a closed loop exactly like the PMDG walk. Exact Fenix LVAR names MUST be confirmed on
  Dean's install first (HubHop/MobiFlight list them; they change less often than they're
  mis-quoted on forums).
- Recommendation: DON'T build until (a) the PMDG adapter has proven the loop live and (b) Dean
  actually feels the gap on Fenix flights. The Fenix RMP still drives the sim's ACTIVE com (vPilot
  works), so the missing piece is only standby convenience — modest value vs. a new dependency.

### What could bite (front-loaded)
1. **Pilot turns the knob mid-walk** — the closed-loop re-read between bursts detects an
   unexpected value and ABORTS (never fights the pilot). Walks are short (<2 s) and only run on
   an explicit button click — no background writes, ever (v6.7.0 lesson stands).
2. **8.33 kHz channel table** — the sim stores 132.975 while the channel label may differ by up
   to ~4.17 kHz; all comparisons reuse LATC_FREQ_TOL (5 kHz), the exact fix that already
   de-flaked the look-ahead in v6.6.4.
3. **Radio unpowered / panel off** — clicks do nothing; the verify loop reports honestly
   ("radio may be unpowered").
4. **Event group priority** — custom events must be transmitted with highest priority or the
   aircraft never sees them (classic silent failure; SPAD/MobiFlight both do this). Bake it in
   from day one.
5. **PMDG update renumbers events** — verify-fail path degrades safely to read-only; the header
   ships with the aircraft, so re-verification after a PMDG update is a 2-minute check.
6. **MSFS 2024 delivery quirks** — 2020-era custom-event patterns are reported working in 2024
   for the PMDG, but this is exactly what the cold-gate test exists to prove; zero risk to
   anything else if it doesn't (adapter just reports unverified).
7. **The pivot-guard test** must be updated in the same commit that builds this, or the
   regression board fails by design.

### Verification
- Bench: dry-run mode logs the planned click sequence (from a mocked current freq) without
  sending — desk-testable math (wrap-around 136→118, 8.33 steps, burst chunking).
- Live (the real gate, ~5 minutes, no flight needed): PMDG cold at a gate → click Set standby →
  watch the RMP walk to the target → ABRP reports "✓ loaded (verified)". Repeat with radio
  panel off (expect honest failure), and once mid-knob-fiddle (expect abort).
- Regression: full VATSIM suite + updated pivot-guard test green; node --check; renderer parse.

---

## 📡 VATSIM ROUTE SCORE — ✅ BUILT (2026-07-11, v6.10.0 commit 6cb217c + v6.10.1 commit 03db671 — awaiting Dean release.bat)
> v6.10.1 follow-up (Dean: "make full coverage obvious, DEL not required"): END-TO-END ✓ badge
> (full:true = all tiers of both fields served dedicated-or-topdown + gapless enroute) on pill
> (solid border + ✓) and detail row (green chip). +2 honesty fixes: staffed TWR covers own-field
> GND/DEL topdown (VS_RANK ladder); enroute walk counts APP TRACON polygons (fills VATSpy FIR holes
> at terminals — KJFK in no FIR polygon). test_vscore 41/41.
> Shipped as designed: vatsimRouteScore pure scorer (ARR45/DEP30/ENR25, topdown 0.45, sibling 60nm
> enroute walk — latcFreqStack byte-untouched), VSCORE per-pair memo on feed-ts, chip + dynamic sort
> + stacked pill + clinical detail row. test_vscore 30/30 (incl. exact-weight cases: CTR-only topdown
> =59, lone dep TWR=11, arr-vs-dep 27>17, APP-preferred-over-CTR credit) + 15 VATSIM suites green
> (227 assertions). LIVE-VERIFY OWED (Dean): first toggle-on "…" → pills ≤3s, sort flips + restores,
> cross-check a staffed hub vs the VATSIM map, detail chips match reality, Live ATC coexists.

### Context
Dean's ask: like the "✱ Fresh routes" chip, add a "📡 VATSIM" toggle in Plan a Flight that scores every
route by LIVE VATSIM ATC coverage — departure staffing (DEL/GND/TWR/APP), enroute Center coverage along
the route, arrival staffing (APP/TWR/GND) — with a sort by best coverage, so the app answers "what's a
good VATSIM route right now" instead of Dean asking Claude. Reference researched: nextsimflight.com
scores AIRPORTS only (DEL/GND/TWR/APP/CTR chips + Staffing%/NSF Score%; its route filter is a binary
"VATSIM: Any/Online") — our per-route score incl. enroute goes beyond it. Everything needed already
exists from the Live ATC build: the datafeed (works with Live mode OFF — renderVatsimAtisBtn already
uses it in Plan a Flight), the OurAirports DB, VATSpy/SimAware polygons, gcSamples, latcFreqStack.
**No new IPC. All work in index.html + version files.**

### Locked decisions (Dean, AskUserQuestion 2026-07-11)
- **Arrival-biased weights** (arr staffing > dep > enroute), **top-down = partial credit** (dedicated
  position full points; Center/Approach covering the field top-down ≈ 45%), scope = **Plan a Flight
  list + expanded route detail panel ONLY** (NOT Free Route / Trip Planner). Detail-panel integration
  must be CLINICAL — the panel is already busy; one compact row in the existing pill language.
- Scores compute only while the toggle is ON (zero cost otherwise).

### Scoring model (0–100)
- **ARR 45**: APP 18 · TWR 18 · GND 9. **DEP 30**: DEL 3 · GND 6 · TWR 10.5 · APP 10.5.
  **ENR 25**: covered-fraction × 25 (share of great-circle samples under an online CTR/FSS FIR).
- Tier credit: `full`=1.0 (dedicated field position, exactly as latcFreqStack's fieldPos finds them);
  `topdown`=0.45 (no dedicated position but an online APP whose TRACON polygon covers the field, or an
  online CTR whose FIR covers it — computed ONCE per airport, reused across its tiers); `off`=0.
- 0 = dark network; 100 = fully staffed both ends + gapless Center coverage.

### Implementation (all index.html; verified anchors)
1. **State/config**: `S.cfg.vatsimRoutes` flag (default false, beside freshOnly ~1230; restore ~1273 —
   set flag + chip .on only, NO fetch at boot). Module state `VSCORE={on,cache:new Map(),ts:0,prevSort,
   loading}` near LATC (~6087).
2. **Pure scorer** `vatsimRouteScore(depApt,arrApt,controllers,dbMap,stepNm)` after latcFreqStack
   (~6162) → `{score, dep:{del,gnd,twr,app:'full'|'topdown'|'off'}, arr:{app,twr,gnd}, enrPct,
   +callsigns per credit for tooltips}` or null on missing apt/db. Uses latcFreqStack UNMODIFIED for
   dedicated positions (briefing/handoff depend on it — do not touch); enroute fraction = a small
   SIBLING gcSamples walk at 60nm step counting samples where any online CTR/FSS airspaceCovers===true;
   top-down check via traconCovers/airspaceCovers at the field lat/lon.
3. **Memo** `vscoreFor(r)`: key `dep|arr` (routes share pairs heavily); whole-cache clear when
   `_vFeed.ts!==VSCORE.ts` (mirrors latcStackForNow ~6463). Compute lazily (sort comparator + pill both
   call it → only filtered routes compute, once per pair). Cache nulls too. If unique pairs in the
   filtered list >500 → stepNm=120. Use `_vFeed.controllers` directly (LATC.controllers only exists in
   Live mode).
4. **Toggle** `toggleVatsimRoutes()` beside toggleFreshOnly (~2914): flip+save; ON → chip shows
   "📡 VATSIM …" while `vscoreEnsureDeps()` = Promise.all(latcEnsureDb(), airspaceLoad(),
   vatsimFeedGet()) + a 200ms poll if LATC.db is still in-flight (Live ATC may have started it), then
   dynamically INSERT `<option value="vatsim">Sort: Best VATSIM coverage</option>` into #sort-f (~544),
   remember prevSort, select it; OFF → restore prevSort, remove the option. renderRoutes() either way.
   Chip markup in #fresh-row (~507): new chip takes `margin-left:auto` (remove from #fresh-toggle-btn)
   so both sit right-aligned. Lazy boot trigger: in sw('routes') (~1425), if restored-on and never
   loaded → vscoreEnsureDeps().then(renderRoutes).
5. **Sort branch** in getRoutes() (~2754, model = wx-best): score desc, unscored→-1 sinks, duration
   tiebreak. Skip the Free Route twin (~3051) per scope.
6. **Row pill — NO new <td>** (5× colspan="7" would need touching; table already dense): when ON,
   `getVatsimPill(r)` (beside getWxPill ~5564, same 86px mono pill language: `📡 72`, bands ≥70 green /
   ≥45 blue / ≥20 amber / >0 orange / 0 grey "📡 —" / null "📡 …", numeric-only tooltip
   "DEP 24/30 · ENR 82% · ARR 33/45") stacked UNDER the wx pill in the existing WX cell (~2808/2815,
   `<div style="margin-top:2px">`). Zero footprint when off.
7. **Detail panel — one clinical row** `vscoreDetailRow(r)` between dp-strip end (~2836) and dp-grid
   (~2837), only when ON + scored: `📡 VATSIM 72 · DEP [DEL][GND][TWR][APP] · ENR 82% · ARR
   [APP][TWR][GND]` — tier chips lit (full) / half-lit amber w/ title "Covered top-down by <cs>
   (partial credit)" (topdown) / dim grey (off), in the metarPills idiom (~5595). **Every callsign
   through esc()** (remote feed data — 2026-07-02 XSS rule).
8. **Version v6.10.0**: package.json + index.html ×3 (tname 349 / sb-ver 393 / footer ~7139) + README
   header + changelog.

### Verification
- Desk test (scratchpad test_vscore.js, pattern = test_briefing.js: slice the LATC block from
  index.html, stub _airspace): full-staff both ends + full FIR → 100 & all chips full; empty feed → 0;
  CTR-only over dep → dep tiers topdown (≈13/30) + partial enr; dedicated TWR only → mixed;
  arr-only staffing outranks identical dep-only (weight sanity); half-covered path → enrPct≈50;
  latcFreqStack byte-untouched (briefing/recommend/handoff/ground-progression suites re-run green).
- Live (Dean): toggle from cold → "…" then pills ≤3s; sort flips + restores; a known-staffed hub
  (VATSIM map cross-check) scores high with matching chips; detail row matches reality; toggle-off
  removes everything; restart-with-flag-on fetches nothing until Plan a Flight opens; Live ATC
  running alongside = unaffected.
- Perf: renderRoutes with max route count <150ms warm (memo) — if not, add bbox prefilter to
  airspaceCovers (designed, only-if-measured).
- Renderer Function-parse + full VATSIM suite; commit/push per standing rules; Dean release.bat.

### Risks (accepted/mitigated)
First-toggle latency (feed ~20MB + DB + polygons) → honest "…" chip state. Polygon cost on huge lists →
60nm step, per-pair memo, 500-pair→120nm cap, gcSamples 400-sample ceiling. Feed-refresh mid-scroll
reorder → same behavior as existing wx sorts (accepted). XSS → esc() on all callsigns.

## 🕶 VATGLASSES SUB-SECTOR OWNERSHIP TIER — ✅ BUILT + BENCH-PROVEN (Fable, 2026-07-11, commit 01c47e0; unreleased, no bump)
> Shipped as designed: main.js airspace-data sv:3 compiles the full 155-file set (5,087 positions /
> 9,753 sectors, 8 MB, 4 s; old sv:2 caches re-download once automatically); renderer _vgPosFor/_vgAt/
> vgCovers run AHEAD of traconCovers/airspaceCovers in recommendFreq with the null-vs-false safety
> rule. Proven on REAL data (test_vatglasses.js 17/17 + full-build integrity 6/6 + board 38/38):
> Greece FL340 owned by LGGG_CTR; LGAD_APP outranks LGGG_CTR by owner priority (curated top-down!);
> FL154 cap respected; US point byte-identical fall-through; LON_CTR owns central England; 0.08 ms
> per resolution. LIVE-VERIFY OWED: next European VATSIM flight — compare vs the VATGlasses site;
> first launch (or Settings refresh) rebuilds the airspace cache to sv:3. Original design below. Slots in as the finest coverage tier:
> **VATGlasses sector-ownership → SimAware TRACON polygon → VATSpy FIR polygon → circle.**
> What it adds over today: (1) SUB-SECTOR precision — when a big Center splits (LON_S/LON_SC/
> LON_CTR), it names the exact position that owns Dean's chunk of sky instead of "a London
> Center covers you"; (2) ALTITUDE awareness — VATGlasses sectors carry min/max flight levels,
> which no current tier has (all 2D today); (3) codified TOP-DOWN ownership — each sector lists
> its owners in priority order, so "who covers me when X is offline" comes from curated data
> instead of our tier heuristic. Limitation to keep front-of-mind: coverage is region-by-region
> (Europe strong, US patchy) — it can only ever be an ENHANCER on top of the existing tiers,
> never a replacement.

### The data (format verified from the official wiki, 2026-07-11)
- Repo: github.com/lennycolton/vatglasses-data, `/data/*.json` — one file per vACC (~dozens of
  files, a few MB total). Community-maintained, AIRAC-cadence updates.
- Each file: **positions** (id → {pre: callsign-prefixes, type: suffix like CTR/APP, frequency,
  callsign}) — this triple is how an online datafeed controller is matched to a position;
  **airspace** (array of {id, owner: [position ids in PRIORITY order, first online wins —
  may cross datasets as "country/position"], sectors: [{min, max (flight levels, inclusive),
  points: [["ddmmss","dddmmss"], …] polygon}]}); **airports** (icao → topdown array); optional
  runway-conditioned sectors.
- **Resolution algorithm** (what VATGlasses itself does): match online controllers → position
  ids (prefix + type + frequency) → find sectors containing (lat, lon, altitude) → walk that
  airspace's owner list in order → the first position that's online owns the point. That's the
  whole trick — the ownership intelligence is IN the data.

### Build design
1. **Download/cache (main.js `airspace-data`, bump cache to sv:3).** Fetch the `/data` listing
   via the GitHub contents API, then each country JSON from raw.githubusercontent (reuse
   `_httpGetLarge`; sequential, polite). COMPILE ONCE in main.js into the existing
   airspace.json cache: parse the "ddmmss"/"dddmmss" strings to decimal [lon,lat] rings
   (sign = leading minus; divide out degrees/minutes/seconds), pre-compute a bounding box per
   sector for cheap point prefiltering, flatten to
   `vg: { positions: {id:{pre,type,freq,callsign}}, sectors: [{airspaceId, owner[], min, max,
   bbox, ring}] }`. Older caches (sv<3) re-download automatically — the exact pattern sv:2 used
   for TRACONs. Refresh rides the existing Settings "refresh airspace data" button; cache is
   fine for an AIRAC (28 days).
2. **Renderer resolution (pure, desk-testable).** New `vgResolve(lat, lon, altFt, controllers)`
   → `{positionId, callsign, freq, controller}` or null:
   a. index online controllers by position id (prefix/type/frequency triple, memoized per feed
      timestamp like latcStackForNow);
   b. candidate sectors: bbox test → ring test → altitude within [min·100ft, max·100ft];
   c. per matching airspace, walk owner[] — first ONLINE position wins; if several airspaces
      match the point (layered volumes), prefer the one with the smallest altitude span (most
      specific volume). Runway-conditioned sectors are SKIPPED in v1 (see landmine 4).
3. **Seam plug-in (recommendFreq, index.html ~6255).** Two touch points, both null-safe exactly
   like traconCovers:
   - **Per-candidate coverage:** `vgCovers(callsign, lat, lon, altFt)` → true/false/**null** —
     true/false only when the controller maps to a VATGlasses position AND some sector for it
     exists near the point; null whenever the region/callsign isn't in the dataset. Coverage
     resolution order per candidate becomes: vgCovers ?? traconCovers ?? airspaceCovers ??
     circle. (Null-propagation is the entire safety story: a region VATGlasses doesn't know
     must fall through untouched, never veto.)
   - **Owner-priority tie-break:** when MULTIPLE candidates of the same tier cover the point
     (two Center positions bandboxing), prefer the one earliest in the owning sector's owner[]
     list — replaces "nearest wins" with curated correctness. v1 may ship without this; it's a
     sort-key line once vgResolve exists.
4. **Briefing (latcFreqStack) stays untouched in v1** — the great-circle Center sampling keeps
   using FIR polygons. Upgrading the briefing to sub-sector precision is a clean v2 follow-up on
   the same vgResolve seam.

### What could bite (front-loaded)
1. **A false `false` is worse than no data** — if region matching is sloppy, vgCovers could veto
   a controller that IS covering Dean. Rule: return null unless the position id matched AND its
   country dataset contains sectors near the point. Desk-test the null paths hardest.
2. **Coordinate parsing** — "ddmmss" vs "dddmmss", negative-zero signs ("-000230"), and
   crossing the antimeridian. Parse with explicit sign handling; desk-test on known UK fixes.
3. **Frequency matching** — datafeed "129.675" vs data "129.67"/8.33 labels; normalize to kHz
   with the LATC_FREQ_TOL tolerance before comparing.
4. **Runway-conditioned sectors** (active only in certain runway configs) — v1 SKIPS them
   (we don't know the live config); mis-including them would assign dead sectors. Logged as the
   known v1 gap.
5. **Cross-dataset owner refs** ("country/position") — resolve at compile time in main.js;
   unresolved refs are dropped with a log line, never a crash.
6. **Dataset size/perf** — few MB parsed once in main.js; renderer gets the compiled index; the
   5s poll does bbox-prefiltered ring tests (micro-work). Memoize per feed-ts like everything
   else in the LATC path.
7. **Repo availability/rate limits** — ~dozens of raw fetches on first build; cache means it
   happens once per AIRAC. A failed partial download must not poison the cache (only write
   airspace.json when the compile succeeds — writeFileAtomic already in place).
8. **Community data quality drift** — a malformed country file must be skipped file-by-file
   (try/catch per file, log, continue), never abort the whole build.

### Verification
- Desk (scratchpad, real data): (a) dms→decimal on known coordinates; (b) UK file compile —
  position matching for a real LON_SC-style split, owner-walk with synthetic online sets
  (specific position online → picked; only bandbox online → falls up; none → null);
  (c) altitude bounds include/exclude (FL340 vs an FL195-capped sector); (d) a US point with no
  VATGlasses coverage → null everywhere → recommendation BYTE-IDENTICAL to today (regression:
  test_recommend.js, test_ground_progression.js, test_handoff.js, test_briefing.js all green
  untouched); (e) frequency normalization edge cases.
- Live (Dean, next European VATSIM flight): compare ABRP's named position vs the VATGlasses
  website for the same lat/lon/FL at a few points enroute; confirm a sub-sector handoff (e.g.
  LON_S → LON_C) is recommended where the old tier could only say "London Center".
