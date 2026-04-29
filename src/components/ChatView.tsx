import { useEffect, useRef, useCallback, useState } from 'react'
import { MessageSquarePlus, Sparkles, ArrowDown } from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { streamChat, parseSpreadsheetIntent, generateImage, cancelGenerateImage, completeChatText, ChatApiError } from '../services/chatApi'
import { recognizeImages } from '../services/ocr'
import { resolveApiConfig } from '../types'
import { prepareDocumentAgentRequest } from '../services/agentOrchestrator'
import { SearchApiError } from '../services/searchApi'
import { readWebPagesFromText, formatWebPageContext } from '../services/webpage'
import { runAgenticSearch } from '../services/agenticSearch'
import { buildConversationSummary, buildSmartContextMessages, shouldUpdateConversationSummary } from '../services/contextManager'
import { buildAssistantSystemPrompt, resolveAssistantProfile, searchAssistantKnowledge } from '../services/assistantProfiles'
import type { AssistantProfile, ChatInputMode, ImageAttachment, FileAttachment, SearchResult } from '../types'
import MessageBubble from './MessageBubble'
import InputArea from './InputArea'
import ImageZoomViewer from './ImageZoomViewer'
import RoleAvatar from './RoleAvatar'
import { useChatScroll } from './useChatScroll'
import { useChatSideActions } from './useChatSideActions'
import katopLogo from '../assets/katop-logo.png'
import type { WorkspaceImageViewPayload } from './workspaceMarkdown'

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

interface ImageSeriesSendOptions {
  imageSeries?: {
    enabled: boolean
    count: number
    mode: 'template_parallel' | 'sequential'
  }
}

interface ImageSeriesChapterPlan {
  title: string
  prompt: string
}

interface ImageSeriesPlan {
  setting: string
  chapters: ImageSeriesChapterPlan[]
}

interface ImageSeriesChapterState {
  index: number
  title: string
  prompt: string
  enhancedPrompt?: string
  status: 'pending' | 'generating' | 'completed' | 'stopped' | 'error'
  revisedPrompt?: string
  imageName?: string
}

interface RoleFlashState {
  key: number
  name: string
  description: string
  emoji: string
  avatarId?: string
}

const MIN_IMAGE_SERIES_COUNT = 2
const MAX_IMAGE_SERIES_COUNT = 8
const IMAGE_SCALE_MIN = 0.5
const IMAGE_SCALE_MAX = 4

function clampImageScale(scale: number) {
  return Math.min(IMAGE_SCALE_MAX, Math.max(IMAGE_SCALE_MIN, Math.round(scale * 100) / 100))
}

function clampImageSeriesCount(count: number) {
  return Math.min(MAX_IMAGE_SERIES_COUNT, Math.max(MIN_IMAGE_SERIES_COUNT, Math.round(count)))
}

function stripJsonCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function extractBalancedJsonObject(value: string, startIndex: number) {
  const expectedClosers: string[] = []
  let isInString = false
  let isEscaped = false

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index]

    if (isInString) {
      if (isEscaped) {
        isEscaped = false
      } else if (char === '\\') {
        isEscaped = true
      } else if (char === '"') {
        isInString = false
      }
      continue
    }

    if (char === '"') {
      isInString = true
      continue
    }

    if (char === '{') {
      expectedClosers.push('}')
      continue
    }

    if (char === '[') {
      expectedClosers.push(']')
      continue
    }

    if (char === '}' || char === ']') {
      const expectedCloser = expectedClosers.pop()
      if (expectedCloser !== char) {
        return null
      }

      if (expectedClosers.length === 0) {
        return value.slice(startIndex, index + 1)
      }
    }
  }

  return null
}

function extractImageSeriesPlanJson(rawText: string) {
  const text = stripJsonCodeFence(rawText)
  if (text.startsWith('{')) {
    return text
  }

  const jsonStart = text.indexOf('{')
  if (jsonStart < 0) {
    return text
  }

  return extractBalancedJsonObject(text, jsonStart) ?? text
}

