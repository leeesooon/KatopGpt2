import type { BrowserWindow } from 'electron'
import { app, dialog } from 'electron'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import Module from 'module'
import os from 'os'
import path from 'path'
import { Script } from 'vm'
import { auditPresentationCodePptx } from './presentationCodeAudit'
import {
  checkPresentationRenderTools,
  removePresentationTempDirectory,
  renderPresentationPreviewImages,
} from './presentationPreview'
import type {
  PresentationCodeDiagnostic,
  PresentationCodeExportRequest,
  PresentationCodeExportResult,
  PresentationCodeRunRequest,
  PresentationCodeRunResult,
} from './shared/presentation'

interface CommandResult {
  stdout: string
  stderr: string
}

interface PresentationCodeSession {
  id: string
  title: string
  tempDir: string
  pptxPath: string
  createdAt: number
  diagnostics: PresentationCodeDiagnostic[]
}

interface NormalizedRunError {
  message: string
  stdout: string
  stderr: string
  diagnostics: PresentationCodeDiagnostic[]
}

const PRESENTATION_CODE_TIMEOUT_MS = 60_000
const MAX_OUTPUT_CHARS = 20_000
const SESSION_MAX_AGE_MS = 2 * 60 * 60_000
const MAX_SESSIONS = 8
const SYNTAX_CONTEXT_RADIUS = 8
const codePresentationSessions = new Map<string, PresentationCodeSession>()

function safeFileName(value: string) {
  const sanitized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
  return sanitized || `KatopGPT-PPT-${Date.now()}`
}

function withPptxExtension(filePath: string) {
  return filePath.toLowerCase().endsWith('.pptx') ? filePath : `${filePath}.pptx`
}

