$dest = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dest

Write-Host "  Pulling latest from GitHub..." -ForegroundColor Cyan

try {
    $result = & git pull origin main 2>&1
    Write-Host $result -ForegroundColor Green
    Write-Host ""
    Write-Host "  Update complete!" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
