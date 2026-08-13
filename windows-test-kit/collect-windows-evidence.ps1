$ErrorActionPreference = "Stop"

function FileVersion($Candidates) {
  foreach ($Candidate in $Candidates) {
    if (Test-Path $Candidate) {
      return [ordered]@{ path = $Candidate; version = (Get-Item $Candidate).VersionInfo.FileVersion }
    }
  }
  return $null
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dist = Join-Path $Root "dist"
if (-not (Test-Path (Join-Path $Dist "index.html"))) {
  $Dist = Join-Path (Split-Path -Parent $Root) "dist"
}
if (-not (Test-Path (Join-Path $Dist "index.html"))) {
  throw "dist/index.html is missing"
}
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Evidence = Join-Path $Root "evidence-$Stamp"
New-Item -ItemType Directory -Path $Evidence | Out-Null

$Tester = Read-Host "Your name"
$BoardRevision = Read-Host "Biotron PCB/revision marking (write UNKNOWN if not visible)"
$FirmwareVersion = Read-Host "Current firmware version shown in Settings (write UNKNOWN if not visible)"
$DeviceCount = Read-Host "Number of connected Biotrons (start with 1)"

$Os = Get-CimInstance Win32_OperatingSystem
$Chrome = FileVersion @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$Edge = FileVersion @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$Reaper = FileVersion @(
  "$env:ProgramFiles\REAPER (x64)\reaper.exe",
  "$env:ProgramFiles\REAPER\reaper.exe",
  "${env:ProgramFiles(x86)}\REAPER\reaper.exe"
)

$Hashes = Get-ChildItem -Path $Dist -File -Recurse | ForEach-Object {
  $Hash = Get-FileHash -Algorithm SHA256 $_.FullName
  [ordered]@{
    path = "dist/" + $_.FullName.Substring($Dist.Length + 1).Replace("\", "/")
    sha256 = $Hash.Hash.ToLower()
  }
}

$Environment = [ordered]@{
  collected_at = (Get-Date).ToUniversalTime().ToString("o")
  tester = $Tester
  os = [ordered]@{
    caption = $Os.Caption
    version = $Os.Version
    build = $Os.BuildNumber
    architecture = $Os.OSArchitecture
  }
  tools = [ordered]@{
    powershell = $PSVersionTable.PSVersion.ToString()
    node = (& node --version)
    chrome = $Chrome
    edge = $Edge
    reaper = $Reaper
  }
  device = [ordered]@{
    count = $DeviceCount
    board_revision = $BoardRevision
    firmware_version = $FirmwareVersion
  }
  winrt_flag = "default-not-yet-changed"
  artifact_files = $Hashes
}
$Environment | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $Evidence "environment.json") -Encoding UTF8

$Checklist = @"
# Biotron Windows physical test — $Stamp

Keep every result as PASS / FAIL / BLOCKED. Add screenshot or video filenames.

- [ ] W01 Settings opens and shows exactly the expected device/version:
- [ ] W02 Release shows success only when the selected device closes:
- [ ] W03 REAPER enables and records Biotron MIDI input:
- [ ] W04 Reconnect while REAPER owns the port shows an honest error:
- [ ] W05 Reconnect succeeds after REAPER releases the port:
- [ ] W06 Five quick handoff cycles pass (final gate requires 20):
- [ ] W07 Offline refresh/restart opens Biotron Settings:
- [ ] W08 Offline firmware update is blocked and device stays out of BOOT:
- [ ] Optional second-device isolation (only after one-device test passes):

Notes:

Screenshots/videos:
"@
$Checklist | Set-Content -Path (Join-Path $Evidence "CHECKLIST.md") -Encoding UTF8
Write-Host "Evidence folder created: $Evidence"
