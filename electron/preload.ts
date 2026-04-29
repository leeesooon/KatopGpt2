import { contextBridge, ipcRenderer } from 'electron'
import type { PresentationExportRequest, PresentationExportResult } from './shared/presentation'

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

interface WorkspaceWindowState {
  open: boolean
}

interface PresentationWindowState {
  open: boolean
}

interface ExtractDocumentTextRequest {
  fileName: string
  mimeType?: string
  data: ArrayBuffer
}

interface SpreadsheetColumnSchema {
  name: string
  inferredType: 'string' | 'number' | 'boolean' | 'date' | 'mixed' | 'empty'
  aliases?: string[]
}

interface SpreadsheetSheetSchema {
  name: string
  rowCount: number
  columnCount: number
  columns: SpreadsheetColumnSchema[]
}

interface SpreadsheetWorkbookSchema {
  sheets: SpreadsheetSheetSchema[]
}

interface ExtractDocumentTextResult {
  ok: boolean
  content?: string
  error?: string
  fileType?: 'pptx' | 'pdf' | 'docx' | 'xlsx' | 'csv'
  spreadsheetSessionId?: string
  spreadsheetSchema?: SpreadsheetWorkbookSchema
}

interface ExecuteSpreadsheetInstructionRequest {
  sessionId: string
  instruction: string
}

interface SpreadsheetPlanFilter {
  column: string
  operator: 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'
  value: string
}

interface SpreadsheetExecutionPlan {
  intent: 'count' | 'rate' | 'sum' | 'avg' | 'chart' | 'export' | 'script' | 'filter_rows' | 'analysis' | 'detail_filter' | 'aggregation'
  sourceSheetName?: string
  groupByColumns?: string[]
  valueColumn?: string
  filters?: SpreadsheetPlanFilter[]
  rateLabel?: string
  rateFilters?: SpreadsheetPlanFilter[]
  selectColumns?: string[]
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  chartType?: 'bar' | 'line' | 'pie' | 'horizontalBar'
  targetSheetName?: string
  useLastCreatedSheet?: boolean
  topN?: number
  steps?: SpreadsheetPlanStep[]
  explanation?: string
  script?: {
    language: 'python' | 'javascript'
    code: string
    summary?: string
  }
}

type SpreadsheetPlanStep =
  | { op: 'filter'; conditions: SpreadsheetPlanFilter[] }
  | { op: 'group_by'; columns: string[] }
  | { op: 'aggregate'; metrics: Array<{ type: 'count' | 'sum' | 'avg'; column?: string; as?: string }> }
  | { op: 'sort'; by: string; direction: 'asc' | 'desc' }
  | { op: 'top_n'; value: number }
  | { op: 'select_columns'; columns: string[] }
  | { op: 'chart'; chartType: 'bar' | 'line' | 'pie' | 'horizontalBar' }
  | { op: 'export'; target: 'new_sheet' | 'excel_file'; sheetName?: string }

interface ExecuteSpreadsheetPlanRequest {
  sessionId: string
  plan: SpreadsheetExecutionPlan
}

interface ExecuteSpreadsheetInstructionResult {
  ok: boolean
  performed: boolean
  message: string
  createdSheetName?: string
}

interface ExportSpreadsheetSessionResult {
  ok: boolean
  message: string
  filePath?: string
  chartPaths?: string[]
}

