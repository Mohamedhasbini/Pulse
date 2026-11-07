# Encrypted off-site copy of the newest backup, into your OneDrive (it uploads to Microsoft's cloud by itself while
# OneDrive is running). The watchdog (mxai-watchdog.ps1) runs this once a day; it is safe to run by hand.
# Encryption: AES-256 with the key BACKUP_KEY from .env (openssl from Git for Windows). Without that key the copies
# cannot be opened by anyone, including you: keep BACKUP_KEY in your password manager, not only on this PC.
# Restore one: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in FILE.enc -out FILE -pass pass:YOUR_KEY
$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $PSScriptRoot
$backups = Join-Path $root 'backups'
$dest    = Join-Path $env:USERPROFILE 'OneDrive\MXAi backups'
$openssl = 'C:\Program Files\Git\usr\bin\openssl.exe'
$log     = Join-Path $backups 'offsite.log'
function Note($m) { "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK') $m" | Add-Content $log }

$key = (Get-Content (Join-Path $root '.env') | Where-Object { $_ -match '^BACKUP_KEY=' } | Select-Object -First 1) -replace '^BACKUP_KEY=', ''
if ($key.Length -lt 32) { Note 'FAIL no BACKUP_KEY in .env'; exit 1 }
if (-not (Test-Path $openssl)) { $openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source }
if (-not $openssl) { Note 'FAIL openssl not found (install Git for Windows)'; exit 1 }
New-Item -ItemType Directory -Force $dest | Out-Null

# the newest real database dump (at least 1 KB) and the photos archive made with it
$db = Get-ChildItem $backups -Filter 'ringback-*.sql.gz' | Where-Object Length -ge 1024 | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $db) { Note 'FAIL no usable backup to copy'; exit 1 }
$stamp = $db.BaseName -replace '^ringback-', '' -replace '\.sql$', ''
$files = @($db) + @(Get-ChildItem $backups -Filter "uploads-$stamp.tar.gz" -ErrorAction SilentlyContinue)
$env:MXAI_BACKUP_KEY = $key
try {
  foreach ($f in $files) {
    $out = Join-Path $dest ($f.Name + '.enc')
    if (Test-Path $out) { continue }
    & $openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in $f.FullName -out "$out.part" -pass env:MXAI_BACKUP_KEY
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$out.part")) { Note "FAIL could not encrypt $($f.Name)"; exit 1 }
    Move-Item "$out.part" $out -Force
  }
} finally { Remove-Item Env:MXAI_BACKUP_KEY -ErrorAction SilentlyContinue }

# keep the newest 30 of each kind there
foreach ($kind in 'ringback-*.enc', 'uploads-*.enc') {
  Get-ChildItem $dest -Filter $kind | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force
}
$readme = Join-Path $dest 'HOW-TO-RESTORE.txt'
if (-not (Test-Path $readme)) {
  @"
MXAi backups, encrypted with AES-256. The key is BACKUP_KEY (in the MXAi .env file, and in your password manager).
1. Decrypt:  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in ringback-DATE.sql.gz.enc -out ringback-DATE.sql.gz -pass pass:YOUR_KEY
2. Put the .sql.gz file in the MXAi backups folder and run: bash scripts/restore.sh backups/ringback-DATE.sql.gz
"@ | Set-Content $readme -Encoding utf8
}
$onedrive = [bool](Get-Process OneDrive -ErrorAction SilentlyContinue)
Note "ok $($db.Name) -> $dest$(if (-not $onedrive) { ' (OneDrive is not running: it uploads when it starts)' })"
