import { useRef, useEffect, useCallback, useState } from 'react'
import { MessageSquarePlus, Sparkles, ArrowDown } from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { streamChat, parseSpreadsheetIntent, ChatApiError } from '../services/chatApi'
import type { SpreadsheetExecutionPlan } from '../services/chatApi'
import { recognizeImages } from '../services/ocr'
import { resolveApiConfig } from '../types'
import { prepareDocumentAgentRequest } from '../services/agentOrchestrator'
import { webSearch, formatSearchContext, shouldTriggerSearch, SearchApiError } from '../services/searchApi'
import { readWebPagesFromText, formatWebPageContext } from '../services/webpage'
import type { ImageAttachment, FileAttachment, SearchResult } from '../types'
import MessageBubble from './MessageBubble'
import InputArea from './InputArea'

interface ContextStats {
  messageCount: number
  messageChars: number
}

const MAX_CONTEXT_COUNTED_FILE_CHARS = 12000

function findLatestSpreadsheetAttachment(messages: Array<{ files?: FileAttachment[] }>, currentFiles: FileAttachment[]) {
  const currentMatch = currentFiles.find(
    (file) => (file.fileType === 'xlsx' || file.fileType === 'csv') && file.spreadsheetSessionId
  )
  if (currentMatch) return currentMatch

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const files = messages[index].files ?? []
    const matchedFile = files.find(
      (file) => (file.fileType === 'xlsx' || file.fileType === 'csv') && file.spreadsheetSessionId
    )
    if (matchedFile) {
      return matchedFile
    }
  }

  return null
}

function shouldExecuteSpreadsheetInstruction(content: string) {
  const trimmed = content.trim()
  if (!trimmed) return false

  return /(生成.*(?:sheet|工作表|图表|柱状图|折线图|饼图|条形图)|新\s*(?:sheet|工作表)|汇总|合计|求和|平均|均值|计数|条数|个数|数量|人数|多少人|有多少|分组|统计|柱状图|折线图|饼图|条形图|图表)/i.test(trimmed)
    && /(excel|xlsx|csv|表格|工作表|sheet|按|列|图表|画图|统计图|可视化)/i.test(trimmed)
}

function shouldExportSpreadsheetSession(content: string) {
  const trimmed = content.trim()
  if (!trimmed) return false

  return /(导出|另存为|保存为|导出为)/i.test(trimmed)
    && /(excel|xlsx|表格|工作表|sheet|文件)/i.test(trimmed)
}

