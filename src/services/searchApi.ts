import type { SearchResult } from '../types'

export class SearchApiError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'SearchApiError'
  }
}

/** Simple in-memory cache with TTL */
class SearchCache {
  private cache = new Map<string, { results: SearchResult[]; timestamp: number }>()
  private readonly ttl = 5 * 60 * 1000 // 5 minutes

  get(query: string): SearchResult[] | null {
    const entry = this.cache.get(query)
    if (!entry) return null
    
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(query)
      return null
    }
    
    return entry.results
  }

  set(query: string, results: SearchResult[]): void {
    this.cache.set(query, { results, timestamp: Date.now() })
  }

  clear(): void {
    this.cache.clear()
  }
}

const searchCache = new SearchCache()

/** Serper API response structure */
interface SerperResponse {
  organic?: Array<{
    title: string
    link: string
    snippet: string
    date?: string
  }>
  error?: string
}

/**
 * Search the web using Serper API (Google results)
 * @param query Search query
 * @param apiKey Serper API key
 * @param lang Language code (default: zh-CN for Chinese)
 * @param maxResults Maximum number of results (default: 8)
 */
export async function webSearch(
  query: string,
  apiKey: string,
  engine: 'serper' | 'tavily' = 'tavily',
  lang: string = 'zh-CN',
  maxResults: number = 8
): Promise<SearchResult[]> {
  // Route to appropriate search engine
  if (engine === 'tavily') {
    return tavilySearch(query, apiKey, maxResults)
  }
  
  // Serper implementation below
  // Check cache first
  const cached = searchCache.get(query)
  if (cached) {
    console.log('%c[Search Cache] %c✓ %s', 'color:#10b981;font-weight:bold', 'color:#64748b', query)
    return cached.slice(0, maxResults)
  }

  // Validate API key
  if (!apiKey || apiKey.trim() === '') {
    throw new SearchApiError('Serper API key 未配置')
  }

  // Map language to Serper lr parameter
  const lrParam = lang === 'zh-CN' ? 'lang_zh-CN' : 
                  lang === 'zh-TW' ? 'lang_zh-TW' : 
                  `lang_${lang}`

  console.group('%c[Search Request] %c→ %s', 'color:#5c7cfa;font-weight:bold', 'color:#64748b', query)
  console.log('%cLanguage: %c%s', 'color:#8494b2', 'color:#e8ecf4', lrParam)
  console.log('%cMax results: %c%d', 'color:#8494b2', 'color:#e8ecf4', maxResults)
  console.groupEnd()

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        lr: lrParam,
        num: maxResults,
      }),
    })

    if (!response.ok) {
      let errorMsg = `搜索请求失败 (${response.status})`
      try {
        const errorBody = await response.json()
        errorMsg = (errorBody as { message?: string }).message ?? errorMsg
      } catch {
        // ignore parse error
      }
      console.group('%c[Search Error] %c← %s', 'color:#ef4444;font-weight:bold', 'color:#64748b', response.status)
      console.log(errorMsg)
      console.groupEnd()
      throw new SearchApiError(errorMsg, response.status)
    }

    const data: SerperResponse = await response.json()

    if (data.error) {
      throw new SearchApiError(data.error)
    }

    const results: SearchResult[] = (data.organic ?? []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      date: item.date,
    }))

    console.group('%c[Search Response] %c← %d results', 'color:#10b981;font-weight:bold', 'color:#64748b', results.length)
    console.log('%cQuery: %c%s', 'color:#8494b2', 'color:#e8ecf4', query)
    console.log('%cResults:', 'color:#8494b2')
    console.dir(results.slice(0, 3), { depth: null })
    console.groupEnd()

    // Cache results
    searchCache.set(query, results)

    return results
  } catch (error) {
    if (error instanceof SearchApiError) {
      throw error
    }
    throw new SearchApiError(
      error instanceof Error ? error.message : '搜索请求失败'
    )
  }
}


/** Tavily API response structure */
interface TavilyResponse {
  results?: Array<{
    title: string
    url: string
    content: string
    published_date?: string
  }>
  error?: string
}

/**
 * Search the web using Tavily API (AI-optimized results)
 * @param query Search query
 * @param apiKey Tavily API key
 * @param maxResults Maximum number of results (default: 8)
 */
