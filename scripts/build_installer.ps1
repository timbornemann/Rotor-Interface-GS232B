param(
    [switch]$SkipDependencyInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$BuildRoot = Join-Path $RepoRoot "build\installer"
$VenvPath = Join-Path $BuildRoot ".venv"
$ArtifactRoot = Join-Path $BuildRoot "artifact"
$PyInstallerDist = Join-Path $BuildRoot "pyinstaller-dist"
$PyInstallerWork = Join-Path $BuildRoot "pyinstaller-work"
$InstallerOutput = Join-Path $RepoRoot "dist\installer"
$IconPath = Join-Path $ArtifactRoot "rotor-interface.ico"
$InstallerLogoPath = Join-Path $RepoRoot "src\renderer\assets\logo-installer.png"
$PackageJsonPath = Join-Path $RepoRoot "package.json"
$RequirementsPath = Join-Path $RepoRoot "requirements.txt"
$InnoScript = Join-Path $RepoRoot "installer\rotor-server.iss"
$EntryPoint = Join-Path $RepoRoot "server\main.py"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-IsccPath {
    $isccFromEnv = [Environment]::GetEnvironmentVariable("INNO_SETUP_ISCC")
    if ($isccFromEnv) {
        if (Test-Path $isccFromEnv) {
            return (Resolve-Path $isccFromEnv).Path
        }
        throw "INNO_SETUP_ISCC is set, but the file does not exist: $isccFromEnv"
    }

    $command = Get-Command "iscc.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    $programFiles = [Environment]::GetEnvironmentVariable("ProgramFiles")
    $candidates = @()
    if ($programFilesX86) {
        $candidates += Join-Path $programFilesX86 "Inno Setup 6\ISCC.exe"
        $candidates += Join-Path $programFilesX86 "Inno Setup 5\ISCC.exe"
    }
    if ($programFiles) {
        $candidates += Join-Path $programFiles "Inno Setup 6\ISCC.exe"
        $candidates += Join-Path $programFiles "Inno Setup 5\ISCC.exe"
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return (Resolve-Path $candidate).Path
        }
    }

    throw @"
Inno Setup Compiler (ISCC.exe) was not found.
Install Inno Setup 6 and run this script again:
  winget install --id JRSoftware.InnoSetup -e

Alternatively set INNO_SETUP_ISCC to the full path of ISCC.exe.
"@
}

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

if (-not (Test-Path $PackageJsonPath)) {
    throw "package.json not found at $PackageJsonPath"
}
if (-not (Test-Path $InstallerLogoPath)) {
    throw "Installer logo not found at $InstallerLogoPath"
}
if (-not (Test-Path $InnoScript)) {
    throw "Inno Setup script not found at $InnoScript"
}

$PackageJson = Get-Content -Raw $PackageJsonPath | ConvertFrom-Json
$Version = [string]$PackageJson.version
if ([string]::IsNullOrWhiteSpace($Version)) {
    throw "package.json does not contain a version."
}

Write-Step "Checking Inno Setup compiler"
$IsccPath = Get-IsccPath

Write-Step "Preparing build directories"
New-Item -ItemType Directory -Force -Path $BuildRoot, $ArtifactRoot, $PyInstallerDist, $PyInstallerWork, $InstallerOutput | Out-Null

if (-not (Test-Path $VenvPath)) {
    Write-Step "Creating build virtual environment"
    Invoke-Checked "python" @("-m", "venv", $VenvPath)
}

$VenvPython = Join-Path $VenvPath "Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    throw "Virtual environment Python not found at $VenvPython"
}

if (-not $SkipDependencyInstall) {
    Write-Step "Installing build and server dependencies"
    Invoke-Checked $VenvPython @("-m", "pip", "install", "--upgrade", "pip")
    Invoke-Checked $VenvPython @("-m", "pip", "install", "--upgrade", "pyinstaller", "pillow")
    Invoke-Checked $VenvPython @("-m", "pip", "install", "-r", $RequirementsPath)
}

Write-Step "Creating Windows icon from logo-installer.png"
$IconScriptPath = Join-Path $BuildRoot "create_icon.py"
$IconScript = @"
from pathlib import Path
from sys import argv
from PIL import Image

source = Path(argv[1])
target = Path(argv[2])
target.parent.mkdir(parents=True, exist_ok=True)

image = Image.open(source).convert("RGBA")
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
image.save(target, format="ICO", sizes=sizes)
"@
Set-Content -Path $IconScriptPath -Value $IconScript -Encoding UTF8
Invoke-Checked $VenvPython @($IconScriptPath, $InstallerLogoPath, $IconPath)

Write-Step "Building RotorServer.exe with PyInstaller"
$DocsAssetSource = Join-Path $RepoRoot "server\api\static\docs"
$DocsAssetArgument = "$DocsAssetSource;server/api/static/docs"
Invoke-Checked $VenvPython @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--console",
    "--name", "RotorServer",
    "--icon", $IconPath,
    "--paths", $RepoRoot,
    "--distpath", $PyInstallerDist,
    "--workpath", $PyInstallerWork,
    "--specpath", $BuildRoot,
    "--add-data", $DocsAssetArgument,
    "--hidden-import", "serial.tools.list_ports_common",
    "--hidden-import", "serial.tools.list_ports_windows",
    $EntryPoint
)

$ServerExe = Join-Path $PyInstallerDist "RotorServer\RotorServer.exe"
if (-not (Test-Path $ServerExe)) {
    throw "PyInstaller did not create $ServerExe"
}

Write-Step "Compiling installer with Inno Setup"
$OutputBaseName = "Rotor-Interface-GS232B"
Remove-Item -Path (Join-Path $InstallerOutput "*.exe") -Force -ErrorAction SilentlyContinue
Invoke-Checked $IsccPath @(
    "/Qp",
    "/DMyAppVersion=$Version",
    "/F$OutputBaseName",
    $InnoScript
)

$InstallerExe = Join-Path $InstallerOutput "$OutputBaseName.exe"
if (-not (Test-Path $InstallerExe)) {
    throw "Installer was not created at $InstallerExe"
}

Write-Host ""
Write-Host "Installer created:" -ForegroundColor Green
Write-Host "  $InstallerExe"
