/** Single model configuration within a provider */
export interface ModelConfig {
  name: string
  multimodal: boolean
  capabilities?: {
    chat?: boolean
    vision?: boolean
    imageGeneration?: boolean
  }
}

export type ChatInputMode = 'chat' | 'image'

export type ImageGenerationSize = '1024x1024' | '1024x1536' | '1536x1024'

export type ImageGenerationQuality = 'auto' | 'low' | 'medium' | 'high'

export interface ImageGenerationSettings {
  providerId?: string
  model?: string
  size: ImageGenerationSize
  quality: ImageGenerationQuality
  count: 1
}

/** Image attached to a message */
export interface ImageAttachment {
  id: string
  /** Full data URL, e.g. "data:image/png;base64,..." */
  base64: string
  name: string
}

export interface SpreadsheetColumnSchema {
  name: string
  inferredType: 'string' | 'number' | 'boolean' | 'date' | 'mixed' | 'empty'
}

export interface SpreadsheetSheetSchema {
  name: string
  rowCount: number
  columnCount: number
  columns: SpreadsheetColumnSchema[]
}

export interface SpreadsheetWorkbookSchema {
  sheets: SpreadsheetSheetSchema[]
}

/** File attached to a message */
export interface FileAttachment {
  id: string
  name: string
  size: number
  /** Text content of the file */
  content: string
  fileType?: 'text' | 'pdf' | 'pptx' | 'docx' | 'xlsx' | 'csv'
  spreadsheetSessionId?: string
  spreadsheetSchema?: SpreadsheetWorkbookSchema
}

export type DocumentAgentMode = 'chat' | 'create' | 'rewrite' | 'expand' | 'summarize'

export type DocumentEditorMode = 'write' | 'preview' | 'split'

export interface DocumentSelection {
  start: number
  end: number
  text: string
}

export interface WorkspaceHandle {
  id: string
  name: string
  rootPath: string
}

export interface WorkspaceDocument {
  relativePath: string
  title: string
  content: string
  isDirty: boolean
  lastLoadedAt: number
  lastSavedAt?: number
}

/** Web search result from search API */
export interface SearchResult {
  title: string
  url: string
  snippet: string
  date?: string
}

/** Search state for a conversation */
export interface SearchState {
  /** Search results for current query */
  results: SearchResult[]
  /** Whether search is in progress */
  isSearching: boolean
  /** Search error message if failed */
  error: string | null
}

/** Supported search engines */
export type SearchEngine = 'serper' | 'tavily' 

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: ImageAttachment[]
  files?: FileAttachment[]
  metadata?: {
    kind?: 'chat' | 'image_generation'
    revisedPrompt?: string
  }
  /** Search results attached to this message (for assistant responses) */
  searchResults?: SearchResult[]
  timestamp: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

/** A single API provider (e.g. OpenAI, DeepSeek, 通义千问) */
export interface ApiProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: ModelConfig[]
}

/** Runtime resolved config passed to API calls */
export interface ApiConfig {
  baseUrl: string
  apiKey: string
  model: string
  multimodal: boolean
}

/** Currently selected provider + model */
export interface ModelSelection {
  providerId: string
  model: string
}

export interface AppSettings {
  providers: ApiProvider[]
  activeModel: ModelSelection | null
  systemPrompt: string
  temperature: number
  maxTokens: number
  /** Number of recent messages to send as context (sliding window) */
  contextWindowSize: number
  /** Selected search engine */
  searchEngine: SearchEngine
  /** Serper API key for web search */
  serperApiKey: string
  /** Tavily API key for web search */
  tavilyApiKey: string
  /** Enable web search by default */
  enableSearchByDefault: boolean
  /** Image generation defaults */
  imageGeneration: ImageGenerationSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  providers: [],
  activeModel: null,
  systemPrompt: 'You are a helpful assistant.',
  temperature: 0.7,
  maxTokens: 0,
  contextWindowSize: 20,
  searchEngine: 'tavily',
  serperApiKey: '',
  tavilyApiKey: '',
  enableSearchByDefault: false,
  imageGeneration: {
    size: '1024x1024',
    quality: 'auto',
    count: 1,
  },
}

/** Resolve a ModelSelection into a flat ApiConfig for API calls */
export function resolveApiConfig(
  providers: ApiProvider[],
  selection: ModelSelection | null
): ApiConfig | null {
  if (!selection) return null
  const provider = providers.find((p) => p.id === selection.providerId)
  if (!provider) return null
  const modelConfig = provider.models.find((m) => m.name === selection.model)
  return {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: selection.model,
    multimodal: modelConfig?.multimodal ?? false,
  }
}

export function supportsImageGeneration(model: ModelConfig | undefined) {
  return model?.capabilities?.imageGeneration ?? false
}

export function supportsVision(model: ModelConfig | undefined) {
  return model?.capabilities?.vision ?? model?.multimodal ?? false
}
