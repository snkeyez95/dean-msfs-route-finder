---
name: project-next-steps
description: Current state and next steps for the MSFS Route Finder / ABRP app
metadata:
  node_type: memory
  type: project
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
---

> Condensed 2026-07-14 (was 600+ lines of append-only history). Full history lives in the roadmap plan
> `imperative-drifting-rain.md` + git log. Keep this file CURRENT-STATE only.

## ▶▶ CURRENT: v6.12.3 BUILT + PUSHED — **Dean IS on v6.12.x now (he released)**
Confirmed live 2026-07-16: his Citation KASE-KSEA flight filed with gfx_fp + autofps_cfg +
periodic_stutter + trim_method 'brake' → the whole v6.12.0/.1/.2 stack is validated on real data.
**v6.12.3** = periodic-stutter verdict severity fix (Dean: "Fix the significance gate"): the gate
counted raw spikes, so a 2.2h flight with 5 brief bursts got the same red "engine overload" banner as
the 48-min EGLL flight that stuttered 18% of itself. Now judges **% of flight inside episodes ≥2%, OR
one run ≥60s**. Calibrated on all 34 real flights — the split is unambiguous (two genuine overload
flights at 10.13%/18.55%; every other flight with episodes ≤0.49% — a 20× gap). Post-regen across the
whole log: **2 RED (both correct) / 11 brief / 21 aperiodic**. test_sig_gate.js 13/13 + board green.
SKILL.md carries the same rule so chat matches the app.
**v6.12.4** = Active Runway fix (Dean caught KMIA "RWY 12 · D-ATIS" vs VATSIM ATIS "DEPG RWYS 8L,
8R"). THREE stacked bugs: (1) runway IDs compared as raw text — DB zero-pads ("08L"), US D-ATIS
doesn't ("8L") → every single-digit US runway rejected as invalid → empty parse. Hit KMIA/KBOS/KJFK/
KATL etc., and ONLY when runway data was loaded (no data → validator accepts everything), which is
why it hid; two-digit runways never affected. Fixed via normRwy/sameRwy canonical compare (also
un-broke xwind/tailwindComp, which silently returned 0/null). (2) fallback regex `\bRWY\s*` rejected
plural "RWYS". (3) **the real damage** — an empty parse left the field showing the PREVIOUS source's
runway + badge; now falls back to "⚡ est. wind" or "Check ATIS", never another source's answer.
test_rwy_padding.js 31/31 + ATIS/weather/VATSIM board green.
**LESSON:** any two runway-ID sources must be compared through normRwy — never `===`.
**v6.12.4–.7 = the KMIA→KMCO flight's harvest** (all Dean-spotted, all "a fallback/signal that doesn't
check its own precondition" — THE recurring bug family in the Live ATC layer):
 · **.4** runway IDs compared raw ("8L" vs DB "08L") → every single-digit US runway rejected → empty
   parse → card kept the PREVIOUS source's runway+badge. normRwy/sameRwy canonical compare (also
   un-broke xwind/tailwindComp). **Never compare runway IDs with `===`.**
 · **.5** "Next up" → "Later …— no ATC enroute" when the next entry is at the ARRIVAL field; deleted
   latcNextActionable (dead since v6.7.0).
 · **.6** frametime chart x-axis had no max → rounded up past the flight end, read as "capture stopped
   early". Pinned to CHART.total_min.
 · **.7** (a) top-down promotion now DIRECTION-AWARE: outbound lone tower uses the dep ring
   (LATC_CTAF_NM + low) so it releases on climb-out; inbound/pattern keep LATC_TWR_TOPDOWN_NM (the
   KLAS case). (b) latcNextUp on UNICOM offers the arrival's online ATC before the CTAF aid. (c)
   latcCheckToasts diffs latcSeqForNow() (online positions) not the rec set — "New controller online"
   no longer fires when YOU enter their airspace. (d) overlay unread = real state, survives live:false
   blips, clears only on expand. test_latc_v6127.js 27/27 + full VATSIM board green.
