---
name: vatsim-audit-2026-07-16
description: "Full VATSIM/overlay adversarial audit — 4 confirmed bugs fixed in v6.12.8, 3 suspected items logged, re-runnable harnesses in the session scratchpad"
metadata: 
  node_type: memory
  type: project
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
---

Full VATSIM + overlay audit ran 2026-07-16 (Dean's copy/paste Fable prompt): 45,056-cell ATC matrix
(KMIA→KMCO + LGAV→LGKR, invariants I1–I10), alert poll-sequence stress A1–A8, overlay O1–O7, surface
V1–V8 + probes — all against real polygons/airport DB.

**Fixed in v6.12.8 (commit 8e2f51c):** (1) airspaceCovers now merges '-SUFFIX' segments for MAPPED
prefixes (NY_CTR was "outside" over Pennsylvania — KZNY-W invisible; BIRD/OBBB/GULF/VABB too);
(2) instant alert path requires a network change — polygon-edge graze no longer chime-storms (was 10
chimes/10 polls at the MCO TRACON edge); (3) uncontrolled fallback tier honest (UNICOM vs CTAF) +
latcNextUp gates on !found → dark dep field with staffed arrival shows "Later: …"; (4) toast-created
overlay (Live off) self-closes — no lingering grey dot (`_overlayWanted` in main.js).

**Logged, NOT fixed (suspected, low):** (a) cursor resting motionless in the panel rect through
auto-collapse leaves the overlay clickable until the next mousemove — first sim click eaten;
(b) overlay_pos restore guard protects the window's LEFT 80px but the dot is RIGHT-anchored — a
monitor-width shrink within ~280px can restore the dot off-screen; (c) nits: handoff toast sub is
esc()'d then textContent-rendered (double-encode for pathological callsigns); header controller
count doesn't filter 199.998 placeholders.

**⚠ HARNESSES ARE GONE — the scratchpad was WIPED later the same night (2026-07-16).** The whole
~57-file regression board (test_vscore/test_recommend/test_tracon/test_vatglasses/test_briefing/
test_handoff/test_polygon/test_autofps_trace/…) built up over weeks AND that night's audit harnesses
(audit_extract.js, test_matrix_audit.js, test_alert_stress.js, test_vatsim_surface_audit.js,
test_v6128_fixes.js) vanished from the temp tree — confirmed absent from every session dir. The
earlier claim here that they were "re-runnable" was true when written and is now false. Temp is NOT
durable storage; never again promise a durable harness that lives in the scratchpad. OPEN DECISION
for Dean: house the tests in the repo (e.g. tests/, excluded from the installer via build.files) so
they survive — this reverses the old "tests never in the repo" rule, which this loss disproved.
Verified clean at audit time (results still stand, the proofs just can't be re-run): vscore
1st/2nd-order monotonicity,
observer-CID, VATSIM-ATIS non-expiry, radio write click-only, tracon null-vs-false, atomic airspace
cache, recommendFreq 0.105ms@90 controllers (runs 4×/5s poll — harmless). Not bench-testable:
OS-level click-through/drag/fullscreen, PMDG hardware walk, live VG sectorization.

**LEDGER (end of night 2026-07-16):**
CLOSED — all 4 confirmed bugs fixed, tested (23/23 fix suite + 45,056-cell matrix + 15/15 alerts +
21/21 surface + 300/300 board), committed + pushed as v6.12.8 (8e2f51c). Memory + README changelog done.
OPEN —
1. [RUN] Dean's release.bat — v6.12.8 unreleased (installed app several versions behind).
2. [LIVE-VERIFY next VATSIM flights] no chime spam at airspace boundaries; segment-fix claims a
   Center on a US East Coast leg (NY area); "Later: <arr ATC>" at a dark departure gate; no stray
   grey dot after an offline capture.
3. [SUSPECTED, unfixed, low] (a) motionless-cursor click-eat after panel auto-collapse; (b) dot can
   restore off-screen after a monitor-width shrink (workaround: delete overlay_pos.json); (c) nits:
   toast double-encode on pathological callsigns + header controller count includes 199.998
   placeholders. Fix only if observed / when touching those files.

Related: [[project_next_steps]]
