import { useRef, useCallback, useState } from 'react'
import { MessageSquarePlus, Sparkles, ArrowDown } from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { streamChat, parseSpreadsheetIntent, generateImage, cancelGenerateImage, ChatApiError } from '../services/chatApi'
import { recognizeImages } from '../services/ocr'
import { resolveApiConfig } from '../types'
import { prepareDocumentAgentRequest } from '../services/agentOrchestrator'
import { SearchApiError } from '../services/searchApi'
import { readWebPagesFromText, formatWebPageContext } from '../services/webpage'
import { runAgenticSearch } from '../services/agenticSearch'
import { buildConversationSummary, buildSmartContextMessages, shouldUpdateConversationSummary } from '../services/contextManager'
import type { ChatInputMode, ImageAttachment, FileAttachment, SearchResult } from '../types'
import MessageBubble from './MessageBubble'
import InputArea from './InputArea'
import { useChatScroll } from './useChatScroll'
import { useChatSideActions } from './useChatSideActions'

import {
  buildImageGenerationPrompt,
  buildSpreadsheetRecentContext,
  calculateContextStats,
  findLatestSpreadsheetAttachment,
  resolveImageGenerationConfig,
  shouldExecuteSpreadsheetInstruction,
  shouldExportSpreadsheetSession,
  summarizeSpreadsheetPlan,
} from './chatViewUtils'

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
    patchMessage,
    updateConversationTitle,
    updateConversationSummary,
    setConversationStreaming,
    attachSearchResults,
  } = useChatStore()

  const abortMapRef = useRef<Map<string, AbortController>>(new Map())
  const imageGenerationRequestMapRef = useRef<Map<string, string>>(new Map())
  const [streamingDrafts, setStreamingDrafts] = useState<Record<string, string>>({})
  const [inputMode, setInputMode] = useState<ChatInputMode>('chat')
  const [imageReferenceDraft, setImageReferenceDraft] = useState<ImageAttachment | null>(null)

  const activeConversation = conversations.find((c) => c.id === activeConversationId)
  const messages = activeConversation?.messages ?? []
  const renderedMessages = messages.map((message) => {
    const draftContent = streamingDrafts[message.id]
    return draftContent == null ? message : { ...message, content: draftContent }
  })
  const isCurrentStreaming = activeConversationId ? streamingConvIds.includes(activeConversationId) : false
  const isImageGenerating = inputMode === 'image' && isCurrentStreaming
  const workspaceTaskState = useWorkspaceStore((state) => state.taskState)
  const workspaceDocument = useWorkspaceStore((state) => {
    if (!state.activeDocumentPath) return null
    return state.documents[state.activeDocumentPath] ?? null
  })
  const {
    messagesEndRef,
    scrollContainerRef,
    showScrollBottom,
    handleScrollToBottom,
  } = useChatScroll({
    activeConversationId,
    messageCount: renderedMessages.length,
    latestMessageContent: renderedMessages[renderedMessages.length - 1]?.content,
  })

  const contextStats = calculateContextStats(messages)
  const {
    handleContinueImageEdit,
    handleExportSpreadsheet,
    isExportingSpreadsheet,
    latestSpreadsheet,
  } = useChatSideActions({
    activeConversationId,
    messages,
    createConversation,
    addMessage,
    setInputMode,
    setImageReferenceDraft,
  })

  const handleSend = async (content: string, images: ImageAttachment[], files: FileAttachment[]) => {
    let convId = activeConversationId
    if (!convId) {
      convId = createConversation()
    }

    const previousMessages = useChatStore.getState().conversations.find((c) => c.id === convId)?.messages ?? []

    if (inputMode === 'image') {
      const imageConfig = resolveImageGenerationConfig(settings)
      if (!imageConfig) {
        addMessage(convId, {
          role: 'assistant',
          content: '请先在设置中为至少一个模型开启“生图”能力，或配置默认生图模型。',
        })
        return
      }

      addMessage(convId, {
        role: 'user',
        content,
        metadata: { kind: 'image_generation' },
      })

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)
      if (conv && conv.messages.length === 1) {
        const title = content.length > 30 ? content.slice(0, 30) + '...' : content
        updateConversationTitle(convId, title || '生图对话')
      }

      setConversationStreaming(convId, true)
      const requestId = `${convId}-${Date.now()}`
      imageGenerationRequestMapRef.current.set(convId, requestId)
      const generatedAt = Date.now()
      const referenceImages = images.slice(0, 1)
      const hasReferenceImage = referenceImages.length > 0
      const enhancedPrompt = buildImageGenerationPrompt(content)
      const assistantMessage = addMessage(convId, {
        role: 'assistant',
        content: hasReferenceImage ? '正在基于参考图生成图片...' : '正在生成图片...',
        images: [{
          id: `generating-${generatedAt}`,
          name: `generated-${generatedAt}.png`,
          isGenerating: true,
        }],
        metadata: {
          kind: 'image_generation',
          originalPrompt: content,
          enhancedPrompt,
          providerId: settings.imageGeneration.providerId,
          model: imageConfig.model,
          size: settings.imageGeneration.size,
          quality: settings.imageGeneration.quality,
        },
      })

      try {
        const result = await generateImage(imageConfig, {
          requestId,
          prompt: enhancedPrompt,
          images: referenceImages,
          size: settings.imageGeneration.size,
          quality: settings.imageGeneration.quality,
        })

        if (!result.ok || (!result.imageUrl && !result.imageBase64)) {
          patchMessage(convId, assistantMessage.id, {
            content: result.error || '生成图片失败，请稍后重试。',
            images: [],
            metadata: { kind: 'image_generation' },
          })
          return
        }

        patchMessage(convId, assistantMessage.id, {
          content: result.revisedPrompt ? `已生成图片。\n\n优化后的提示词：${result.revisedPrompt}` : '已生成图片。',
          images: [{
            id: `generated-${generatedAt}`,
            base64: result.imageBase64,
            url: result.imageUrl,
            filePath: result.filePath,
            name: result.fileName ?? `generated-${generatedAt}.png`,
          }],
          metadata: {
            kind: 'image_generation',
            originalPrompt: content,
            enhancedPrompt,
            revisedPrompt: result.revisedPrompt,
            providerId: settings.imageGeneration.providerId,
            model: imageConfig.model,
            size: settings.imageGeneration.size,
            quality: settings.imageGeneration.quality,
          },
        })
      } finally {
        setConversationStreaming(convId, false)
        imageGenerationRequestMapRef.current.delete(convId)
      }
      return
    }

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
      try {
        const startIndex = referenceSources.length + 1
        const searchResult = await runAgenticSearch(
          apiConfig,
          messageContent,
          previousMessages,
          apiKey,
          settings.searchEngine,
          searchEnabled,
          startIndex,
          abortController.signal
        )
        if (searchResult.context) {
          referenceSections.push(`以下是网络搜索结果：\n\n${searchResult.context}`)
          referenceSources = [...referenceSources, ...searchResult.results]
        }
      } catch (err) {
        if (err instanceof SearchApiError) {
          // Non-blocking: continue without search
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

      const activeConversationForContext = useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)
      let activeSummary = activeConversationForContext?.summary

      if (activeConversationForContext && shouldUpdateConversationSummary(activeConversationForContext)) {
        const nextSummary = await buildConversationSummary(apiConfig, activeConversationForContext, abortController.signal)
        if (nextSummary) {
          updateConversationSummary(convId, nextSummary)
          activeSummary = nextSummary
        }
      }

      const currentMessages = buildSmartContextMessages(
        allMessages,
        activeSummary,
        settings.contextWindowSize,
        userMessage.id,
        documentRequest.prompt
      )
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
    const imageRequestId = imageGenerationRequestMapRef.current.get(activeConversationId)
    if (imageRequestId) {
      void cancelGenerateImage(imageRequestId)
      return
    }
    const controller = abortMapRef.current.get(activeConversationId)
    controller?.abort()
  }

  const apiConfigured = inputMode === 'image'
    ? resolveImageGenerationConfig(settings) !== null
    : resolveApiConfig(settings.providers, settings.activeModel) !== null

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
            <MessageBubble key={msg.id} message={msg} onContinueImageEdit={handleContinueImageEdit} />
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
        imageReferenceDraft={imageReferenceDraft}
        onConsumeImageReferenceDraft={() => setImageReferenceDraft(null)}
        inputMode={inputMode}
        onInputModeChange={setInputMode}
        hasSpreadsheetSession={Boolean(latestSpreadsheet?.spreadsheetSessionId)}
        spreadsheetName={latestSpreadsheet?.name ?? null}
        isExportingSpreadsheet={isExportingSpreadsheet}
        isStreaming={isCurrentStreaming}
        isImageGenerating={isImageGenerating}
        disabled={!apiConfigured}
        contextStats={contextStats}
      />
    </div>
  )
}
