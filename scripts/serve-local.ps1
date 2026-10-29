# تقديم ملفات الواجهة المبنية محلياً (frontend/dist)
# الاستخدام: .\scripts\serve-local.ps1 [-Port 3444]
param(
    [int]$Port = 3444,
    [string]$ApiUrl = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $projectRoot "frontend")

if (-not (Test-Path "dist\index.html")) {
    throw "الواجهة غير مبنية. شغّل أولاً: cd frontend; npm run build"
}

$env:PORT = "$Port"
if ($ApiUrl) { $env:API_PROXY_TARGET = $ApiUrl }

Write-Host "تقديم الواجهة على http://127.0.0.1:$Port" -ForegroundColor Green
if ($ApiUrl) { Write-Host "تحويل /api/* إلى $ApiUrl" -ForegroundColor Yellow }
node scripts/serve-static.mjs
