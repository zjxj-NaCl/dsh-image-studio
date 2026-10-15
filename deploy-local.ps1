param(
  [string]$InstallRoot = 'C:\Users\ZJXJ_NaCl\.dsh\plugins\dsh-image-studio'
)
$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
if (!(Test-Path -LiteralPath $InstallRoot)) { throw "Install target directory does not exist: $InstallRoot" }
$installedRoot = (Resolve-Path -LiteralPath $InstallRoot).Path
if ($installedRoot -ne 'C:\Users\ZJXJ_NaCl\.dsh\plugins\dsh-image-studio') { throw 'Only the inspected local plugin directory is supported.' }
$item = Get-Item -LiteralPath $installedRoot -Force
if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installed plugin must be a regular directory, not a link.' }
$sourceManifest = Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw | ConvertFrom-Json
if ($sourceManifest.name -ne 'dsh-image-studio') { throw "Unexpected source package: $($sourceManifest.name)" }
$targetManifestPath = Join-Path $installedRoot 'package.json'
if (Test-Path -LiteralPath $targetManifestPath) {
  $targetManifest = Get-Content -LiteralPath $targetManifestPath -Raw | ConvertFrom-Json
  if ($targetManifest.name -ne 'dsh-image-studio') { throw "Unexpected installed package: $($targetManifest.name)" }
}
& node (Join-Path $packageRoot 'build.mjs') --check
if ($LASTEXITCODE -ne 0) { throw 'Build is stale.' }
# Copy only enumerated source/build/test artifacts. Preserve all host settings
# and unrelated plugin files.
$relativeFiles = @(
  'lib\index.js', 'lib\image-api.js', 'lib\comfy.js', 'lib\tool.js', 'lib\client.js', 'lib\conversation-host.js', 'lib\bridge.js',
  'src\index.js', 'src\image-api.js', 'src\comfy.js', 'src\tool.js', 'src\studio-model.js', 'src\client.js', 'src\model-config.js', 'src\conversation-host.js', 'src\bridge.js',
  'build.mjs', 'cordis.patch.yml', 'LICENSE', 'package.json', 'README.md',
  'test-image-api.mjs', 'test-studio-model.mjs', 'test-client.mjs', 'test-auth.mjs', 'test-host.mjs', 'test-tool.mjs',
  'test-bridge.mjs', 'test-bridge-route.mjs', 'test-host-inject.mjs'
)
$entries = foreach ($relative in $relativeFiles) {
  $source = [IO.Path]::GetFullPath((Join-Path $packageRoot $relative))
  $target = [IO.Path]::GetFullPath((Join-Path $installedRoot $relative))
  if (!$source.StartsWith($packageRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or !$target.StartsWith($installedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside selected package.' }
  $sourceItem = Get-Item -LiteralPath $source -Force
  if ($sourceItem.PSIsContainer -or ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Invalid source: $relative" }
  $targetItem = $null
  if (Test-Path -LiteralPath $target) {
    $targetItem = Get-Item -LiteralPath $target -Force
    if ($targetItem.PSIsContainer -or ($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Invalid target: $relative" }
  }
  $parent = Split-Path -Parent $target
  while ($parent -and $parent.StartsWith($installedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    if (Test-Path -LiteralPath $parent) {
      $parentItem = Get-Item -LiteralPath $parent -Force
      if (!$parentItem.PSIsContainer -or ($parentItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Invalid target parent: $relative" }
    }
    if ($parent -eq $installedRoot) { break }
    $parent = Split-Path -Parent $parent
  }
  [pscustomobject]@{ Relative = $relative; Source = $source; Target = $target; Exists = ($null -ne $targetItem) }
}
if (@($entries).Count -ne 30) { throw 'Unexpected deployment target count.' }
$bridgeTarget = Join-Path $installedRoot 'lib\bridge.js'
if ((Test-Path -LiteralPath $bridgeTarget) -and (Get-FileHash -LiteralPath $bridgeTarget).Hash -ne (Get-FileHash -LiteralPath (Join-Path $packageRoot 'lib\bridge.js')).Hash) { throw 'Installed conversation bridge changed since inspection; stop for review.' }
$backupRoot = Join-Path $packageRoot ('deployment-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $backupRoot | Out-Null
$entries | Select-Object Relative,Exists | Format-Table -AutoSize
# Complete every backup before overwriting anything.
foreach ($entry in $entries) {
  if ($entry.Exists) {
    $backupFile = Join-Path $backupRoot $entry.Relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force | Out-Null
    Copy-Item -LiteralPath $entry.Target -Destination $backupFile
  }
}
foreach ($entry in $entries) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $entry.Target) -Force | Out-Null
  Copy-Item -LiteralPath $entry.Source -Destination $entry.Target -Force
  if ((Get-FileHash -LiteralPath $entry.Source).Hash -ne (Get-FileHash -LiteralPath $entry.Target).Hash) { throw "Deployment verification failed: $($entry.Relative)" }
}
Write-Output "Updated 30 exact plugin artifacts. Original files backed up at: $backupRoot"
Write-Output 'Restart DSH and the project Agent to activate. No process was stopped and no workflow was changed.'
