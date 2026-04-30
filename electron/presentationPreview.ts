import { execFile } from 'child_process'
import type { Dirent } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type {
  PresentationInstallRenderToolsResult,
  PresentationPreviewSlide,
  PresentationRenderToolsStatus,
  PresentationRenderToolName,
} from './shared/presentation'

interface CommandResult {
  stdout: string
  stderr: string
}

const PREVIEW_TIMEOUT_MS = 90_000
const INSTALL_TIMEOUT_MS = 30 * 60_000
const TEMP_CLEANUP_RETRY_DELAYS_MS = [120, 300, 700, 1_200]

const WINDOWS_KNOWN_TOOL_PATHS: Record<PresentationRenderToolName, string[]> = {
  soffice: [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ],
  pdftoppm: [
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'pdftoppm.exe')
      : '',
  ].filter(Boolean),
}

function runCommand(command: string, args: string[], timeoutMs = PREVIEW_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: path.isAbsolute(command) ? path.dirname(command) : undefined,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    }, (error, stdout, stderr) => {
      if (error) {
        const details = [stderr?.toString().trim(), stdout?.toString().trim(), error.message]
          .filter(Boolean)
          .join('\n')
        reject(new Error(details || error.message))
        return
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function removePresentationTempDirectory(directoryPath: string) {
  for (let attempt = 0; attempt <= TEMP_CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await fs.rm(directoryPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 150,
      })
      return
    } catch {
      const retryDelay = TEMP_CLEANUP_RETRY_DELAYS_MS[attempt]
      if (retryDelay === undefined) return
      await wait(retryDelay)
    }
  }
}

async function resolveExecutablePath(executablePath: string) {
  if (process.platform !== 'win32') return executablePath
  try {
    return await fs.realpath(executablePath)
  } catch {
    return executablePath
  }
}

async function resolveCommand(command: PresentationRenderToolName) {
  const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const result = await runCommand(lookupCommand, [command], 10_000)
    const foundPath = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    if (foundPath) return resolveExecutablePath(foundPath)
  } catch {
    // Fall through to known install locations.
  }

  if (process.platform !== 'win32') return undefined

  for (const knownPath of WINDOWS_KNOWN_TOOL_PATHS[command]) {
    try {
      await fs.access(knownPath)
      return resolveExecutablePath(knownPath)
    } catch {
      // Continue checking other known paths.
    }
  }

  if (command === 'pdftoppm') {
    return findWindowsExecutableInKnownRoots('pdftoppm.exe')
  }

  return undefined
}

async function findWindowsExecutableInKnownRoots(fileName: string) {
  const roots = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages') : '',
    ...(await findLikelyPopplerRoots(process.env.PROGRAMFILES)),
    ...(await findLikelyPopplerRoots(process.env['PROGRAMFILES(X86)'])),
  ].filter(Boolean)

  for (const root of roots) {
    const result = await findExecutableUnder(root, fileName, 5)
    if (result) return result
  }

  return undefined
}

async function findLikelyPopplerRoots(root: string | undefined) {
  if (!root) return []
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().includes('poppler'))
      .map((entry) => path.join(root, entry.name))
  } catch {
    return []
  }
}

async function findExecutableUnder(root: string, fileName: string, maxDepth: number): Promise<string | undefined> {
  if (maxDepth < 0) return undefined
  let entries: Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return undefined
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return fullPath
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || entry.name.toLowerCase() === 'node_modules') continue
    const result = await findExecutableUnder(path.join(root, entry.name), fileName, maxDepth - 1)
    if (result) return result
  }

  return undefined
}

function quotePowerShellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function encodePowerShellCommand(command: string) {
  return Buffer.from(command, 'utf16le').toString('base64')
}

