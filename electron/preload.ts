import { contextBridge, ipcRenderer } from 'electron'

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

const chatStreamListeners = new Map<number, (event: ChatStreamEvent) => void>()
let nextChatStreamListenerId = 1

ipcRenderer.on('api:chatStreamEvent', (_event, payload: ChatStreamEvent) => {
  for (const listener of chatStreamListeners.values()) {
    try {
      listener(payload)
    } catch (error) {
      console.error('Chat stream listener failed:', error)
    }
  }
})

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  fetchWebPage: (url: string) => ipcRenderer.invoke('web:fetchPage', url),
  extractDocumentText: (request: ExtractDocumentTextRequest) => ipcRenderer.invoke('files:extractDocumentText', request),
  testApiConnection: (config: ApiConnectionConfig) => ipcRenderer.invoke('api:testConnection', config),
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
