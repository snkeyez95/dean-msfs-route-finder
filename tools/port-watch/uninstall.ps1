# tools/port-watch/uninstall.ps1 — removes the "ABRP Port Watch" scheduled task. The log
# (%APPDATA%\A Better Route Planner\port_watch\port_watch.jsonl) is kept.
schtasks /delete /tn "ABRP Port Watch" /f | Out-Host