function parseImageSeriesPlan(rawText: string, fallbackTopic: string, count: number): ImageSeriesPlan {
  let parsed: Partial<ImageSeriesPlan>
  try {
    parsed = JSON.parse(extractImageSeriesPlanJson(rawText)) as Partial<ImageSeriesPlan>
  } catch {
    throw new Error('章节拆分结果不是有效 JSON，请重试或换用更稳定的文本模型。')
  }
  const chapters = Array.isArray(parsed.chapters)
    ? parsed.chapters
        .slice(0, count)
        .map((chapter, index) => ({
          title: typeof chapter?.title === 'string' && chapter.title.trim()
            ? chapter.title.trim()
            : `第 ${index + 1} 章`,
          prompt: typeof chapter?.prompt === 'string' && chapter.prompt.trim()
            ? chapter.prompt.trim()
            : `${fallbackTopic}，第 ${index + 1} 张章节图`,
        }))
    : []

  if (chapters.length < count) {
    throw new Error('章节拆分结果数量不足，请重试。')
  }

  return {
    setting: typeof parsed.setting === 'string' ? parsed.setting.trim() : '',
    chapters,
  }
}

function buildImageSeriesPlanningPrompt(topic: string, count: number, webContext?: string) {
  return [
    `主题：${topic}`,
    webContext ? `网页内容：\n${webContext}` : '',
    `张数：${count}`,
    '',
    '请优先根据网页内容总结核心章节/要点，再拆成连续章节分镜，并返回严格 JSON，不要输出 Markdown，不要输出解释。',
    'JSON 格式：{"setting":"统一角色、画风、世界观和视觉一致性设定","chapters":[{"title":"章节标题","prompt":"这一张图片的详细生图提示词"}]}',
    '要求：每张图对应一个不同章节，内容连续但画面有变化；统一角色外观、服装、色彩、镜头语言和画风；提示词使用中文。',
  ].filter(Boolean).join('\n')
}

