# بناء تطبيق أندرويد (APK) من واجهة Next.js
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $projectRoot "frontend")

if (-not $env:JAVA_HOME) {
    $jbr = "C:\Program Files\Android\Android Studio\jbr"
    if (Test-Path $jbr) { $env:JAVA_HOME = $jbr }
}

if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
    throw "لم يتم العثور على Java. ثبّت Android Studio أو اضبط JAVA_HOME."
}

if (-not (Test-Path "android\local.properties")) {
    $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
    if (-not (Test-Path $sdk)) { throw "لم يتم العثور على Android SDK في $sdk" }
    "sdk.dir=$($sdk -replace '\\', '\\')" | Set-Content "android\local.properties" -Encoding ASCII
}

Write-Host "=== 1/4 بناء واجهة الويب ===" -ForegroundColor Cyan
npm run build

Write-Host "=== 2/4 مزامنة Capacitor ===" -ForegroundColor Cyan
npx cap sync android

Write-Host "=== 3/4 بناء APK ===" -ForegroundColor Cyan
Push-Location android
try {
    .\gradlew.bat assembleDebug --console=plain
} finally {
    Pop-Location
}

$apk = "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) { throw "لم يتم إنتاج APK" }

$target = Join-Path $projectRoot "housing-management-v2.0.0.apk"
Copy-Item $apk $target -Force
Write-Host ""
Write-Host "تم إنشاء الملف: $target" -ForegroundColor Green
