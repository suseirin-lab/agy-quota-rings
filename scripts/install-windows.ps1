#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoDir = Split-Path -Parent $PSScriptRoot
$SupportDir = Join-Path $env:LOCALAPPDATA "agy-quota-rings"
$SrcDestDir = Join-Path $SupportDir "src"

$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
    Write-Error "Node.js 22+ is required but was not found in PATH. Install from https://nodejs.org/"
    exit 1
}

$NodeVersionRaw = (& $NodeCmd.Source -v).Trim().TrimStart("v")
$NodeMajor = [int]($NodeVersionRaw.Split(".")[0])
if ($NodeMajor -lt 22) {
    Write-Error "Node.js 22+ is required (found v$NodeVersionRaw)."
    exit 1
}

New-Item -ItemType Directory -Force -Path $SrcDestDir | Out-Null
Copy-Item -Force (Join-Path $RepoDir "src\quota-rings.js") (Join-Path $SrcDestDir "quota-rings.js")
Copy-Item -Force (Join-Path $RepoDir "src\watcher.mjs") (Join-Path $SrcDestDir "watcher.mjs")

# Silent WScript launcher (no console window flash, managed mode: exits when Antigravity closes)
$VbsPath = Join-Path $SupportDir "launch-antigravity.vbs"
$WatcherPath = Join-Path $SrcDestDir "watcher.mjs"
$NodeExe = $NodeCmd.Source

$VbsContent = @"
Option Explicit
Dim shell, env, cmd
Set shell = CreateObject("WScript.Shell")
Set env = shell.Environment("Process")
env("NO_PROXY") = "127.0.0.1,localhost"
env("no_proxy") = "127.0.0.1,localhost"
env("HTTP_PROXY") = ""
env("HTTPS_PROXY") = ""
env("ALL_PROXY") = ""
env("http_proxy") = ""
env("https_proxy") = ""
env("all_proxy") = ""

cmd = Chr(34) & "$NodeExe" & Chr(34) & " " & Chr(34) & "$WatcherPath" & Chr(34) & " --launch --relaunch --exit-on-host-close"
shell.Run cmd, 0, False
"@

Set-Content -Path $VbsPath -Value $VbsContent -Encoding ASCII

# Locate Antigravity.exe icon if available
$IconCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Antigravity\Antigravity.exe"),
    (Join-Path $env:LOCALAPPDATA "Antigravity\Antigravity.exe"),
    (Join-Path $env:ProgramFiles "Antigravity\Antigravity.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Antigravity\Antigravity.exe")
)
$IconExe = $IconCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

$WshShell = New-Object -ComObject WScript.Shell
$ShortcutDirs = @(
    [Environment]::GetFolderPath("Desktop"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs")
)

foreach ($Dir in $ShortcutDirs) {
    if (-not (Test-Path $Dir)) { continue }
    $LnkPath = Join-Path $Dir "Antigravity (Quota Rings).lnk"
    $Shortcut = $WshShell.CreateShortcut($LnkPath)
    $Shortcut.TargetPath = "wscript.exe"
    $Shortcut.Arguments = "`"$VbsPath`""
    $Shortcut.WorkingDirectory = $SupportDir
    $Shortcut.Description = "Launch Antigravity Desktop with agy-quota-rings (managed mode)"
    if ($IconExe) {
        $Shortcut.IconLocation = "$IconExe,0"
    }
    $Shortcut.Save()
}

Write-Host "Installed agy-quota-rings for Windows!" -ForegroundColor Green
Write-Host "Install dir : $SupportDir"
Write-Host "Shortcut    : Desktop & Start Menu -> 'Antigravity (Quota Rings)'"
Write-Host "Tip         : Pin the shortcut to Taskbar. Watcher exits automatically when Antigravity closes."
