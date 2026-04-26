import { app, BrowserWindow, dialog, ipcMain, protocol, shell, type WebContents } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import {
  extractDocumentText,
  executeSpreadsheetInstruction,
  executeSpreadsheetPlan,
  exportSpreadsheetSession,
  type ExportSpreadsheetSessionResult,
  type ExecuteSpreadsheetPlanRequest,
  type ExecuteSpreadsheetInstructionRequest,
  type ExtractDocumentTextRequest,
} from './documentExtraction.ts'

let mainWindow: BrowserWindow | null = null
let workspaceWindow: BrowserWindow | null = null
const activeApiStreams = new Map<string, AbortController>()
const activeImageGenerations = new Map<string, AbortController>()

const APP_AMPERSAND_RE = /&(?:amp(?:;|%3[Bb])|#38;)/gi
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const READABLE_WEB_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain']
const MAX_WEB_PAGE_CHARS = 500000
const WEB_FETCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) KatopGPT/1.0 Chrome/124.0.0.0 Safari/537.36'
const ALLOWED_WORKSPACE_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'katopgpt-image',
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
])

type ApiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

interface ApiChatMessage {
  role: string
  content: string | ApiContentPart[]
}

interface ApiConnectionConfig {
  baseUrl: string
  apiKey: string
}

interface WorkspaceHandle {
  id: string
  name: string
  rootPath: string
}

interface ApiConnectionTestResult {
  ok: boolean
  status?: number
  error?: string
}

interface ImageFileResult {
  ok: boolean
  message?: string
  filePath?: string
  dataUrl?: string
}

function parseImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) {
    throw new Error('图片数据格式不正确。')
  }

  const mimeType = match[1].toLowerCase()
  const extension = IMAGE_MIME_EXTENSIONS[mimeType]
  if (!extension) {
    throw new Error('暂不支持该图片格式。')
  }

  return {
    buffer: Buffer.from(match[2], 'base64'),
    mimeType,
    extension,
  }
}

function sanitizeImageFileName(fileName: string, extension: string) {
  const fallback = `katopgpt-image-${Date.now()}`
  const baseName = path.basename(fileName || fallback, path.extname(fileName || ''))
  const sanitized = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || fallback
  return `${sanitized}.${extension}`
}

function imageFileUrl(filePath: string) {
  return `katopgpt-image://generated/${encodeURIComponent(path.basename(filePath))}`
}

function parseImageFileUrl(rawUrl: string) {
  if (!rawUrl.startsWith('katopgpt-image://')) return null
  const imageRoot = path.join(app.getPath('userData'), 'generated-images')

  try {
    const parsedUrl = new URL(rawUrl)
    if (parsedUrl.hostname === 'generated') {
      const fileName = path.basename(decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, '')))
      return path.join(imageRoot, fileName)
    }
  } catch {
    // Fallback to legacy parsing below.
  }

  const decodedPath = decodeURIComponent(rawUrl.slice('katopgpt-image://'.length))
  const legacyPath = decodedPath.replace(/^generated\//, '')
  const absolutePath = path.isAbsolute(legacyPath)
    ? path.resolve(legacyPath)
    : path.join(imageRoot, path.basename(legacyPath))
  const relativePath = path.relative(imageRoot, absolutePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null
  return absolutePath
}

async function persistGeneratedImageDataUrl(dataUrl: string, fileName: string) {
  const image = parseImageDataUrl(dataUrl)
  const imageDir = path.join(app.getPath('userData'), 'generated-images')
  await fs.mkdir(imageDir, { recursive: true })
  const finalFileName = sanitizeImageFileName(fileName, image.extension)
  const filePath = path.join(imageDir, finalFileName)
  await fs.writeFile(filePath, image.buffer)
  return {
    filePath,
    fileName: finalFileName,
    imageUrl: imageFileUrl(filePath),
  }
}

function imageDataUrlToFile(dataUrl: string, fileName: string) {
  const image = parseImageDataUrl(dataUrl)
  return new File([image.buffer], sanitizeImageFileName(fileName, image.extension), {
    type: image.mimeType,
  })
}

async function persistGeneratedImageResponse(firstImage: { b64_json?: string; url?: string }, abortSignal: AbortSignal) {
  if (firstImage.b64_json) {
    return persistGeneratedImageDataUrl(
      normalizeImageDataUrl(firstImage.b64_json),
      `generated-${Date.now()}.png`
    )
  }

  if (firstImage.url) {
    const imageResponse = await fetch(firstImage.url, { signal: abortSignal })
    if (!imageResponse.ok) {
      throw new Error('图片已生成，但下载图片失败。')
    }
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
    const mimeType = imageResponse.headers.get('content-type') || 'image/png'
    return persistGeneratedImageDataUrl(
      normalizeImageDataUrl(imageBuffer.toString('base64'), mimeType),
      `generated-${Date.now()}.${IMAGE_MIME_EXTENSIONS[mimeType.toLowerCase()] ?? 'png'}`
    )
  }

  throw new Error('生图接口返回格式不受支持。')
}

async function openImageDataUrl(dataUrl: string, fileName: string): Promise<ImageFileResult> {
  try {
    const filePath = dataUrl.startsWith('katopgpt-image://') ? parseImageFileUrl(dataUrl) : null
    const targetPath = filePath ?? (() => {
      const image = parseImageDataUrl(dataUrl)
      const imageDir = path.join(app.getPath('temp'), 'katopgpt-images')
      return { image, imageDir }
    })()

    let openPath = filePath
    if (!openPath && typeof targetPath !== 'string') {
      await fs.mkdir(targetPath.imageDir, { recursive: true })
      openPath = path.join(targetPath.imageDir, sanitizeImageFileName(fileName, targetPath.image.extension))
      await fs.writeFile(openPath, targetPath.image.buffer)
    }

    if (!openPath) {
      throw new Error('图片文件路径不可用。')
    }

    const errorMessage = await shell.openPath(openPath)

    if (errorMessage) {
      return { ok: false, message: errorMessage }
    }

    return { ok: true, filePath: openPath }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '打开图片失败。',
    }
  }
}

