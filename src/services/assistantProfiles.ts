import type { AppSettings, AssistantProfile, KnowledgeChunk, KnowledgeDocument, SearchResult } from '../types'
import { getDefaultAvatarIdForProfile } from './roleAvatars'

const BUILT_IN_CREATED_AT = 1700000000000
const KNOWLEDGE_CHUNK_SIZE = 1400
const KNOWLEDGE_CHUNK_OVERLAP = 180
const MAX_KNOWLEDGE_CONTEXT_CHARS = 7000
const MAX_KNOWLEDGE_RESULTS = 5

type BuiltInProfileDraft = Omit<AssistantProfile, 'knowledgeDocuments' | 'createdAt' | 'updatedAt'>

const BUILT_IN_PROFILE_DRAFTS: BuiltInProfileDraft[] = [
  {
    id: 'builtin-general',
    name: '通用助手',
    description: '日常问答、总结、翻译和轻量写作。',
    emoji: '✨',
    avatarId: 'assistant-general',
    instructions: '你是一个清晰、可靠的通用 AI 助手。优先理解用户真实目标，给出直接、有用、可执行的回答。遇到不确定信息时明确说明不确定性，不编造。',
    tone: '简洁、自然、直接，必要时补充关键背景。',
    outputFormat: '默认使用中文；复杂问题先给结论，再给步骤或要点。',
    domainHints: '适合日常知识、办公、写作、总结、翻译、轻量分析。',
    isBuiltIn: true,
    isDefault: true,
  },
  {
    id: 'builtin-engineer',
    name: '代码工程师',
    description: '代码解释、调试、重构和架构建议。',
    emoji: '⌘',
    avatarId: 'assistant-engineer',
    instructions: '你是资深软件工程师。回答代码问题时先定位问题和约束，再给最小可行修复；优先可执行方案、边界条件和验证方式；不要给空泛建议。',
    tone: '专业、直接、审慎，避免过度解释基础概念。',
    outputFormat: '优先使用问题定位、修改方案、验证方式三段结构；代码示例保持简洁。',
    domainHints: '软件工程、TypeScript、React、Electron、API、调试、重构、工程质量。',
    isBuiltIn: true,
  },
  {
    id: 'builtin-writer',
    name: '写作编辑',
    description: '润色、改写、标题、文案和报告。',
    emoji: '✍',
    avatarId: 'assistant-writer',
    instructions: '你是专业中文写作编辑。优先改善结构、节奏、表达准确性和读者感受；保留原意，不擅自添加未经确认的事实。',
    tone: '精炼、有质感，按用户指定场景调整正式度。',
    outputFormat: '需要改写时可给 2-3 个版本；长文先给结构建议，再给正文。',
    domainHints: '中文写作、商业文案、报告、邮件、标题、表达润色。',
    isBuiltIn: true,
  },
  {
    id: 'builtin-tutor',
    name: '学习导师',
    description: '概念讲解、学习计划和分步骤辅导。',
    emoji: '□',
    avatarId: 'assistant-tutor',
    instructions: '你是耐心的学习导师。先判断用户当前理解层级，用例子解释抽象概念，并通过小问题或检查点确认掌握情况。',
    tone: '耐心、清楚、循序渐进，不居高临下。',
    outputFormat: '优先使用“直观解释 -> 例子 -> 常见误区 -> 练习/下一步”。',
    domainHints: '学习规划、知识讲解、考试准备、技能训练。',
    isBuiltIn: true,
  },
  {
    id: 'builtin-pm',
    name: '产品经理',
    description: '需求拆解、PRD、用户故事和验收标准。',
    emoji: '◆',
    avatarId: 'assistant-pm',
    instructions: '你是务实的产品经理。始终围绕用户目标、业务价值、边界、优先级和验收标准组织回答；主动暴露关键取舍和风险。',
    tone: '结构化、克制、面向落地。',
    outputFormat: '优先输出目标、范围、核心流程、边界规则、验收标准。',
    domainHints: '产品设计、需求分析、PRD、用户故事、功能规划、优先级。',
    isBuiltIn: true,
  },
  {
    id: 'builtin-data-analyst',
    name: '数据分析师',
    description: '指标分析、表格理解、结论提炼和图表建议。',
    emoji: '▦',
    avatarId: 'assistant-data',
    instructions: '你是严谨的数据分析师。先明确分析口径和假设，再提炼结论；发现异常、缺失或口径不清时要说明，不做过度推断。',
    tone: '客观、严谨、结论先行。',
    outputFormat: '优先输出关键结论、证据、异常点、后续建议；涉及图表时说明推荐图表类型。',
    domainHints: '数据分析、Excel、CSV、指标口径、统计、图表、业务洞察。',
    isBuiltIn: true,
  },
  {
    id: 'builtin-translator',
    name: '翻译专家',
    description: '中英互译、本地化、多版本表达。',
    emoji: '文',
    avatarId: 'assistant-translator',
    instructions: '你是专业翻译和本地化专家。优先准确传达原意、语气和场景；保留必要术语，并在有歧义时说明关键选择。',
    tone: '准确、自然、符合目标语言习惯。',
    outputFormat: '默认直接给译文；需要时附术语说明、直译/意译版本或语气版本。',
    domainHints: '中英互译、本地化、术语统一、商务表达、技术文档翻译。',
    isBuiltIn: true,
  },
  {
    id: 'builtin-researcher',
    name: '研究助手',
    description: '资料整理、行业/竞品分析和来源归纳。',
    emoji: '◎',
    avatarId: 'assistant-researcher',
    instructions: '你是研究助手。整理资料时区分事实、推断和待验证信息；引用来源时保持可追踪，不把检索结果包装成确定结论。',
    tone: '客观、审慎、信息密度高。',
    outputFormat: '优先输出摘要、关键发现、证据/来源、不确定性、下一步验证。',
    domainHints: '资料研究、行业分析、竞品分析、政策/市场信息整理。',
    isBuiltIn: true,
  },
]

