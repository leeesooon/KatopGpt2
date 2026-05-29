import type { SpreadsheetPlanStep, SpreadsheetWorkbookSchema } from '../../electron/shared/spreadsheetPlan'
import type {
  PresentationCodeArtifact,
  PresentationCodeAsset,
  PresentationCodeDiagnostic,
  PresentationCodeExportRequest,
  PresentationCodeExportResult,
  PresentationCodeRequest,
  PresentationCodeRunRequest,
  PresentationCodeRunResult,
  PresentationDeckSpec,
  PresentationExportRequest,
  PresentationExportResult,
  PresentationInstallRenderToolsResult,
  PresentationPreviewRequest,
  PresentationPreviewResult,
  PresentationPreviewSlide,
  PresentationQaIssue,
  PresentationRenderToolsStatus,
  PresentationSlideLayout,
  PresentationSlideSpec,
  PresentationSlideVariant,
  PresentationSvgVisualType,
  PresentationThemeId,
} from '../../electron/shared/presentation'

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

export interface ImagePromptPresetItem {
  id: string
  label: string
  text: string
}

export interface ImagePromptPresetGroup {
  id: string
  name: string
  items: ImagePromptPresetItem[]
}

export interface ImagePromptPresetModule {
  id: string
  name: string
  description?: string
  groups: ImagePromptPresetGroup[]
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
  defaultModel?: ModelSelection | null
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

export type DocumentAgentMode = 'chat' | 'create' | 'rewrite' | 'expand'

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

export type AssistantWorkPhase =
  | 'checking_pages'
  | 'reading_pages'
  | 'planning_search'
  | 'searching'
  | 'organizing'
  | 'answering'

export interface AssistantWorkState {
  phase: AssistantWorkPhase
  label: string
  detail?: string
  engine?: SearchEngine
  sourceCount?: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  assistantProfileId?: string
  modelSelection?: ModelSelection | null
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

interface ResolvedModelSelection {
  selection: ModelSelection
  provider: ApiProvider
  modelConfig: ModelConfig
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
  /** Prompt enhancement modules for image mode */
  imagePromptModules: ImagePromptPresetModule[]
}

export const DEFAULT_IMAGE_PROMPT_MODULES: ImagePromptPresetModule[] = [
  {
    id: 'general',
    name: '通用创作',
    description: '风格、构图和画面质量通用控制',
    groups: [
      { id: 'general-style', name: '风格', items: ['电影感', '赛博朋克', '水彩插画', '极简海报', '写实摄影', '3D 渲染'].map((label) => ({ id: `general-style-${label}`, label, text: label })) },
      { id: 'general-ratio', name: '比例', items: ['1:1 方图', '16:9 横幅', '9:16 竖版', '4:3 构图', '3:2 摄影比例'].map((label) => ({ id: `general-ratio-${label}`, label, text: label })) },
      { id: 'general-lighting', name: '光照', items: ['柔和自然光', '黄昏逆光', '霓虹灯光', '棚拍布光', '高对比明暗'].map((label) => ({ id: `general-lighting-${label}`, label, text: label })) },
      { id: 'general-lens', name: '镜头', items: ['广角镜头', '长焦压缩', '微距特写', '低角度仰拍', '俯视视角'].map((label) => ({ id: `general-lens-${label}`, label, text: label })) },
      { id: 'general-material', name: '材质', items: ['玻璃质感', '金属材质', '纸张纹理', '丝绸质感', '磨砂塑料'].map((label) => ({ id: `general-material-${label}`, label, text: label })) },
      { id: 'general-composition', name: '构图', items: ['中心构图', '三分法构图', '留白构图', '对称构图', '动态斜线构图'].map((label) => ({ id: `general-composition-${label}`, label, text: label })) },
    ],
  },
  {
    id: 'ppt',
    name: 'PPT',
    description: '适合演示文稿封面、章节页和汇报视觉',
    groups: [
      { id: 'ppt-layout', name: '版式', items: ['PPT 封面主视觉', '章节页背景', '16:9 横版构图', '左侧标题留白', '右侧视觉焦点'].map((label) => ({ id: `ppt-layout-${label}`, label, text: label })) },
      { id: 'ppt-business', name: '商务', items: ['商务风', '科技企业风', '数据汇报氛围', '蓝白专业配色', '高级灰背景'].map((label) => ({ id: `ppt-business-${label}`, label, text: label })) },
      { id: 'ppt-detail', name: '细节', items: ['清晰标题区', '低干扰背景', '适合叠加文字', '简洁信息层级', '无多余装饰'].map((label) => ({ id: `ppt-detail-${label}`, label, text: label })) },
    ],
  },
  {
    id: 'photo-edit',
    name: 'P图',
    description: '适合基于参考图修改、修复和合成',
    groups: [
      { id: 'photo-edit-subject', name: '主体', items: ['保留主体', '保持五官不变', '保持产品结构不变', '保持原始姿态', '细节自然真实'].map((label) => ({ id: `photo-edit-subject-${label}`, label, text: label })) },
      { id: 'photo-edit-scene', name: '场景', items: ['替换背景', '去除杂物', '统一光影', '自然融合边缘', '真实透视关系'].map((label) => ({ id: `photo-edit-scene-${label}`, label, text: label })) },
      { id: 'photo-edit-quality', name: '质感', items: ['增强清晰度', '修复瑕疵', '保留皮肤纹理', '色彩更干净', '不改变原图风格'].map((label) => ({ id: `photo-edit-quality-${label}`, label, text: label })) },
    ],
  },
  {
    id: 'poster',
    name: '海报',
    description: '适合活动、品牌和促销主视觉',
    groups: [
      { id: 'poster-scene', name: '场景', items: ['活动主视觉', '品牌海报', '促销氛围', '节日营销', '新品发布'].map((label) => ({ id: `poster-scene-${label}`, label, text: label })) },
      { id: 'poster-layout', name: '版式', items: ['强对比标题区', '中文排版留白', '竖版构图', '中心视觉冲击', '上方大标题空间'].map((label) => ({ id: `poster-layout-${label}`, label, text: label })) },
      { id: 'poster-style', name: '表现', items: ['高饱和视觉', '高级品牌感', '摄影级产品图', '动感光效', '清晰商业合成'].map((label) => ({ id: `poster-style-${label}`, label, text: label })) },
    ],
  },
  {
    id: 'web-layout',
    name: '网页布局',
    description: '适合网页首屏、界面概念和布局参考',
    groups: [
      { id: 'web-layout-page', name: '页面', items: ['SaaS 首屏', '后台仪表盘', '移动端界面', '产品落地页', '真实网页截图风格'].map((label) => ({ id: `web-layout-page-${label}`, label, text: label })) },
      { id: 'web-layout-structure', name: '结构', items: ['卡片布局', '清晰组件层级', '顶部导航栏', '数据模块分区', '响应式网格'].map((label) => ({ id: `web-layout-structure-${label}`, label, text: label })) },
      { id: 'web-layout-style', name: '风格', items: ['现代干净界面', '深色仪表盘', '浅色专业界面', '高可读信息密度', '真实 UI 细节'].map((label) => ({ id: `web-layout-style-${label}`, label, text: label })) },
    ],
  },
]

export function cloneImagePromptModules(modules: ImagePromptPresetModule[]) {
  return modules.map((module) => ({
    ...module,
    groups: module.groups.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item })),
    })),
  }))
}

