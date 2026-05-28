import type { ApiConfig, Message, SearchEngine, SearchResult } from '../types'
import { completeChatText } from './chatApi'
import { formatSearchContext, shouldTriggerSearch, webSearch } from './searchApi'

interface SearchPlan {
  shouldSearch: boolean
  queries: string[]
  reason?: string
}

interface AgenticSearchResult {
  results: SearchResult[]
  context: string
}

export type AgenticSearchProgress =
  | { phase: 'planning_search'; engine: SearchEngine; sourceCount: number }
  | { phase: 'searching'; engine: SearchEngine; sourceCount: number }
  | { phase: 'organizing'; engine: SearchEngine; sourceCount: number }

interface AgenticSearchOptions {
  signal?: AbortSignal
  onProgress?: (progress: AgenticSearchProgress) => void
}

function isAbortSignal(value: AbortSignal | AgenticSearchOptions | undefined): value is AbortSignal {
  return Boolean(
    value
    && typeof value === 'object'
    && 'aborted' in value
    && 'addEventListener' in value
  )
}

function extractJsonObject(text: string) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
      } catch {
        return null
      }
    }
    return null
  }
}

function normalizeQueries(value: unknown, fallbackQuery: string) {
  if (!Array.isArray(value)) return [fallbackQuery]
  const queries = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
  return Array.from(new Set(queries)).slice(0, 3)
}

function buildRecentContext(messages: Message[]) {
  return messages
    .slice(-6)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}: ${message.content.slice(0, 800)}`)
    .join('\n\n')
}

async function planSearch(
  config: ApiConfig,
  userPrompt: string,
  recentMessages: Message[],
  forceSearch: boolean,
  signal?: AbortSignal
): Promise<SearchPlan> {
  if (!forceSearch && !shouldTriggerSearch(userPrompt)) {
    return { shouldSearch: false, queries: [] }
  }

  try {
    const plannerPrompt = [
      '请判断用户问题是否需要联网搜索，并生成适合中文用户的搜索 query。',
      '只输出 JSON，不要输出 Markdown。格式：{"shouldSearch":true,"queries":["query1","query2"],"reason":"..."}',
      '最多 3 个 query；如果问题依赖最新信息、价格、新闻、版本、政策、推荐、对比或明确要求联网，应搜索。',
      forceSearch ? '用户已显式开启联网搜索，除非问题完全无法搜索，否则 shouldSearch 应为 true。' : '',
      `最近上下文：\n${buildRecentContext(recentMessages)}`,
      `用户问题：\n${userPrompt}`,
    ].filter(Boolean).join('\n\n')

    const content = await completeChatText(
      config,
      [
        { role: 'system', content: '你是搜索规划器，只输出严格 JSON。' },
        { role: 'user', content: plannerPrompt },
      ],
      0,
      400,
      signal
    )
    const parsed = extractJsonObject(content)
    if (!parsed) throw new Error('invalid search plan')
    const queries = normalizeQueries(parsed.queries, userPrompt)
    return {
      shouldSearch: Boolean(parsed.shouldSearch) && queries.length > 0,
      queries,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    }
  } catch {
    return {
      shouldSearch: forceSearch || shouldTriggerSearch(userPrompt),
      queries: [userPrompt],
    }
  }
}

function mergeSearchResults(resultGroups: SearchResult[][]) {
  const seen = new Set<string>()
  const merged: SearchResult[] = []
  for (const group of resultGroups) {
    for (const result of group) {
      const key = result.url || result.title
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(result)
    }
  }
  return merged
}

async function planFollowUpSearch(
  config: ApiConfig,
  userPrompt: string,
  currentResults: SearchResult[],
  signal?: AbortSignal
) {
  if (currentResults.length < 3) return []
  try {
    const prompt = [
      '请判断现有搜索结果是否足以回答用户问题。',
      '如果缺少关键角度，最多补充 1 个追搜 query；否则返回空数组。',
      '只输出 JSON：{"queries":[]}',
      `用户问题：\n${userPrompt}`,
      `现有结果：\n${formatSearchContext(currentResults, 1800, 1)}`,
    ].join('\n\n')
    const content = await completeChatText(
      config,
      [
        { role: 'system', content: '你是搜索查漏助手，只输出严格 JSON。' },
        { role: 'user', content: prompt },
      ],
      0,
      250,
      signal
    )
    const parsed = extractJsonObject(content)
    return normalizeQueries(parsed?.queries, '').filter(Boolean).slice(0, 1)
  } catch {
    return []
  }
}

export async function runAgenticSearch(
  config: ApiConfig,
  userPrompt: string,
  recentMessages: Message[],
  apiKey: string,
  engine: SearchEngine,
  forceSearch: boolean,
  startIndex: number,
  options?: AbortSignal | AgenticSearchOptions
): Promise<AgenticSearchResult> {
  const signal = isAbortSignal(options) ? options : options?.signal
  const onProgress = isAbortSignal(options) ? undefined : options?.onProgress

  onProgress?.({ phase: 'planning_search', engine, sourceCount: 0 })
  const plan = await planSearch(config, userPrompt, recentMessages, forceSearch, signal)
  if (!plan.shouldSearch || plan.queries.length === 0) {
    return { results: [], context: '' }
  }

  onProgress?.({ phase: 'searching', engine, sourceCount: 0 })
  const firstRound = await Promise.all(
    plan.queries.map((query) => webSearch(query, apiKey, engine, 'zh-CN', 5, signal))
  )
  let mergedResults = mergeSearchResults(firstRound).slice(0, 10)
  onProgress?.({ phase: 'searching', engine, sourceCount: mergedResults.length })

  onProgress?.({ phase: 'organizing', engine, sourceCount: mergedResults.length })
  const followUpQueries = await planFollowUpSearch(config, userPrompt, mergedResults, signal)
  if (followUpQueries.length > 0) {
    onProgress?.({ phase: 'searching', engine, sourceCount: mergedResults.length })
    const followUp = await Promise.all(
      followUpQueries.map((query) => webSearch(query, apiKey, engine, 'zh-CN', 5, signal))
    )
    mergedResults = mergeSearchResults([mergedResults, ...followUp]).slice(0, 12)
    onProgress?.({ phase: 'searching', engine, sourceCount: mergedResults.length })
  }

  onProgress?.({ phase: 'organizing', engine, sourceCount: mergedResults.length })
  return {
    results: mergedResults,
    context: formatSearchContext(mergedResults, 5000, startIndex),
  }
}