function buildImageSeriesChapterPrompt(setting: string, chapter: ImageSeriesChapterPlan, index: number, count: number) {
  return [
    setting ? `统一设定：${setting}` : '',
    `连续章节图 ${index + 1}/${count}：${chapter.title}`,
    chapter.prompt,
    '保持与系列前后图片一致的角色、画风、色彩和世界观，同时突出本章节独立内容。',
  ].filter(Boolean).join('\n\n')
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
    patchMessage,
    updateConversationTitle,
    updateConversationSummary,
    setConversationAssistantProfile,
    setConversationStreaming,
    attachSearchResults,
  } = useChatStore()

  const abortMapRef = useRef<Map<string, AbortController>>(new Map())
  const imageGenerationRequestMapRef = useRef<Map<string, Set<string>>>(new Map())
  const roleFlashTimerRef = useRef<number | null>(null)
  const previousConversationIdRef = useRef<string | null>(null)
  const [streamingDrafts, setStreamingDrafts] = useState<Record<string, string>>({})
  const [inputMode, setInputMode] = useState<ChatInputMode>('chat')
  const [imageReferenceDraft, setImageReferenceDraft] = useState<ImageAttachment | null>(null)
  const [roleFlash, setRoleFlash] = useState<RoleFlashState | null>(null)
  const [previewImage, setPreviewImage] = useState<WorkspaceImageViewPayload | null>(null)
  const [previewScale, setPreviewScale] = useState(1)
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 })

  const activeConversation = conversations.find((c) => c.id === activeConversationId)
  const activeAssistantProfileId = activeConversation?.assistantProfileId ?? settings.activeAssistantProfileId
  const messages = activeConversation?.messages ?? []
  const renderedMessages = messages.map((message) => {
    const draftContent = streamingDrafts[message.id]
    return draftContent == null ? message : { ...message, content: draftContent }
  })
  const isCurrentStreaming = activeConversationId ? streamingConvIds.includes(activeConversationId) : false
  const isImageGenerating = inputMode === 'image' && isCurrentStreaming
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

  const handleOpenImagePreview = useCallback((image: WorkspaceImageViewPayload) => {
    setPreviewImage(image)
    setPreviewScale(1)
    setPreviewOffset({ x: 0, y: 0 })
  }, [])

  const handleCloseImagePreview = useCallback(() => {
    setPreviewImage(null)
    setPreviewScale(1)
    setPreviewOffset({ x: 0, y: 0 })
  }, [])

  const handlePreviewScaleChange = useCallback((scale: number) => {
    setPreviewScale(clampImageScale(scale))
  }, [])

  const registerImageRequest = (conversationId: string, requestId: string) => {
    const requestIds = imageGenerationRequestMapRef.current.get(conversationId) ?? new Set<string>()
    requestIds.add(requestId)
    imageGenerationRequestMapRef.current.set(conversationId, requestIds)
  }

  const unregisterImageRequest = (conversationId: string, requestId: string) => {
    const requestIds = imageGenerationRequestMapRef.current.get(conversationId)
    if (!requestIds) return
    requestIds.delete(requestId)
    if (requestIds.size === 0) {
      imageGenerationRequestMapRef.current.delete(conversationId)
    }
  }

  const showRoleFlash = useCallback((profile: AssistantProfile) => {
    if (roleFlashTimerRef.current !== null) {
      window.clearTimeout(roleFlashTimerRef.current)
    }

    setRoleFlash({
      key: Date.now(),
      name: profile.name,
      description: profile.description,
      emoji: profile.emoji || '★',
      avatarId: profile.avatarId,
    })
    roleFlashTimerRef.current = window.setTimeout(() => {
      setRoleFlash(null)
      roleFlashTimerRef.current = null
    }, 1150)
  }, [])

  const handleRoleSelected = useCallback((profile: AssistantProfile) => {
    if (!activeConversationId) return
    setConversationAssistantProfile(activeConversationId, profile.id)
    showRoleFlash(profile)
  }, [activeConversationId, setConversationAssistantProfile, showRoleFlash])

  useEffect(() => {
    if (!activeConversationId) {
      previousConversationIdRef.current = null
      return
    }

    const previousConversationId = previousConversationIdRef.current
    previousConversationIdRef.current = activeConversationId
    if (!previousConversationId || previousConversationId === activeConversationId) return

    const profile = resolveAssistantProfile(settings, activeAssistantProfileId)
    if (profile) {
      showRoleFlash(profile)
    }
  }, [activeAssistantProfileId, activeConversationId, settings, showRoleFlash])

  useEffect(() => {
    return () => {
      if (roleFlashTimerRef.current !== null) {
        window.clearTimeout(roleFlashTimerRef.current)
      }
    }
  }, [])

  const handleSend = async (content: string, images: ImageAttachment[], files: FileAttachment[], options?: ImageSeriesSendOptions) => {
    let convId = activeConversationId
    if (!convId) {
      convId = createConversation()
    }

    const conversationForRequest = useChatStore.getState().conversations.find((c) => c.id === convId)
    const previousMessages = conversationForRequest?.messages ?? []
    const assistantProfileIdForRequest = conversationForRequest?.assistantProfileId ?? settings.activeAssistantProfileId

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

      if (options?.imageSeries?.enabled) {
        const plannerSelection = settings.imageGeneration.plannerProviderId && settings.imageGeneration.plannerModel
          ? {
              providerId: settings.imageGeneration.plannerProviderId,
              model: settings.imageGeneration.plannerModel,
            }
          : settings.activeModel
        const chatConfig = resolveApiConfig(settings.providers, plannerSelection)
        if (!chatConfig) {
          addMessage(convId, {
            role: 'assistant',
            content: '请先在设置中配置“章节总结模型”，用于拆分连续多图章节。',
            metadata: { kind: 'image_generation' },
          })
          return
        }

        const seriesCount = clampImageSeriesCount(options.imageSeries.count)
        const seriesId = `${convId}-${Date.now()}`
        const splitController = new AbortController()
        abortMapRef.current.set(convId, splitController)
        setConversationStreaming(convId, true)

        const assistantMessage = addMessage(convId, {
          role: 'assistant',
          content: '正在拆分章节...',
          metadata: {
            kind: 'image_generation',
            originalPrompt: content,
            providerId: settings.imageGeneration.providerId,
            model: imageConfig.model,
            size: settings.imageGeneration.size,
            quality: settings.imageGeneration.quality,
            seriesId,
          },
        })

        try {
          let webSources: SearchResult[] = []
          patchMessage(convId, assistantMessage.id, {
            content: '正在读取网页内容...',
            metadata: {
              kind: 'image_generation',
              originalPrompt: content,
              providerId: settings.imageGeneration.providerId,
              model: imageConfig.model,
              size: settings.imageGeneration.size,
              quality: settings.imageGeneration.quality,
              seriesId,
            },
          })

          const webPages = await readWebPagesFromText(content)
          webSources = webPages.sources
          const webContext = webPages.sources.length > 0
            ? formatWebPageContext(webPages.sources, 5000)
            : ''
          patchMessage(convId, assistantMessage.id, {
            content: webContext ? '正在总结网页并拆分章节...' : '正在拆分章节...',
            searchResults: webSources.length > 0 ? webSources : undefined,
            metadata: {
              kind: 'image_generation',
              originalPrompt: content,
              providerId: settings.imageGeneration.providerId,
              model: imageConfig.model,
              size: settings.imageGeneration.size,
              quality: settings.imageGeneration.quality,
              seriesId,
            },
          })

          const planText = await completeChatText(
            chatConfig,
            [
              {
                role: 'system',
                content: '你是专业连续插画分镜策划。你只输出严格 JSON，不输出 Markdown 或解释。',
              },
              {
                role: 'user',
                content: buildImageSeriesPlanningPrompt(content, seriesCount, webContext),
              },
            ],
            0.4,
            1800,
            splitController.signal
          )
          const seriesPlan = parseImageSeriesPlan(planText, content, seriesCount)
          let seriesChapters: ImageSeriesChapterState[] = seriesPlan.chapters.map((chapter, index) => ({
            index,
            title: chapter.title,
            prompt: chapter.prompt,
            status: 'pending' as const,
          }))
          const buildPlaceholderImages = (completedImages: ImageAttachment[]) => [
            ...completedImages,
            ...seriesChapters.slice(completedImages.length).map((chapter) => ({
              id: `series-${seriesId}-${chapter.index}`,
              name: `${chapter.index + 1}-${chapter.title}.png`,
              isGenerating: true,
            })),
          ]

          const seriesMode = options.imageSeries.mode
          let completedImages: ImageAttachment[] = []
          const initialReference = images.find((image) => image.base64)
          const chapterImageSlots: ImageAttachment[] = seriesChapters.map((chapter) => ({
            id: `series-${seriesId}-${chapter.index}`,
            name: `${chapter.index + 1}-${chapter.title}.png`,
            isGenerating: true,
          }))
          const syncSeriesMessage = (statusText: string) => {
            patchMessage(convId, assistantMessage.id, {
              content: statusText,
              images: chapterImageSlots,
              searchResults: webSources.length > 0 ? webSources : undefined,
              metadata: {
                kind: 'image_generation',
                originalPrompt: content,
                providerId: settings.imageGeneration.providerId,
                model: imageConfig.model,
                size: settings.imageGeneration.size,
                quality: settings.imageGeneration.quality,
                seriesId,
                seriesMode,
                seriesChapters,
              },
            })
          }
          const readResultReference = async (result: { imageBase64?: string; imageUrl?: string }, imageName: string, index: number) => {
            let referenceBase64 = result.imageBase64
            if (!referenceBase64 && result.imageUrl && window.electronAPI?.readImage) {
              const readResult = await window.electronAPI.readImage(result.imageUrl)
              if (readResult.ok && readResult.dataUrl) {
                referenceBase64 = readResult.dataUrl
              }
            }
            return referenceBase64
              ? {
                  id: `series-reference-${seriesId}-${index}`,
                  base64: referenceBase64,
                  name: imageName,
                }
              : null
          }
          const markRemainingStopped = (fromIndex: number) => {
            seriesChapters = seriesChapters.map((item) =>
              item.index < fromIndex ? item : { ...item, status: 'stopped' as const }
            )
            for (let slotIndex = fromIndex; slotIndex < chapterImageSlots.length; slotIndex += 1) {
              chapterImageSlots[slotIndex] = {
                id: `series-stopped-${seriesId}-${slotIndex}`,
                name: `${slotIndex + 1}-${seriesPlan.chapters[slotIndex].title}.png`,
                isGenerating: true,
              }
            }
          }
          const generateChapterImage = async (index: number, referenceImage?: ImageAttachment) => {
            const chapter = seriesPlan.chapters[index]
            const chapterPrompt = buildImageSeriesChapterPrompt(seriesPlan.setting, chapter, index, seriesCount)
            const enhancedPrompt = buildImageGenerationPrompt(chapterPrompt)
            seriesChapters = seriesChapters.map((item) =>
              item.index === index
                ? { ...item, enhancedPrompt, status: 'generating' as const }
                : item
            )
            const requestId = `${seriesId}-${index}-${Date.now()}`
            registerImageRequest(convId, requestId)
            try {
              const result = await generateImage(imageConfig, {
                requestId,
                prompt: enhancedPrompt,
                images: referenceImage ? [referenceImage] : [],
                size: settings.imageGeneration.size,
                quality: settings.imageGeneration.quality,
              })
              if (!result.ok || (!result.imageUrl && !result.imageBase64)) {
                return { ok: false as const, error: result.error || '生成图片失败', stopped: result.error?.includes('已停止') ?? false }
              }

              const imageName = result.fileName ?? `series-${index + 1}-${Date.now()}.png`
              const imageAttachment: ImageAttachment = {
                id: `series-generated-${seriesId}-${index}`,
                base64: result.imageBase64,
                url: result.imageUrl,
                filePath: result.filePath,
                name: imageName,
              }
              const reference = await readResultReference(result, imageName, index)
              seriesChapters = seriesChapters.map((item) =>
                item.index === index
                  ? {
                      ...item,
                      status: 'completed' as const,
                      revisedPrompt: result.revisedPrompt,
                      imageName,
                    }
                  : item
              )
              return { ok: true as const, image: imageAttachment, reference }
            } finally {
              unregisterImageRequest(convId, requestId)
            }
          }

          syncSeriesMessage(`正在生成连续多图（0/${seriesCount}）...`)

          if (seriesMode === 'sequential') {
            let previousReference = initialReference
            for (let index = 0; index < seriesChapters.length; index += 1) {
              if (splitController.signal.aborted) {
                throw new DOMException('Aborted', 'AbortError')
              }

              syncSeriesMessage(`正在生成连续多图（${index + 1}/${seriesCount}）：${seriesPlan.chapters[index].title}`)
              const result = await generateChapterImage(index, previousReference)
              if (!result.ok) {
                const stopped = result.stopped
                seriesChapters = seriesChapters.map((item) =>
                  item.index < index
                    ? item
                    : {
                        ...item,
                        status: stopped ? 'stopped' as const : item.index === index ? 'error' as const : 'stopped' as const,
                      }
                )
                syncSeriesMessage(stopped
                  ? `已停止连续多图，已完成 ${completedImages.length}/${seriesCount} 张。`
                  : `连续多图生成中断：${result.error}\n已完成 ${completedImages.length}/${seriesCount} 张。`)
                return
              }

              completedImages = [...completedImages, result.image]
              chapterImageSlots[index] = result.image
              if (result.reference) {
                previousReference = result.reference
              }
              syncSeriesMessage(index + 1 === seriesCount
                ? `已生成连续多图：${seriesPlan.chapters.map((item, chapterIndex) => `${chapterIndex + 1}. ${item.title}`).join(' / ')}`
                : `正在生成连续多图（${index + 1}/${seriesCount}）...`)
            }
          } else {
            syncSeriesMessage(`正在生成风格模板：${seriesPlan.chapters[0].title}`)
            const templateResult = await generateChapterImage(0, initialReference)
            if (!templateResult.ok) {
              seriesChapters = seriesChapters.map((item) => ({
                ...item,
                status: item.index === 0 ? 'error' as const : 'stopped' as const,
              }))
              syncSeriesMessage(`连续多图生成中断：${templateResult.error}\n已完成 0/${seriesCount} 张。`)
              return
            }

            completedImages = [templateResult.image]
            chapterImageSlots[0] = templateResult.image
            const styleReference = templateResult.reference
            if (!styleReference) {
              markRemainingStopped(1)
              syncSeriesMessage('风格模板读取失败，无法并发生成剩余章节。')
              return
            }

            seriesChapters = seriesChapters.map((item) =>
              item.index > 0 ? { ...item, status: 'generating' as const } : item
            )
            syncSeriesMessage(`正在并发生成剩余章节（1/${seriesCount}）...`)
            const remainingIndexes = seriesChapters.slice(1).map((chapter) => chapter.index)
            const settledResults = await Promise.allSettled(
              remainingIndexes.map(async (index) => ({ index, result: await generateChapterImage(index, styleReference) }))
            )
            let successCount = 1
            for (const settled of settledResults) {
              if (settled.status === 'fulfilled') {
                const { index, result } = settled.value
                if (result.ok) {
                  successCount += 1
                  completedImages = [...completedImages, result.image]
                  chapterImageSlots[index] = result.image
                } else {
                  seriesChapters = seriesChapters.map((item) =>
                    item.index === index
                      ? { ...item, status: result.stopped ? 'stopped' as const : 'error' as const }
                      : item
                  )
                }
              } else {
                const failedIndex = remainingIndexes[settledResults.indexOf(settled)]
                seriesChapters = seriesChapters.map((item) =>
                  item.index === failedIndex ? { ...item, status: 'error' as const } : item
                )
              }
              syncSeriesMessage(`正在并发生成剩余章节（${successCount}/${seriesCount}）...`)
            }
            syncSeriesMessage(successCount === seriesCount
              ? `已生成连续多图：${seriesPlan.chapters.map((item, chapterIndex) => `${chapterIndex + 1}. ${item.title}`).join(' / ')}`
              : `连续多图部分完成：已完成 ${successCount}/${seriesCount} 张。`)
          }
        } catch (error) {
          patchMessage(convId, assistantMessage.id, {
            content: error instanceof Error && error.name === 'AbortError'
              ? '已停止连续多图章节拆分。'
              : `连续多图生成失败：${error instanceof Error ? error.message : '未知错误'}`,
            images: [],
            metadata: {
              kind: 'image_generation',
              originalPrompt: content,
              providerId: settings.imageGeneration.providerId,
              model: imageConfig.model,
              size: settings.imageGeneration.size,
              quality: settings.imageGeneration.quality,
              seriesId,
            },
          })
        } finally {
          setConversationStreaming(convId, false)
          imageGenerationRequestMapRef.current.delete(convId)
          abortMapRef.current.delete(convId)
        }
        return
      }

      setConversationStreaming(convId, true)
      const requestId = `${convId}-${Date.now()}`
      registerImageRequest(convId, requestId)
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
        unregisterImageRequest(convId, requestId)
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
    const knowledgeResult = searchAssistantKnowledge(settings, messageContent, assistantProfileIdForRequest)
    const assistantSystemPrompt = buildAssistantSystemPrompt(settings, knowledgeResult.context || undefined, assistantProfileIdForRequest)

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
        assistantSystemPrompt,
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
        attachSearchResults(convId!, assistantMsg.id, [...referenceSources, ...knowledgeResult.sources])
      } else if (knowledgeResult.sources.length > 0) {
        attachSearchResults(convId!, assistantMsg.id, knowledgeResult.sources)
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
    const imageRequestIds = imageGenerationRequestMapRef.current.get(activeConversationId)
    if (imageRequestIds && imageRequestIds.size > 0) {
      for (const requestId of imageRequestIds) {
        void cancelGenerateImage(requestId)
      }
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
            <div className="w-16 h-16 mx-auto mb-6 flex items-center justify-center">
              <img src={katopLogo} alt="KatopGPT" className="w-16 h-16 object-contain drop-shadow-[0_0_24px_rgba(139,92,246,0.35)]" />
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
    <div className="relative flex-1 flex flex-col min-w-0">
      {roleFlash && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center pb-24">
          <div key={roleFlash.key} className="role-flash-card">
            <RoleAvatar avatarId={roleFlash.avatarId} emoji={roleFlash.emoji} size="xl" />
            <div className="mt-3 text-center">
              <div className="text-sm font-semibold text-amber-50">已切换角色</div>
              <div className="mt-0.5 text-base font-semibold text-surface-100">{roleFlash.name}</div>
              {roleFlash.description && (
                <div className="mt-1 max-w-56 truncate text-xs text-surface-400">
                  {roleFlash.description}
                </div>
              )}
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
            <MessageBubble
              key={msg.id}
              message={msg}
              onContinueImageEdit={handleContinueImageEdit}
              onOpenImagePreview={handleOpenImagePreview}
            />
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
        activeAssistantProfileId={activeAssistantProfileId}
        onRoleSelected={handleRoleSelected}
      />
      <ImageZoomViewer
        image={previewImage}
        scale={previewScale}
        offset={previewOffset}
        onScaleChange={handlePreviewScaleChange}
        onOffsetChange={setPreviewOffset}
        onClose={handleCloseImagePreview}
      />
    </div>
  )
}
