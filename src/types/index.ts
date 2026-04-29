import type { SpreadsheetPlanStep, SpreadsheetWorkbookSchema } from '../../electron/shared/spreadsheetPlan'

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
  plannerProviderId?: string
  plannerModel?: string
  size: ImageGenerationSize
  quality: ImageGenerationQuality
  count: 1
}

export interface KnowledgeChunk {
  id: string
  documentId: string
  documentName: string
  content: string
  index: number
}

export interface KnowledgeDocument {
  id: string
  name: string
  fileType?: FileAttachment['fileType']
  size: number
  content: string
  chunks: KnowledgeChunk[]
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface AssistantProfile {
  id: string
  name: string
  description: string
  emoji: string
  avatarId?: string
  instructions: string
  tone: string
  outputFormat: string
  domainHints: string
  isBuiltIn?: boolean
  isDefault?: boolean
  isHidden?: boolean
  knowledgeDocuments: KnowledgeDocument[]
  createdAt: number
  updatedAt: number
}

/** Image attached to a message */
export interface ImageAttachment {
  id: string
  /** Full data URL, e.g. "data:image/png;base64,..." */
  base64?: string
  url?: string
  filePath?: string
  name: string
  isGenerating?: boolean
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
  originalContentLength?: number
  isTruncated?: boolean
  previewContent?: string
  contextContent?: string
  validationWarning?: string
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
  revision?: number
  lastSavedRevision?: number
  isPendingNaming?: boolean
  pendingInitialContent?: string
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
    originalPrompt?: string
    enhancedPrompt?: string
    providerId?: string
    model?: string
    size?: ImageGenerationSize
    quality?: ImageGenerationQuality
    seriesId?: string
    seriesMode?: 'template_parallel' | 'sequential'
    seriesChapters?: Array<{
      index: number
      title: string
      prompt: string
      enhancedPrompt?: string
      status: 'pending' | 'generating' | 'completed' | 'stopped' | 'error'
      revisedPrompt?: string
      imageName?: string
    }>
  }
  /** Search results attached to this message (for assistant responses) */
  searchResults?: SearchResult[]
  timestamp: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  assistantProfileId?: string
  summary?: ConversationSummary
  createdAt: number
  updatedAt: number
}

export interface ConversationSummary {
  content: string
  coveredMessageId: string
  coveredMessageCount: number
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
  assistantProfiles: AssistantProfile[]
  activeAssistantProfileId: string | null
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
  assistantProfiles: [],
  activeAssistantProfileId: null,
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

export type { SpreadsheetPlanStep, SpreadsheetWorkbookSchema }
