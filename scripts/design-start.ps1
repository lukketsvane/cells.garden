param(
    [switch]$InstallStartup,
    [switch]$RemoveStartup,
    [string]$PlaywrightBrowsersPath
)

$ErrorActionPreference = 'Stop'
if ($InstallStartup -and $RemoveStartup) { throw 'Choose either -InstallStartup or -RemoveStartup.' }

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$publisherScript = Join-Path $PSScriptRoot 'design-dev.mjs'
$launcherScript = Join-Path $PSScriptRoot 'design-start.ps1'
$stateDirectory = Join-Path $projectRoot '.design-staging\figma-live'
$configPath = Join-Path $stateDirectory 'startup.json'
$pidPath = Join-Path $stateDirectory 'publisher.pid'
$stdoutPath = Join-Path $stateDirectory 'stdout.log'
$stderrPath = Join-Path $stateDirectory 'stderr.log'
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'cells.garden-figma-live.vbs'
$powershellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$startupCommand = '"' + $powershellPath + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcherScript + '"'
$startupContent = 'Set shell = CreateObject("WScript.Shell")' + "`r`n" + 'shell.Run "' + $startupCommand.Replace('"', '""') + '", 0, False' + "`r`n"

if ($RemoveStartup) {
    if (Test-Path -LiteralPath $startupPath) {
        if ([IO.File]::ReadAllText($startupPath) -ne $startupContent) { throw "Startup file belongs to another launcher: $startupPath" }
        Remove-Item -LiteralPath $startupPath
    }
    Write-Output "Login startup removed: $startupPath"
    exit 0
}

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$existingPublisher = $null
if ($listeners.Count) {
    if ($listeners.Count -eq 1) {
        $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $($listeners[0])"
        $scriptPattern = '(?i)(?:^|\s)"?' + [regex]::Escape($publisherScript) + '"?(?=\s|$)'
        if ($candidate.Name -eq 'node.exe' -and $candidate.CommandLine -match $scriptPattern -and $candidate.CommandLine -match '(?:^|\s)"?--publish"?(?=\s|$)') {
            $existingPublisher = $candidate
        }
    }
    if (-not $existingPublisher) { throw "Port 5173 is already in use by process $($listeners -join ', '). Stop that server before starting the Figma publisher; no process was stopped." }
}

New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$startupConfig = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } else { $null }
$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$nodePath = if ($nodeCommand) { $nodeCommand.Source } elseif ($startupConfig.nodePath -and (Test-Path -LiteralPath $startupConfig.nodePath -PathType Leaf)) { $startupConfig.nodePath } else { throw 'Install Node.js before starting the Figma publisher.' }
$providedBrowsersPath = if ($PSBoundParameters.ContainsKey('PlaywrightBrowsersPath')) { $PlaywrightBrowsersPath } else { $env:PLAYWRIGHT_BROWSERS_PATH }
if ($providedBrowsersPath) {
    if (-not (Test-Path -LiteralPath $providedBrowsersPath -PathType Container)) { throw "Playwright browser directory does not exist: $providedBrowsersPath" }
    $resolvedBrowsersPath = (Resolve-Path -LiteralPath $providedBrowsersPath).Path
    $env:PLAYWRIGHT_BROWSERS_PATH = $resolvedBrowsersPath
} elseif ($startupConfig) {
    if ($startupConfig.playwrightBrowsersPath) { $env:PLAYWRIGHT_BROWSERS_PATH = $startupConfig.playwrightBrowsersPath }
}
@{ nodePath = $nodePath; playwrightBrowsersPath = $env:PLAYWRIGHT_BROWSERS_PATH } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

if ($InstallStartup) {
    if ((Test-Path -LiteralPath $startupPath) -and [IO.File]::ReadAllText($startupPath) -ne $startupContent) { throw "Startup file belongs to another launcher: $startupPath" }
    [IO.File]::WriteAllText($startupPath, $startupContent, [Text.Encoding]::Unicode)
    Write-Output "Login startup installed: $startupPath"
}

if ($existingPublisher) {
    Set-Content -LiteralPath $pidPath -Value $existingPublisher.ProcessId -Encoding ASCII
    Write-Output "Figma publisher already running for this checkout (PID $($existingPublisher.ProcessId))."
    exit 0
}

$publisher = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $publisherScript + '"'), '--publish') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Set-Content -LiteralPath $pidPath -Value $publisher.Id -Encoding ASCII
for ($attempt = 0; $attempt -lt 50; $attempt++) {
    $publisher.Refresh()
    if ($publisher.HasExited) { throw "Figma publisher exited with code $($publisher.ExitCode). Read $stderrPath and $stdoutPath." }
    $publisherListening = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $publisher.Id
    if ($publisherListening) {
        Write-Output "Figma publisher running in the background (PID $($publisher.Id)). Logs: $stateDirectory"
        exit 0
    }
    Start-Sleep -Milliseconds 200
}
throw "Figma publisher has not opened port 5173 yet (PID $($publisher.Id)). Read $stderrPath and $stdoutPath."
