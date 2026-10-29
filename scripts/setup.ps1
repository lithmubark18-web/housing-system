# إعداد بيئة التطوير المحلية لنظام إدارة السكن
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "=== نظام إدارة السكن — الإعداد المحلي ===" -ForegroundColor Cyan

# 1) متغيرات البيئة للخادم الخلفي
if (-not (Test-Path "backend\.env")) {
    Copy-Item "backend\.env.example" "backend\.env"
    Write-Host "تم إنشاء backend\.env (اترك DATABASE_URL فارغاً للعمل على data.json)" -ForegroundColor Yellow
}

# 2) البيئة الافتراضية لبايثون
if (-not (Test-Path "backend\.venv\Scripts\python.exe")) {
    Write-Host "إنشاء بيئة بايثون 3.13..." -ForegroundColor Green
    py -3.13 -m venv backend\.venv
}

Write-Host "تثبيت متطلبات الخادم الخلفي..." -ForegroundColor Green
& backend\.venv\Scripts\python.exe -m pip install --upgrade pip
& backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

# 3) حزم الواجهة
if (-not (Test-Path "frontend\node_modules")) {
    Write-Host "تثبيت حزم الواجهة..." -ForegroundColor Green
    Push-Location frontend
    npm install
    Pop-Location
}

# 4) إنشاء ملف البيانات المحلي من البذرة عند أول تشغيل
if (-not (Test-Path "backend\data.json")) {
    Write-Host "سيُنشأ backend\data.json تلقائياً من seed.json عند أول تشغيل للخادم." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "تم الإعداد. شغّل النظام بالأمر:" -ForegroundColor Cyan
Write-Host "  .\scripts\start-local.ps1" -ForegroundColor Green