async function readImageDataUrl(imageUrl: string): Promise<ImageFileResult> {
  try {
    const filePath = parseImageFileUrl(imageUrl)
    if (!filePath) {
      throw new Error('图片路径不可用。')
    }

    const buffer = await fs.readFile(filePath)
    const extension = path.extname(filePath).toLowerCase()
    const mimeType = Object.entries(IMAGE_MIME_EXTENSIONS).find(([, item]) => `.${item}` === extension)?.[0] ?? 'image/png'
    return {
      ok: true,
      filePath,
      dataUrl: normalizeImageDataUrl(buffer.toString('base64'), mimeType),
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '读取图片失败。',
    }
  }
}

async function saveImageDataUrl(dataUrl: string, fileName: string): Promise<ImageFileResult> {
  try {
    const sourcePath = dataUrl.startsWith('katopgpt-image://') ? parseImageFileUrl(dataUrl) : null
    const image = sourcePath ? null : parseImageDataUrl(dataUrl)
    const extension = sourcePath ? path.extname(sourcePath).slice(1) || 'png' : image!.extension
    const defaultFileName = sanitizeImageFileName(fileName, extension)
    const dialogOptions = {
      title: '保存图片',
      defaultPath: path.join(app.getPath('pictures'), defaultFileName),
      filters: [
        { name: '图片文件', extensions: [extension] },
      ],
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (result.canceled || !result.filePath) {
      return { ok: false, message: '已取消保存。' }
    }

    if (sourcePath) {
      await fs.copyFile(sourcePath, result.filePath)
    } else {
      await fs.writeFile(result.filePath, image!.buffer)
    }

    return {
      ok: true,
      message: `已保存到：${result.filePath}`,
      filePath: result.filePath,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '保存图片失败。',
    }
  }
}

async function openImagePath(filePath: string): Promise<ImageFileResult> {
  try {
    const errorMessage = await shell.openPath(filePath)

    if (errorMessage) {
      return { ok: false, message: errorMessage }
    }

    return { ok: true, filePath }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '打开图片失败。',
    }
  }
}

