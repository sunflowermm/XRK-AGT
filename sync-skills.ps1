$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cursorDir = Join-Path $root ".cursor"
if (-not (Test-Path $cursorDir)) { Write-Error "Source not found: $cursorDir"; exit 1 }

$pairs = @(
    @{ From = "skills"; ToClaude = ".claude\skills"; ToTrae = ".trae\skills" },
    @{ From = "rules";  ToClaude = ".claude\rules"; ToTrae = ".trae\rules" }
)

foreach ($pair in $pairs) {
    $src = Join-Path $cursorDir $pair.From
    if (-not (Test-Path $src)) { Write-Host "Skip (missing): $src"; continue }
    foreach ($targetRel in $pair.ToClaude, $pair.ToTrae) {
        $target = Join-Path $root $targetRel
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Write-Host "Copy .cursor\$($pair.From) -> $targetRel"
        Copy-Item -Path (Join-Path $src "*") -Destination $target -Recurse -Force
    }
}
Write-Host "Done. .cursor/skills and .cursor/rules synced to .claude and .trae."
