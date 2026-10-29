# تشغيل النظام محلياً: الخادم الخلفي على 8000 والواجهة على 3000
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$python = "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

if (-not (Test-Path "backend\.env")) { Copy-Item "backend\.env.example" "backend\.env" }

Write-Host "=== نظام إدارة السكن — تشغيل محلي ===" -ForegroundColor Cyan

$api = Start-Process -PassThru -WindowStyle Hidden `
    -FilePath (Resolve-Path $python) `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory (Join-Path $projectRoot "backend")

Write-Host "الخادم الخلفي: http://127.0.0.1:8000  (المستندات: /docs)" -ForegroundColor Green

Push-Location frontend
try {
    npm run dev
} finally {
    Pop-Location
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force }
}
