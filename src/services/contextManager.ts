import type { ApiConfig, Conversation, ConversationSummary, Message } from '../types'
import { completeChatText } from './chatApi'

const SUMMARY_TRIGGER_MESSAGE_COUNT = 24
const SUMMARY_KEEP_RECENT_COUNT = 12
const SUMMARY_MAX_SOURCE_CHARS = 16000
const SUMMARY_MAX_TOKENS = 900

function estimateMessageChars(message: Message) {
  const fileChars = message.files?.reduce((total, file) => total + Math.min(file.content.length, 2000), 0) ?? 0
  const imageChars = message.images?.length ? message.images.length * 120 : 0
  return message.content.length + fileChars + imageChars
}

function formatMessageForSummary(message: Message) {
  const roleLabel = message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '系统'
  const fileText = message.files?.length
    ? `\n附件：${message.files.map((file) => `${file.name}（${file.fileType ?? 'file'}）`).join('、')}`
    : ''
  const imageText = message.images?.length ? `\n图片：${message.images.length} 张` : ''
  return `${roleLabel}: ${message.content}${fileText}${imageText}`.trim()
}

function extractMessagesForSummary(messages: Message[], summary?: ConversationSummary) {
  const recentBoundary = Math.max(0, messages.length - SUMMARY_KEEP_RECENT_COUNT)
  const coveredIndex = summary
    ? messages.findIndex((message) => message.id === summary.coveredMessageId) + 1
    : 0
  const startIndex = Math.max(0, coveredIndex)
  return messages.slice(startIndex, recentBoundary)
}

export function shouldUpdateConversationSummary(conversation: Conversation) {
  const summarizableMessages = extractMessagesForSummary(conversation.messages, conversation.summary)
  if (summarizableMessages.length < 8) return false
  if (conversation.messages.length >= SUMMARY_TRIGGER_MESSAGE_COUNT) return true
  const chars = summarizableMessages.reduce((total, message) => total + estimateMessageChars(message), 0)
  return chars >= 12000
}

export async function buildConversationSummary(
  config: ApiConfig,
  conversation: Conversation,
  signal?: AbortSignal
): Promise<ConversationSummary | null> {
  const summarizableMessages = extractMessagesForSummary(conversation.messages, conversation.summary)
  const lastCoveredMessage = summarizableMessages[summarizableMessages.length - 1]
  if (!lastCoveredMessage) return null

  const sourceText = summarizableMessages
    .map(formatMessageForSummary)
    .join('\n\n')
    .slice(-SUMMARY_MAX_SOURCE_CHARS)
  const previousSummary = conversation.summary?.content?.trim()

  const prompt = [
    '请为这段聊天更新一份中文长期上下文摘要，供后续模型回答时使用。',
    '要求：保留用户目标、关键事实、约束、已做决定、待办事项、重要文件/表格信息；删除寒暄和重复内容；不要编造。',
    '输出 5-12 条简洁要点。',
    previousSummary ? `已有摘要：\n${previousSummary}` : '',
    `新增对话：\n${sourceText}`,
  ].filter(Boolean).join('\n\n')

  try {
    const content = await completeChatText(
      config,
      [
        { role: 'system', content: '你是聊天上下文整理助手，只输出可复用的中文摘要。' },
        { role: 'user', content: prompt },
      ],
      0,
      SUMMARY_MAX_TOKENS,
      signal
    )
    if (!content) return null
    return {
      content,
      coveredMessageId: lastCoveredMessage.id,
      coveredMessageCount: (conversation.summary?.coveredMessageCount ?? 0) + summarizableMessages.length,
      updatedAt: Date.now(),
    }
  } catch {
    return null
  }
}

export function buildSmartContextMessages(
  messages: Message[],
  summary: ConversationSummary | undefined,
  contextWindowSize: number,
  currentUserMessageId: string,
  currentUserContent: string
) {
  const safeWindowSize = Math.max(1, contextWindowSize)
  const recentMessages = messages.length > safeWindowSize
    ? messages.slice(-safeWindowSize)
    : messages
  const mappedMessages = recentMessages.map((message) => {
    if (message.id !== currentUserMessageId) return message
    return { ...message, content: currentUserContent }
  })

  if (!summary?.content.trim()) return mappedMessages

  const coveredMessageStillIncluded = mappedMessages.some((message) => message.id === summary.coveredMessageId)
  if (coveredMessageStillIncluded) return mappedMessages

  return [
    {
      id: `summary-${summary.coveredMessageId}`,
      role: 'system' as const,
      content: `以下是本会话较早内容的摘要，请作为长期上下文使用：\n\n${summary.content}`,
      timestamp: summary.updatedAt,
    },
    ...mappedMessages,
  ]
}

