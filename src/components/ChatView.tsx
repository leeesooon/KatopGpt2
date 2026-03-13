import { useRef, useEffect, useCallback, useState } from 'react'
import { MessageSquarePlus, Sparkles, ArrowDown } from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { streamChat, ChatApiError } from '../services/chatApi'
import { recognizeImages } from '../services/ocr'
import { resolveApiConfig } from '../types'
import { webSearch, formatSearchContext, shouldTriggerSearch, SearchApiError } from '../services/searchApi'
import type { ImageAttachment, FileAttachment } from '../types'
import MessageBubble from './MessageBubble'
import InputArea from './InputArea'

export default function ChatView() {
  const {
    conversations,
    activeConversationId,
    settings,
    streamingConvIds,
    searchEnabled,
    createConversation,
    addMessage,
    updateMessage,
    updateConversationTitle,
    setConversationStreaming,
    attachSearchResults,
  } = useChatStore()

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const abortMapRef = useRef<Map<string, AbortController>>(new Map())
  const scrollRafRef = useRef<number>(0)
  const scrollPositionsRef = useRef<Map<string, number>>(new Map())
  const prevConvIdRef = useRef<string | null>(null)
  const isRestoringScrollRef = useRef(false)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  const activeConversation = conversations.find((c) => c.id === activeConversationId)
  const messages = activeConversation?.messages ?? []
  const isCurrentStreaming = activeConversationId ? streamingConvIds.includes(activeConversationId) : false

  const scrollToBottom = useCallback(() => {
    if (scrollRafRef.current || isRestoringScrollRef.current) return
    scrollRafRef.current = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      scrollRafRef.current = 0
    })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages.length, messages[messages.length - 1]?.content, scrollToBottom])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  // Save scroll position continuously + detect scroll-away-from-bottom
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 120)
      if (activeConversationId) {
        scrollPositionsRef.current.set(activeConversationId, scrollTop)
      }
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [activeConversationId])

  // Restore scroll position on conversation switch
  useEffect(() => {
    const prevId = prevConvIdRef.current
    prevConvIdRef.current = activeConversationId ?? null

    if (prevId === activeConversationId) return

    const container = scrollContainerRef.current
    if (!container || !activeConversationId) return

    isRestoringScrollRef.current = true

    requestAnimationFrame(() => {
      const savedPos = scrollPositionsRef.current.get(activeConversationId)
      if (savedPos != null) {
        container.scrollTop = savedPos
      } else {
        messagesEndRef.current?.scrollIntoView()
      }
      requestAnimationFrame(() => {
        isRestoringScrollRef.current = false
      })
    })
  }, [activeConversationId])

  const handleScrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSend = async (content: string, images: ImageAttachment[], files: FileAttachment[]) => {
    const apiConfig = resolveApiConfig(settings.providers, settings.activeModel)
    if (!apiConfig) return

    let convId = activeConversationId
    if (!convId) {
      convId = createConversation()
    }

    // Build message content — file contents are injected at API call time, not stored in message
    let messageContent = content
    const messageFiles: FileAttachment[] | undefined = files.length > 0 ? files : undefined

    // Handle images
    let messageImages: ImageAttachment[] | undefined = undefined

    if (images.length > 0) {
      if (apiConfig.multimodal) {
        messageImages = images
      } else {
        try {
          const ocrText = await recognizeImages(images)
          messageContent = ocrText + (messageContent ? '\n\n' + messageContent : '')
        } catch (err) {
          console.error('OCR failed:', err)
          messageContent = (messageContent ? messageContent + '\n\n' : '') + '[图片 OCR 识别失败]'
        }
        messageImages = images
      }
    }

    // Add user message
    addMessage(convId, {
      role: 'user',
      content: messageContent,
      images: messageImages,
      files: messageFiles,
    })

    // Auto-title on first message
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)
    if (conv && conv.messages.length === 1) {
      const titleSource = content || (files.length > 0 ? files[0].name : '图片对话')
      const title = titleSource.length > 30 ? titleSource.slice(0, 30) + '...' : titleSource
      updateConversationTitle(convId, title)
    }

    // Start streaming
    setConversationStreaming(convId, true)
    const abortController = new AbortController()
    abortMapRef.current.set(convId, abortController)

    // Add empty assistant message

    // Web search if enabled
    let searchResults = []
    let searchContext = ''
    const apiKey = settings.searchEngine === 'tavily' ? settings.tavilyApiKey : settings.serperApiKey
    
    console.group('%c[Search Flow] %cInitializing', 'color:#5c7cfa;font-weight:bold', 'color:#64748b')
    console.log('%cSearch enabled (manual): %c%s', 'color:#8494b2', 'color:#e8ecf4', searchEnabled)
    console.log('%cSearch enabled (auto): %c%s', 'color:#8494b2', 'color:#e8ecf4', settings.enableSearchByDefault)
    console.log('%cSearch engine: %c%s', 'color:#8494b2', 'color:#e8ecf4', settings.searchEngine)
    console.log('%cAPI key configured: %c%s', 'color:#8494b2', 'color:#e8ecf4', apiKey ? 'YES' : 'NO')
    console.log('%cMessage content: %c%s', 'color:#8494b2', 'color:#e8ecf4', messageContent.slice(0, 100))
    console.groupEnd()
    
    if ((searchEnabled || settings.enableSearchByDefault) && apiKey) {
      const shouldSearch = searchEnabled || shouldTriggerSearch(messageContent)
      console.log('%c[Search Flow] %cShould trigger search: %c%s', 'color:#5c7cfa;font-weight:bold', 'color:#64748b', 'color:#e8ecf4', shouldSearch)
      
      if (shouldSearch) {
        try {
          console.log('%c[Search] %cTriggered for query (%s)', 'color:#5c7cfa;font-weight:bold', 'color:#64748b', settings.searchEngine)
          searchResults = await webSearch(messageContent, apiKey, settings.searchEngine, 'zh-CN', 8)
          searchContext = formatSearchContext(searchResults, 4000)
          
          console.group('%c[Search] %c✓ Search completed', 'color:#10b981;font-weight:bold', 'color:#64748b')
          console.log('%cResults count: %c%d', 'color:#8494b2', 'color:#e8ecf4', searchResults.length)
          console.log('%cContext length: %c%d chars', 'color:#8494b2', 'color:#e8ecf4', searchContext.length)
          console.log('%cFirst 3 results:', 'color:#8494b2')
          console.dir(searchResults.slice(0, 3), { depth: null })
          console.groupEnd()
        } catch (err) {
          console.group('%c[Search] %c✗ Search failed', 'color:#ef4444;font-weight:bold', 'color:#64748b')
          console.error(err)
          console.groupEnd()
          
          if (err instanceof SearchApiError) {
            // Non-blocking: continue without search
            console.log('%c[Search] %cContinuing without search results', 'color:#f59e0b;font-weight:bold', 'color:#64748b')
          }
        }
      } else {
        console.log('%c[Search Flow] %cSkipped - trigger conditions not met', 'color:#f59e0b;font-weight:bold', 'color:#64748b')
      }
    } else {
      console.group('%c[Search Flow] %cSkipped - prerequisites not met', 'color:#f59e0b;font-weight:bold', 'color:#64748b')
      if (!apiKey) console.log('%cReason: %cNo API key configured', 'color:#8494b2', 'color:#ef4444')
      if (!searchEnabled && !settings.enableSearchByDefault) console.log('%cReason: %cSearch not enabled', 'color:#8494b2', 'color:#ef4444')
      console.groupEnd()
    }

    const assistantMsg = addMessage(convId, { role: 'assistant', content: '' })
    let fullContent = ''
    let rafPending = false

    try {
      const allMessages = useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)!
        .messages.filter((m) => m.id !== assistantMsg.id)

      // Sliding window: only send the last N messages as context
      const windowSize = settings.contextWindowSize
      const currentMessages = allMessages.length > windowSize
        ? allMessages.slice(-windowSize)
        : allMessages

      console.group('%c[API Call] %cPreparing request', 'color:#5c7cfa;font-weight:bold', 'color:#64748b')
      console.log('%cSearch context length: %c%d chars', 'color:#8494b2', 'color:#e8ecf4', searchContext.length)
      if (searchContext) {
        console.log('%cSearch context preview: %c%s', 'color:#8494b2', 'color:#e8ecf4', searchContext.slice(0, 200) + '...')
      }
      console.groupEnd()
      
      const stream = streamChat(
        apiConfig,
        currentMessages,
        settings.systemPrompt,
        settings.temperature,
        settings.maxTokens,
        abortController.signal,
        searchContext || undefined
      )

      for await (const chunk of stream) {
        fullContent += chunk
        // Throttle state updates to 1 per animation frame
        if (!rafPending) {
          rafPending = true
          const snapshot = fullContent
          requestAnimationFrame(() => {
            updateMessage(convId!, assistantMsg.id, snapshot)
            rafPending = false
          })
        }
      }

      // Final flush — ensure the complete content is written
      updateMessage(convId!, assistantMsg.id, fullContent)
      
      // Attach search results if any
      if (searchResults.length > 0) {
        console.group('%c[Search Results] %cAttaching to message', 'color:#10b981;font-weight:bold', 'color:#64748b')
        console.log('%cMessage ID: %c%s', 'color:#8494b2', 'color:#e8ecf4', assistantMsg.id)
        console.log('%cResults count: %c%d', 'color:#8494b2', 'color:#e8ecf4', searchResults.length)
        console.groupEnd()
        
        attachSearchResults(convId!, assistantMsg.id, searchResults)
      } else {
        console.log('%c[Search Results] %cNo results to attach', 'color:#f59e0b;font-weight:bold', 'color:#64748b')
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (!fullContent) {
          updateMessage(convId!, assistantMsg.id, '*(已停止生成)*')
        }
      } else {
        const errorMsg =
          err instanceof ChatApiError
            ? `⚠️ API 错误: ${err.message}`
            : `⚠️ 请求失败: ${err instanceof Error ? err.message : '未知错误'}`
        updateMessage(convId!, assistantMsg.id, errorMsg)
      }
    } finally {
      setConversationStreaming(convId!, false)
      abortMapRef.current.delete(convId!)
    }
  }

  const handleStop = () => {
    if (!activeConversationId) return
    const controller = abortMapRef.current.get(activeConversationId)
    controller?.abort()
  }

  const apiConfigured = resolveApiConfig(settings.providers, settings.activeModel) !== null

  // Empty state
  if (!activeConversationId) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center animate-fade-in">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary-500/20 to-primary-700/20 border border-primary-500/20 flex items-center justify-center">
              <Sparkles size={28} className="text-primary-400" />
            </div>
            <h2 className="text-xl font-semibold text-surface-200 mb-2">KatopGPT</h2>
            <p className="text-surface-400 text-sm mb-6 max-w-sm">
              {apiConfigured
                ? '开始一段新对话，探索 AI 的无限可能'
                : '请先在设置中配置 API 服务商和模型'}
            </p>
            {apiConfigured && (
              <button onClick={() => createConversation()} className="btn-primary inline-flex items-center gap-2">
                <MessageSquarePlus size={16} />
                开始对话
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto relative" ref={scrollContainerRef}>
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-20 animate-fade-in">
              <Sparkles size={24} className="text-primary-400 mx-auto mb-3" />
              <p className="text-surface-400 text-sm">发送消息开始对话</p>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom button */}
        {showScrollBottom && (
          <button
            onClick={handleScrollToBottom}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10
                       w-9 h-9 flex items-center justify-center
                       bg-surface-800/90 border border-surface-600/50
                       rounded-full shadow-lg backdrop-blur-sm
                       hover:bg-surface-700 transition-all duration-200
                       animate-fade-in active:scale-95 mx-auto"
            title="回到最新"
          >
            <ArrowDown size={16} className="text-surface-300" />
          </button>
        )}
      </div>

      {/* Input */}
      <InputArea
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isCurrentStreaming}
        disabled={!apiConfigured}
      />
    </div>
  )
}
