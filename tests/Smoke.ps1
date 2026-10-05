<#
 End-to-end check of the whole workflow against a throwaway copy of the app (own port, own data folder).

     .\tests\Smoke.ps1             # builds, starts a temporary instance on port 5098, runs the checks, stops it
     .\tests\Smoke.ps1 -BaseUrl http://localhost:5080    # run against a running instance instead (adds demo data; use a test copy!)

 It signs in with your Windows account, so your account must be an admin (BG\sims.anderson is by default).
 Exit code 0 = everything passed.
#>
param([string] $BaseUrl = '')
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$proj = Join-Path $repo 'src\Receiving.Web'
$h = @{ 'X-Requested-With' = 'fetch' }
$script:pass = 0; $script:fail = 0
function Check($name, [scriptblock]$test) {
  try { $r = & $test; if ($r) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green } else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red } }
  catch { $script:fail++; Write-Host "  FAIL  $name  ($($_.Exception.Message))" -ForegroundColor Red }
}
function Call($s, $m, $p, $b = $null) {
  $a = @{ Uri = "$BaseUrl$p"; Method = $m; Headers = $h; WebSession = $s; UseBasicParsing = $true }
  if ($null -ne $b) { $a.Body = ($b | ConvertTo-Json -Depth 8 -Compress); $a.ContentType = 'application/json' }
  try { $r = Invoke-WebRequest @a; if ($r.Content) { try { $r.Content | ConvertFrom-Json } catch { $r.Content } } else { 'ok' } }
  catch { [pscustomobject]@{ __error = [int]$_.Exception.Response.StatusCode; __body = $_.ErrorDetails.Message } }
}
function Failed($r) { $r -is [pscustomobject] -and $null -ne $r.__error }
function Status($r) { if (Failed $r) { $r.__error } else { 200 } }

