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

interface ExtractDocumentTextResult {
  ok: boolean
  content?: string
  error?: string
  fileType?: 'pptx' | 'pdf' | 'docx'
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
  testApiConnection: (config: ApiConnectionConfig) => Promise<ApiConnectionTestResult>
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
