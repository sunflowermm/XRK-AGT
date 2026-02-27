Param(
    [string]$SourceDir = "skills"
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = Join-Path $root $SourceDir

if (-not (Test-Path $sourcePath)) {
    Write-Error "Source directory not found: $sourcePath"
    exit 1
}

$targets = @(
    (Join-Path $root ".claude\skills"),
    (Join-Path $root ".trae\skills"),
    (Join-Path $root ".cursor\skills")
)

foreach ($target in $targets) {
    if (-not (Test-Path $target)) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
    }

    Write-Host "Copy $sourcePath -> $target"
    Copy-Item -Path (Join-Path $sourcePath "*") -Destination $target -Recurse -Force
}

Write-Host "skills synced to .claude and .trae and .cursor."
