# tools/port-watch/install.ps1 — v6.25.0. Registers the "ABRP Port Watch" scheduled task: when
# Windows logs Tcpip event 4266 ("all UDP ports in use"), run snapshot.js to record who holds the
# ports. Current-user task (no admin needed); runs through conhost --headless so no window ever pops
# over the sim. A diagnostic — remove with uninstall.ps1 once the culprit is named.
# Built from a task XML file, not `schtasks /tr`: PowerShell 5.1 strips the embedded quotes when it
# passes /tr to schtasks, so a path with a space ("Program Files") split the command (2026-10-28).
param([switch]$DryRun)   # -DryRun: build + validate the task XML and print it; registers nothing
$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot 'snapshot.js'
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$esc = { param($s) [Security.SecurityElement]::Escape($s) }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$query = "<QueryList><Query Id=`"0`" Path=`"System`"><Select Path=`"System`">*[System[Provider[@Name='Tcpip'] and (EventID=4266)]]</Select></Query></QueryList>"
$args2 = '--headless "' + $node + '" "' + $script + '"'
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>ABRP diagnostic: on Tcpip 4266 (UDP ports exhausted) record which process holds the ports. Remove with tools\port-watch\uninstall.ps1.</Description></RegistrationInfo>
  <Triggers><EventTrigger><Enabled>true</Enabled><Subscription>$(& $esc $query)</Subscription></EventTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>$(& $esc $user)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>$(& $esc $conhost)</Command><Arguments>$(& $esc $args2)</Arguments></Exec></Actions>
</Task>
"@
[void][xml]$xml.Replace('encoding="UTF-16"', '')          # fail here, not in schtasks, if the XML is malformed
if ($DryRun) { $xml; return }
$tmp = Join-Path $env:TEMP 'abrp_port_watch_task.xml'
[IO.File]::WriteAllText($tmp, $xml, [Text.Encoding]::Unicode)
schtasks /create /tn "ABRP Port Watch" /xml $tmp /f | Out-Host
$code = $LASTEXITCODE
Remove-Item $tmp -ErrorAction SilentlyContinue
if ($code -ne 0) { throw "schtasks failed ($code)" }
Write-Host "Installed. Self-test: one sample ->"
& $node $script --once
Write-Host ("Log: " + (Join-Path $env:APPDATA 'A Better Route Planner\port_watch\port_watch.jsonl'))
