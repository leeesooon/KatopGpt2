import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore } from '../store/chatStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { streamChat, ChatApiError } from '../services/chatApi'
import { prepareDocumentAgentRequest } from '../services/agentOrchestrator'
import { runAgenticSearch } from '../services/agenticSearch'
import { buildAssistantSystemPrompt, searchAssistantKnowledge } from '../services/assistantProfiles'
import { resolveApiConfig } from '../types'
import type { DocumentAgentMode, DocumentSelection, Message, WorkspaceDocument } from '../types'

export type RunnableDocumentAgentMode = Exclude<DocumentAgentMode, 'chat'>

const DOCUMENT_AGENT_IDLE_COMPLETE_MS = 5000
const DOCUMENT_AGENT_FIRST_CHUNK_TIMEOUT_MS = 45000

interface UseDocumentAgentRunnerOptions {
  activeDocument: WorkspaceDocument | null
  selection: DocumentSelection | null
  searchEnabled: boolean
}

interface LastRunRequest {
  mode: RunnableDocumentAgentMode
  userPrompt: string
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError')
  )
}

function buildRunError(error: unknown) {
  if (error instanceof ChatApiError) return `API 错误：${error.message}`
  if (error instanceof Error) return `请求失败：${error.message}`
  return '请求失败：未知错误'
}