async function tavilySearch(
  query: string,
  apiKey: string,
  maxResults: number = 8
): Promise<SearchResult[]> {
  // Check cache first
  const cached = searchCache.get(query)
  if (cached) {
    console.log('%c[Search Cache] %c✓ %s', 'color:#10b981;font-weight:bold', 'color:#64748b', query)
    return cached.slice(0, maxResults)
  }

  // Validate API key
  if (!apiKey || apiKey.trim() === '') {
    throw new SearchApiError('Tavily API key 未配置')
  }

  console.group('%c[Search Request] %c→ %s (Tavily)', 'color:#5c7cfa;font-weight:bold', 'color:#64748b', query)
  console.log('%cMax results: %c%d', 'color:#8494b2', 'color:#e8ecf4', maxResults)
  console.groupEnd()

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
      }),
    })

    if (!response.ok) {
      let errorMsg = `搜索请求失败 (${response.status})`
      try {
        const errorBody = await response.json()
        errorMsg = (errorBody as { error?: string }).error ?? errorMsg
      } catch {
        // ignore parse error
      }
      console.group('%c[Search Error] %c← %s', 'color:#ef4444;font-weight:bold', 'color:#64748b', response.status)
      console.log(errorMsg)
      console.groupEnd()
      throw new SearchApiError(errorMsg, response.status)
    }

    const data: TavilyResponse = await response.json()

    if (data.error) {
      throw new SearchApiError(data.error)
    }

    const results: SearchResult[] = (data.results ?? []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.content.slice(0, 500), // Truncate long content
      date: item.published_date,
    }))

    console.group('%c[Search Response] %c← %d results (Tavily)', 'color:#10b981;font-weight:bold', 'color:#64748b', results.length)
    console.log('%cQuery: %c%s', 'color:#8494b2', 'color:#e8ecf4', query)
    console.log('%cResults:', 'color:#8494b2')
    console.dir(results.slice(0, 3), { depth: null })
    console.groupEnd()

    // Cache results
    searchCache.set(query, results)

    return results
  } catch (error) {
    if (error instanceof SearchApiError) {
      throw error
    }
    throw new SearchApiError(
      error instanceof Error ? error.message : '搜索请求失败'
    )
  }
}

/**
 * Format search results into LLM context string
 * @param results Search results
 * @param maxTokens Approximate token budget (default: 4000)
 */
export function formatSearchContext(
  results: SearchResult[],
  maxTokens: number = 4000
): string {
  const contextParts: string[] = []
  let currentTokens = 0

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const snippet = result.snippet.slice(0, 500) // Truncate long snippets
    const date = result.date ? `\n日期: ${result.date}` : ''

    const entry = `[来源 ${i + 1}]
标题: ${result.title}
链接: ${result.url}${date}
内容: ${snippet}`

    // Rough token estimation (1 token ≈ 4 chars for Chinese)
    const entryTokens = Math.ceil(entry.length / 4)
    
    if (currentTokens + entryTokens > maxTokens) {
      break
    }

    contextParts.push(entry)
    currentTokens += entryTokens
  }

  return contextParts.join('\n\n')
}

/**
 * Detect if a query needs web search (heuristic-based)
 * @param query User query
 */
export function shouldTriggerSearch(query: string): boolean {
  const lowerQuery = query.toLowerCase()

  // Patterns that indicate need for current information
  const needsSearchPatterns = [
    /\b(最新|最近|当前|新|今天|现在|今年|2024|2025|2026)\b/,
    /\b(价格|新闻|更新|发布|公告)\b/,
    /\b(什么是|谁是|哪里|何时|为什么).*\b(最新|最近|现在)\b/,
    /\b(比较|对比|vs|versus|最好|推荐)\b/,
  ]

  // Patterns that indicate no search needed
  const noSearchPatterns = [
    /^(写|创建|生成|总结|解释|翻译)/,
    /\b(我的|我们的|私人|个人)\b/,
    /^(帮我|请|能否|可以)/,
  ]

  // Check no-search patterns first
  if (noSearchPatterns.some((pattern) => pattern.test(lowerQuery))) {
    return false
  }

  // Check needs-search patterns
  if (needsSearchPatterns.some((pattern) => pattern.test(lowerQuery))) {
    return true
  }

  // Default: no search
  return false
}
