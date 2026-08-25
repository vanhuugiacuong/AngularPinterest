[CmdletBinding()]
param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$backendDir = Join-Path $projectRoot 'backend'
$frontendDir = Join-Path $projectRoot 'frontend'
$clipDir = Join-Path $backendDir 'services\clip-service'
$venvDir = Join-Path $clipDir '.venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'
$requirements = Join-Path $clipDir 'requirements.txt'
$logDir = Join-Path $projectRoot 'logs'

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Test-ListeningPort {
  param([int]$Port)
  return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Wait-HttpReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      # Service is still starting.
    }
    Start-Sleep -Milliseconds 750
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Start-LoggedProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [string]$LogName
  )

  $stdout = Join-Path $logDir "$LogName.stdout.log"
  $stderr = Join-Path $logDir "$LogName.stderr.log"
  return Start-Process `
    -FilePath $FilePath `
    -ArgumentList $ArgumentList `
    -WorkingDirectory $WorkingDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru
}

Write-Host '[1/5] Checking Python environment...' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $venvPython)) {
  $systemPython = Get-Command python -ErrorAction SilentlyContinue
  if (-not $systemPython) {
    throw 'Python was not found in PATH. Install Python 3.11+ and run this launcher again.'
  }
  & $systemPython.Source -m venv $venvDir
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not create the Python .venv.'
  }
}

& $venvPython -c 'import fastapi, uvicorn, torch, transformers, PIL, numpy' 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Installing CLIP dependencies for the first run. This may take a few minutes...' -ForegroundColor Yellow
  & $venvPython -m pip install --upgrade pip
  if ($LASTEXITCODE -ne 0) { throw 'Could not upgrade pip in the .venv.' }
  & $venvPython -m pip install -r $requirements
  if ($LASTEXITCODE -ne 0) { throw 'Could not install CLIP service dependencies.' }
}

Write-Host '[2/5] Starting 18+ image moderation service...' -ForegroundColor Cyan
if (-not (Test-ListeningPort -Port 8001)) {
  $clipProcess = Start-LoggedProcess `
    -FilePath $venvPython `
    -ArgumentList @('-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8001') `
    -WorkingDirectory $clipDir `
    -LogName 'clip'
  Write-Host "CLIP is starting (PID $($clipProcess.Id))."
}

if (-not (Wait-HttpReady -Url 'http://127.0.0.1:8001/health' -TimeoutSeconds 120)) {
  throw "CLIP did not become ready. See: $logDir\clip.stderr.log"
}

Write-Host '[3/5] Starting backend...' -ForegroundColor Cyan
if (-not (Test-ListeningPort -Port 3000)) {
  if (-not (Test-Path -LiteralPath (Join-Path $backendDir 'node_modules'))) {
    & npm.cmd install --prefix $backendDir
    if ($LASTEXITCODE -ne 0) { throw 'Could not install backend dependencies.' }
  }
  Push-Location $backendDir
  try {
    & npx.cmd prisma generate
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate Prisma Client.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
  } finally {
    Pop-Location
  }
  $backendProcess = Start-LoggedProcess `
    -FilePath (Get-Command node).Source `
    -ArgumentList @('--enable-source-maps', 'dist/src/main') `
    -WorkingDirectory $backendDir `
    -LogName 'backend'
  Write-Host "Backend is starting (PID $($backendProcess.Id))."
}

if (-not (Wait-HttpReady -Url 'http://127.0.0.1:3000/api/pins?page=1&limit=1' -TimeoutSeconds 45)) {
  throw "Backend did not become ready. See: $logDir\backend.stderr.log"
}

Write-Host '[4/5] Starting frontend...' -ForegroundColor Cyan
if (-not (Test-ListeningPort -Port 4200)) {
  if (-not (Test-Path -LiteralPath (Join-Path $frontendDir 'node_modules'))) {
    & npm.cmd install --prefix $frontendDir
    if ($LASTEXITCODE -ne 0) { throw 'Could not install frontend dependencies.' }
  }
  $frontendProcess = Start-LoggedProcess `
    -FilePath (Get-Command npm.cmd).Source `
    -ArgumentList @('start') `
    -WorkingDirectory $frontendDir `
    -LogName 'frontend'
  Write-Host "Frontend is starting (PID $($frontendProcess.Id))."
}

if (-not (Wait-HttpReady -Url 'http://localhost:4200' -TimeoutSeconds 60)) {
  throw "Frontend did not become ready. See: $logDir\frontend.stderr.log"
}

Write-Host '[5/5] Starting SePay webhook tunnel...' -ForegroundColor Cyan
$ngrokCommand = Get-Command ngrok.exe -ErrorAction SilentlyContinue
if (-not $ngrokCommand) {
  Write-Host 'ngrok was not found; payment verification will use SePay API polling.' -ForegroundColor Yellow
} elseif (-not (Test-ListeningPort -Port 4040)) {
  $ngrokProcess = Start-LoggedProcess `
    -FilePath $ngrokCommand.Source `
    -ArgumentList @('http', '--url=nickname-absence-jaunt.ngrok-free.dev', '3000') `
    -WorkingDirectory $projectRoot `
    -LogName 'ngrok'
  Write-Host "SePay webhook tunnel is starting (PID $($ngrokProcess.Id))."
  if (-not (Wait-HttpReady -Url 'http://127.0.0.1:4040/api/tunnels' -TimeoutSeconds 20)) {
    Write-Host "ngrok did not become ready. See: $logDir\ngrok.stderr.log" -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'NovaFrame is ready:' -ForegroundColor Green
Write-Host '  Frontend : http://localhost:4200'
Write-Host '  Backend  : http://localhost:3000'
Write-Host '  CLIP 18+ : http://localhost:8001/health'
Write-Host '  Webhook  : https://nickname-absence-jaunt.ngrok-free.dev/api/memberships/payments/webhook/sepay'

if (-not $NoBrowser) {
  Start-Process 'http://localhost:4200'
}
