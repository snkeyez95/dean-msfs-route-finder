$dest = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dest

Write-Host "  Checking for updates..." -ForegroundColor Cyan

try {
    $result = & git pull origin main 2>&1 | Where-Object { $_ -notmatch '^From ' }
    $clean = ($result | Out-String).Trim()
    if ($clean -eq "Already up to date.") {
        Write-Host "  Already up to date." -ForegroundColor Green
    } else {
        Write-Host "  Updated successfully:" -ForegroundColor Green
        Write-Host "  $clean" -ForegroundColor Green
    }
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
