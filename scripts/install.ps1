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
    if (Test-Path $ManagedTihulu) { return $ManagedTihulu }
    $command = Get-Command tihulu -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

function Test-HardwarePolicies([string]$Executable) {
    if (-not $Executable -or -not (Test-Path $Executable)) { return $false }
    try {
        $help = (& $Executable run --help 2>&1 | Out-String)
        return $help.Contains("--group-hardware") -and $help.Contains("--trail-hardware") -and $help.Contains("--timelapse-hardware")
    } catch { return $false }
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

function Ensure-Python {
    $Python = Find-Python312
    if ($Python) { return $Python }
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Python 3.9+ was not found and winget is unavailable. Install Python 3.12, then rerun this command."
    }
    & $winget.Source install --id Python.Python.3.12 -e --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget could not install Python 3.12." }
    $Python = Find-Python312
    if (-not $Python) { throw "Python 3.12 was installed but could not be located in this PowerShell session." }
    return $Python
}

function Install-CurrentEngine {
    $Python = Ensure-Python
    New-Item -ItemType Directory -Force -Path $EngineRoot | Out-Null
    $VenvPath = Join-Path $EngineRoot ".venv"
    $VenvPython = Join-Path $VenvPath "Scripts\python.exe"
    if (-not (Test-Path $VenvPython)) {
        $VenvArgs = @($Python.Prefix) + @("-m", "venv", $VenvPath)
        & $Python.Exe @VenvArgs
        if ($LASTEXITCODE -ne 0) { throw "Could not create the tihulu-star-trail virtual environment." }
    }
    & $VenvPython -m pip install --upgrade pip setuptools wheel
    if ($LASTEXITCODE -ne 0) { throw "Could not update pip." }
    & $VenvPython -m pip install --upgrade --force-reinstall "tihulu-star-trail[video] @ https://github.com/Tihulu/tihulu-star-trail/archive/refs/heads/main.zip"
    if ($LASTEXITCODE -ne 0) { throw "Could not install/update tihulu-star-trail." }
}

$Tihulu = Find-Tihulu
if (-not $Tihulu) {
    Write-Step "tihulu-star-trail is not installed - installing the current engine"
    Install-CurrentEngine
} elseif (Test-HardwarePolicies $Tihulu) {
    Write-Step "Found compatible tihulu-star-trail: $Tihulu"
} else {
    Write-Step "Installed tihulu engine is older than this GUI - updating it"
    Install-CurrentEngine
}

$Tihulu = Find-Tihulu
if (-not $Tihulu) { throw "tihulu-star-trail installed, but its launcher could not be found." }
& $Tihulu --help *> $null
if ($LASTEXITCODE -ne 0) { throw "The tihulu launcher exists but could not be executed." }
if (-not (Test-HardwarePolicies $Tihulu)) {
    throw "The engine was updated but still does not expose group/trail/timelapse hardware controls."
}

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
Write-Host "Engine hardware controls: Auto / CPU / GPU / GPU+CPU ready"
Write-Host "License: GNU AGPL v3 (AGPL-3.0-only)"
Write-Host "Open it from the Windows Start menu."