async function exportSpreadsheetSessionToFile(sessionId: string): Promise<ExportSpreadsheetSessionResult> {
  try {
    const { buffer, defaultFileName, charts } = exportSpreadsheetSession(sessionId)
    const dialogOptions = {
      title: '导出表格结果',
      defaultPath: path.join(app.getPath('documents'), defaultFileName),
      filters: [
        { name: 'Excel 文件', extensions: ['xlsx'] },
      ],
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (result.canceled || !result.filePath) {
      return {
        ok: false,
        message: '已取消导出。',
      }
    }

    await fs.writeFile(result.filePath, buffer)
    const chartPaths: string[] = []
    const exportDir = path.dirname(result.filePath)
    const exportBaseName = path.basename(result.filePath, path.extname(result.filePath))
    for (const chart of charts) {
      const chartPath = path.join(exportDir, `${exportBaseName}_${chart.fileName}`)
      await fs.writeFile(chartPath, chart.svgContent, 'utf8')
      chartPaths.push(chartPath)
    }

    return {
      ok: true,
      message: chartPaths.length > 0
        ? `已导出 Excel：${result.filePath}\n已导出图表：\n${chartPaths.map((item) => `- ${item}`).join('\n')}`
        : `已导出到：${result.filePath}`,
      filePath: result.filePath,
      chartPaths,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '导出表格失败',
    }
  }
}

interface StartChatStreamRequest {
  streamId: string
  baseUrl: string
  apiKey: string
  model: string
  messages: ApiChatMessage[]
  temperature: number
  maxTokens: number
}

interface CompleteChatRequest {
  baseUrl: string
  apiKey: string
  model: string
  messages: ApiChatMessage[]
  temperature: number
  maxTokens: number
  tools?: ChatToolDefinition[]
  toolChoice?: ChatToolChoice
  responseMode?: 'text' | 'raw'
}

interface ChatToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

type ChatToolChoice = 'auto' | {
  type: 'function'
  function: { name: string }
}

interface CompleteChatResponsePayload {
  choices?: Array<{
    message?: {
      content?: unknown
      tool_calls?: Array<{
        function?: {
          name?: unknown
          arguments?: unknown
        }
      }>
    }
  }>
}

interface GenerateImageRequest {
  requestId?: string
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  images?: Array<{
    base64?: string
    name: string
  }>
  size: '1024x1024' | '1024x1536' | '1536x1024'
  quality: 'auto' | 'low' | 'medium' | 'high'
}

interface GenerateImageResult {
  ok: boolean
  imageBase64?: string
  imageUrl?: string
  filePath?: string
  fileName?: string
  revisedPrompt?: string
  error?: string
}

interface ChatCompletionChunk {
  choices: Array<{
    delta: { content?: string; role?: string }
    finish_reason: string | null
  }>
}

interface ParsedStreamLine {
  chunk?: ChatCompletionChunk
  content?: string
  isDone: boolean
}

interface ChatCompletionResponseChoice {
  delta?: { content?: unknown }
  message?: { content?: unknown }
  text?: unknown
}

interface ChatCompletionResponse {
  choices?: ChatCompletionResponseChoice[]
}

type ChatStreamEvent =
  | { streamId: string; type: 'chunk'; chunk: string }
  | { streamId: string; type: 'done' }
  | { streamId: string; type: 'error'; message: string; status?: number }
  | { streamId: string; type: 'aborted' }

function normalizeExternalUrl(rawUrl: string) {
  const trimmedUrl = rawUrl.trim()
  if (!trimmedUrl) return null

  const normalizedUrl = trimmedUrl.replace(APP_AMPERSAND_RE, '&')

  try {
    const url = new URL(normalizedUrl)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

function openExternalUrl(rawUrl: string) {
  const externalUrl = normalizeExternalUrl(rawUrl)
  if (!externalUrl) return false
  void shell.openExternal(externalUrl)
  return true
}

function normalizeApiBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '')
}

function normalizeImageDataUrl(value: string, mimeType = 'image/png') {
  const trimmed = value.trim()
  if (trimmed.startsWith('data:image/')) return trimmed
  return `data:${mimeType};base64,${trimmed}`
}

function normalizeRelativeWorkspacePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!normalized) {
    throw new Error('文档路径不能为空')
  }

  return normalized
}

function ensureWorkspacePath(rootPath: string, relativePath: string) {
  const normalizedRelativePath = normalizeRelativeWorkspacePath(relativePath)
  const absoluteRoot = path.resolve(rootPath)
  const absoluteTarget = path.resolve(absoluteRoot, normalizedRelativePath)
  const relative = path.relative(absoluteRoot, absoluteTarget)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('禁止访问工作区外部路径')
  }

  const extension = path.extname(absoluteTarget).toLowerCase()
  if (!ALLOWED_WORKSPACE_EXTENSIONS.has(extension)) {
    throw new Error('当前仅支持 Markdown 或纯文本文件')
  }

  return {
    normalizedRelativePath,
    absoluteTarget,
  }
}

