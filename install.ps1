# install.ps1

param(
    [string]$Repo = "ch99q/pluggy",
    [string]$Binary = "pluggy"
)

function Get-Arch {
    switch ($env:PROCESSOR_ARCHITECTURE) {
        "AMD64" { return "x86_64" }
        "ARM64" { return "arm64" }
        default { throw "Unsupported architecture: $($env:PROCESSOR_ARCHITECTURE)" }
    }
}

function Ensure-Path($InstallDir) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
        Write-Host "Added $InstallDir to your user PATH. You may need to restart your terminal."
    }
}

$arch = Get-Arch
$os = "windows"
$exeName = "$Binary.exe"
$downloadUrl = "https://github.com/$Repo/releases/latest/download/$Binary-$os-$arch.exe"
$installDir = "$env:USERPROFILE\.deno\bin"

if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir | Out-Null
}

$dest = Join-Path $installDir $exeName

Write-Host "Downloading $downloadUrl ..."
Invoke-WebRequest -Uri $downloadUrl -OutFile $dest

Write-Host "Installed $Binary to $dest"

Ensure-Path $installDir

Write-Host "`nYou can now run '$Binary' from any terminal. If not, restart your terminal or add $installDir to your PATH."
