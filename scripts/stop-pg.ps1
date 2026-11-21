$pgRoot = Join-Path $env:LOCALAPPDATA "pg17-wow-forever"
$pgCtl = Join-Path $pgRoot "pgsql\bin\pg_ctl.exe"
$dataDir = Join-Path $pgRoot "data"

if (-not (Test-Path $pgCtl)) {
  Write-Host "Portable PostgreSQL 17 not found at $pgRoot."
  exit 0
}

& $pgCtl -D $dataDir stop -m fast
