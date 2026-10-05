#Requires -RunAsAdministrator
<#
 Installs or updates the Steel Receiving app in IIS.
 Run on the web server in an elevated PowerShell:   .\Install-Receiving.ps1
 Safe to run again for updates: your data folder and appsettings.Production.json are left alone.
#>
param(
  [int]    $Port      = 8091,
  [string] $SiteName  = 'Receiving',
  [string] $AppPath   = 'E:\Receiving\app',
  [string] $DataPath  = 'E:\Receiving\data',
  [string] $SourcePath = (Join-Path $PSScriptRoot 'app')
)
$ErrorActionPreference = 'Stop'
function Step($t){ Write-Host "`n== $t" -ForegroundColor Green }
function Fail($t){ Write-Host "`nSTOPPED: $t" -ForegroundColor Red; exit 1 }

Import-Module WebAdministration

Step "Checking the server"
if (-not (Test-Path (Join-Path $SourcePath 'Receiving.Web.dll'))) { Fail "Receiving.Web.dll not found in $SourcePath. Unzip the whole deploy package first." }
if (-not (Get-WebGlobalModule | Where-Object Name -eq 'AspNetCoreModuleV2')) {
  Fail "The ASP.NET Core Module for IIS is not installed. Install the '.NET 8 Hosting Bundle' (dotnet-hosting-8.x-win.exe) once, run 'iisreset', then run this script again."
}
$runtime = & dotnet --list-runtimes 2>$null | Where-Object { $_ -like 'Microsoft.AspNetCore.App 8.*' }
if (-not $runtime) { Fail "ASP.NET Core 8 runtime not found. Install the .NET 8 Hosting Bundle." }
Write-Host "ASP.NET Core module: ok. Runtime: $($runtime | Select-Object -First 1)"

$existing = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
if (-not $existing) {
  $inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($inUse) { Fail "Port $Port is already in use on this server. Pick another with -Port." }
  $bound = Get-Website | Where-Object { ($_.Bindings.Collection | ForEach-Object { $_.bindingInformation }) -match ":${Port}:" }
  if ($bound) { Fail "Port $Port is already bound by IIS site '$($bound.Name)'. Pick another with -Port." }
}

Step "Copying the app to $AppPath"
New-Item -ItemType Directory -Force $AppPath, $DataPath | Out-Null
$pool = $SiteName
if (Test-Path "IIS:\AppPools\$pool") { Stop-WebAppPool $pool -ErrorAction SilentlyContinue; Start-Sleep 2 }
robocopy $SourcePath $AppPath /E /NFL /NDL /NJH /NJS /XF appsettings.Production.json | Out-Null
if ($LASTEXITCODE -ge 8) { Fail "File copy failed (robocopy code $LASTEXITCODE)." }
$prodCfg = Join-Path $AppPath 'appsettings.Production.json'
if (-not (Test-Path $prodCfg)) {
  (@{ DataDir = $DataPath } | ConvertTo-Json) | Set-Content $prodCfg -Encoding UTF8
  Write-Host "Wrote appsettings.Production.json (data folder: $DataPath)"
}

Step "App pool and site"
if (-not (Test-Path "IIS:\AppPools\$pool")) { New-WebAppPool $pool | Out-Null }
Set-ItemProperty "IIS:\AppPools\$pool" managedRuntimeVersion ''
Set-ItemProperty "IIS:\AppPools\$pool" startMode 'AlwaysRunning'
Set-ItemProperty "IIS:\AppPools\$pool" processModel.loadUserProfile $true
Set-ItemProperty "IIS:\AppPools\$pool" processModel.idleTimeout ([TimeSpan]::Zero)
if (-not $existing) { New-Website -Name $SiteName -PhysicalPath $AppPath -ApplicationPool $pool -Port $Port | Out-Null }
else { Set-ItemProperty "IIS:\Sites\$SiteName" physicalPath $AppPath; Set-ItemProperty "IIS:\Sites\$SiteName" applicationPool $pool }

Step "Folder permissions"
icacls $DataPath /grant "IIS AppPool\${pool}:(OI)(CI)M" /T | Out-Null
icacls $AppPath  /grant "IIS AppPool\${pool}:(OI)(CI)RX" /T | Out-Null
Write-Host "App pool 'IIS AppPool\$pool' can write to $DataPath"

Step "Windows sign-in for admins (anonymous stays on for the PIN screens)"
try {
  Set-WebConfigurationProperty -Filter '/system.webServer/security/authentication/anonymousAuthentication' -Name enabled -Value $true  -PSPath 'IIS:\' -Location $SiteName
  Set-WebConfigurationProperty -Filter '/system.webServer/security/authentication/windowsAuthentication'   -Name enabled -Value $true  -PSPath 'IIS:\' -Location $SiteName
  Write-Host "Anonymous + Windows authentication enabled for $SiteName"
} catch {
  Write-Host "Could not set authentication from script: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "Fix: IIS Manager > site '$SiteName' > Authentication > enable Anonymous and Windows Authentication." -ForegroundColor Yellow
}

Step "Firewall"
if (-not (Get-NetFirewallRule -DisplayName "Steel Receiving $Port" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "Steel Receiving $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
  Write-Host "Opened TCP $Port"
} else { Write-Host "Rule already present" }

Step "Starting and testing"
Start-WebAppPool $pool; Start-Website $SiteName
Start-Sleep 4
try {
  $r = Invoke-WebRequest "http://localhost:$Port/api/config" -UseBasicParsing -TimeoutSec 60
  Write-Host "OK: $($r.StatusCode) $($r.Content)" -ForegroundColor Green
} catch {
  Write-Host "The site did not answer: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Check Event Viewer > Windows Logs > Application (source IIS AspNetCore Module V2)." -ForegroundColor Yellow
  exit 1
}
Write-Host "`nDone. Open http://$($env:COMPUTERNAME):$Port/ , sign in with Windows as an admin, then set Settings > General > Site address and the email server." -ForegroundColor Green