interface ApiConnectionTestResult {
  ok: boolean
  status?: number
  error?: string
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
      content?: string
      tool_calls?: Array<{
        function?: {
          name?: string
          arguments?: string
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

interface ImageFileResult {
  ok: boolean
  message?: string
  filePath?: string
  dataUrl?: string
}

interface SaveWorkspaceImageResult {
  ok: boolean
  relativePath?: string
  markdown?: string
  error?: string
}

type ChatStreamEvent =
  | { streamId: string; type: 'chunk'; chunk: string }
  | { streamId: string; type: 'done' }
  | { streamId: string; type: 'error'; message: string; status?: number }
  | { streamId: string; type: 'aborted' }

const chatStreamListeners = new Map<number, (event: ChatStreamEvent) => void>()
let nextChatStreamListenerId = 1
const workspaceWindowStateListeners = new Map<number, (state: WorkspaceWindowState) => void>()
let nextWorkspaceWindowStateListenerId = 1
const presentationWindowStateListeners = new Map<number, (state: PresentationWindowState) => void>()
let nextPresentationWindowStateListenerId = 1

ipcRenderer.on('api:chatStreamEvent', (_event, payload: ChatStreamEvent) => {
  for (const listener of chatStreamListeners.values()) {
    try {
      listener(payload)
    } catch (error) {
      console.error('Chat stream listener failed:', error)
    }
  }
})

ipcRenderer.on('workspace:windowState', (_event, payload: WorkspaceWindowState) => {
  for (const listener of workspaceWindowStateListeners.values()) {
    try {
      listener(payload)
    } catch (error) {
      console.error('Workspace window listener failed:', error)
    }
  }
})

ipcRenderer.on('presentation:windowState', (_event, payload: PresentationWindowState) => {
  for (const listener of presentationWindowStateListeners.values()) {
    try {
      listener(payload)
    } catch (error) {
      console.error('Presentation window listener failed:', error)
    }
  }
})

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openImage: (dataUrl: string, fileName: string) => ipcRenderer.invoke('images:open', dataUrl, fileName),
  saveImage: (dataUrl: string, fileName: string) => ipcRenderer.invoke('images:save', dataUrl, fileName),
  readImage: (imageUrl: string) => ipcRenderer.invoke('images:read', imageUrl),
  openWorkspaceWindow: () => ipcRenderer.invoke('workspaceWindow:open'),
  closeWorkspaceWindow: () => ipcRenderer.invoke('workspaceWindow:close'),
  getWorkspaceWindowState: () => ipcRenderer.invoke('workspaceWindow:getState'),
  subscribeWorkspaceWindowState: (listener: (state: WorkspaceWindowState) => void) => {
    const id = nextWorkspaceWindowStateListenerId++
    workspaceWindowStateListeners.set(id, listener)
    return id
  },
  unsubscribeWorkspaceWindowState: (listenerId: number) => {
    workspaceWindowStateListeners.delete(listenerId)
  },
  openPresentationWindow: () => ipcRenderer.invoke('presentationWindow:open'),
  closePresentationWindow: () => ipcRenderer.invoke('presentationWindow:close'),
  getPresentationWindowState: () => ipcRenderer.invoke('presentationWindow:getState'),
  subscribePresentationWindowState: (listener: (state: PresentationWindowState) => void) => {
    const id = nextPresentationWindowStateListenerId++
    presentationWindowStateListeners.set(id, listener)
    return id
  },
  unsubscribePresentationWindowState: (listenerId: number) => {
    presentationWindowStateListeners.delete(listenerId)
  },
  fetchWebPage: (url: string) => ipcRenderer.invoke('web:fetchPage', url),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  listWorkspaceDocuments: (rootPath: string) => ipcRenderer.invoke('workspace:listDocuments', rootPath),
  readWorkspaceDocument: (rootPath: string, relativePath: string) => ipcRenderer.invoke('workspace:readDocument', rootPath, relativePath),
  writeWorkspaceDocument: (rootPath: string, relativePath: string, content: string) => ipcRenderer.invoke('workspace:writeDocument', rootPath, relativePath, content),
  createWorkspaceDocument: (rootPath: string, relativePath: string, content: string) => ipcRenderer.invoke('workspace:createDocument', rootPath, relativePath, content),
  renameWorkspaceDocument: (rootPath: string, oldRelativePath: string, newRelativePath: string) => ipcRenderer.invoke('workspace:renameDocument', rootPath, oldRelativePath, newRelativePath),
  deleteWorkspaceDocument: (rootPath: string, relativePath: string) => ipcRenderer.invoke('workspace:deleteDocument', rootPath, relativePath),
  saveWorkspaceImage: (rootPath: string, currentDocumentPath: string, imageDataUrl: string, fileName?: string) =>
    ipcRenderer.invoke('workspace:saveImage', rootPath, currentDocumentPath, imageDataUrl, fileName),
  extractDocumentText: (request: ExtractDocumentTextRequest) => ipcRenderer.invoke('files:extractDocumentText', request),
  executeSpreadsheetInstruction: (request: ExecuteSpreadsheetInstructionRequest) => ipcRenderer.invoke('files:executeSpreadsheetInstruction', request),
  executeSpreadsheetPlan: (request: ExecuteSpreadsheetPlanRequest) => ipcRenderer.invoke('files:executeSpreadsheetPlan', request),
  exportSpreadsheetSession: (sessionId: string) => ipcRenderer.invoke('files:exportSpreadsheetSession', sessionId),
  exportPresentationDeck: (request: PresentationExportRequest) => ipcRenderer.invoke('presentations:exportDeck', request) as Promise<PresentationExportResult>,
  testApiConnection: (config: ApiConnectionConfig) => ipcRenderer.invoke('api:testConnection', config),
  completeChat: (request: CompleteChatRequest) => ipcRenderer.invoke('api:completeChat', request) as Promise<string | CompleteChatResponsePayload>,
  generateImage: (request: GenerateImageRequest) => ipcRenderer.invoke('api:generateImage', request),
  cancelGenerateImage: (requestId: string) => ipcRenderer.invoke('api:cancelGenerateImage', requestId),
  startChatStream: (request: StartChatStreamRequest) => ipcRenderer.invoke('api:startChatStream', request),
  cancelChatStream: (streamId: string) => ipcRenderer.invoke('api:cancelChatStream', streamId),
  subscribeChatStreamEvents: (listener: (event: ChatStreamEvent) => void) => {
    const id = nextChatStreamListenerId++
    chatStreamListeners.set(id, listener)
    return id
  },
  unsubscribeChatStreamEvents: (listenerId: number) => {
    chatStreamListeners.delete(listenerId)
  },
})
