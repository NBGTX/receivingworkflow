<#
 One command to update the Steel Receiving site on the web server, run from your PC:

     .\deploy-src\Deploy.ps1

 It publishes the app, copies it to \\SERVER\E$\Receiving\deploy, then runs Install-Receiving.ps1 on the server
 through a one-time Task Scheduler job (no WinRM needed), waits for the result and checks the site answers.

   -NoInstall     copy the files only; run Install-Receiving.ps1 on the server yourself
   -SkipPublish   reuse the last publish
   -Server / -Port   defaults: 10.9.33.141 and 8091

 Needs admin rights on the server (the same ones you use for the E$ share).
#>
param(
  [string] $Server  = '10.9.33.141',
  [int]    $Port    = 8091,
  [string] $Share   = 'E$',
  [string] $RemoteDir = 'E:\Receiving\deploy',
  [switch] $NoInstall,
  [switch] $SkipPublish
)
$ErrorActionPreference = 'Stop'
function Step($t){ Write-Host "`n== $t" -ForegroundColor Green }
$repo   = Split-Path $PSScriptRoot -Parent
$proj   = Join-Path $repo 'src\Receiving.Web'
$out    = Join-Path $repo 'deploy\Receiving-deploy'
$target = "\\$Server\$Share\" + ($RemoteDir -replace '^[A-Za-z]:\\','')

if (-not $SkipPublish) {
  Step "Publishing"
  # the short commit id (plus -dirty when files are uncommitted) shows in the page footer
  $rev = (& git -C $repo rev-parse --short HEAD 2>$null); if ($rev -and (& git -C $repo status --porcelain 2>$null)) { $rev += '-dirty' }
  dotnet publish $proj -c Release -o (Join-Path $out 'app') --nologo "-p:SourceRevisionId=$rev" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }
  Copy-Item (Join-Path $PSScriptRoot 'Install-Receiving.ps1') $out -Force
}

Step "Copying to $target"
New-Item -ItemType Directory -Force $target | Out-Null
robocopy (Join-Path $out 'app') (Join-Path $target 'app') /MIR /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (code $LASTEXITCODE)" }
Copy-Item (Join-Path $out 'Install-Receiving.ps1') $target -Force
Write-Host "Copied."

if ($NoInstall) { Write-Host "`nFiles are on the server. Run Install-Receiving.ps1 there to finish." -ForegroundColor Yellow; return }

Step "Installing on $Server"
$task = 'ReceivingInstall'
$log  = Join-Path $target 'install.log'
if (Test-Path $log) { Remove-Item $log -Force }
$cmd  = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File $RemoteDir\Install-Receiving.ps1"
schtasks /Create /S $Server /TN $task /TR $cmd /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not create the install task on $Server. Run Install-Receiving.ps1 there yourself." }
try {
  schtasks /Run /S $Server /TN $task | Out-Null
  $deadline = (Get-Date).AddMinutes(6); $result = $null
  while ((Get-Date) -lt $deadline -and -not $result) {
    Start-Sleep 4
    if (Test-Path $log) { $t = Get-Content $log -Raw -ErrorAction SilentlyContinue; if ($t -match 'INSTALL-RESULT: (\w+)') { $result = $Matches[1] } }
  }
  if (Test-Path $log) { Write-Host (Get-Content $log -Tail 25 | Out-String) }
  if ($result -ne 'OK') { throw "Install did not finish OK (result: $result). See $log" }
} finally {
  schtasks /Delete /S $Server /TN $task /F | Out-Null
}

Step "Checking the site"
$r = Invoke-WebRequest "http://${Server}:$Port/api/config" -UseBasicParsing -TimeoutSec 60
Write-Host "http://${Server}:$Port answers $($r.StatusCode): $($r.Content)" -ForegroundColor Green
