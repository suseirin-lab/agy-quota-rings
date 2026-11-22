#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "SilentlyContinue"

$SupportDir = Join-Path $env:LOCALAPPDATA "agy-quota-rings"
$WatcherPath = Join-Path $SupportDir "src\watcher.mjs"

$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($NodeCmd -and (Test-Path $WatcherPath)) {
    & $NodeCmd.Source $WatcherPath --remove | Out-Null
}

# Stop any running agy-quota-rings watcher process
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*agy-quota-rings*watcher.mjs*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$Shortcuts = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Antigravity (Quota Rings).lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Antigravity (Quota Rings).lnk")
)
foreach ($Lnk in $Shortcuts) {
    if (Test-Path $Lnk) { Remove-Item -Force $Lnk }
}

if (Test-Path $SupportDir) {
    Remove-Item -Recurse -Force $SupportDir
}

Write-Host "Uninstalled agy-quota-rings cleanly." -ForegroundColor Green
