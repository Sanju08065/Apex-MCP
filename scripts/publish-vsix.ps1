$ErrorActionPreference = 'Stop'
Write-Output '1/4 — Installing dependencies (npm ci)'
npm ci

Write-Output '2/4 — Running package script (npm run package)'
npm run package

Write-Output '3/4 — Locating generated .vsix file'
$vsix = Get-ChildItem -Path . -Filter '*.vsix' -Recurse -File | Select-Object -First 1
if (-not $vsix) {
    Write-Error 'VSIX not found'
    exit 2
}
$vsixPath = $vsix.FullName
Write-Output "VSIX_FOUND::$vsixPath"

Write-Output '4/4 — Checking/creating releases repo and creating release'
try {
    gh repo view Sanju08065/apex-releases > $null 2>&1
    $exists = $true
} catch {
    $exists = $false
}
if (-not $exists) {
    Write-Output 'Releases repo not found — creating apex-releases'
    gh repo create Sanju08065/apex-releases --public --description 'Release artifacts for Apex MCP' --confirm
}

$tag = 'v1.0.1'
Write-Output "Creating GitHub release $tag and uploading $vsixPath"
gh release create $tag --title $tag --notes-file CHANGELOG.md $vsixPath

Write-Output 'Finished'
