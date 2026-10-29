---
name: udp-port-exhaustion
description: Recurring Windows UDP ephemeral-port exhaustion (Tcpip 4266) every 2-4 days of uptime; prime suspect for the 2026-10-27 LIMC sim deadlock (HangDetector 0xC0000194) and overlaps the worst recent flights; leaker not yet identified
metadata:
  type: project
---

**Finding (2026-10-27):** MSFS froze taxiing at LIMC (Fenix A321) at 10:10:18 — AsoboReport-RunningSession
`Where="HangDetector" Code=0xC0000194` (possible deadlock); sys CPU fell 45%→4% instantly (sim stopped working,
not overloaded), VRAM a calm 85%, frames clean beforehand. Windows System log: **Tcpip 4266 "all ephemeral UDP
ports in use" at 09:14 (before the flight) and 10:11**. Bing streaming lockers were held in the crash report —
network calls stalling on a dry port pool fits the deadlock. ABRP filed the 6-min flight cleanly.

**Recurs:** 11 Tcpip 4266/4231 events in 30 days (Sep 27 → Oct 27), every ~2–4 days, incl. idle hours (Oct 14
02:45) → a 24/7 background app leaking UDP sockets, not MSFS. Overlapped the two worst recent flights:
Oct 21 KMIA→KMCO (21:11, mid-flight) and Oct 23 EDDM→EDDB (08:42, mid-flight) — those were blamed on Fenix /
Defender (also real), but port exhaustion was stacked on top.

**Leaker unknown** — reboot at 10:13 reset it (61 UDP endpoints after). Right after boot: Plex Media Server
held the most (16), then svchost, ProtonVPN, qBittorrent. Find it by checking `Get-NetUDPEndpoint` grouped by
OwningProcess after ~1 day of uptime — the leaker will be in the thousands. Pool = 16,384 ports (49152+).

**How to apply:** when a flight freezes/hangs or networking acts up, check Tcpip 4266 in the System log first.
Interim habit: reboot before a long flight if the PC has been up 2+ days. Enlarging the UDP dynamic range
(netsh) only delays it — fix the leaker instead. Related: [[process-lasso-si-affinity-fence]].

**2026-10-28 update (LSZH-EDDB Fenix, worst Fenix flight logged, P99 33ms):** cruise CPU freeze storm 56:10–56:51 into the flight (1.0–1.6 s freezes, GPU starved, FenixDisplay/FenixSystem top) = ~22:09:20–22:10:00 wall clock; Windows logged Tcpip 4266 at **22:10:39** — 3rd freeze to line up with port exhaustion (after 10-27 LIMC). Uptime at event ≈36 h (faster than the old "2–4 days"). KEY CLUE: next morning, with the sim closed, total UDP endpoints were only 56 (Plex 13 = normal) — so it's a BURST from something running during the flight that releases its ports on exit (MSFS itself or a sim companion), NOT a slow leak by an always-on app like Plex. Catching it needs a per-process UDP sample DURING flight.

**2026-10-28 correction + build (v6.25.0):** cross-matched all 34 events since 07-12 against 83 flights → only 5 in-flight, 9 within 30 min of one, 20 nowhere near a flight; 09-16 had an in-flight event and was SMOOTH. So exhaustion is a suspect, not a proven freeze cause — don't overstate it. Built: capture samples UDP per-process every 15s (telemetry udp_total/udp_top, summary.settings.udp, debrief warning), plus tools/port-watch (snapshot.js + install.ps1) = an event-triggered task on Tcpip 4266 that logs who holds the ports to %APPDATA%\A Better Route Planner\port_watch\port_watch.jsonl. Dean must run install.ps1 himself (auto mode blocked Claude). Next 4266 → read port_watch.jsonl to name the culprit. Reserved UDP ranges ≈860 (Hyper-V HNS running) — watch whether that grows.