async function launchWingetInstallerWindow(tasks: Array<{ packageId: string; label: string }>) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'katopgpt-ppt-install-'))
  const logPath = path.join(tempDir, 'install.log')
  const installLines = tasks.flatMap((task) => {
    const executableCandidates = task.packageId === 'TheDocumentFoundation.LibreOffice'
      ? [
          'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
          'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
        ]
      : [
          process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'pdftoppm.exe')
            : '',
        ].filter(Boolean)

    return [
      `Invoke-WingetInstall -PackageId ${quotePowerShellString(task.packageId)} -Label ${quotePowerShellString(task.label)} -ExecutableCandidates @(${executableCandidates.map(quotePowerShellString).join(',')})`,
    ]
  })
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$exitCode = 0',
    '$script:Winget = $null',
    `$logPath = ${quotePowerShellString(logPath)}`,
    'function Write-Log {',
    '  param(',
    '    [AllowEmptyString()][string]$Message,',
    '    [ConsoleColor]$Color = [ConsoleColor]::Gray',
    '  )',
    '  Write-Host $Message -ForegroundColor $Color',
    '  try { Add-Content -Path $logPath -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message) -Encoding UTF8 } catch {}',
    '}',
    'try {',
    '  New-Item -ItemType File -Path $logPath -Force | Out-Null',
    '  Write-Log "KatopGPT PPT dependency installer" Green',
    '  Write-Log "Installing LibreOffice and/or Poppler. Allow UAC if prompted." Yellow',
    '  $wingetCandidates = @(',
    '    (Join-Path $env:LOCALAPPDATA "Microsoft\\WindowsApps\\winget.exe"),',
    '    "winget.exe"',
    '  )',
    '  foreach ($candidate in $wingetCandidates) {',
    '    try {',
    '      $resolved = Get-Command $candidate -ErrorAction Stop',
    '      if ($resolved.Source) { $script:Winget = $resolved.Source; break }',
    '    } catch {}',
    '  }',
    '  if (-not $script:Winget) {',
    '    throw "winget was not found. Install Windows App Installer first, or install LibreOffice and Poppler manually."',
    '  }',
    '  Write-Log "Using winget: $script:Winget" DarkGray',
    '  function Invoke-WingetInstall {',
    '    param(',
    '      [Parameter(Mandatory=$true)][string]$PackageId,',
    '      [Parameter(Mandatory=$true)][string]$Label,',
    '      [Parameter(Mandatory=$true)][string[]]$ExecutableCandidates',
    '    )',
    '    function Test-DependencyInstalled {',
    '      foreach ($candidate in $ExecutableCandidates) {',
    '        if ($candidate -and (Test-Path $candidate)) { return $true }',
    '      }',
    '      return $false',
    '    }',
    '    if (Test-DependencyInstalled) {',
    '      Write-Log "$Label already has a detectable executable." Green',
    '      return $true',
    '    }',
    '    $wingetTemp = Join-Path $env:TEMP "WinGet"',
    '    for ($attempt = 1; $attempt -le 3; $attempt += 1) {',
    '      Write-Log ""',
    '      Write-Log "Installing $Label (attempt $attempt/3)..." Cyan',
    '      if (Test-Path $wingetTemp) {',
    '        Get-ChildItem -Path $wingetTemp -Directory -Filter "$PackageId*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue',
    '      }',
    '      & $script:Winget install --id $PackageId --exact --source winget --accept-package-agreements --accept-source-agreements --force 2>&1 | ForEach-Object { Write-Log ($_ | Out-String).TrimEnd() Gray }',
    '      if ($LASTEXITCODE -eq 0 -or (Test-DependencyInstalled)) {',
    '        Write-Log "$Label install command finished or executable was detected." Green',
    '        return $true',
    '      }',
    '      Write-Log "$Label install failed. winget exit code: $LASTEXITCODE" Yellow',
    '      if ($attempt -lt 3) {',
    '        Write-Log "Retrying after a short delay..." Yellow',
    '        Start-Sleep -Seconds 5',
    '      }',
    '    }',
    '    return $false',
    '  }',
    '  $failed = @()',
    ...installLines.map((line) => `  if (-not (${line})) { $failed += ${line.match(/-Label '([^']+)'/)?.[1] ? quotePowerShellString(line.match(/-Label '([^']+)'/)?.[1] ?? '') : "'dependency'"} }`),
    '  Write-Log ""',
    '  if ($failed.Count -gt 0) {',
    '    $exitCode = 1',
    '    Write-Log ("Some installs failed: " + ($failed -join ", ")) Red',
    '  } else {',
    '    Write-Log "Install commands finished. Return to KatopGPT and click Recheck. Restart the app if needed." Green',
    '  }',
    '} catch {',
    '  $exitCode = 1',
    '  Write-Log ""',
    '  Write-Log "Install failed:" Red',
    '  Write-Log $_.Exception.Message Red',
    '  Write-Log ""',
    '  Write-Log "You can run these commands manually:" Yellow',
    '  Write-Log "winget install --id TheDocumentFoundation.LibreOffice --exact --source winget --accept-package-agreements --accept-source-agreements"',
    '  Write-Log "winget install --id oschwartz10612.Poppler --exact --source winget --accept-package-agreements --accept-source-agreements"',
    '} finally {',
    '  Write-Log ""',
    '  Write-Log "Install log: $logPath" DarkGray',
    '  Read-Host "Press Enter to close this window"',
    '  exit $exitCode',
    '}',
  ].join('\r\n')
  const encodedInstallerCommand = encodePowerShellCommand(script)
  const command = [
    'Start-Process',
    '-FilePath powershell.exe',
    '-WindowStyle Normal',
    '-ArgumentList',
    `@('-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',${quotePowerShellString(encodedInstallerCommand)})`,
  ].join(' ')
  await runCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], INSTALL_TIMEOUT_MS)
  return { logPath }
}