export function useDocumentAgentRunner({
  activeDocument,
  selection,
  searchEnabled,
}: UseDocumentAgentRunnerOptions) {
  const settings = useChatStore((state) => state.settings)
  const conversations = useChatStore((state) => state.conversations)
  const activeConversationId = useChatStore((state) => state.activeConversationId)
  const startTask = useWorkspaceStore((state) => state.startTask)
  const completeTask = useWorkspaceStore((state) => state.completeTask)
  const failTask = useWorkspaceStore((state) => state.failTask)
  const clearLatestSuggestion = useWorkspaceStore((state) => state.clearLatestSuggestion)
  const [isRunning, setIsRunning] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [lastRunRequest, setLastRunRequest] = useState<LastRunRequest | null>(null)
  const [activeRunId, setActiveRunId] = useState<number | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeRunIdRef = useRef<number | null>(null)
  const streamingContentRef = useRef('')
  const runningTitleRef = useRef('文档建议')
  const runningModeRef = useRef<RunnableDocumentAgentMode>('expand')
  const isMountedRef = useRef(true)
  const runIdRef = useRef(0)
  const idleCompleteTimerRef = useRef<number | null>(null)
  const firstChunkTimerRef = useRef<number | null>(null)

  const apiConfig = resolveApiConfig(settings.providers, settings.activeModel)
  const hasApiConfig = Boolean(apiConfig)
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId)
  const activeAssistantProfileId = activeConversation?.assistantProfileId ?? settings.activeAssistantProfileId

  const clearIdleCompleteTimer = useCallback(() => {
    if (idleCompleteTimerRef.current === null) return
    window.clearTimeout(idleCompleteTimerRef.current)
    idleCompleteTimerRef.current = null
  }, [])

  const clearFirstChunkTimer = useCallback(() => {
    if (firstChunkTimerRef.current === null) return
    window.clearTimeout(firstChunkTimerRef.current)
    firstChunkTimerRef.current = null
  }, [])

  const beginRun = useCallback((runId: number) => {
    activeRunIdRef.current = runId
    setActiveRunId(runId)
    setIsRunning(true)
  }, [])

  const finishRun = useCallback((runId?: number) => {
    if (runId !== undefined && activeRunIdRef.current !== runId) return

    activeRunIdRef.current = null
    setActiveRunId(null)
    setIsRunning(false)
  }, [])

  const completeRunFromTimer = useCallback((
    runId: number,
    abortController: AbortController,
    title: string,
    mode: RunnableDocumentAgentMode
  ) => {
    if (runIdRef.current !== runId) return

    const finalContent = streamingContentRef.current.trim()
    clearIdleCompleteTimer()
    clearFirstChunkTimer()
    runIdRef.current += 1
    abortController.abort()
    abortControllerRef.current = null

    if (finalContent) {
      completeTask(finalContent, mode, undefined, title)
    } else {
      failTask('模型未返回可显示内容，请重试一次。', title)
    }

    if (isMountedRef.current) {
      finishRun(runId)
    }
  }, [clearFirstChunkTimer, clearIdleCompleteTimer, completeTask, failTask, finishRun])

  const run = useCallback(async (mode: RunnableDocumentAgentMode, userPrompt: string) => {
    if (abortControllerRef.current) return
    const runId = runIdRef.current + 1
    runIdRef.current = runId

    const currentApiConfig = resolveApiConfig(settings.providers, settings.activeModel)
    if (!currentApiConfig) {
      failTask('请先在设置中配置可用的聊天模型。', '文档助手不可用')
      return
    }

    if (mode !== 'create' && !activeDocument) {
      failTask('请先打开或新建一个文档。', '文档助手不可用')
      return
    }

    if (mode === 'rewrite' && !selection?.text.trim()) {
      failTask('请先选中需要改写的文本。', '文档助手不可用')
      return
    }

    const request = prepareDocumentAgentRequest({
      mode,
      userPrompt,
      document: activeDocument,
      selection,
    })
    const abortController = new AbortController()
    const userMessage: Message = {
      id: `document-agent-${Date.now()}`,
      role: 'user',
      content: request.prompt,
      timestamp: Date.now(),
    }

    abortControllerRef.current = abortController
    streamingContentRef.current = ''
    runningTitleRef.current = request.title
    runningModeRef.current = mode
    setLastRunRequest({ mode, userPrompt })
    setStreamingContent('')
    beginRun(runId)
    clearLatestSuggestion()
    startTask(request.title)

    firstChunkTimerRef.current = window.setTimeout(() => {
      completeRunFromTimer(runId, abortController, request.title, mode)
    }, DOCUMENT_AGENT_FIRST_CHUNK_TIMEOUT_MS)

    const completeCurrentRun = (message?: string) => {
      const finalContent = streamingContentRef.current.trim()
      if (!finalContent) {
        failTask('模型未返回可显示内容，请重试一次。', request.title)
        return false
      }

      completeTask(finalContent, mode, undefined, request.title, message)
      return true
    }

    const scheduleIdleComplete = () => {
      clearIdleCompleteTimer()
      idleCompleteTimerRef.current = window.setTimeout(() => {
        completeRunFromTimer(runId, abortController, request.title, mode)
      }, DOCUMENT_AGENT_IDLE_COMPLETE_MS)
    }

    try {
      let referenceContext: string | undefined
      const knowledgeResult = searchAssistantKnowledge(settings, `${userPrompt}\n\n${request.prompt}`, activeAssistantProfileId)
      const assistantSystemPrompt = buildAssistantSystemPrompt(settings, knowledgeResult.context || undefined, activeAssistantProfileId)
      const searchApiKey = settings.searchEngine === 'tavily'
        ? settings.tavilyApiKey
        : settings.serperApiKey

      if (searchEnabled && searchApiKey) {
        try {
          const searchResult = await runAgenticSearch(
            currentApiConfig,
            userPrompt.trim() || request.title,
            [],
            searchApiKey,
            settings.searchEngine,
            true,
            1,
            abortController.signal
          )
          if (searchResult.context) {
            referenceContext = `以下是网络搜索结果：\n\n${searchResult.context}`
          }
        } catch {
          referenceContext = undefined
        }
      }

      for await (const chunk of streamChat(
        currentApiConfig,
        [userMessage],
        assistantSystemPrompt,
        settings.temperature,
        settings.maxTokens,
        abortController.signal,
        referenceContext
      )) {
        if (runIdRef.current !== runId) return
        if (chunk.trim()) {
          clearFirstChunkTimer()
        }
        streamingContentRef.current += chunk
        if (isMountedRef.current) {
          setStreamingContent(streamingContentRef.current)
        }
        scheduleIdleComplete()
      }

      if (runIdRef.current !== runId) return
      clearFirstChunkTimer()
      clearIdleCompleteTimer()
      completeCurrentRun()
    } catch (error) {
      if (runIdRef.current !== runId) return
      clearFirstChunkTimer()
      clearIdleCompleteTimer()
      if (isAbortError(error)) {
        const stoppedContent = streamingContentRef.current.trim()
        if (stoppedContent) {
          completeTask(
            stoppedContent,
            runningModeRef.current,
            undefined,
            runningTitleRef.current,
            '已停止生成，已保留当前草稿，可继续编辑或应用。'
          )
        } else {
          failTask('已停止生成，未产生可保留的内容。', runningTitleRef.current)
        }
        return
      }

      failTask(buildRunError(error), request.title)
    } finally {
      if (runIdRef.current === runId) {
        clearFirstChunkTimer()
        clearIdleCompleteTimer()
      }
      if (runIdRef.current === runId) {
        abortControllerRef.current = null
      }
      if (runIdRef.current === runId && isMountedRef.current) {
        finishRun(runId)
      }
    }
  }, [
    activeDocument,
    activeAssistantProfileId,
    beginRun,
    clearLatestSuggestion,
    clearFirstChunkTimer,
    clearIdleCompleteTimer,
    completeRunFromTimer,
    completeTask,
    failTask,
    finishRun,
    searchEnabled,
    selection,
    settings.activeAssistantProfileId,
    settings.activeModel,
    settings.assistantProfiles,
    settings.maxTokens,
    settings.providers,
    settings.searchEngine,
    settings.serperApiKey,
    settings.systemPrompt,
    settings.tavilyApiKey,
    settings.temperature,
    startTask,
  ])

  const stop = useCallback(() => {
    const controller = abortControllerRef.current
    clearFirstChunkTimer()
    clearIdleCompleteTimer()
    controller?.abort()
    runIdRef.current += 1
    abortControllerRef.current = null

    const stoppedContent = streamingContentRef.current.trim()
    if (stoppedContent) {
      completeTask(
        stoppedContent,
        runningModeRef.current,
        undefined,
        runningTitleRef.current,
        '已停止生成，已保留当前草稿，可继续编辑或应用。'
      )
    } else {
      failTask('已停止生成。', runningTitleRef.current)
    }

    if (isMountedRef.current) {
      finishRun()
    }
  }, [clearFirstChunkTimer, clearIdleCompleteTimer, completeTask, failTask, finishRun])

  const reset = useCallback(() => {
    clearFirstChunkTimer()
    clearIdleCompleteTimer()
    runIdRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    streamingContentRef.current = ''
    if (isMountedRef.current) {
      setStreamingContent('')
      finishRun()
    }
  }, [clearFirstChunkTimer, clearIdleCompleteTimer, finishRun])

  const retry = useCallback(() => {
    if (!lastRunRequest || abortControllerRef.current) return
    void run(lastRunRequest.mode, lastRunRequest.userPrompt)
  }, [lastRunRequest, run])

  useEffect(() => {
    return () => {
      clearIdleCompleteTimer()
      clearFirstChunkTimer()
      isMountedRef.current = false
      activeRunIdRef.current = null
      abortControllerRef.current?.abort()
    }
  }, [clearFirstChunkTimer, clearIdleCompleteTimer])

  return {
    isRunning,
    hasActiveRun: activeRunId !== null,
    streamingContent,
    hasApiConfig,
    canRetry: Boolean(lastRunRequest),
    run,
    stop,
    reset,
    retry,
  }
}
