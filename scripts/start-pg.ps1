$pgRoot = Join-Path $env:LOCALAPPDATA "pg17-wow-forever"
$pgCtl = Join-Path $pgRoot "pgsql\bin\pg_ctl.exe"
$dataDir = Join-Path $pgRoot "data"
$logFile = Join-Path $pgRoot "postgres.log"

if (-not (Test-Path $pgCtl)) {
  Write-Error "Portable PostgreSQL 17 not found at $pgRoot. Set DATABASE_URL in .env.local to your PostgreSQL server."
  exit 1
}

& $pgCtl -D $dataDir status | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Local PostgreSQL 17 is already running on 127.0.0.1:5432."
  exit 0
}

& $pgCtl -D $dataDir -l $logFile -o "-p 5432 -h 127.0.0.1" start
