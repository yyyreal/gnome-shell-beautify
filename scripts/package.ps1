[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$metadataPath = Join-Path $projectRoot 'metadata.json'
$metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
$uuid = [string]$metadata.uuid
$version = [string]$metadata.'version-name'

if ([string]::IsNullOrWhiteSpace($uuid) -or $uuid -notmatch '^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$') {
    throw 'metadata.json 中的 uuid 无效。'
}

$requiredFiles = @(
    'extension.js',
    'prefs.js',
    'i18n.js',
    'metadata.json',
    'manifest.json',
    'stylesheet.css',
    'prefs.css',
    'README.md'
)
foreach ($relativePath in $requiredFiles) {
    $sourcePath = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "缺少打包文件：$relativePath"
    }
}

$schemaPath = Join-Path $projectRoot 'schemas\org.gnome.shell.extensions.gnome-beautify.gschema.xml'
[xml](Get-Content -Raw -LiteralPath $schemaPath) | Out-Null

$buildRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'build'))
$stagePath = [System.IO.Path]::GetFullPath((Join-Path $buildRoot $uuid))
$buildBoundary = $buildRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $stagePath.StartsWith($buildBoundary, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw '构建暂存目录超出项目 build 目录，已停止。'
}

if (Test-Path -LiteralPath $stagePath) {
    Remove-Item -LiteralPath $stagePath -Recurse -Force
}
New-Item -ItemType Directory -Path $stagePath -Force | Out-Null

foreach ($relativePath in $requiredFiles) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination $stagePath
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'icons') -Destination $stagePath -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'schemas') -Destination $stagePath -Recurse

$schemaCompiler = Get-Command glib-compile-schemas -ErrorAction SilentlyContinue
if ($schemaCompiler) {
    & $schemaCompiler.Source (Join-Path $stagePath 'schemas')
}

node --check (Join-Path $stagePath 'extension.js')
if ($LASTEXITCODE -ne 0) { throw 'extension.js 语法检查失败。' }
node --check (Join-Path $stagePath 'prefs.js')
if ($LASTEXITCODE -ne 0) { throw 'prefs.js 语法检查失败。' }
node --check (Join-Path $stagePath 'i18n.js')
if ($LASTEXITCODE -ne 0) { throw 'i18n.js 语法检查失败。' }

$distRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))
New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
$zipPath = [System.IO.Path]::GetFullPath((Join-Path $distRoot "$uuid-v$version.zip"))
$distBoundary = $distRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $zipPath.StartsWith($distBoundary, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw '输出文件超出项目 dist 目录，已停止。'
}
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $stagePath '*') -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "打包完成：$zipPath"