export function createDefaultImagePromptModules() {
  return cloneImagePromptModules(DEFAULT_IMAGE_PROMPT_MODULES)
}

export function normalizeImagePromptModules(modules: ImagePromptPresetModule[] | undefined): ImagePromptPresetModule[] {
  if (!Array.isArray(modules)) {
    return createDefaultImagePromptModules()
  }

  const normalizedModules = modules
    .map((module, moduleIndex) => {
      const name = module.name?.trim()
      if (!name) return null

      const groups = Array.isArray(module.groups)
        ? module.groups
            .map((group, groupIndex) => {
              const groupName = group.name?.trim()
              if (!groupName) return null

              const items = Array.isArray(group.items)
                ? group.items
                    .map((item, itemIndex) => {
                      const label = item.label?.trim()
                      const text = item.text?.trim() || label
                      if (!label || !text) return null
                      return {
                        id: item.id || `${module.id || `module-${moduleIndex}`}-group-${groupIndex}-item-${itemIndex}`,
                        label,
                        text,
                      }
                    })
                    .filter((item): item is ImagePromptPresetItem => item !== null)
                : []

              const normalizedGroup: ImagePromptPresetGroup = {
                id: group.id || `${module.id || `module-${moduleIndex}`}-group-${groupIndex}`,
                name: groupName,
                items,
              }
              return normalizedGroup
            })
            .filter((group): group is ImagePromptPresetGroup => group !== null)
        : []

      const normalizedModule: ImagePromptPresetModule = {
        id: module.id || `module-${moduleIndex}`,
        name,
        groups,
      }
      const description = module.description?.trim()
      if (description) {
        normalizedModule.description = description
      }
      return normalizedModule
    })
    .filter((module): module is ImagePromptPresetModule => module !== null)

  return normalizedModules.length > 0 ? normalizedModules : createDefaultImagePromptModules()
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
  imagePromptModules: createDefaultImagePromptModules(),
}