async function collectWorkspaceDocuments(rootPath: string, currentRelativePath = ''): Promise<string[]> {
  const currentAbsolutePath = path.join(rootPath, currentRelativePath)
  const entries = await fs.readdir(currentAbsolutePath, { withFileTypes: true })
  const documents: string[] = []

  for (const entry of entries) {
    const entryRelativePath = currentRelativePath
      ? `${currentRelativePath}/${entry.name}`
      : entry.name

    if (entry.isDirectory()) {
      documents.push(...await collectWorkspaceDocuments(rootPath, entryRelativePath))
      continue
    }

    const extension = path.extname(entry.name).toLowerCase()
    if (ALLOWED_WORKSPACE_EXTENSIONS.has(extension)) {
      documents.push(entryRelativePath.replace(/\\/g, '/'))
    }
  }

  return documents.sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

async function selectWorkspace(): Promise<WorkspaceHandle | null> {
  if (!mainWindow) return null

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择 Markdown 工作区',
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const rootPath = result.filePaths[0]
  return {
    id: rootPath,
    name: path.basename(rootPath),
    rootPath,
  }
}

async function listWorkspaceDocuments(rootPath: string) {
  return collectWorkspaceDocuments(rootPath)
}

async function readWorkspaceDocument(rootPath: string, relativePath: string) {
  const { absoluteTarget } = ensureWorkspacePath(rootPath, relativePath)
  return fs.readFile(absoluteTarget, 'utf8')
}

async function writeWorkspaceDocument(rootPath: string, relativePath: string, content: string) {
  const { absoluteTarget } = ensureWorkspacePath(rootPath, relativePath)
  await fs.mkdir(path.dirname(absoluteTarget), { recursive: true })
  await fs.writeFile(absoluteTarget, content, 'utf8')
  return true
}

async function createWorkspaceDocument(rootPath: string, relativePath: string, content: string) {
  const { absoluteTarget } = ensureWorkspacePath(rootPath, relativePath)
  await fs.mkdir(path.dirname(absoluteTarget), { recursive: true })
  await fs.writeFile(absoluteTarget, content, { encoding: 'utf8', flag: 'wx' })
  return true
}

async function renameWorkspaceDocument(rootPath: string, oldRelativePath: string, newRelativePath: string) {
  const { absoluteTarget: oldAbsoluteTarget } = ensureWorkspacePath(rootPath, oldRelativePath)
  const { absoluteTarget: newAbsoluteTarget } = ensureWorkspacePath(rootPath, newRelativePath)
  await fs.mkdir(path.dirname(newAbsoluteTarget), { recursive: true })
  await fs.rename(oldAbsoluteTarget, newAbsoluteTarget)
  return true
}

async function deleteWorkspaceDocument(rootPath: string, relativePath: string) {
  const { absoluteTarget } = ensureWorkspacePath(rootPath, relativePath)
  await fs.unlink(absoluteTarget)
  return true
}

function extractApiErrorMessage(errorBody: unknown, fallback: string) {
  if (!errorBody || typeof errorBody !== 'object') return fallback

  const body = errorBody as Record<string, unknown>
  const error = body.error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) {
      return message.trim()
    }
  }

  const message = body.message
  if (typeof message === 'string' && message.trim()) {
    return message.trim()
  }

  return fallback
}

