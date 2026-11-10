---
name: port-watch-reminder
description: DONE 2026-11-10 — port-watch snapshot task uninstalled; no per-session check anymore
metadata:
  type: project
---

The "ABRP Port Watch" scheduled task was REMOVED by Dean on 2026-11-10 (verified: schtasks query → not found). The per-session port-watch duty is OVER — do not check port_watch.jsonl or remind him to install/uninstall.

Outcome: 6 real Tcpip 4266 captures (10-30 → 11-10), all showing only ~70–80 UDP ports in use 2 s after the event, so the burst is under 2 s and snapshots can't name it. Events happen with the sim and ABRP closed, so neither is the cause. Remaining suspects: ProtonVPN, qBittorrent, Plex, svchost. Dean closes ProtonVPN manually before flights. The in-capture UDP sampling (summary.settings.udp) still runs on every flight. See [[udp-port-exhaustion]].