export async function checkPresentationRenderTools(): Promise<PresentationRenderToolsStatus> {
  const [sofficePath, pdftoppmPath] = await Promise.all([
    resolveCommand('soffice'),
    resolveCommand('pdftoppm'),
  ])
  const missing: PresentationRenderToolName[] = []
  if (!sofficePath) missing.push('soffice')
  if (!pdftoppmPath) missing.push('pdftoppm')

  if (missing.length > 0) {
    const missingLabels = missing.map((item) => item === 'soffice' ? 'LibreOffice soffice' : 'Poppler pdftoppm').join('、')
    const detectedLabels = [
      sofficePath ? `soffice：${sofficePath}` : '',
      pdftoppmPath ? `pdftoppm：${pdftoppmPath}` : '',
    ].filter(Boolean)
    return {
      ok: false,
      missing,
      sofficePath,
      pdftoppmPath,
      message: `PPT 助手还缺少 ${missingLabels}，才能生成真实预览和高质量导出。${detectedLabels.length > 0 ? `已检测到：${detectedLabels.join('；')}。` : ''}`,
    }
  }

  return {
    ok: true,
    missing,
    sofficePath,
    pdftoppmPath,
    message: '已检测到 LibreOffice 和 Poppler，可生成真实预览。',
  }
}

