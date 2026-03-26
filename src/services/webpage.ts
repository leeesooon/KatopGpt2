import type { SearchResult } from '../types'
import { normalizeExternalUrl } from '../utils/externalLinks'

const URL_RE = /https?:\/\/[^\s<>"']+/gi
const MAX_URLS_PER_MESSAGE = 3
const MAX_PAGE_CONTENT_CHARS = 6000
const MAX_PAGE_SNIPPET_CHARS = 2400

const CONTENT_ROOT_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '.article',
  '.article-content',
  '.post-content',
  '.entry-content',
  '.content',
  '.main-content',
  '#content',
]

const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'form',
  'button',
  'nav',
  'footer',
  'aside',
  '[role="navigation"]',
  '[role="complementary"]',
  '.cookie',
  '.cookies',
  '.consent',
  '.newsletter',
  '.social-share',
  '.related',
  '.recommended',
  '.advertisement',
  '.ads',
]

interface FetchedWebPage {
  finalUrl: string
  html: string
  contentType: string
}

function normalizeWhitespace(text: string) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trimEnd()}...`
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}

function normalizeCandidateUrl(rawUrl: string) {
  let candidate = rawUrl.trim()

  while (candidate) {
    const normalized = normalizeExternalUrl(candidate)
    if (normalized) return normalized
    candidate = candidate.slice(0, -1)
  }

  return null
}

export function extractUrlsFromText(text: string) {
  const seen = new Set<string>()
  const urls: string[] = []
  URL_RE.lastIndex = 0

  for (const match of text.matchAll(URL_RE)) {
    const normalizedUrl = normalizeCandidateUrl(match[0])
    if (!normalizedUrl || seen.has(normalizedUrl)) continue

    seen.add(normalizedUrl)
    urls.push(normalizedUrl)

    if (urls.length >= MAX_URLS_PER_MESSAGE) break
  }

  return urls
}

function getMetaContent(doc: Document, selectors: string[]) {
  for (const selector of selectors) {
    const value = doc.querySelector<HTMLMetaElement>(selector)?.content?.trim()
    if (value) return value
  }

  return ''
}

function collectTextBlocks(root: ParentNode) {
  const candidates = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre, blockquote'))
  const blocks: string[] = []

  for (const node of candidates) {
    const text = normalizeWhitespace(node.textContent ?? '')
    if (!text) continue

    const previous = blocks[blocks.length - 1]
    if (previous === text) continue

    blocks.push(text)
  }

  if (blocks.length > 0) {
    return blocks.join('\n\n')
  }

  return normalizeWhitespace((root as HTMLElement).innerText || root.textContent || '')
}

function parseWebPage(html: string, fallbackUrl: string, contentType: string) {
  if (contentType.includes('text/plain')) {
    const contentText = truncateText(normalizeWhitespace(html), MAX_PAGE_CONTENT_CHARS)

    return {
      title: fallbackUrl,
      snippet: truncateText(contentText, MAX_PAGE_SNIPPET_CHARS),
      contentText,
    }
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  for (const selector of NOISE_SELECTORS) {
    doc.querySelectorAll(selector).forEach((node) => node.remove())
  }

  const title =
    normalizeWhitespace(doc.title) ||
    normalizeWhitespace(doc.querySelector('h1')?.textContent ?? '') ||
    getMetaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
    fallbackUrl

  const description = getMetaContent(doc, [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ])

  const root = CONTENT_ROOT_SELECTORS
    .map((selector) => doc.querySelector(selector))
    .find((node) => node != null) ?? doc.body

  const contentText = truncateText(collectTextBlocks(root), MAX_PAGE_CONTENT_CHARS)
  const snippetSource = description || contentText
  const snippet = truncateText(snippetSource, MAX_PAGE_SNIPPET_CHARS)

  return {
    title,
    snippet,
    contentText,
  }
}

async function fetchWebPage(url: string): Promise<FetchedWebPage> {
  if (window.electronAPI?.fetchWebPage) {
    return window.electronAPI.fetchWebPage(url)
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`网页请求失败 (${response.status})`)
  }

  return {
    finalUrl: response.url || url,
    html: await response.text(),
    contentType: response.headers.get('content-type') ?? '',
  }
}

export async function readWebPagesFromText(text: string) {
  const urls = extractUrlsFromText(text)
  if (urls.length === 0) {
    return {
      sources: [] as SearchResult[],
    }
  }

  const pages = await Promise.all(
    urls.map(async (url) => {
      try {
        const page = await fetchWebPage(url)
        const parsed = parseWebPage(page.html, page.finalUrl, page.contentType)

        return {
          source: {
            title: parsed.title,
            url: page.finalUrl,
            snippet: parsed.snippet,
          } satisfies SearchResult,
          contentText: parsed.contentText,
        }
      } catch (error) {
        console.group('%c[Web Page] %c✗ Failed to read', 'color:#ef4444;font-weight:bold', 'color:#64748b')
        console.log('%cURL: %c%s', 'color:#8494b2', 'color:#e8ecf4', url)
        console.error(error)
        console.groupEnd()
        return null
      }
    })
  )

  const successfulPages = pages.filter((page): page is NonNullable<typeof page> => page !== null)
  const sources = successfulPages.map((page) => ({
    ...page.source,
    snippet: page.contentText || page.source.snippet,
  }))

  return {
    sources,
  }
}

export function formatWebPageContext(
  sources: SearchResult[],
  maxTokens: number = 5000,
  startIndex: number = 1
) {
  const contextParts: string[] = []
  let currentTokens = 0

  for (let i = 0; i < sources.length; i++) {
    const sourceIndex = startIndex + i
    const source = sources[i]
    const content = truncateText(source.snippet, MAX_PAGE_SNIPPET_CHARS)
    const entry = `[来源 ${sourceIndex}]
类型: 用户提供的网页
标题: ${source.title}
链接: ${source.url}
内容: ${content}`

    const entryTokens = estimateTokens(entry)
    if (currentTokens + entryTokens > maxTokens) {
      break
    }

    contextParts.push(entry)
    currentTokens += entryTokens
  }

  return contextParts.join('\n\n')
}