function createBuiltInProfile(draft: BuiltInProfileDraft): AssistantProfile {
  return {
    ...draft,
    avatarId: draft.avatarId ?? getDefaultAvatarIdForProfile(draft.id),
    knowledgeDocuments: [],
    createdAt: BUILT_IN_CREATED_AT,
    updatedAt: BUILT_IN_CREATED_AT,
  }
}

export const BUILT_IN_ASSISTANT_PROFILES = BUILT_IN_PROFILE_DRAFTS.map(createBuiltInProfile)

export function getDefaultAssistantProfiles() {
  return BUILT_IN_ASSISTANT_PROFILES.map((profile) => ({
    ...profile,
    knowledgeDocuments: [],
  }))
}

export function mergeBuiltInAssistantProfiles(profiles: AssistantProfile[] | undefined) {
  const existingProfiles = Array.isArray(profiles) ? profiles : []
  const existingById = new Map(existingProfiles.map((profile) => [profile.id, profile]))
  const mergedBuiltIns = BUILT_IN_ASSISTANT_PROFILES.map((builtIn) => {
    const existing = existingById.get(builtIn.id)
    return existing
      ? {
          ...builtIn,
          ...existing,
          avatarId: existing.avatarId ?? builtIn.avatarId,
          isBuiltIn: true,
          knowledgeDocuments: existing.knowledgeDocuments ?? [],
        }
      : { ...builtIn, knowledgeDocuments: [] }
  })
  const customProfiles = existingProfiles.filter((profile) => !BUILT_IN_PROFILE_DRAFTS.some((builtIn) => builtIn.id === profile.id))
  return [...mergedBuiltIns, ...customProfiles]
}

export function resolveDefaultAssistantProfile(settings: AppSettings) {
  const profiles = settings.assistantProfiles.filter((profile) => !profile.isHidden)
  return profiles.find((profile) => profile.id === settings.activeAssistantProfileId)
    ?? profiles.find((profile) => profile.isDefault)
    ?? profiles[0]
    ?? null
}

export function resolveAssistantProfile(settings: AppSettings, profileId?: string | null) {
  const profiles = settings.assistantProfiles.filter((profile) => !profile.isHidden)
  return profiles.find((profile) => profile.id === profileId)
    ?? resolveDefaultAssistantProfile(settings)
}

export function resolveActiveAssistantProfile(settings: AppSettings) {
  return resolveDefaultAssistantProfile(settings)
}

export function buildAssistantSystemPrompt(settings: AppSettings, knowledgeContext?: string, profileId?: string | null) {
  const basePrompt = settings.systemPrompt.trim()
  const profile = resolveAssistantProfile(settings, profileId)
  const sections = [basePrompt]

  if (profile) {
    const profileLines = [
      '当前定制助手：',
      `名称：${profile.name}`,
      profile.description.trim() ? `简介：${profile.description.trim()}` : '',
      profile.instructions.trim() ? `核心指令：\n${profile.instructions.trim()}` : '',
      profile.tone.trim() ? `回复语气：${profile.tone.trim()}` : '',
      profile.outputFormat.trim() ? `输出格式偏好：${profile.outputFormat.trim()}` : '',
      profile.domainHints.trim() ? `专业领域/背景提示：${profile.domainHints.trim()}` : '',
    ].filter(Boolean)
    sections.push(profileLines.join('\n'))
  }

  if (knowledgeContext?.trim()) {
    sections.push([
      '当前助手的知识资料片段：',
      '请优先参考这些资料回答。资料不足或问题超出资料范围时，明确说明缺口，不要编造。',
      knowledgeContext.trim(),
    ].join('\n'))
  }

  return sections.filter(Boolean).join('\n\n')
}

