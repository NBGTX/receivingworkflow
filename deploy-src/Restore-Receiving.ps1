<#
 Restores a Steel Receiving backup zip (made by Settings > Backups) into the data folder.

     .\Restore-Receiving.ps1 -Backup E:\Receiving\data\backups\receiving-backup-20261005-020000.zip

 What it does:
   1. stops the IIS app pool so nothing writes while files are swapped
   2. renames the current data folder to  <data>.before-restore-<time>  (nothing is deleted)
   3. unzips the backup into a fresh data folder (database, packet PDFs, final packets, photos, encryption keys)
   4. gives the app pool write access again and starts it

 To go back, stop the pool, rename the folders back, start the pool.
 Run in an elevated PowerShell on the web server. Use -NoIis to skip the pool steps (for a test on another machine).
#>
param(
  [Parameter(Mandatory)] [string] $Backup,
  [string] $DataPath = 'E:\Receiving\data',
  [string] $SiteName = 'Receiving',
  [switch] $NoIis
)
$ErrorActionPreference = 'Stop'
function Step($t){ Write-Host "`n== $t" -ForegroundColor Green }

if (-not (Test-Path $Backup)) { throw "Backup not found: $Backup" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $Backup))
try {
  if (-not ($zip.Entries | Where-Object FullName -eq 'receiving.db')) { throw "That zip has no receiving.db. It is not a Steel Receiving backup." }
  Write-Host ("Backup holds {0} files, {1:N1} MB unpacked." -f $zip.Entries.Count, (($zip.Entries | Measure-Object Length -Sum).Sum / 1MB))
} finally { $zip.Dispose() }

if (-not $NoIis) {
  Import-Module WebAdministration
  Step "Stopping the app pool"
  if (Test-Path "IIS:\AppPools\$SiteName") { Stop-WebAppPool $SiteName -ErrorAction SilentlyContinue; Start-Sleep 3 }
}

Step "Setting the current data aside"
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (Test-Path $DataPath) {
  $aside = "$DataPath.before-restore-$stamp"
  Rename-Item $DataPath (Split-Path $aside -Leaf)
  Write-Host "Kept as $aside"
}
New-Item -ItemType Directory -Force $DataPath | Out-Null

Step "Unpacking the backup"
Expand-Archive -Path $Backup -DestinationPath $DataPath -Force
if (-not (Test-Path (Join-Path $DataPath 'receiving.db'))) { throw "receiving.db is missing after unpacking." }
foreach ($d in 'pdfs','final','keys','photos') { New-Item -ItemType Directory -Force (Join-Path $DataPath $d) | Out-Null }
Write-Host ("Restored: database {0:N1} MB, {1} PDFs, {2} final packets, {3} key files." -f ((Get-Item (Join-Path $DataPath 'receiving.db')).Length/1MB), @(Get-ChildItem (Join-Path $DataPath 'pdfs') -File).Count, @(Get-ChildItem (Join-Path $DataPath 'final') -File).Count, @(Get-ChildItem (Join-Path $DataPath 'keys') -File).Count)

if (-not $NoIis) {
  Step "Permissions and restart"
  icacls $DataPath /grant "IIS AppPool\${SiteName}:(OI)(CI)M" /T | Out-Null
  Start-WebAppPool $SiteName
  Start-Sleep 4
  try { $r = Invoke-WebRequest "http://localhost/" -UseBasicParsing -TimeoutSec 5 } catch { }
  Write-Host "App pool started. Open the site and check your packets."
}
Write-Host "`nRESTORE-RESULT: OK" -ForegroundColor Green
