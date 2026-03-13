/** Single model configuration within a provider */
export interface ModelConfig {
  name: string
  multimodal: boolean
}

/** Image attached to a message */
export interface ImageAttachment {
  id: string
  /** Full data URL, e.g. "data:image/png;base64,..." */
  base64: string
  name: string
}

/** File attached to a message */
export interface FileAttachment {
  id: string
  name: string
  size: number
  /** Text content of the file */
  content: string
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