function normalizeKnowledgeText(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function splitKnowledgeIntoChunks(documentId: string, documentName: string, content: string): KnowledgeChunk[] {
  const normalized = normalizeKnowledgeText(content)
  if (!normalized) return []

  const chunks: KnowledgeChunk[] = []
  let offset = 0
  while (offset < normalized.length) {
    const slice = normalized.slice(offset, offset + KNOWLEDGE_CHUNK_SIZE)
    const breakIndex = Math.max(
      slice.lastIndexOf('\n\n'),
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('\n')
    )
    const cutIndex = breakIndex > KNOWLEDGE_CHUNK_SIZE * 0.55 ? breakIndex + 1 : slice.length
    const chunkText = slice.slice(0, cutIndex).trim()
    if (chunkText) {
      chunks.push({
        id: `${documentId}-chunk-${chunks.length}`,
        documentId,
        documentName,
        content: chunkText,
        index: chunks.length,
      })
    }
    offset += Math.max(1, cutIndex - KNOWLEDGE_CHUNK_OVERLAP)
  }

  return chunks
}

function tokenizeQuery(text: string) {
  const normalized = text.toLowerCase()
  const latinTokens = normalized.match(/[a-z0-9_]{2,}/g) ?? []
  const chineseTokens = normalized
    .match(/[\u4e00-\u9fa5]{2,}/g)
    ?.flatMap((segment) => {
      const tokens = [segment]
      for (let index = 0; index < segment.length - 1; index += 1) {
        tokens.push(segment.slice(index, index + 2))
      }
      return tokens
    }) ?? []
  return Array.from(new Set([...latinTokens, ...chineseTokens])).slice(0, 80)
}

function scoreChunk(chunk: KnowledgeChunk, queryTokens: string[]) {
  if (queryTokens.length === 0) return 0
  const content = chunk.content.toLowerCase()
  const title = chunk.documentName.toLowerCase()
  return queryTokens.reduce((score, token) => {
    if (title.includes(token)) return score + 5
    if (content.includes(token)) return score + Math.min(4, Math.max(1, token.length - 1))
    return score
  }, 0)
}

export function searchAssistantKnowledge(settings: AppSettings, query: string, profileId?: string | null) {
  const profile = resolveAssistantProfile(settings, profileId)
  if (!profile) return { context: '', sources: [] as SearchResult[] }

  const queryTokens = tokenizeQuery([
    query,
    profile.name,
    profile.description,
    profile.domainHints,
  ].filter(Boolean).join('\n'))

  const rankedChunks = profile.knowledgeDocuments
    .filter((document) => document.enabled)
    .flatMap((document) => document.chunks)
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_KNOWLEDGE_RESULTS)

  let totalChars = 0
  const selected = rankedChunks.filter(({ chunk }) => {
    if (totalChars >= MAX_KNOWLEDGE_CONTEXT_CHARS) return false
    totalChars += chunk.content.length
    return true
  })

  const context = selected
    .map(({ chunk }, index) => `[知识 ${index + 1} | ${chunk.documentName} | 片段 ${chunk.index + 1}]\n${chunk.content}`)
    .join('\n\n')

  const sources = selected.map(({ chunk }, index) => ({
    title: `${chunk.documentName} · 片段 ${chunk.index + 1}`,
    url: '',
    snippet: chunk.content.slice(0, 180),
    date: `知识资料 ${index + 1}`,
  }))

  return { context, sources }
}

export function cloneProfileAsCustom(profile: AssistantProfile, id: string): AssistantProfile {
  const now = Date.now()
  return {
    ...profile,
    id,
    name: `${profile.name} 副本`,
    isBuiltIn: false,
    isDefault: false,
    isHidden: false,
    knowledgeDocuments: profile.knowledgeDocuments.map((document) => ({
      ...document,
      id: `${id}-${document.id}`,
      chunks: document.chunks.map((chunk) => ({
        ...chunk,
        id: `${id}-${chunk.id}`,
        documentId: `${id}-${document.id}`,
      })),
    })),
    createdAt: now,
    updatedAt: now,
  }
}

export function resetBuiltInProfile(profile: AssistantProfile): AssistantProfile {
  const builtIn = BUILT_IN_ASSISTANT_PROFILES.find((item) => item.id === profile.id)
  if (!builtIn) return profile
  return {
    ...builtIn,
    knowledgeDocuments: profile.knowledgeDocuments ?? [],
    isHidden: false,
    updatedAt: Date.now(),
  }
}

export function createKnowledgeDocument(
  id: string,
  name: string,
  size: number,
  content: string,
  fileType?: KnowledgeDocument['fileType']
): KnowledgeDocument {
  const now = Date.now()
  return {
    id,
    name,
    size,
    fileType,
    content,
    chunks: splitKnowledgeIntoChunks(id, name, content),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}