function shortenText(text: string, maxLength: number = 300) {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trimEnd()}...`
}

async function readApiError(response: Response) {
  const fallback = `API 请求失败 (${response.status})`

  try {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const errorBody = await response.json()
      return {
        message: extractApiErrorMessage(errorBody, fallback),
        body: errorBody,
      }
    }

    const text = shortenText((await response.text()).trim())
    return {
      message: text || fallback,
    }
  } catch {
    return {
      message: fallback,
    }
  }
}

function parseStreamLine(line: string): ParsedStreamLine | null {
  const trimmed = line.trim()
  if (!trimmed || !trimmed.startsWith('data:')) return null

  const data = trimmed.slice(5).trimStart()
  if (data === '[DONE]') {
    return { isDone: true }
  }

  try {
    const chunk: ChatCompletionChunk = JSON.parse(data)
    return {
      chunk,
      content: extractCompletionText(chunk) ?? undefined,
      isDone: false,
    }
  } catch {
    return null
  }
}

function extractTextFromMessageContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const textValue = (part as Record<string, unknown>).text
        return typeof textValue === 'string' ? textValue : ''
      })
      .join('')

    return text || null
  }

  return null
}

function extractCompletionText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null

  const choices = (payload as ChatCompletionResponse).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return null
  }

  const firstChoice = choices[0]
  const candidates = [
    extractTextFromMessageContent(firstChoice?.delta?.content),
    extractTextFromMessageContent(firstChoice?.message?.content),
    typeof firstChoice?.text === 'string' ? firstChoice.text : null,
  ]

  return candidates.find((candidate) => typeof candidate === 'string' && candidate.length > 0) ?? null
}

function formatRawResponsePreview(rawText: string, maxLength: number = 300) {
  const normalized = rawText
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()

  if (!normalized) {
    return '（上游响应为空）'
  }

  return shortenText(normalized, maxLength)
}

function buildUnparsedResponseError(rawText: string) {
  return `模型已返回响应，但未解析出可显示文本。上游原始响应预览：${formatRawResponsePreview(rawText)}`
}

function extractCompletionTextFromRaw(rawText: string): string | null {
  const trimmed = rawText.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    const text = extractCompletionText(parsed)
    if (text) return text
  } catch {
    // ignore JSON parse error
  }

  let mergedText = ''
  for (const line of trimmed.split(/\r?\n/)) {
    const parsed = parseStreamLine(line)
    if (parsed?.content) {
      mergedText += parsed.content
    }
  }

  return mergedText || null
}

async function relayNonStreamCompletionResponse(sender: WebContents, streamId: string, response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  const rawText = await response.text()

  if (contentType.includes('application/json')) {
    try {
      const payload = JSON.parse(rawText)
      const text = extractCompletionText(payload)
      if (!text) {
        throw new Error(buildUnparsedResponseError(rawText))
      }

      sendChatStreamEvent(sender, { streamId, type: 'chunk', chunk: text })
      sendChatStreamEvent(sender, { streamId, type: 'done' })
      return
    } catch (error) {
      if (error instanceof Error && error.message.includes('上游原始响应预览')) {
        throw error
      }

      throw new Error(buildUnparsedResponseError(rawText))
    }
  }

  const text = extractCompletionTextFromRaw(rawText)
  if (!text) {
    throw new Error(buildUnparsedResponseError(rawText))
  }

  sendChatStreamEvent(sender, { streamId, type: 'chunk', chunk: text })
  sendChatStreamEvent(sender, { streamId, type: 'done' })
}

async function completeChat(request: CompleteChatRequest) {
  const baseUrl = normalizeApiBaseUrl(request.baseUrl)
  const url = `${baseUrl}/chat/completions`
  const requestBody: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: false,
    temperature: request.temperature,
  }

  if (request.maxTokens > 0) {
    requestBody.max_tokens = request.maxTokens
  }
  if (request.tools?.length) {
    requestBody.tools = request.tools
  }
  if (request.toolChoice) {
    requestBody.tool_choice = request.toolChoice
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const { message } = await readApiError(response)
    throw new Error(message)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const rawText = await response.text()

  if (contentType.includes('application/json')) {
    try {
      const payload = JSON.parse(rawText) as CompleteChatResponsePayload
      if (request.responseMode === 'raw') {
        return payload
      }
      const text = extractCompletionText(payload)
      if (text) return text
    } catch {
      // ignore and fallback below
    }
  }

  const text = extractCompletionTextFromRaw(rawText)
  if (!text) {
    throw new Error(buildUnparsedResponseError(rawText))
  }

  if (request.responseMode === 'raw') {
    throw new Error(buildUnparsedResponseError(rawText))
  }

  return text
}

async function generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
  const baseUrl = normalizeApiBaseUrl(request.baseUrl)
  const prompt = request.prompt.trim()
  const referenceImage = request.images?.find((image) => image.base64)
  const url = referenceImage ? `${baseUrl}/images/edits` : `${baseUrl}/images/generations`
  const abortController = new AbortController()

  if (request.requestId) {
    activeImageGenerations.set(request.requestId, abortController)
  }

  if (!request.apiKey.trim()) {
    return { ok: false, error: '请先在设置中填写生图模型的 API Key。' }
  }

  if (!prompt) {
    return { ok: false, error: '请输入要生成的图片描述。' }
  }

  try {
    const response = referenceImage
      ? await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${request.apiKey}`,
          },
          body: (() => {
            const formData = new FormData()
            formData.append('model', request.model)
            formData.append('prompt', prompt)
            formData.append('n', '1')
            formData.append('size', request.size)
            formData.append('image', imageDataUrlToFile(referenceImage.base64!, referenceImage.name))
            return formData
          })(),
          signal: abortController.signal,
        })
      : await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${request.apiKey}`,
          },
          body: JSON.stringify({
            model: request.model,
            prompt,
            n: 1,
            size: request.size,
            quality: request.quality,
          }),
          signal: abortController.signal,
        })

    if (!response.ok) {
      const { message } = await readApiError(response)
      return { ok: false, error: message }
    }

    const payload = await response.json() as {
      data?: Array<{
        b64_json?: string
        url?: string
        revised_prompt?: string
      }>
    }
    const firstImage = payload.data?.[0]

    if (!firstImage) {
      return { ok: false, error: '生图接口没有返回图片数据。' }
    }

    const persisted = await persistGeneratedImageResponse(firstImage, abortController.signal)
    return {
      ok: true,
      ...persisted,
      revisedPrompt: firstImage.revised_prompt,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: '已停止生成图片。' }
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : '生成图片失败。',
    }
  } finally {
    if (request.requestId) {
      activeImageGenerations.delete(request.requestId)
    }
  }
}

function sendChatStreamEvent(sender: WebContents, payload: ChatStreamEvent) {
  if (sender.isDestroyed()) return
  sender.send('api:chatStreamEvent', payload)
}

async function testApiConnection(config: ApiConnectionConfig): Promise<ApiConnectionTestResult> {
  const baseUrl = normalizeApiBaseUrl(config.baseUrl)
  const url = `${baseUrl}/models`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    })

    if (response.ok) {
      return { ok: true, status: response.status }
    }

    const { message } = await readApiError(response)
    return { ok: false, status: response.status, error: message }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '连接失败',
    }
  }
}

async function proxyChatStream(
  sender: WebContents,
  request: StartChatStreamRequest,
  abortController: AbortController
) {
  const baseUrl = normalizeApiBaseUrl(request.baseUrl)
  const url = `${baseUrl}/chat/completions`
  const requestBody: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: true,
    temperature: request.temperature,
  }

  if (request.maxTokens > 0) {
    requestBody.max_tokens = request.maxTokens
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    })

    if (!response.ok) {
      const { message } = await readApiError(response)
      sendChatStreamEvent(sender, {
        streamId: request.streamId,
        type: 'error',
        message,
        status: response.status,
      })
      return
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !contentType.includes('text/event-stream')) {
      await relayNonStreamCompletionResponse(sender, request.streamId, response)
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      sendChatStreamEvent(sender, {
        streamId: request.streamId,
        type: 'error',
        message: '无法读取响应流',
      })
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let rawResponse = ''
    let hasVisibleContent = false

    try {
      let streamEnded = false

      while (true) {
        const { done, value } = await reader.read()
        const chunkText = done ? decoder.decode() : decoder.decode(value, { stream: true })
        rawResponse += chunkText
        buffer += chunkText
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const parsed = parseStreamLine(line)
          if (!parsed) continue

          if (parsed.isDone) {
            sendChatStreamEvent(sender, { streamId: request.streamId, type: 'done' })
            streamEnded = true
            break
          }

          if (parsed.content) {
            hasVisibleContent = true
            sendChatStreamEvent(sender, {
              streamId: request.streamId,
              type: 'chunk',
              chunk: parsed.content,
            })
          }
        }

        if (streamEnded) return
        if (done) break
      }

      const trailingLine = buffer.trim()
      if (trailingLine) {
        const parsed = parseStreamLine(trailingLine)
        if (parsed?.content) {
          hasVisibleContent = true
          sendChatStreamEvent(sender, {
            streamId: request.streamId,
            type: 'chunk',
            chunk: parsed.content,
          })
        }
        if (parsed?.isDone) {
          sendChatStreamEvent(sender, { streamId: request.streamId, type: 'done' })
          return
        }
      }

      if (!hasVisibleContent) {
        const fallbackText = extractCompletionTextFromRaw(rawResponse)
        if (fallbackText) {
          sendChatStreamEvent(sender, {
            streamId: request.streamId,
            type: 'chunk',
            chunk: fallbackText,
          })
          sendChatStreamEvent(sender, { streamId: request.streamId, type: 'done' })
          return
        }

        sendChatStreamEvent(sender, {
          streamId: request.streamId,
          type: 'error',
          message: buildUnparsedResponseError(rawResponse),
        })
        return
      }

      sendChatStreamEvent(sender, { streamId: request.streamId, type: 'done' })
    } finally {
      reader.releaseLock()
    }
  } catch (error) {
    if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      sendChatStreamEvent(sender, { streamId: request.streamId, type: 'aborted' })
      return
    }

    sendChatStreamEvent(sender, {
      streamId: request.streamId,
      type: 'error',
      message: error instanceof Error ? error.message : '请求失败',
    })
  } finally {
    activeApiStreams.delete(request.streamId)
  }
}

async function fetchWebPage(rawUrl: string) {
  const externalUrl = normalizeExternalUrl(rawUrl)
  if (!externalUrl) {
    throw new Error('无效网页链接')
  }

  const response = await fetch(externalUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': WEB_FETCH_USER_AGENT,
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`网页请求失败 (${response.status})`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const isReadableContent = READABLE_WEB_CONTENT_TYPES.some((type) => contentType.includes(type))
  if (contentType && !isReadableContent) {
    throw new Error(`暂不支持读取该网页类型：${contentType}`)
  }

  const html = (await response.text()).slice(0, MAX_WEB_PAGE_CHARS)

  return {
    finalUrl: normalizeExternalUrl(response.url) ?? externalUrl,
    contentType,
    html,
  }
}

function isAppUrl(url: string) {
  if (url.startsWith('file://')) return true
  if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) {
    return true
  }
  return false
}

function getRendererUrl(searchParams?: URLSearchParams) {
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL)
    if (searchParams) {
      url.search = searchParams.toString()
    }
    return url.toString()
  }

  return null
}

function attachCommonWindowHandlers(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (openExternalUrl(url)) {
      return { action: 'deny' }
    }

    if (url.startsWith('data:') || url === 'about:blank') {
      return { action: 'allow' }
    }

    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return

    event.preventDefault()
    openExternalUrl(url)
  })
}

function broadcastWorkspaceWindowState() {
  const payload = { open: Boolean(workspaceWindow && !workspaceWindow.isDestroyed()) }
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('workspace:windowState', payload)
  })
}

function createWorkspaceWindow() {
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.focus()
    broadcastWorkspaceWindowState()
    return workspaceWindow
  }

  workspaceWindow = new BrowserWindow({
    width: 980,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    title: 'KatopGPT Workspace',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  attachCommonWindowHandlers(workspaceWindow)

  workspaceWindow.once('ready-to-show', () => {
    workspaceWindow?.show()
    broadcastWorkspaceWindowState()
  })

  workspaceWindow.on('closed', () => {
    workspaceWindow = null
    broadcastWorkspaceWindowState()
  })

  const searchParams = new URLSearchParams({ workspaceWindow: '1' })
  const devUrl = getRendererUrl(searchParams)

  if (devUrl) {
    void workspaceWindow.loadURL(devUrl)
  } else {
    void workspaceWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'), {
      search: searchParams.toString(),
    })
  }

  return workspaceWindow
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  attachCommonWindowHandlers(mainWindow)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    broadcastWorkspaceWindowState()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'))
  }
}


function registerWindowIpcHandlers() {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized())
  ipcMain.handle('shell:openExternal', (_event, url: string) => openExternalUrl(url))
  ipcMain.handle('workspaceWindow:open', () => {
    createWorkspaceWindow()
    return true
  })
  ipcMain.handle('workspaceWindow:close', () => {
    if (!workspaceWindow || workspaceWindow.isDestroyed()) return false
    workspaceWindow.close()
    return true
  })
  ipcMain.handle('workspaceWindow:getState', () => ({
    open: Boolean(workspaceWindow && !workspaceWindow.isDestroyed()),
  }))
}

function registerImageIpcHandlers() {
  ipcMain.handle('images:open', (_event, dataUrl: string, fileName: string) => openImageDataUrl(dataUrl, fileName))
  ipcMain.handle('images:save', (_event, dataUrl: string, fileName: string) => saveImageDataUrl(dataUrl, fileName))
  ipcMain.handle('images:read', (_event, imageUrl: string) => readImageDataUrl(imageUrl))
}

function registerWorkspaceIpcHandlers() {
  ipcMain.handle('workspace:select', () => selectWorkspace())
  ipcMain.handle('workspace:listDocuments', (_event, rootPath: string) => listWorkspaceDocuments(rootPath))
  ipcMain.handle('workspace:readDocument', (_event, rootPath: string, relativePath: string) => readWorkspaceDocument(rootPath, relativePath))
  ipcMain.handle('workspace:writeDocument', (_event, rootPath: string, relativePath: string, content: string) => writeWorkspaceDocument(rootPath, relativePath, content))
  ipcMain.handle('workspace:createDocument', (_event, rootPath: string, relativePath: string, content: string) => createWorkspaceDocument(rootPath, relativePath, content))
  ipcMain.handle('workspace:renameDocument', (_event, rootPath: string, oldRelativePath: string, newRelativePath: string) => renameWorkspaceDocument(rootPath, oldRelativePath, newRelativePath))
  ipcMain.handle('workspace:deleteDocument', (_event, rootPath: string, relativePath: string) => deleteWorkspaceDocument(rootPath, relativePath))
}

function registerDocumentIpcHandlers() {
  ipcMain.handle('files:extractDocumentText', (_event, request: ExtractDocumentTextRequest) => extractDocumentText(request))
  ipcMain.handle('files:executeSpreadsheetInstruction', (_event, request: ExecuteSpreadsheetInstructionRequest) => executeSpreadsheetInstruction(request))
  ipcMain.handle('files:executeSpreadsheetPlan', (_event, request: ExecuteSpreadsheetPlanRequest) => executeSpreadsheetPlan(request))
  ipcMain.handle('files:exportSpreadsheetSession', (_event, sessionId: string) => exportSpreadsheetSessionToFile(sessionId))
}

function registerApiIpcHandlers() {
  ipcMain.handle('web:fetchPage', (_event, url: string) => fetchWebPage(url))
  ipcMain.handle('api:testConnection', (_event, config: ApiConnectionConfig) => testApiConnection(config))
  ipcMain.handle('api:completeChat', (_event, request: CompleteChatRequest) => completeChat(request))
  ipcMain.handle('api:generateImage', (_event, request: GenerateImageRequest) => generateImage(request))
  ipcMain.handle('api:cancelGenerateImage', (_event, requestId: string) => {
    const controller = activeImageGenerations.get(requestId)
    if (!controller) return false
    controller.abort()
    activeImageGenerations.delete(requestId)
    return true
  })
  ipcMain.handle('api:startChatStream', (event, request: StartChatStreamRequest) => {
    if (activeApiStreams.has(request.streamId)) {
      throw new Error('聊天流已存在')
    }

    const abortController = new AbortController()
    activeApiStreams.set(request.streamId, abortController)
    void proxyChatStream(event.sender, request, abortController)
    return true
  })
  ipcMain.handle('api:cancelChatStream', (_event, streamId: string) => {
    const controller = activeApiStreams.get(streamId)
    if (!controller) return false
    controller.abort()
    return true
  })
}

function registerIpcHandlers() {
  registerWindowIpcHandlers()
  registerImageIpcHandlers()
  registerWorkspaceIpcHandlers()
  registerDocumentIpcHandlers()
  registerApiIpcHandlers()
}

app.whenReady().then(() => {
  protocol.handle('katopgpt-image', async (request) => {
    const filePath = parseImageFileUrl(request.url)
    if (!filePath) {
      return new Response('Not found', { status: 404 })
    }

    try {
      const buffer = await fs.readFile(filePath)
      const extension = path.extname(filePath).toLowerCase()
      const contentType = Object.entries(IMAGE_MIME_EXTENSIONS).find(([, item]) => `.${item}` === extension)?.[0] ?? 'image/png'
      return new Response(buffer, { headers: { 'Content-Type': contentType } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  registerIpcHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  activeApiStreams.forEach((controller) => controller.abort())
  activeApiStreams.clear()
  activeImageGenerations.forEach((controller) => controller.abort())
  activeImageGenerations.clear()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
