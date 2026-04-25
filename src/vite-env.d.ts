/// <reference types="vite/client" />

interface FetchedWebPage {
  finalUrl: string
  contentType: string
  html: string
}

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
  intent: 'count' | 'sum' | 'avg' | 'chart' | 'export' | 'script' | 'filter_rows' | 'analysis' | 'detail_filter' | 'aggregation'
  sourceSheetName?: string
  groupByColumns?: string[]
  valueColumn?: string
  filters?: SpreadsheetPlanFilter[]
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
}

interface GenerateImageRequest {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  size: '1024x1024' | '1024x1536' | '1536x1024'
  quality: 'auto' | 'low' | 'medium' | 'high'
}

interface GenerateImageResult {
  ok: boolean
  imageBase64?: string
  revisedPrompt?: string
  error?: string
}

type ChatStreamEvent =
  | { streamId: string; type: 'chunk'; chunk: string }
  | { streamId: string; type: 'done' }
  | { streamId: string; type: 'error'; message: string; status?: number }
  | { streamId: string; type: 'aborted' }

interface ElectronAPI {
  minimize: () => void
  maximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  openExternal: (url: string) => Promise<boolean>
  openWorkspaceWindow: () => Promise<boolean>
  closeWorkspaceWindow: () => Promise<boolean>
  getWorkspaceWindowState: () => Promise<WorkspaceWindowState>
  subscribeWorkspaceWindowState: (listener: (state: WorkspaceWindowState) => void) => number
  unsubscribeWorkspaceWindowState: (listenerId: number) => void
  fetchWebPage: (url: string) => Promise<FetchedWebPage>
  selectWorkspace: () => Promise<WorkspaceHandle | null>
  listWorkspaceDocuments: (rootPath: string) => Promise<string[]>
  readWorkspaceDocument: (rootPath: string, relativePath: string) => Promise<string>
  writeWorkspaceDocument: (rootPath: string, relativePath: string, content: string) => Promise<boolean>
  createWorkspaceDocument: (rootPath: string, relativePath: string, content: string) => Promise<boolean>
  renameWorkspaceDocument: (rootPath: string, oldRelativePath: string, newRelativePath: string) => Promise<boolean>
  deleteWorkspaceDocument: (rootPath: string, relativePath: string) => Promise<boolean>
  extractDocumentText: (request: ExtractDocumentTextRequest) => Promise<ExtractDocumentTextResult>
  executeSpreadsheetInstruction: (request: ExecuteSpreadsheetInstructionRequest) => Promise<ExecuteSpreadsheetInstructionResult>
  executeSpreadsheetPlan: (request: ExecuteSpreadsheetPlanRequest) => Promise<ExecuteSpreadsheetInstructionResult>
  exportSpreadsheetSession: (sessionId: string) => Promise<ExportSpreadsheetSessionResult>
  testApiConnection: (config: ApiConnectionConfig) => Promise<ApiConnectionTestResult>
  completeChat: (request: CompleteChatRequest) => Promise<string>
  generateImage: (request: GenerateImageRequest) => Promise<GenerateImageResult>
  startChatStream: (request: StartChatStreamRequest) => Promise<boolean>
  cancelChatStream: (streamId: string) => Promise<boolean>
  subscribeChatStreamEvents: (listener: (event: ChatStreamEvent) => void) => number
  unsubscribeChatStreamEvents: (listenerId: number) => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
