# Updates a self-built Orca on Windows: the latest Orca code with your branch's commits on top,
# rebuilt and reinstalled. Run once with -Install from the repo; Orca's Help menu runs it after that.
param([switch]$Install)

# Programs are judged by exit code: Windows PowerShell treats their progress text on stderr as errors.
$ErrorActionPreference = 'Continue'
$state = Join-Path $env:LOCALAPPDATA 'orca-custom-build'
New-Item -ItemType Directory -Force $state -ErrorAction Stop | Out-Null

function Copy-Updater([string]$repo) {
  $source = Join-Path $repo 'scripts\custom-build'
  Copy-Item (Join-Path $source 'update-my-orca.ps1') $state -Force -ErrorAction Stop
  Copy-Item (Join-Path $source 'cl-shim.c') $state -Force -ErrorAction Stop
  Set-Content (Join-Path $state 'repo.txt') $repo -ErrorAction Stop
}

if ($Install) {
  $repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  Copy-Updater $repo
  $baseFile = Join-Path $repo '.git\orca-custom-base'
  if (-not (Test-Path $baseFile)) {
    # The upstream commit your branch started from (a shallow clone's root); updates move it forward.
    $base = & git -C $repo merge-base HEAD upstream/main
    if (-not $base) { $base = (& git -C $repo rev-list --max-parents=0 HEAD | Select-Object -First 1) }
    Set-Content $baseFile $base
  }
  Write-Host "Installed. Orca's Help menu now has 'Update Your Build'."
  return
}

function Step([string]$message) { Write-Host "`n== $message" -ForegroundColor Cyan }
function Check([string]$what) { if ($LASTEXITCODE) { throw "$what failed (exit $LASTEXITCODE)." } }

Start-Transcript -Path (Join-Path $state 'update.log') -Force | Out-Null
try {
  $repo = (Get-Content (Join-Path $state 'repo.txt') -Raw -ErrorAction Stop).Trim()
  Set-Location $repo -ErrorAction Stop
  $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
  $baseFile = Join-Path $repo '.git\orca-custom-base'
  $base = (Get-Content $baseFile -Raw -ErrorAction Stop).Trim()

  Step 'Checking the Orca folder'
  if (& git status --porcelain) { throw 'The Orca folder has unsaved changes. Commit or stash them, then update again.' }

  Step 'Downloading the latest Orca code'
  & git fetch --depth=300 upstream main; Check 'Downloading'
  $upstream = (& git rev-parse upstream/main).Trim()
  if ($upstream -eq $base) {
    Write-Host 'Already on the latest Orca code; rebuilding your build anyway.'
  } else {
    Step 'Putting your changes on top of it'
    & git checkout -B orca-update-candidate $upstream; Check 'Preparing'
    & git cherry-pick "$base..$branch"
    if ($LASTEXITCODE) {
      & git cherry-pick --abort
      & git checkout $branch
      & git branch -D orca-update-candidate
      throw 'Your changes conflict with the latest Orca code, so nothing changed. Ask Claude to resolve the conflict.'
    }
    & git branch -f $branch HEAD; Check 'Saving'
    & git checkout $branch; Check 'Saving'
    & git branch -D orca-update-candidate | Out-Null
    Set-Content $baseFile $upstream -ErrorAction Stop
    # Back up to your fork; a failure here does not stop the update.
    & git push --force-with-lease origin $branch
  }
  Copy-Updater $repo

  $pnpmVersion = ((Get-Content package.json -Raw | ConvertFrom-Json).packageManager -split '[@+]')[1]
  $pnpm = "pnpm@$pnpmVersion"
  Step 'Installing dependencies'
  & npx --yes $pnpm install --frozen-lockfile; Check 'Installing dependencies'
  & npx --yes $pnpm -C mobile install --frozen-lockfile; Check 'Installing mobile dependencies'

  Step 'Building Orca (10-15 minutes)'
  & npx --yes $pnpm run build:desktop; Check 'Building'
  & npx --yes $pnpm run ensure:electron-runtime; Check 'Preparing Electron'
  if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    # Packaging compiles one small helper with cl.exe; LLVM's clang-cl stands in when MSVC is absent.
    $shim = Join-Path $state 'clshim'
    if (-not (Test-Path (Join-Path $shim 'cl.exe'))) {
      New-Item -ItemType Directory -Force $shim | Out-Null
      & 'C:\Program Files\LLVM\bin\clang-cl.exe' /nologo /O2 (Join-Path $state 'cl-shim.c') "/Fe:$shim\cl.exe" "/Fo:$shim\cl-shim.obj"
      Check 'Preparing the compiler'
    }
    $env:PATH = "$shim;$env:PATH"
  }
  Remove-Item dist -Recurse -Force -ErrorAction SilentlyContinue
  & npx --yes $pnpm exec electron-builder --config config/electron-builder.config.cjs --win '-c.extraMetadata.version=1.4.999'
  Check 'Packaging'

  Step 'Ready to install'
  Read-Host 'The new build is ready. Press Enter to close Orca and install it'
  Get-Process Orca -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 3
  Start-Process (Join-Path $repo 'dist\orca-windows-setup.exe') -ArgumentList '/S' -Wait
  Start-Process (Join-Path $env:LOCALAPPDATA 'Programs\orca\Orca.exe')
  Write-Host "`nUpdated. Orca is reopening." -ForegroundColor Green
} catch {
  Write-Host "`n$_" -ForegroundColor Red
  Write-Host "Your installed Orca was not changed. The log is $(Join-Path $state 'update.log')."
} finally {
  Stop-Transcript | Out-Null
  Read-Host 'Press Enter to close this window'
}
