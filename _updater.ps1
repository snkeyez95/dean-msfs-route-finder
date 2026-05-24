$baseUrl = "https://raw.githubusercontent.com/snkeyez95/dean-msfs-route-finder/main"
$files = @("index.html", "main.js", "preload.js")
$dest = Split-Path -Parent $MyInvocation.MyCommand.Path

foreach ($f in $files) {
    try {
        $url = "$baseUrl/$f"
        $out = Join-Path $dest $f
        Write-Host "  Updating $f ..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -Headers @{"Cache-Control"="no-cache"; "Pragma"="no-cache"}
        Write-Host "  OK" -ForegroundColor Green
    } catch {
        Write-Host "  FAILED: $f - $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "  Update complete!" -ForegroundColor Green