function buildSpreadsheetRecentContext(messages: Array<{ role: string; content: string }>) {
  return messages
    .slice(-6)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}: ${message.content}`)
    .join('\n\n')
}

function summarizeSpreadsheetPlan(plan: SpreadsheetExecutionPlan) {
  if (plan.intent === 'export') return '导出当前表格结果'
  if (plan.intent === 'chart') {
    return `基于${plan.useLastCreatedSheet ? '最近结果表' : '指定工作表'}生成${plan.chartType ?? 'bar'}图表`
  }
  if (plan.intent === 'filter_rows') {
    const filterText = plan.filters?.length
      ? plan.filters.map((filter) => `${filter.column}${filter.operator}${filter.value}`).join('，')
      : '无筛选条件'
    const selectText = plan.selectColumns?.length ? `，保留列 ${plan.selectColumns.join(' + ')}` : ''
    const sortText = plan.sortBy ? `，按 ${plan.sortBy} ${plan.sortDirection === 'asc' ? '升序' : '降序'}` : ''
    const topNText = plan.topN ? `，取前 ${plan.topN} 行` : ''
    return `筛选明细：${filterText}${selectText}${sortText}${topNText}`
  }
  if (plan.intent === 'script') {
    return plan.script?.summary ? `执行脚本计划：${plan.script.summary}` : '执行脚本计划'
  }

  const metricLabel = plan.intent === 'count'
    ? '计数'
    : plan.intent === 'sum'
      ? `汇总 ${plan.valueColumn ?? '数值列'}`
      : `统计 ${plan.valueColumn ?? '数值列'} 平均值`
  const groups = plan.groupByColumns?.join(' + ') || '未指定分组'
  const filterText = plan.filters?.length
    ? `，筛选 ${plan.filters.map((filter) => `${filter.column}${filter.operator}${filter.value}`).join('，')}`
    : ''
  const topNText = plan.topN ? `，取前 ${plan.topN} 项` : ''
  return `按 ${groups} ${metricLabel}${filterText}${topNText}`
}

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
  const shouldAutoStickRef = useRef(true)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [streamingDrafts, setStreamingDrafts] = useState<Record<string, string>>({})
  const [isExportingSpreadsheet, setIsExportingSpreadsheet] = useState(false)

  const activeConversation = conversations.find((c) => c.id === activeConversationId)
  const messages = activeConversation?.messages ?? []
  const renderedMessages = messages.map((message) => {
    const draftContent = streamingDrafts[message.id]
    return draftContent == null ? message : { ...message, content: draftContent }
  })
  const isCurrentStreaming = activeConversationId ? streamingConvIds.includes(activeConversationId) : false
  const workspaceTaskState = useWorkspaceStore((state) => state.taskState)
  const workspaceDocument = useWorkspaceStore((state) => {
    if (!state.activeDocumentPath) return null
    return state.documents[state.activeDocumentPath] ?? null
  })

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (scrollRafRef.current || isRestoringScrollRef.current) return
    scrollRafRef.current = requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      if (container) {
        if (behavior === 'smooth') {
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
        } else {
          container.scrollTop = container.scrollHeight
        }
      }
      scrollRafRef.current = 0
    })
  }, [])

  useEffect(() => {
    if (shouldAutoStickRef.current) {
      scrollToBottom('auto')
    }
  }, [renderedMessages.length, renderedMessages[renderedMessages.length - 1]?.content, scrollToBottom])

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
      const awayFromBottom = scrollHeight - scrollTop - clientHeight > 120
      shouldAutoStickRef.current = !awayFromBottom
      setShowScrollBottom(awayFromBottom)
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
    shouldAutoStickRef.current = true
    scrollToBottom('smooth')
  }

  const contextStats: ContextStats = messages.reduce(
    (stats, message) => {
      const imageChars = message.images?.length ? message.images.length * 120 : 0
      const fileChars = message.files?.reduce(
        (total, file) => total + Math.min(file.content.length, MAX_CONTEXT_COUNTED_FILE_CHARS),
        0
      ) ?? 0
      return {
        messageCount: stats.messageCount + 1,
        messageChars: stats.messageChars + message.content.length + imageChars + fileChars,
      }
    },
    { messageCount: 0, messageChars: 0 }
  )
  const latestSpreadsheet = findLatestSpreadsheetAttachment(messages, [])

  const handleExportSpreadsheet = useCallback(async () => {
    if (!latestSpreadsheet?.spreadsheetSessionId || !window.electronAPI?.exportSpreadsheetSession || isExportingSpreadsheet) {
      return
    }

    setIsExportingSpreadsheet(true)
    try {
      const exportResult = await window.electronAPI.exportSpreadsheetSession(latestSpreadsheet.spreadsheetSessionId)
      const convId = activeConversationId ?? createConversation()
      addMessage(convId, {
        role: 'assistant',
        content: exportResult.message,
      })
    } finally {
      setIsExportingSpreadsheet(false)
    }
  }, [activeConversationId, addMessage, createConversation, isExportingSpreadsheet, latestSpreadsheet])

  const handleSend = async (content: string, images: ImageAttachment[], files: FileAttachment[]) => {
    const apiConfig = resolveApiConfig(settings.providers, settings.activeModel)
    if (!apiConfig) return

    const workspaceState = useWorkspaceStore.getState()
    const documentRequest = prepareDocumentAgentRequest({
      mode: workspaceState.pendingAction,
      userPrompt: content,
      document: workspaceState.activeDocumentPath
        ? workspaceState.documents[workspaceState.activeDocumentPath] ?? null
        : null,
      selection: workspaceState.selection,
    })
    const isDocumentAction = workspaceState.pendingAction !== 'chat'

    let convId = activeConversationId
    if (!convId) {
      convId = createConversation()
    }

    const previousMessages = useChatStore.getState().conversations.find((c) => c.id === convId)?.messages ?? []

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
        } catch {
          messageContent = (messageContent ? messageContent + '\n\n' : '') + '[图片 OCR 识别失败]'
        }
        messageImages = images
      }
    }

    // Add user message
    const userMessage = addMessage(convId, {
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

    const latestSpreadsheet = findLatestSpreadsheetAttachment(previousMessages, files)
    if (
      latestSpreadsheet?.spreadsheetSessionId
      && shouldExportSpreadsheetSession(content)
      && window.electronAPI?.exportSpreadsheetSession
    ) {
      const exportResult = await window.electronAPI.exportSpreadsheetSession(latestSpreadsheet.spreadsheetSessionId)
      addMessage(convId, {
        role: 'assistant',
        content: exportResult.message,
      })
      return
    }

    if (
      latestSpreadsheet?.spreadsheetSessionId
      && window.electronAPI?.executeSpreadsheetInstruction
    ) {
      try {
        const recentContext = buildSpreadsheetRecentContext(previousMessages)
        const intentResult = await parseSpreadsheetIntent(
          apiConfig,
          content,
          latestSpreadsheet.content,
          latestSpreadsheet.spreadsheetSchema,
          recentContext
        )

        if (intentResult?.shouldExecute) {
          if (intentResult.plan && window.electronAPI?.executeSpreadsheetPlan) {
            if (intentResult.plan.intent === 'export' && window.electronAPI?.exportSpreadsheetSession) {
              const exportResult = await window.electronAPI.exportSpreadsheetSession(latestSpreadsheet.spreadsheetSessionId)
              addMessage(convId, {
                role: 'assistant',
                content: exportResult.message,
              })
              return
            }

            const plannedResult = await window.electronAPI.executeSpreadsheetPlan({
              sessionId: latestSpreadsheet.spreadsheetSessionId,
              plan: intentResult.plan,
            })

            addMessage(convId, {
              role: 'assistant',
              content: `已理解为：${summarizeSpreadsheetPlan(intentResult.plan)}\n\n${plannedResult.message}`,
            })
            return
          }

          if (!intentResult.normalizedInstruction) {
            return
          }

          const spreadsheetResult = await window.electronAPI.executeSpreadsheetInstruction({
            sessionId: latestSpreadsheet.spreadsheetSessionId,
            instruction: intentResult.normalizedInstruction,
          })

          addMessage(convId, {
            role: 'assistant',
            content: spreadsheetResult.message,
          })
          return
        }
        if (shouldExecuteSpreadsheetInstruction(content)) {
          addMessage(convId, {
            role: 'assistant',
            content: '表格助手没有成功解析这条请求，所以没有走本地执行链路。请换一种更明确的说法，或重试一次。',
          })
          return
        }
      } catch {
        if (shouldExecuteSpreadsheetInstruction(content)) {
          addMessage(convId, {
            role: 'assistant',
            content: '表格助手在规划这条请求时失败了，所以没有执行统计。请重试一次；如果还不行，我建议把需求拆得更具体一些，比如“按部门计数，并生成柱状图”。',
          })
          return
        }
      }
    }

    if (
      latestSpreadsheet?.spreadsheetSessionId
      && shouldExecuteSpreadsheetInstruction(content)
      && window.electronAPI?.executeSpreadsheetInstruction
    ) {
      const spreadsheetResult = await window.electronAPI.executeSpreadsheetInstruction({
        sessionId: latestSpreadsheet.spreadsheetSessionId,
        instruction: content,
      })

      addMessage(convId, {
        role: 'assistant',
        content: spreadsheetResult.message,
      })
      return
    }

    // Start streaming
    setConversationStreaming(convId, true)
    const abortController = new AbortController()
    abortMapRef.current.set(convId, abortController)

    // Add empty assistant message

    // Web references and search
    let referenceSources: SearchResult[] = []
    const referenceSections: string[] = []
    const apiKey = settings.searchEngine === 'tavily' ? settings.tavilyApiKey : settings.serperApiKey

    const webPages = await readWebPagesFromText(messageContent)
    if (webPages.sources.length > 0) {
      const startIndex = referenceSources.length + 1
      referenceSections.push(`以下是用户提供网页的提取内容：\n\n${formatWebPageContext(webPages.sources, 5000, startIndex)}`)
      referenceSources = [...referenceSources, ...webPages.sources]
    }

    if ((searchEnabled || settings.enableSearchByDefault) && apiKey) {
      const shouldSearch = searchEnabled || shouldTriggerSearch(messageContent)

      if (shouldSearch) {
        try {
          const searchResults = await webSearch(messageContent, apiKey, settings.searchEngine, 'zh-CN', 8)
          const startIndex = referenceSources.length + 1
          const searchContext = formatSearchContext(searchResults, 4000, startIndex)
          if (searchContext) {
            referenceSections.push(`以下是网络搜索结果：\n\n${searchContext}`)
            referenceSources = [...referenceSources, ...searchResults]
          }
        } catch (err) {
          if (err instanceof SearchApiError) {
            // Non-blocking: continue without search
          }
        }
      }
    }

    const assistantMsg = addMessage(convId, { role: 'assistant', content: '' })
    setStreamingDrafts((state) => ({ ...state, [assistantMsg.id]: '' }))
    let fullContent = ''
    let rafPending = false
    let pendingFrame = 0

    if (isDocumentAction) {
      workspaceState.startTask(documentRequest.title)
    }

    const cancelPendingMessageUpdate = () => {
      if (pendingFrame) {
        cancelAnimationFrame(pendingFrame)
        pendingFrame = 0
      }
      rafPending = false
    }

    try {
      const allMessages = useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)!
        .messages.filter((m) => m.id !== assistantMsg.id)

      // Sliding window: only send the last N messages as context
      const windowSize = settings.contextWindowSize
      const currentMessages = (allMessages.length > windowSize
        ? allMessages.slice(-windowSize)
        : allMessages
      ).map((message) => {
        if (message.id !== userMessage.id) return message
        return {
          ...message,
          content: documentRequest.prompt,
        }
      })
      const referenceContext = referenceSections.join('\n\n')

      const stream = streamChat(
        apiConfig,
        currentMessages,
        settings.systemPrompt,
        settings.temperature,
        settings.maxTokens,
        abortController.signal,
        referenceContext || undefined
      )

      for await (const chunk of stream) {
        fullContent += chunk
        // Throttle state updates to 1 per animation frame
        if (!rafPending) {
          rafPending = true
          pendingFrame = requestAnimationFrame(() => {
            setStreamingDrafts((state) => ({ ...state, [assistantMsg.id]: fullContent }))
            pendingFrame = 0
            rafPending = false
          })
        }
      }

      // Final flush — ensure the complete content is written
      cancelPendingMessageUpdate()
      updateMessage(
        convId!,
        assistantMsg.id,
        fullContent.trim() ? fullContent : '⚠️ 模型未返回可显示内容，请重试一次'
      )
      setStreamingDrafts((state) => {
        const next = { ...state }
        delete next[assistantMsg.id]
        return next
      })

      if (isDocumentAction && fullContent.trim()) {
        useWorkspaceStore.getState().completeTask(fullContent, workspaceState.pendingAction, assistantMsg.id, documentRequest.title)
      }

      // Attach reference sources if any
      if (referenceSources.length > 0) {
        attachSearchResults(convId!, assistantMsg.id, referenceSources)
      }
    } catch (err: unknown) {
      cancelPendingMessageUpdate()

      if (err instanceof Error && err.name === 'AbortError') {
        updateMessage(
          convId!,
          assistantMsg.id,
          fullContent.trim() ? fullContent : '*(已停止生成)*'
        )
      } else {
        const errorMsg =
          err instanceof ChatApiError
            ? `⚠️ API 错误: ${err.message}`
            : `⚠️ 请求失败: ${err instanceof Error ? err.message : '未知错误'}`
        updateMessage(convId!, assistantMsg.id, errorMsg)
        if (isDocumentAction) {
          useWorkspaceStore.getState().failTask(errorMsg, documentRequest.title)
        }
      }
      setStreamingDrafts((state) => {
        const next = { ...state }
        delete next[assistantMsg.id]
        return next
      })
    } finally {
      cancelPendingMessageUpdate()
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
      {(workspaceDocument || workspaceTaskState.status !== 'idle') && (
        <div className="border-b border-white/8 bg-white/[0.03] px-5 py-3 backdrop-blur-sm">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 text-xs text-surface-400">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-amber-300/15 bg-amber-300/10 px-2.5 py-1 text-amber-100/90">
                {workspaceDocument ? `当前文档: ${workspaceDocument.title}` : '文档工作区未选中文档'}
              </span>
              {workspaceDocument?.isDirty && (
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-surface-300">存在未保存修改</span>
              )}
            </div>
            <div className="rounded-full border border-white/10 px-2.5 py-1 text-surface-300">
              {workspaceTaskState.title}
            </div>
          </div>
        </div>
      )}
      {/* Messages */}
      <div className="flex-1 overflow-y-auto relative" ref={scrollContainerRef}>
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {renderedMessages.length === 0 && (
            <div className="text-center py-20 animate-fade-in">
              <Sparkles size={24} className="text-primary-400 mx-auto mb-3" />
              <p className="text-surface-400 text-sm">发送消息开始对话</p>
            </div>
          )}
          {renderedMessages.map((msg) => (
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
        onExportSpreadsheet={handleExportSpreadsheet}
        hasSpreadsheetSession={Boolean(latestSpreadsheet?.spreadsheetSessionId)}
        spreadsheetName={latestSpreadsheet?.name ?? null}
        isExportingSpreadsheet={isExportingSpreadsheet}
        isStreaming={isCurrentStreaming}
        disabled={!apiConfigured}
        contextStats={contextStats}
      />
    </div>
  )
}
