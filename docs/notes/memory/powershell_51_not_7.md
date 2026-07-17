---
name: powershell_51_not_7
description: "ABRP spawns Windows PowerShell 5.1, not 7 — validate PS logic in powershell.exe, never the dev terminal (pwsh)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
---

ABRP's `main.js` spawns `powershell` = **Windows PowerShell 5.1** (ships on every Windows 10/11).
The Claude dev terminal here is **PowerShell 7 (pwsh)**. They differ in real, biting ways.

**The bug that cost three failed test rounds (v5.9.11–v5.9.15):** in PS 5.1,
`@($json | ConvertFrom-Json)` on an N-element array returns **1** (the whole array as one object);
in PS 7 it returns N. The flight app-reopen wrote N app paths but read back 1, so only one app
reopened. Every synthetic test I ran "passed" because it ran in pwsh 7.

**Why:** I validated PowerShell-dependent logic in the wrong shell, repeatedly, and shipped fixes
that tested green and failed on Dean's machine — burning his tokens and patience.

**How to apply:**
- Any time logic depends on spawned PowerShell, validate it via `powershell.exe -NoProfile -Command`
  (5.1), NOT the default pwsh terminal.
- Prefer to keep DATA handling in Node (JSON.parse/stringify, file I/O) and use PowerShell only for
  OS actions (Get-Process / Stop-Process / Start-Process). Pass data in via embedded array literals
  (the kill-list pattern) and out via stdout lines — never round-trip state through PS-side
  ConvertTo/From-Json or Set-Content/Get-Content. This is also what makes features portable to any
  Windows machine (the v5.9.16 reopen fix). See [[feedback_map_and_release]] for release/recap rules.

**Other Windows process-management landmines that bit the flight close/reopen (relevant when fixing
the pending multi-instance Radarr case):**
- **Read an elevated/service process's exe path via `Get-CimInstance Win32_Process … ExecutablePath`,
  NOT `(Get-Process).Path`.** The `.Path` property throws "access denied" for elevated processes
  (Plex, the *arr suite); inside a `try`, that throw silently drops the app (v5.9.18 fix — only 1 of 7
  captured). Use CIM as primary, `.Path` only as a separate-try fallback. ABRP runs as admin, so CIM
  can read these.
- **Multi-instance apps can't be de-duped by exe path.** Dean runs two Radarr off one `Radarr.exe`,
  differentiated only by Startup shortcut / `--data` arg (`Radarr.lnk` vs `Radarr-4K.lnk`). Saving
  by exe path + `new Set` collapses them to one, so only one reopens. Radarr also happily launches
  DUPLICATES (no per-folder lock), so the fix must relaunch **each distinct shortcut exactly once**,
  not by exe path. (Plex Tuner Service is the opposite — a child of Plex Media Server, comes back on
  its own when Plex starts; don't try to reopen it separately.)