/** Resolve a ModelSelection into a flat ApiConfig for API calls */
function findResolvedModelSelection(
  providers: ApiProvider[],
  selection: ModelSelection | null | undefined,
  predicate?: (model: ModelConfig) => boolean
): ResolvedModelSelection | null {
  if (!selection) return null
  const provider = providers.find((p) => p.id === selection.providerId)
  if (!provider) return null
  const modelConfig = provider.models.find((m) => m.name === selection.model)
  if (!modelConfig) return null
  if (predicate && !predicate(modelConfig)) return null

  return {
    selection: {
      providerId: provider.id,
      model: modelConfig.name,
    },
    provider,
    modelConfig,
  }
}

export function normalizeModelSelection(
  providers: ApiProvider[],
  selection: ModelSelection | null | undefined
): ModelSelection | null {
  return findResolvedModelSelection(providers, selection)?.selection ?? null
}

export function normalizeChatModelSelection(
  providers: ApiProvider[],
  selection: ModelSelection | null | undefined
): ModelSelection | null {
  return findResolvedModelSelection(providers, selection, supportsGeneralChat)?.selection ?? null
}

export function normalizeImageGenerationModelSelection(
  providers: ApiProvider[],
  selection: ModelSelection | null | undefined
): ModelSelection | null {
  return findResolvedModelSelection(providers, selection, supportsImageGeneration)?.selection ?? null
}

export function findFirstChatModelSelection(providers: ApiProvider[]): ModelSelection | null {
  for (const provider of providers) {
    const model = provider.models.find((item) => supportsGeneralChat(item))
    if (model) {
      return { providerId: provider.id, model: model.name }
    }
  }
  return null
}

export function findFirstImageGenerationModelSelection(providers: ApiProvider[]): ModelSelection | null {
  for (const provider of providers) {
    const model = provider.models.find((item) => supportsImageGeneration(item))
    if (model) {
      return { providerId: provider.id, model: model.name }
    }
  }
  return null
}

export function resolveDefaultConversationModelSelection(
  settings: AppSettings,
  assistantProfileId?: string | null
): ModelSelection | null {
  const visibleProfiles = settings.assistantProfiles.filter((profile) => !profile.isHidden)
  const profile = visibleProfiles.find((item) => item.id === assistantProfileId)
    ?? visibleProfiles.find((item) => item.id === settings.activeAssistantProfileId)
    ?? visibleProfiles.find((item) => item.isDefault)
    ?? visibleProfiles[0]

  return normalizeChatModelSelection(settings.providers, profile?.defaultModel)
    ?? normalizeChatModelSelection(settings.providers, settings.activeModel)
    ?? findFirstChatModelSelection(settings.providers)
}