function trimCommandOutput(value: string) {
  if (value.length <= MAX_OUTPUT_CHARS) return value
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n...输出过长，已截断。`
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function truncateCodeLine(value: string) {
  if (value.length <= 220) return value
  return `${value.slice(0, 217)}...`
}

function parseSyntaxLocation(error: Error, codePath: string) {
  const stack = error.stack ?? ''
  const fileName = escapeRegExp(path.basename(codePath))
  const locationMatch = stack.match(new RegExp(`${fileName}:(\\d+)(?::(\\d+))?`))
  const rawLineNumber = locationMatch ? Number(locationMatch[1]) : Number.NaN
  const rawColumnNumber = locationMatch?.[2] ? Number(locationMatch[2]) : Number.NaN
  const stackLines = stack.split(/\r?\n/)
  const pointerLine = stackLines.find((line) => /^\s*\^+\s*$/.test(line))
  const pointerColumn = pointerLine ? pointerLine.indexOf('^') + 1 : Number.NaN
  const lineNumber = Number.isFinite(rawLineNumber) && rawLineNumber > 0 ? rawLineNumber : undefined
  let columnNumber = Number.isFinite(rawColumnNumber) && rawColumnNumber > 0
    ? rawColumnNumber
    : Number.isFinite(pointerColumn) && pointerColumn > 0
      ? pointerColumn
      : undefined

  if (lineNumber === 1 && columnNumber) {
    const moduleWithWrapper = Module as typeof Module & { wrapper?: string[] }
    const wrapperPrefixLength = moduleWithWrapper.wrapper?.[0]?.length ?? 0
    columnNumber = Math.max(1, columnNumber - wrapperPrefixLength)
  }

  return { lineNumber, columnNumber }
}

function formatSyntaxCodeFrame(code: string, lineNumber?: number, columnNumber?: number) {
  const lines = code.split(/\r?\n/)
  const targetLine = lineNumber && lineNumber >= 1 && lineNumber <= lines.length ? lineNumber : 1
  const start = Math.max(1, targetLine - SYNTAX_CONTEXT_RADIUS)
  const end = Math.min(lines.length, targetLine + SYNTAX_CONTEXT_RADIUS)
  const width = String(end).length
  const frameLines: string[] = []

  for (let line = start; line <= end; line += 1) {
    const marker = line === targetLine ? '>' : ' '
    const lineNumberText = String(line).padStart(width, ' ')
    frameLines.push(`${marker} ${lineNumberText} | ${truncateCodeLine(lines[line - 1] ?? '')}`)
    if (line === targetLine && columnNumber) {
      frameLines.push(`  ${' '.repeat(width)} | ${' '.repeat(Math.max(0, columnNumber - 1))}^`)
    }
  }

  return frameLines.join('\n')
}

function buildSyntaxDiagnostics(error: Error, code: string, codePath: string): PresentationCodeDiagnostic[] {
  const { lineNumber, columnNumber } = parseSyntaxLocation(error, codePath)
  const locationText = lineNumber
    ? `第 ${lineNumber} 行${columnNumber ? `第 ${columnNumber} 列` : ''}`
    : '未知行号'
  const codeFrame = formatSyntaxCodeFrame(code, lineNumber, columnNumber)

  return [{
    level: 'error',
    message: [
      `模型生成的 JS 代码语法预检失败：${locationText} 存在非法语法（SyntaxError: ${error.message}）。`,
      '常见原因是函数调用里写了 y: 3.84、w: 2.78 这类裸命名参数；请改成普通位置参数，或把坐标整体作为 { x, y, w, h } 对象传入。',
      '源码片段：',
      codeFrame,
    ].join('\n'),
  }]
}

function assertGeneratedCodeSyntax(code: string, codePath: string) {
  try {
    new Script(Module.wrap(code), {
      filename: codePath,
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      const diagnostics = buildSyntaxDiagnostics(error, code, codePath)
      throw Object.assign(new Error('PPT Agent 生成的 JavaScript 存在语法错误，已在执行前拦截。'), {
        stdout: '',
        stderr: '',
        diagnostics,
      })
    }
    throw error
  }
}

function runNodeScript(scriptPath: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [scriptPath, ...args], {
      cwd,
      timeout: PRESENTATION_CODE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
    }, (error, stdout, stderr) => {
      const commandOutput = {
        stdout: trimCommandOutput(stdout.toString()),
        stderr: trimCommandOutput(stderr.toString()),
      }
      if (error) {
        reject(Object.assign(new Error(error.message), commandOutput))
        return
      }
      resolve(commandOutput)
    })
  })
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

function getBundledChildRunnerPath() {
  return path.join(__dirname, 'presentationCodeChild.js')
}

async function writeRunFiles(request: PresentationCodeRunRequest, tempDir: string, outputPath: string) {
  const inputPath = path.join(tempDir, 'input.json')
  const codePath = path.join(tempDir, 'generated-presentation.cjs')
  const runnerPath = getBundledChildRunnerPath()

  await fs.writeFile(inputPath, JSON.stringify(request.input, null, 2), 'utf8')
  await fs.writeFile(codePath, request.artifact.code, 'utf8')

  return {
    inputPath,
    codePath,
    runnerPath,
    outputPath,
  }
}

function normalizeCommandError(error: unknown) {
  if (error instanceof Error) {
    const withOutput = error as Error & {
      stdout?: string
      stderr?: string
      diagnostics?: PresentationCodeDiagnostic[]
    }
    return {
      message: error.message,
      stdout: withOutput.stdout ?? '',
      stderr: withOutput.stderr ?? '',
      diagnostics: withOutput.diagnostics ?? [],
    }
  }

  return {
    message: String(error),
    stdout: '',
    stderr: '',
    diagnostics: [],
  }
}

async function cleanupExpiredSessions() {
  const now = Date.now()
  const sessions = [...codePresentationSessions.values()]
    .sort((a, b) => a.createdAt - b.createdAt)

  const expired = sessions.filter((session, index) =>
    now - session.createdAt > SESSION_MAX_AGE_MS || index < Math.max(0, sessions.length - MAX_SESSIONS)
  )

  for (const session of expired) {
    codePresentationSessions.delete(session.id)
    await removePresentationTempDirectory(session.tempDir)
  }
}

export async function runPresentationCodeDeck(request: PresentationCodeRunRequest): Promise<PresentationCodeRunResult> {
  await cleanupExpiredSessions()

  if (!request.artifact.trustedNodeExecution) {
    return {
      ok: false,
      message: '需要先确认本地 Node 信任模式，才能运行模型生成的 PPT 代码。',
      errorMessage: '未确认信任模式',
      diagnostics: [{
        level: 'error',
        message: '本地代码执行已被拦截：用户尚未确认信任模式。',
      }],
    }
  }

  const tools = await checkPresentationRenderTools()
  if (!tools.ok) {
    return {
      ok: false,
      message: tools.message,
      errorMessage: tools.message,
      diagnostics: [{
        level: 'error',
        message: tools.message,
      }],
    }
  }

  const title = request.artifact.title || request.input.topic || 'KatopGPT PPT'
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'katopgpt-ppt-code-'))
  const outputPath = path.join(tempDir, `${safeFileName(title)}.pptx`)
  const diagnostics: PresentationCodeDiagnostic[] = [{
    level: 'info',
    message: '已创建临时运行目录，准备执行模型生成的本地 Node.js 代码。',
  }]

  try {
    const runFiles = await writeRunFiles(request, tempDir, outputPath)
    assertGeneratedCodeSyntax(request.artifact.code, runFiles.codePath)
    const commandResult = await runNodeScript(
      runFiles.runnerPath,
      [runFiles.inputPath, runFiles.outputPath, runFiles.codePath],
      tempDir
    )

    if (!(await fileExists(outputPath))) {
      throw Object.assign(new Error('代码执行完成，但没有生成有效的 PPTX 文件。'), commandResult)
    }

    const auditResult = await auditPresentationCodePptx(outputPath)
    if (!auditResult.ok) {
      throw Object.assign(new Error('PPTX 越界审计未通过，请根据 diagnostics 收紧画布坐标和文本框尺寸。'), {
        ...commandResult,
        diagnostics: auditResult.diagnostics,
      })
    }
    diagnostics.push(...auditResult.diagnostics)

    const slides = await renderPresentationPreviewImages(outputPath)
    if (slides.length === 0) {
      throw Object.assign(new Error('PPTX 已生成，但真实预览没有产出页面。'), commandResult)
    }

    if (slides.length !== request.input.slideCount) {
      diagnostics.push({
        level: 'warning',
        message: `预期生成 ${request.input.slideCount} 页，实际预览到 ${slides.length} 页。`,
      })
    }

    const sessionId = randomUUID()
    codePresentationSessions.set(sessionId, {
      id: sessionId,
      title,
      tempDir,
      pptxPath: outputPath,
      createdAt: Date.now(),
      diagnostics,
    })

    return {
      ok: true,
      message: `已生成 ${slides.length} 页真实预览。`,
      sessionId,
      slides,
      diagnostics,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
    }
  } catch (error) {
    const normalized: NormalizedRunError = normalizeCommandError(error)
    await removePresentationTempDirectory(tempDir)
    const errorDiagnostics = normalized.diagnostics.length > 0
      ? normalized.diagnostics
      : [{
          level: 'error' as const,
          message: normalized.message,
        }]
    return {
      ok: false,
      message: 'PPT Agent 代码执行或真实预览失败。',
      diagnostics: [
        ...diagnostics,
        ...errorDiagnostics,
      ],
      errorMessage: normalized.message,
      stdout: normalized.stdout,
      stderr: normalized.stderr,
    }
  }
}

export async function exportPresentationCodeSessionToFile(
  request: PresentationCodeExportRequest,
  ownerWindow?: BrowserWindow | null
): Promise<PresentationCodeExportResult> {
  await cleanupExpiredSessions()

  const session = codePresentationSessions.get(request.sessionId)
  if (!session) {
    return {
      ok: false,
      message: '预览会话已失效，请重新生成或重新预览后再导出。',
    }
  }

  if (!(await fileExists(session.pptxPath))) {
    codePresentationSessions.delete(session.id)
    await removePresentationTempDirectory(session.tempDir)
    return {
      ok: false,
      message: '预览会话中的 PPTX 文件已不存在，请重新生成。',
    }
  }

  const defaultTitle = request.title || session.title || 'KatopGPT-PPT'
  const saveDialogOptions = {
    title: '导出 PPTX',
    defaultPath: path.join(app.getPath('documents'), `${safeFileName(defaultTitle)}.pptx`),
    filters: [
      { name: 'PowerPoint 文件', extensions: ['pptx'] },
    ],
  }
  const { canceled, filePath } = ownerWindow
    ? await dialog.showSaveDialog(ownerWindow, saveDialogOptions)
    : await dialog.showSaveDialog(saveDialogOptions)

  if (canceled || !filePath) {
    return {
      ok: false,
      message: '已取消导出。',
    }
  }

  const targetPath = withPptxExtension(filePath)
  await fs.copyFile(session.pptxPath, targetPath)

  return {
    ok: true,
    filePath: targetPath,
    message: '已导出与当前预览一致的 PPTX 文件。',
  }
}
