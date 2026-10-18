# Publish the GitHub Release for the current version.
#
# The token is read from GH_TOKEN / GITHUB_TOKEN when already set, otherwise from
# the git credential store that `git push` already uses — so nothing has to be
# pasted into a terminal or written to a file. The token is never printed.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-release.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-release.ps1 -DryRun
param(
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $PSScriptRoot 'publish-release.mjs'

if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
  $request = "protocol=https`nhost=github.com`n"
  $answer = ($request | & git credential fill 2>$null) -join "`n"
  if ($answer -notmatch '(?m)^password=(.+)$') {
    throw 'No GitHub token: set GH_TOKEN, or sign in once with git push so the credential store has one.'
  }
  $env:GH_TOKEN = $Matches[1].Trim()
  Write-Output 'Using the token already stored by git.'
}

$arguments = @($entry)
if ($DryRun) { $arguments += '--dry-run' }
& node @arguments
exit $LASTEXITCODE