export function resolveConversationModelSelection(
  settings: AppSettings,
  conversation?: Pick<Conversation, 'assistantProfileId' | 'modelSelection'> | null
): ModelSelection | null {
  return normalizeChatModelSelection(settings.providers, conversation?.modelSelection)
    ?? resolveDefaultConversationModelSelection(settings, conversation?.assistantProfileId)
}

export function resolveImageGenerationModelSelection(settings: AppSettings): ModelSelection | null {
  const imageSettings = settings.imageGeneration
  const explicitSelection = imageSettings.providerId && imageSettings.model
    ? { providerId: imageSettings.providerId, model: imageSettings.model }
    : null

  return normalizeImageGenerationModelSelection(settings.providers, explicitSelection)
    ?? findFirstImageGenerationModelSelection(settings.providers)
}

export function normalizeImageGenerationSettings(
  imageGeneration: ImageGenerationSettings | undefined,
  providers: ApiProvider[]
): ImageGenerationSettings {
  const baseSettings = {
    ...DEFAULT_SETTINGS.imageGeneration,
    ...imageGeneration,
    count: 1 as const,
  }
  const selection = resolveImageGenerationModelSelection({
    ...DEFAULT_SETTINGS,
    providers,
    imageGeneration: baseSettings,
  })
  const plannerSelection = baseSettings.plannerProviderId && baseSettings.plannerModel
    ? normalizeChatModelSelection(providers, {
        providerId: baseSettings.plannerProviderId,
        model: baseSettings.plannerModel,
      })
    : null

  return {
    ...baseSettings,
    providerId: selection?.providerId,
    model: selection?.model,
    plannerProviderId: plannerSelection?.providerId,
    plannerModel: plannerSelection?.model,
  }
}

export function resolveApiConfig(
  providers: ApiProvider[],
  selection: ModelSelection | null
): ApiConfig | null {
  const resolved = findResolvedModelSelection(providers, selection)
  if (!resolved) return null

  return {
    baseUrl: resolved.provider.baseUrl,
    apiKey: resolved.provider.apiKey,
    model: resolved.selection.model,
    multimodal: resolved.modelConfig.multimodal,
  }
}

export function resolveConversationApiConfig(
  settings: AppSettings,
  conversation?: Pick<Conversation, 'assistantProfileId' | 'modelSelection'> | null
): ApiConfig | null {
  return resolveApiConfig(
    settings.providers,
    resolveConversationModelSelection(settings, conversation)
  )
}

export function supportsImageGeneration(model: ModelConfig | undefined) {
  return model?.capabilities?.imageGeneration ?? false
}

export function supportsChat(model: ModelConfig | undefined) {
  return model?.capabilities?.chat ?? true
}

export function supportsGeneralChat(model: ModelConfig | undefined) {
  return supportsChat(model) && !supportsImageGeneration(model)
}

export function supportsVision(model: ModelConfig | undefined) {
  return model?.capabilities?.vision ?? model?.multimodal ?? false
}

export type { SpreadsheetPlanStep, SpreadsheetWorkbookSchema }
export type {
  PresentationCodeArtifact,
  PresentationCodeAsset,
  PresentationCodeDiagnostic,
  PresentationCodeExportRequest,
  PresentationCodeExportResult,
  PresentationCodeRequest,
  PresentationCodeRunRequest,
  PresentationCodeRunResult,
  PresentationDeckSpec,
  PresentationExportRequest,
  PresentationExportResult,
  PresentationInstallRenderToolsResult,
  PresentationPreviewRequest,
  PresentationPreviewResult,
  PresentationPreviewSlide,
  PresentationQaIssue,
  PresentationRenderToolsStatus,
  PresentationSlideLayout,
  PresentationSlideSpec,
  PresentationSlideVariant,
  PresentationSvgVisualType,
  PresentationThemeId,
}
