# SPDX-License-Identifier: AGPL-3.0-only
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$GuiRepo = "Tihulu/GUI4tihulu-star-trail"
$EngineRoot = Join-Path $env:LOCALAPPDATA "GUI4tihulu-star-trail\cli"
$ManagedTihulu = Join-Path $EngineRoot ".venv\Scripts\tihulu.exe"

function Write-Step([string]$Message) {
    Write-Host "`n$Message" -ForegroundColor Magenta
}

function Find-Tihulu {
    $command = Get-Command tihulu -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    if (Test-Path $ManagedTihulu) { return $ManagedTihulu }
    return $null
}

function Find-Python312 {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) { return @{ Exe = $py.Source; Prefix = @("-3.12") } }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        try {
            $version = & $python.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
            if ([version]$version -ge [version]"3.9") { return @{ Exe = $python.Source; Prefix = @() } }
        } catch {}
    }

    $preferred = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
    if (Test-Path $preferred) { return @{ Exe = $preferred; Prefix = @() } }

    $pythonRoot = Join-Path $env:LOCALAPPDATA "Programs\Python"
    if (Test-Path $pythonRoot) {
        $candidate = Get-ChildItem $pythonRoot -Filter python.exe -Recurse -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($candidate) { return @{ Exe = $candidate.FullName; Prefix = @() } }
    }
    return $null
}

$Tihulu = Find-Tihulu
if (-not $Tihulu) {
    Write-Step "tihulu-star-trail is not installed - installing the engine"
    $Python = Find-Python312
    if (-not $Python) {
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if (-not $winget) {
            throw "Python 3.9+ was not found and winget is unavailable. Install Python 3.12, then rerun this command."
        }
        & $winget.Source install --id Python.Python.3.12 -e --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw "winget could not install Python 3.12." }
        $Python = Find-Python312
        if (-not $Python) { throw "Python 3.12 was installed but could not be located in this PowerShell session." }
    }

    New-Item -ItemType Directory -Force -Path $EngineRoot | Out-Null
    $VenvPath = Join-Path $EngineRoot ".venv"
    $VenvArgs = @($Python.Prefix) + @("-m", "venv", $VenvPath)
    & $Python.Exe @VenvArgs
    if ($LASTEXITCODE -ne 0) { throw "Could not create the tihulu-star-trail virtual environment." }

    $VenvPython = Join-Path $VenvPath "Scripts\python.exe"
    & $VenvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "Could not update pip." }
    & $VenvPython -m pip install "tihulu-star-trail[video] @ https://github.com/Tihulu/tihulu-star-trail/archive/refs/heads/main.zip"
    if ($LASTEXITCODE -ne 0) { throw "Could not install tihulu-star-trail." }

    $Tihulu = Find-Tihulu
    if (-not $Tihulu) { throw "tihulu-star-trail installed, but its launcher could not be found." }
} else {
    Write-Step "Found tihulu-star-trail: $Tihulu"
}

& $Tihulu --help *> $null
if ($LASTEXITCODE -ne 0) { throw "The tihulu launcher exists but could not be executed." }

Write-Step "Downloading the latest Tihulu Star Trail Studio"
$Headers = @{ "Accept" = "application/vnd.github+json"; "User-Agent" = "GUI4tihulu-star-trail-installer" }
$Release = Invoke-RestMethod -Headers $Headers -Uri "https://api.github.com/repos/$GuiRepo/releases/latest"
$Asset = $Release.assets | Where-Object { $_.name -match '(?i)(setup|installer).*\.exe$' } | Select-Object -First 1
if (-not $Asset) {
    $Asset = $Release.assets | Where-Object { $_.name -match '(?i)\.exe$' -and $_.name -notmatch '\.sig$' } | Select-Object -First 1
}
if (-not $Asset) { throw "No Windows installer exists in the latest GUI release. Publish a tagged release first." }

$Installer = Join-Path $env:TEMP "tihulu-star-trail-studio-setup.exe"
Invoke-WebRequest -Headers $Headers -Uri $Asset.browser_download_url -OutFile $Installer

Write-Step "Installing Tihulu Star Trail Studio"
$Process = Start-Process -FilePath $Installer -ArgumentList "/S" -Wait -PassThru
Remove-Item $Installer -Force -ErrorAction SilentlyContinue
if ($Process.ExitCode -ne 0) { throw "GUI installer exited with code $($Process.ExitCode)." }

Write-Host "`nInstalled Tihulu Star Trail Studio." -ForegroundColor Green
Write-Host "Engine: $Tihulu"
Write-Host "License: GNU AGPL v3 (AGPL-3.0-only)"
Write-Host "Open it from the Windows Start menu."