**Dean's flying facts (2026-07-16):** VATSIM connection is **OBSERVER mode** → he appears in the feed's
`controllers[]` (callsign CFG2, facility 0), **NOT `pilots[]`**, and **observers publish NO lat/lon** —
so VATSIM can never give his position. ABRP reads PLANE LATITUDE for LiveATC but never logs it
(telemetry = alt + gspeed only); he decided that's fine. He took Reset's advice: **Sens 3→5**.
**STILL OPEN:** radio-change logger (offered, not built — his radios being retuned by something
external; ABRP proven not guilty: PMDG-only adapter, click-gated, Citation matches nothing).
**LATENT:** airspaceCovers skips the '-SUFFIX' segment scan when prefixMap HITS (JAX→KZJX base only);
didn't bite (his route is all KZMA) but same family as the v6.6.x segment fix.
Older stack context:
**v6.12.2** = periodicity classifier refinement (Dean: "Adopt 1" from the AVSIM Test15 review):
dropped-spike bridging (skip-1 gap ≈2× beat bridges instead of fragmenting; ≥3× harmonic still
breaks) + final-cadence band-check (kills drift-induced sub-0.7s false episodes). Real result: EGLL
06-14 now ONE 70-spike episode (was fragmented 36); spawn-in false positives dropped to aperiodic.
33/33 sidecars reclassified (periodic_v='skip1-bridge', REPORT_V='periodic-stutter-v2'), raw logs
hash-proven untouched. 23/23 periodicity tests + full board green. NOTE: also confirmed live — Dean
dropped **AutoFPS maxTLod 800→700** (our autofps_cfg reader reads 700 correctly; the plan's 800→700
cap-change-card scenario is now real data waiting for his next 2 AutoFPS flights).
Older stack context (still delivered by the same release):
**v6.12.1 = PERIODIC-STUTTER CLASSIFIER** (from the AVSIM ResetXPDR spike-detection review, Dean:
"Build #1"): periodicity.js cadence test (0.7–1.8s marching spikes = engine overload → lower TLOD;
aperiodic = streaming/addon → TLOD won't help) over full PresentMon data; verdict line on every
report (significance-gated); already backfilled + regenerated all 33 real reports (raw logs
hash-proven untouched). Real findings: Fenix EGLL 06-13/14 pre-rBAR = textbook periodic (659 spikes
@1.22s); KLAS arr-taxi = aperiodic (diagnosis confirmed). AutoFPS test-build log tokens (SRed/LTD)
verified compatible with our LINE_RE. Remaining AVSIM-derived ideas in roadmap backlog: parse
DetectPeriodic/SRed events into the trace sidecar; ExitAppAfterFlightSession+IFR/VFR args for the
launch-time AutoFPS envelope.
ICAO* labels · scenery drag-drop + GSX variant picker · My Airports sorted/grouped · movable overlay
dot · honest AutoFPS TLOD labels (one-time report regen) · **v6.12.0 = SETTINGS A/B (the passive Lab
replacement — name locked by Dean) + live overlay perf strip**.
**v6.12.0 in one line:** every capture snapshots the graphics settings (10-key watch list,
gfx_watch.js, clouds 1=Medium calibrated) + AutoFPS min/max cfg; consecutive same-fingerprint flights
form runs per lane (fixed vs AutoFPS, never pooled); a change = a before/after card judged vs ±1σ
(verdicts incl. FREE UPGRADE = GPU busy up, smoothness+VRAM held); TLOD↔VRAM dot chart; GPU-busy
metrics retroactive on all 33 flights; overlay panel gains a one-line perf strip while recording
(perf_live.json, 5s). Lab UI fully removed (lab.js dormant); launchAndCapture no longer calls
perfLabNext. Tests: test_settings_ab.js 50/50 + 19 regression suites green.
**LIVE-VERIFY OWED next flight:** summary carries settings.graphics/gfx_fp; perf strip shows while
recording + vanishes at file time (Dean judges density — be ready to TRIM fields); then he changes
one watched setting → next flight → COLLECTING 1/2 card appears.
**LABEL CALIBRATION ✅ DONE 2026-07-14** (Dean's in-sim screenshots vs UserCfg): quality enums 1 =
Medium confirmed across the watch list, BUT scales differ per key — **Particles stores 1 = in-sim
"High"** (fixed in gfx_watch.js), **Water FFTSize 512 = "High"** (now an enum w/ labels), Texture
stores 2 = "Medium" (unwatched, kept as proof). Never assume a shared scale for new keys.

### v6.11.2 = Live ATC coverage-model fixes — owed: LIVE validation only
All from Dean's live KLAS flight (KPSP→KLAS, PMDG, VATSIM, AutoFPS):
- **Top-down Tower** — a Tower with no APP/CTR above it now covers ~30nm at ANY altitude
  (`LATC_TWR_TOPDOWN_NM`). The old 7nm/4000ft near-field gate hid a live `LAS_E_TWR` at 11,500ft.
  Stays tight when a higher tier IS online (no climb-out sticking).
- **Arrival ring 15→30nm** (`LATC_ARR_NM`) + 5nm hysteresis — an approach that swings wide (RNAV to KLAS
  via LAPIN @15.8nm) no longer drops to enroute UNICOM. **Departure ring stays 15nm + low — Dean's call.**
- **Instant alert** on definite events (ATC signs off → CTAF/UNICOM; new ATC online) — skips the 2-poll
  (~10s) debounce. Controller↔controller changes KEEP the debounce (edge-flicker lives there).
- **CTAF as "Next up"** on UNICOM inbound + **"Also online at your field"** line + audio hardening
  (one persistent resumed AudioContext + `autoplayPolicy` on the overlay window).
Desk-test `scratchpad/test_latc_v665.js` 19/19. Split-tower callsigns (`LAS_E_TWR`) already resolved
fine — NOT the bug; the coverage gate was. DEFERRED: top-down covers **Tower only** (lone GND/DEL is rare).
**Watch next VATSIM flight:** lone Tower picked up ~30nm out with an instant chime; CTAF as Next-up.

### AutoFPS — the "TLOD 800" finding (2026-07-13)
Dean raised the ceiling to 800. Median TLOD **514**; sat at 774–800 for 17% of the flight (it kept HITTING
the cap — would go higher if allowed). **Zero smoothness cost** in the air (climb/cruise p99 ~18ms,
59.4fps — he's CPU-bound + FG-capped) but drove **VRAM to 95% (11,687MB)** = no margin. Dean: "might not
do that again." **His real limit is VRAM, not FPS/smoothness** — keep peak under ~90% (~11,059MB).
**KLAS ground-stutter verdict: NOT AutoFPS, NOT VRAM — hard scenery (CPU-bound).** arr_taxi p99 35.3ms /
stutter 1.46% (vs ~18ms elsewhere), but TLOD was already floored at **125** from ~2,400ft AGL through
touchdown and taxi, AND arr_taxi VRAM was the flight's **lowest** (10,011MB). Lowering LOD can't unclog a
CPU busy streaming payware buildings.
**Keep AutoFPS "Log+" ON** — it extends logging past touchdown (to AGL 8ft) and is the only window into
TLOD near the ground; without it that verdict was unprovable. (Still stops ~3min before the gate; AutoFPS
never logs frametime, only FPS.) **Parking-brake end-trim VALIDATED** (clean stop; trimmed max 217ms = a
real taxi hitch, not a teardown spike).

### Scenery library — 86 airports, statics pass COMPLETE
Dean's rule: **static aircraft OFF always; High-impact items FLAGGED for his decision, never auto-removed.**
(He took EDDF/Luton/Calgary interiors but KEPT Newark's High cars, KPAE's Boeing factory interior, KRNT's
animations, Berlin's interiors.) Statics disabled at 26 airports; all reversible (original parked beside it
as `.static`/`.off`/`.disabled`).
**Lesson: VERIFY IN THE FOLDER, not just the website** — the site was wrong/incomplete twice (EPKT actually
had a `layout.json.nostatic`; EPWA's real toggle is the PLC swap, NOT the `EPWA_Static.BGL` sitting there).
Per-dev methods: iniBuilds `.disabled` · Drzewiecki PLC + layout swap (`.static`/`.nostatic`) · Aerosoft
`.off` (+ refresh `.bat` at EDDF only) · FSimStudios `.bgl.off`. **MK-Studios + TropicalSim ship NO toggles**
(monolithic single-bgl packages — nothing to disable).

### GSX — Dean is NOT using GSX right now (2026-07-14), but plans to return to it
**While GSX is OFF: leave every scenery's VDGS ENABLED** — it IS his docking guidance without GSX.
Disabling it would remove a feature he's using to avoid a conflict that doesn't exist yet.
**WHEN HE TURNS GSX BACK ON, do a VDGS pass** (scenery VDGS conflicts/duplicates GSX's own docking):
- EPWA Warsaw → `EPWA_VDGS.BGL` (profile readme explicitly says "ensure VDGS is disabled"; Medium)
- EETN Tallinn → `EETN_VDGS.BGL` (Medium, "recommended if you use GSX")
- EGSS Stansted → `egss-scene-nool-vdgs.bgl` (Medium)
- EHAM Amsterdam → `eham_flytampa.ini`, set `disable_static_docks = 1` (Medium–High)
(Re-check the library for others not yet catalogued.)
**GSX importer variant bug FIXED in v6.11.4** (duplicate-basename detection + variant picker; the
EPWA winter-profile overwrite can't recur). Dean's install was hand-corrected to summer already.

### Parked / not started
- **Performance v7 blueprint** (in roadmap) — build the **cohort engine FIRST**, then Flights / Insights /
  Advisor / Experiments.
- Granite Score badge · launch-time AutoFPS envelope · VATGlasses built but unvalidated in Europe ·
  PMDG cold-gate Set-standby test still unclicked.
- Scenery gap analysis (2026-07-13) → Dean bought 18 airports off it. **Remaining big gaps: Asia**
  (Tokyo/Seoul/Singapore/HK) **and Oceania** (Sydney) — still zero coverage.

### Standing reminders
- Dean sources scenery from a torrent site. **Do not compile magnet/download lists** — point him to legit
  stores (iniBuilds, Orbx, Contrail, SimMarket, in-sim Marketplace, flightsim.to for freeware).
- **Release version must be HIGHER than installed** or the auto-updater won't fire. Internal feature labels
  (e.g. the "v6.6.x" VATSIM line) are NOT release versions — ship as 6.11.x.
- Dean runs `release.bat` himself, often same-day. Never assume a backlog awaiting release. `update.bat` is
  dev-era — don't recommend it. See [[feedback_map_and_release]], [[work-discipline-validate-before-ship]].
