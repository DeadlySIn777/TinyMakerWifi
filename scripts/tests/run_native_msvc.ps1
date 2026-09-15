param(
    [string]$UnitySource,
    [string]$VcVars = 'C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Auxiliary/Build/vcvars64.bat'
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (!$UnitySource) { $UnitySource = Join-Path $project '.pio/libdeps/native/Unity/src' }
if (!(Test-Path (Join-Path $UnitySource 'unity.c'))) {
    throw 'Supply -UnitySource pointing to an installed Unity/src directory (unity.c, unity.h).'
}
if (!(Test-Path $VcVars)) { throw "MSVC environment not found: $VcVars" }
$UnitySource = (Resolve-Path $UnitySource).Path
$output = Join-Path $project '.cache/native'
New-Item -ItemType Directory -Force $output | Out-Null
$batch = Join-Path $output 'run-tests.cmd'
# Fixed build command only. No network, printer connection, or hardware upload.
$lines = @(
    '@echo off'
    ('call "' + $VcVars + '" >nul')
    'if errorlevel 1 exit /b %errorlevel%'
    ('cl /nologo /EHsc /std:c++14 /D_CRT_SECURE_NO_WARNINGS /I"' + $project + '\src" /I"' + $UnitySource + '" "' + $project + '\test\test_pure\test_main.cpp" "' + $UnitySource + '\unity.c" /Fe:"test_pure.exe" /Fo:".\\"')
    'if errorlevel 1 exit /b %errorlevel%'
    'test_pure.exe'
    'exit /b %errorlevel%'
)
Set-Content -LiteralPath $batch -Value $lines -Encoding Ascii
Push-Location $output
try {
    & cmd.exe /d /c run-tests.cmd
    if ($LASTEXITCODE -ne 0) { throw "Native tests failed (exit $LASTEXITCODE)." }
} finally { Pop-Location }
