$base = "E:\PY\CODES\PY_APP\app\src"
$dirs = @(
    "$base\channels",
    "$base\core\gateway"
)

foreach ($dir in $dirs) {
    $files = Get-ChildItem -Path $dir -Recurse -Filter "*.ts" |-Object {
        $_.DirectoryName -notlike "*\node_modules\*" -and
        $_.DirectoryName -notlike "*\dist\*"and
        $_.Name -notlike "*..ts" -and
        $_.Name -notlike "*.spec.ts"
    }
    foreach ($f in $files) {
        $content = Get-Content $f.FullNameRaw -ErrorAction SilentlyContinue
        if ($content -match 'new Logger\(') {
            if ($content -notmatch 'module:') {
                Write-Output $f.FullName
            }
        }
    }
}
