# tools/port-watch/install.ps1 — v6.25.0. Registers the "ABRP Port Watch" scheduled task: when
# Windows logs Tcpip event 4266 ("all UDP ports in use"), run snapshot.js to record who holds the
# ports. Current-user task (no admin needed); runs through conhost --headless so no window ever pops
# over the sim. A diagnostic — remove with uninstall.ps1 once the culprit is named.
$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot 'snapshot.js'
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$tr = '"' + $conhost + '" --headless "' + $node + '" "' + $script + '"'
$query = "*[System[Provider[@Name='Tcpip'] and (EventID=4266)]]"
schtasks /create /tn "ABRP Port Watch" /sc ONEVENT /ec System /mo $query /tr $tr /f | Out-Host
if ($LASTEXITCODE -ne 0) { throw "schtasks failed ($LASTEXITCODE)" }
Write-Host "Installed. Self-test: one sample ->"
& $node $script --once
Write-Host ("Log: " + (Join-Path $env:APPDATA 'A Better Route Planner\port_watch\port_watch.jsonl'))
