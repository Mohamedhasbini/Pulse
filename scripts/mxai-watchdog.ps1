# MXAi watchdog for this PC. Runs hidden from the moment you sign in to Windows (task "MXAi watchdog"), and every
# 2 minutes makes sure everything MXAi needs is up, starting or reconnecting whatever is not:
#   Docker Desktop -> app, database, backups (docker compose) and n8n -> Cloudflare tunnel -> nexfoyz.dev home page.
# Each repair is written to logs\watchdog.log. Safe to run twice: only one copy runs at a time.
$ErrorActionPreference = 'SilentlyContinue'
$root   = Split-Path -Parent $PSScriptRoot
$log    = Join-Path $root 'logs\watchdog.log'
$docker = "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
$tunnel = "$env:USERPROFILE\Jarvis\tunnel\cloudflared.exe"
$python = "$env:LOCALAPPDATA\Programs\Python\Python312\pythonw.exe"
$site   = "$env:USERPROFILE\Jarvis\site\serve.py"

New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$mutex = New-Object System.Threading.Mutex($false, 'Global\MXAiWatchdog')
if (-not $mutex.WaitOne(0)) { exit }  # another copy is already watching
function Note($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Add-Content $log
  if ((Get-Item $log).Length -gt 1MB) { Move-Item $log "$log.old" -Force } }
function Up($url) { try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 8).StatusCode -eq 200 } catch { $false } }

$stateFile = Join-Path $root 'logs\watchdog-state.json'
function State { try { Get-Content $stateFile -Raw | ConvertFrom-Json } catch { [pscustomobject]@{ offsite = ''; restore = '2000-01-01' } } }
function SaveState($s) { $s | ConvertTo-Json | Set-Content $stateFile }
Note 'watchdog started'
while ($true) {
  # 1. Docker
  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) { Note 'Docker was not running: starting it'; Start-Process $docker }
    for ($i = 0; $i -lt 36; $i++) { Start-Sleep 5; docker info *> $null; if ($LASTEXITCODE -eq 0) { break } }
  }
  if ($LASTEXITCODE -eq 0) {
    # 2. app, database, backups and n8n
    if (-not (Up 'http://localhost:3100/health')) {
      Note 'app not answering: docker compose up'; Push-Location $root; docker compose up -d *> $null; Pop-Location
    }
    if ((docker inspect -f '{{.State.Running}}' n8n 2>$null) -ne 'true') { Note 'n8n stopped: starting it'; docker start n8n *> $null }
  }
  # 3. Cloudflare tunnel (app.nexfoyz.dev and client websites). A stuck tunnel (running but the site unreachable for
  #    two checks in a row) is restarted too.
  $cf = Get-Process cloudflared -ErrorAction SilentlyContinue
  if (-not $cf) { Note 'tunnel was down: starting it'; Start-Process $tunnel -ArgumentList 'tunnel', 'run', 'jarvis' -WindowStyle Hidden; $script:bad = 0 }
  elseif (Up 'http://localhost:3100/health') {
    if (Up 'https://app.nexfoyz.dev/health') { $script:bad = 0 }
    else { $script:bad++; if ($script:bad -ge 2) { Note 'public address unreachable: restarting the tunnel'; $cf | Stop-Process -Force; Start-Sleep 2
      Start-Process $tunnel -ArgumentList 'tunnel', 'run', 'jarvis' -WindowStyle Hidden; $script:bad = 0 } }
  }
  # 4. backups leave this PC once a day (encrypted, to OneDrive) and are test-restored once a week
  if ($LASTEXITCODE -eq 0 -or (Up 'http://localhost:3100/health')) {
    $st = State; $today = Get-Date -Format 'yyyy-MM-dd'
    if ($st.offsite -ne $today) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'offsite-backup.ps1')
      if ($LASTEXITCODE -eq 0) { $st.offsite = $today; SaveState $st } else { Note 'off-site copy failed, see backups\offsite.log' }
    }
    if (((Get-Date) - [datetime]$st.restore).TotalDays -ge 7) {
      Push-Location $root; docker compose cp scripts/restore-test.sh backup:/tmp/restore-test.sh *> $null; docker compose exec -T backup sh /tmp/restore-test.sh *> $null; $rc = $LASTEXITCODE; Pop-Location
      if ($rc -eq 0) { $st.restore = (Get-Date -Format 's'); SaveState $st } else { Note 'restore test FAILED, see backups\restore-test.log' }
    }
  }
  # 5. nexfoyz.dev home page
  if ((Test-Path $site) -and -not (Up 'http://localhost:8092/')) { Note 'home page down: starting it'; Start-Process $python -ArgumentList "`"$site`"" -WindowStyle Hidden }
  Start-Sleep 120
}
