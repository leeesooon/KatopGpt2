import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Conversation, Message, AppSettings, ApiProvider, ModelSelection, ModelConfig, SearchResult } from '../types'
import { DEFAULT_SETTINGS } from '../types'

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  settings: AppSettings
  isSettingsOpen: boolean
  /** Set of conversation IDs currently streaming */
  streamingConvIds: string[]
  /** Enable web search for current message */
  searchEnabled: boolean
  /** Enable web search for current message */

  // Conversation actions
  createConversation: () => string
  deleteConversation: (id: string) => void
  setActiveConversation: (id: string) => void
  updateConversationTitle: (id: string, title: string) => void

  // Message actions
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>) => Message
  updateMessage: (conversationId: string, messageId: string, content: string) => void
  getActiveMessages: () => Message[]

  // Provider actions
  addProvider: (provider: Omit<ApiProvider, 'id'>) => string
  updateProvider: (id: string, updates: Partial<Omit<ApiProvider, 'id'>>) => void
  deleteProvider: (id: string) => void

  // Model selection
  setActiveModel: (selection: ModelSelection | null) => void

  // Settings actions
  updateSettings: (settings: Partial<Pick<AppSettings, 'systemPrompt' | 'temperature' | 'maxTokens' | 'contextWindowSize' | 'searchEngine' | 'serperApiKey' | 'tavilyApiKey' | 'enableSearchByDefault' | 'imageGeneration'>>) => void
  setSettingsOpen: (open: boolean) => void

  // Streaming — per conversation
  setConversationStreaming: (convId: string, streaming: boolean) => void
  isConversationStreaming: (convId: string) => boolean
  // Search actions
  setSearchEnabled: (enabled: boolean) => void
  attachSearchResults: (conversationId: string, messageId: string, results: SearchResult[]) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      settings: DEFAULT_SETTINGS,
      isSettingsOpen: false,
      streamingConvIds: [],
      searchEnabled: false,

      createConversation: () => {
        const id = uuidv4()
        const conversation: Conversation = {
          id,
          title: '新对话',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeConversationId: id,
        }))
        return id
      },

      deleteConversation: (id) => {
        set((state) => {
          const filtered = state.conversations.filter((c) => c.id !== id)
          const newActiveId =
            state.activeConversationId === id
              ? filtered[0]?.id ?? null
              : state.activeConversationId
          return {
            conversations: filtered,
            activeConversationId: newActiveId,
          }
        })
      },

      setActiveConversation: (id) => {
        set({ activeConversationId: id })
      },

      updateConversationTitle: (id, title) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: Date.now() } : c
          ),
        }))
      },

      addMessage: (conversationId, message) => {
        const newMessage: Message = {
          ...message,
          id: uuidv4(),
          timestamp: Date.now(),
        }
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  messages: [...c.messages, newMessage],
                  updatedAt: Date.now(),
                }
              : c
          ),
        }))
        return newMessage
      },

      updateMessage: (conversationId, messageId, content) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, content } : m
                  ),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }))
      },

      getActiveMessages: () => {
        const state = get()
        const conv = state.conversations.find(
          (c) => c.id === state.activeConversationId
        )
        return conv?.messages ?? []
      },

      // Provider CRUD
      addProvider: (provider) => {
        const id = uuidv4()
        const newProvider: ApiProvider = { ...provider, id }
        set((state) => {
          const newProviders = [...state.settings.providers, newProvider]
          // Auto-select first model if nothing selected
          let activeModel = state.settings.activeModel
          if (!activeModel && newProvider.models.length > 0) {
            activeModel = { providerId: id, model: newProvider.models[0].name }
          }
          return {
            settings: { ...state.settings, providers: newProviders, activeModel },
          }
        })
        return id
      },

      updateProvider: (id, updates) => {
        set((state) => {
          const newProviders = state.settings.providers.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          )
          // Fix activeModel if the selected model was removed
          let activeModel = state.settings.activeModel
          if (activeModel?.providerId === id) {
            const updated = newProviders.find((p) => p.id === id)
            if (updated && !updated.models.some(m => m.name === activeModel!.model)) {
              activeModel = updated.models.length > 0
                ? { providerId: id, model: updated.models[0].name }
                : null
            }
          }
          return {
            settings: { ...state.settings, providers: newProviders, activeModel },
          }
        })
      },

      deleteProvider: (id) => {
        set((state) => {
          const newProviders = state.settings.providers.filter((p) => p.id !== id)
          let activeModel = state.settings.activeModel
          if (activeModel?.providerId === id) {
            // Pick first available model from remaining providers
            const fallback = newProviders.find((p) => p.models.length > 0)
            activeModel = fallback
              ? { providerId: fallback.id, model: fallback.models[0].name }
              : null
          }
          return {
            settings: { ...state.settings, providers: newProviders, activeModel },
          }
        })
      },

      setActiveModel: (selection) => {
        set((state) => ({
          settings: { ...state.settings, activeModel: selection },
        }))
      },

      updateSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }))
      },

      setSettingsOpen: (open) => set({ isSettingsOpen: open }),

      setConversationStreaming: (convId, streaming) =>
        set((state) => ({
          streamingConvIds: streaming
            ? [...state.streamingConvIds, convId]
            : state.streamingConvIds.filter((id) => id !== convId),
        })),

      isConversationStreaming: (convId) => {
        return get().streamingConvIds.includes(convId)
      },

      setSearchEnabled: (enabled) => set({ searchEnabled: enabled }),

      attachSearchResults: (conversationId, messageId, results) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, searchResults: results } : m
                  ),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }))
      },
    }),
    {
      name: 'katop-gpt-storage',
      version: 6,
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        settings: state.settings,
      }),
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>
        if (version === 0) {
          // Migrate from old single-api format to multi-provider format
          const oldSettings = state.settings as Record<string, unknown> | undefined
          if (oldSettings && 'api' in oldSettings && !('providers' in oldSettings)) {
            const oldApi = oldSettings.api as { baseUrl?: string; apiKey?: string; model?: string } | undefined
            const providers: ApiProvider[] = []
            let activeModel: ModelSelection | null = null

            if (oldApi?.baseUrl && oldApi?.apiKey) {
              const id = uuidv4()
              providers.push({
                id,
                name: 'Default',
                baseUrl: oldApi.baseUrl,
                apiKey: oldApi.apiKey,
                models: oldApi.model ? [{ name: oldApi.model, multimodal: false }] : [],
              })
              if (oldApi.model) {
                activeModel = { providerId: id, model: oldApi.model }
              }
            }

            state.settings = {
              providers,
              activeModel,
              systemPrompt: (oldSettings.systemPrompt as string) ?? DEFAULT_SETTINGS.systemPrompt,
              temperature: (oldSettings.temperature as number) ?? DEFAULT_SETTINGS.temperature,
              maxTokens: (oldSettings.maxTokens as number) ?? DEFAULT_SETTINGS.maxTokens,
            }
          }
          // Also ensure settings has all required fields even if empty
          if (oldSettings && !('providers' in oldSettings)) {
            state.settings = { ...DEFAULT_SETTINGS, ...oldSettings, providers: [], activeModel: null }
          }
        }
        if (version <= 1) {
          // Migrate models from string[] to ModelConfig[]
          const settings = state.settings as AppSettings | undefined
          if (settings?.providers) {
            settings.providers = settings.providers.map((p: ApiProvider) => ({
              ...p,
              models: p.models.map((m: unknown) =>
                typeof m === 'string' ? { name: m, multimodal: false } : m
              ) as ModelConfig[],
            }))
          }
        }
        if (version <= 2) {
          // Add contextWindowSize with default value
          const settings = state.settings as Record<string, unknown> | undefined
          if (settings && settings.contextWindowSize == null) {
            settings.contextWindowSize = DEFAULT_SETTINGS.contextWindowSize
          }
        }
        if (version <= 3) {
          // maxTokens default 4096 → 0 (0 = don't send, let API decide)
          const settings = state.settings as Record<string, unknown> | undefined
          if (settings && settings.maxTokens === 4096) {
            settings.maxTokens = 0
          }
        }
        if (version <= 4) {
          // Add search settings with defaults
          const settings = state.settings as Record<string, unknown> | undefined
          if (settings) {
            if (settings.searchEngine == null) {
              settings.searchEngine = 'tavily'
            }
            if (settings.serperApiKey == null) {
              settings.serperApiKey = ''
            }
            if (settings.tavilyApiKey == null) {
              settings.tavilyApiKey = ''
            }
            if (settings.enableSearchByDefault == null) {
              settings.enableSearchByDefault = false
            }
          }
        }
        if (version <= 5) {
          const settings = state.settings as AppSettings | undefined
          if (settings) {
            settings.imageGeneration = {
              ...DEFAULT_SETTINGS.imageGeneration,
              ...settings.imageGeneration,
              count: 1,
            }
            if (settings.providers) {
              settings.providers = settings.providers.map((provider) => ({
                ...provider,
                models: provider.models.map((model) => {
                  if (typeof model === 'string') {
                    return { name: model, multimodal: false }
                  }
                  return {
                    ...model,
                    capabilities: {
                      chat: true,
                      vision: model.capabilities?.vision ?? model.multimodal ?? false,
                      imageGeneration: model.capabilities?.imageGeneration ?? false,
                      ...model.capabilities,
                    },
                  }
                }) as ModelConfig[],
              }))
            }
          }
        }
        return state as unknown as ChatState
      },
    }
  )
)