$proc = $null; $data = $null
if (-not $BaseUrl) {
  $BaseUrl = 'http://localhost:5098'
  $data = Join-Path $env:TEMP ("receiving-smoke-" + (Get-Date -Format 'HHmmss'))
  Write-Host "Building..."; dotnet build $proj -nologo -v q | Out-Null
  $proc = Start-Process -PassThru -WindowStyle Hidden dotnet -ArgumentList 'run', '--no-build', '--no-launch-profile', '--project', $proj, '--', '--DataDir', $data, '--Urls', $BaseUrl
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 1; try { Invoke-WebRequest "$BaseUrl/api/config" -UseBasicParsing | Out-Null; break } catch { } }
}
try {
  Write-Host "`nSign-in and access"
  $adm = $null
  Check 'config answers without sign-in' { (Invoke-WebRequest "$BaseUrl/api/config" -UseBasicParsing).StatusCode -eq 200 }
  Check 'packets refuse an anonymous caller' { (Status (Call $null GET '/api/packets')) -eq 401 }
  Check 'Windows admin sign-in' { Invoke-WebRequest "$BaseUrl/api/auth/windows" -UseDefaultCredentials -SessionVariable s -UseBasicParsing | Out-Null; $script:adm = $s; $true }
  $null = Call $adm POST '/api/admin/seed-demo' @{}
  Check 'demo data loads (5 packets)' { @(Call $adm GET '/api/packets').Count -ge 5 -or (@(Call $adm GET '/api/packets?all=true' | ForEach-Object { $_ }).Count -ge 5) }

  Write-Host "`nUsers and PINs"
  $null = Call $adm POST '/api/admin/users' @{ name = 'Smoke Receiver'; roles = @('receiver'); pin = '5151'; email = 'smoke@example.com' }
  $null = Call $adm POST '/api/admin/users' @{ name = 'Smoke Receiver B'; roles = @('receiver'); pin = '6262' }
  $null = Call $adm POST '/api/admin/users' @{ name = 'Smoke Reviewer'; roles = @('reviewer'); pin = '7373' }
  $cards = Call $adm GET '/api/auth/cards'
  function Login($name, $pin) { $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession; $id = ($cards | Where-Object { $_.name -eq $name }).id; $r = Call $s POST '/api/auth/pin' @{ userId = $id; pin = $pin }; if (Failed $r) { return $null }; $s }
  Check 'wrong PIN is refused' { $id = ($cards | Where-Object { $_.name -eq 'Smoke Receiver' }).id; (Status (Call (New-Object Microsoft.PowerShell.Commands.WebRequestSession) POST '/api/auth/pin' @{ userId = $id; pin = '0000' })) -eq 401 }
  $r1 = Login 'Smoke Receiver' '5151'; $r2 = Login 'Smoke Receiver B' '6262'; $rv = Login 'Smoke Reviewer' '7373'; $rd = Login 'Demo Reviewer' '4444'
  Check 'correct PINs sign in' { $r1 -and $r2 -and $rv }

  Write-Host "`nPacket intake"
  $new = Call $adm POST '/api/packets' @{ bol = 'SMOKE-1'; vendor = 'Smoke Mill'; ship = '10/05/26'; carrier = 'Test'; rows = @(@{ po = 'TX-9000001'; heat = 'H100'; coil = ''; cc = '900001'; desc = 'W12x30'; len = "43' 0`""; wt = '7,740' }) }
  Check 'packet is created as a draft' { $new.ready -eq $false }
  Check 'duplicate BOL is refused' { (Status (Call $adm POST '/api/packets' @{ bol = 'SMOKE-1'; vendor = 'x'; rows = @(@{ po = 'TX-1' }) })) -eq 409 }
  Check 'receiver cannot see the draft' { -not ((Call $r1 GET '/api/packets') | Where-Object { $_.bol -eq 'SMOKE-1' }) }
  $pdf = [IO.File]::ReadAllBytes((Join-Path $repo 'Inspections\Beam, Channel, and Angle Inspection Sheet.pdf'))
  Check 'PDF upload makes it visible to receivers' { Invoke-WebRequest "$BaseUrl/api/packets/$($new.id)/pdf" -Method POST -Headers $h -ContentType 'application/pdf' -Body $pdf -WebSession $adm -UseBasicParsing | Out-Null; [bool]((Call $r1 GET '/api/packets') | Where-Object { $_.bol -eq 'SMOKE-1' }) }

  Write-Host "`nInspection"
  $id = $new.id; $f = "/api/packets/$id/forms/TX-9000001/shape"
  Check 'receiver can open the form' { (Call $r1 POST "$f/lock" @{}).ok }
  Check 'second receiver is blocked while it is open' { (Status (Call $r2 POST "$f/lock" @{})) -eq 409 }
  Check 'second receiver cannot save over it' { (Status (Call $r2 PUT $f @{ date = '2026-10-05'; items = @(@{}); submit = $false })) -eq 409 }
  Check 'first receiver submits (one reject)' { $x = Call $r1 PUT $f @{ date = '2026-10-05'; items = @(@{ heat = 'H100'; cc = '900001'; desc = 'W12x30'; qty = '6'; visual = 'bad'; cert = 'ok' }); submit = $true }; $x.stage -eq 'inspecting' }
  Check 'reject is logged' { @((Call $adm GET "/api/packets/$id").log | Where-Object { $_.what -like '*rejected*' }).Count -ge 1 }
  Check 'complete moves it to review' { (Call $r1 POST "/api/packets/$id/complete" @{}).stage -eq 'review' }
  Check 'every reviewer must approve (second one moves it on)' { (Call $rv POST "/api/packets/$id/approve" @{}).stage -eq 'review' -and (Call $rd POST "/api/packets/$id/approve" @{}).stage -eq 'receive' }
  Check 'receive needs a D365 number' { (Status (Call $adm POST "/api/packets/$id/receive" @{ d365 = '' })) -eq 400 }
  Check 'receive then authorize files it' { $null = Call $adm POST "/api/packets/$id/receive" @{ d365 = 'PR-SMOKE' }; (Call $adm POST "/api/packets/$id/authorize" @{}).stage -eq 'filed' }
  Check 'final packet PDF is saved and served' { $r = Invoke-WebRequest "$BaseUrl/api/packets/$id/final.pdf" -WebSession $adm -UseBasicParsing; $r.Content.Length -gt 5000 -and [Text.Encoding]::ASCII.GetString($r.Content[0..4]) -eq '%PDF-' }
  Check 'DocuWare index CSV has the row' { (Invoke-WebRequest "$BaseUrl/api/packets/$id/csv" -WebSession $adm -UseBasicParsing).Content -match 'SMOKE-1' }
  Check 'filed packet can be reopened with a reason' { (Status (Call $adm POST "/api/packets/$id/reopen" @{ reason = '' })) -eq 400 -and (Call $adm POST "/api/packets/$id/reopen" @{ reason = 'smoke test' }).stage -eq 'authorize' }

  Write-Host "`nIntake tools"
  Check 'reports summary works' { (Call $adm GET '/api/reports/summary').total -ge 1 }
  Check 'inspection export is a CSV' { (Invoke-WebRequest "$BaseUrl/api/reports/export.csv" -WebSession $adm -UseBasicParsing).Content -match 'Rejected fields' }
  Check 'PO list import and check' { $null = Call $adm POST '/api/admin/po-import' @{ csv = "PO,Vendor,Qty`nTX-9000001,Smoke Mill,100" }; $c = Call $adm GET '/api/pos/check?pos=TX-9000001,TX-NOPE'; $c.loaded -and ($c.results | Where-Object { $_.po -eq 'TX-9000001' }).found -and -not ($c.results | Where-Object { $_.po -eq 'TX-NOPE' }).found }
  Check 'draft can be deleted by intake' { $d = Call $adm POST '/api/packets' @{ bol = 'SMOKE-DRAFT'; vendor = 'x'; rows = @(@{ po = 'TX-1' }) }; (Call $adm DELETE "/api/packets/$($d.id)") -eq 'ok' }
  Check 'receiver cannot delete' { (Status (Call $r1 DELETE "/api/packets/$id")) -eq 403 }

  Write-Host "`nAdmin"
  Check 'backup runs and lists' { $b = Call $adm POST '/api/admin/backups/run' @{}; $b.file -and @((Call $adm GET '/api/admin/backups').files).Count -ge 1 }
  Check 'status page answers' { (Call $adm GET '/api/admin/status').users -ge 3 }
  Check 'audit search answers' { @((Call $adm GET '/api/admin/audit?q=smoke').rows).Count -ge 1 }
  Check 'reviewer can read the dashboard data' { (Call $rv GET '/api/reports/summary').total -ge 1 }
  Check 'receiver cannot read the dashboard data' { (Status (Call $r1 GET '/api/reports/summary')) -eq 403 }
  Check 'receiver cannot open admin settings' { (Status (Call $r1 GET '/api/admin/settings')) -eq 403 }
}
finally {
  if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; Start-Sleep 1; Write-Host "`n(temporary instance stopped; data in $data)" }
}
Write-Host ("`n{0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor $(if ($script:fail) { 'Red' } else { 'Green' })
exit $(if ($script:fail) { 1 } else { 0 })