export async function installPresentationRenderTools(): Promise<PresentationInstallRenderToolsResult> {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      message: '当前一键安装仅支持 Windows。请手动安装 LibreOffice 和 Poppler，并确保 soffice、pdftoppm 可执行。',
      status: await checkPresentationRenderTools(),
    }
  }

  try {
    await runCommand('winget', ['--version'], 15_000)
  } catch {
    return {
      ok: false,
      message: '未检测到 winget，无法自动安装。请先安装 Windows App Installer，或手动安装 LibreOffice 和 Poppler。',
      status: await checkPresentationRenderTools(),
    }
  }

  const beforeStatus = await checkPresentationRenderTools()
  const installTasks: Array<{ tool: PresentationRenderToolName; packageId: string; label: string }> = []
  if (beforeStatus.missing.includes('soffice')) {
    installTasks.push({
      tool: 'soffice',
      packageId: 'TheDocumentFoundation.LibreOffice',
      label: 'LibreOffice',
    })
  }
  if (beforeStatus.missing.includes('pdftoppm')) {
    installTasks.push({
      tool: 'pdftoppm',
      packageId: 'oschwartz10612.Poppler',
      label: 'Poppler',
    })
  }

  if (installTasks.length === 0) {
    return {
      ok: true,
      message: 'PPT 渲染依赖已安装，无需重复安装。',
      status: beforeStatus,
    }
  }

  let installResult: Awaited<ReturnType<typeof launchWingetInstallerWindow>> | null = null
  try {
    installResult = await launchWingetInstallerWindow(installTasks)
  } catch (error) {
    return {
      ok: false,
      message: `未能打开安装窗口：${error instanceof Error ? error.message : '未知错误'}。请手动安装 LibreOffice 和 Poppler。`,
      status: await checkPresentationRenderTools(),
    }
  }

  return {
    ok: false,
    started: true,
    logPath: installResult.logPath,
    message: `已打开 PPT 依赖安装窗口。请等待窗口内安装完成后，回到 KatopGPT 点击“重新检测”。安装日志：${installResult.logPath}`,
    status: beforeStatus,
  }
}

async function findGeneratedPdf(workDir: string, pptxPath: string) {
  const expectedPath = path.join(workDir, `${path.basename(pptxPath, path.extname(pptxPath))}.pdf`)
  try {
    await fs.access(expectedPath)
    return expectedPath
  } catch {
    const entries = await fs.readdir(workDir)
    const firstPdf = entries.find((entry) => entry.toLowerCase().endsWith('.pdf'))
    return firstPdf ? path.join(workDir, firstPdf) : undefined
  }
}

async function convertPptxToPdf(pptxPath: string, workDir: string, tools: PresentationRenderToolsStatus) {
  const soffice = tools.sofficePath ?? 'soffice'
  await runCommand(soffice, [
    '--headless',
    '--norestore',
    '--nolockcheck',
    '--convert-to',
    'pdf',
    '--outdir',
    workDir,
    pptxPath,
  ])

  const pdfPath = await findGeneratedPdf(workDir, pptxPath)
  if (!pdfPath) {
    throw new Error('LibreOffice 未生成 PDF，无法继续生成真实预览。')
  }
  return pdfPath
}

async function renderPdfToPng(pdfPath: string, workDir: string, tools: PresentationRenderToolsStatus) {
  const pdftoppm = tools.pdftoppmPath ?? 'pdftoppm'
  const outputPrefix = path.join(workDir, 'slide')
  await runCommand(pdftoppm, [
    '-png',
    '-r',
    '130',
    pdfPath,
    outputPrefix,
  ])

  const entries = await fs.readdir(workDir)
  return entries
    .filter((entry) => /^slide-\d+\.png$/i.test(entry))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((entry) => path.join(workDir, entry))
}

export async function renderPresentationPreviewImages(pptxPath: string): Promise<PresentationPreviewSlide[]> {
  const tools = await checkPresentationRenderTools()
  if (!tools.ok) {
    throw new Error(tools.message)
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'katopgpt-ppt-preview-'))
  try {
    const pdfPath = await convertPptxToPdf(pptxPath, workDir, tools)
    const pngPaths = await renderPdfToPng(pdfPath, workDir, tools)
    if (pngPaths.length === 0) {
      throw new Error('Poppler 未生成预览图，无法检查真实页面效果。')
    }

    return Promise.all(pngPaths.map(async (pngPath, index) => {
      const buffer = await fs.readFile(pngPath)
      return {
        index,
        dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
      }
    }))
  } finally {
    await removePresentationTempDirectory(workDir)
  }
}
