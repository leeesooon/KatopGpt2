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
  fetchWebPage: (url: string) => Promise<FetchedWebPage>
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
