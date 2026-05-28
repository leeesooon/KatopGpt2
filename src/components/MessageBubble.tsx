import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check, User, Bot, FileText, Download, ExternalLink, Sparkles } from 'lucide-react'
import type { AssistantWorkState, FileAttachment, ImageAttachment, Message } from '../types'
import SourcesPanel from './SourcesPanel'
import { normalizeExternalUrl, openExternalUrl } from '../utils/externalLinks'
import MermaidBlock from './MermaidBlock'
import { useWorkspaceStore } from '../store/workspaceStore'
import type { WorkspaceImageViewPayload } from './workspaceMarkdown'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  workState?: AssistantWorkState
  onContinueImageEdit?: (image: ImageAttachment) => void
  onOpenImagePreview?: (image: WorkspaceImageViewPayload) => void
}

type CitationContainerTag = 'blockquote' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'li' | 'p' | 'td' | 'th'

const MARKDOWN_WRAPPER_RE = /^\s*```[ \t]*(?:markdown|md)\s*\r?\n/i
const TRAILING_FENCE_RE = /\r?\n```[ \t]*$/
const CITATION_RE = /(\[\d+\])/g
const SKIP_CITATION_TAGS = new Set(['a', 'code', 'pre'])
const DEFAULT_PREVIEW_COLUMNS = 6
const CELL_TEXT_PREVIEW_LENGTH = 48

function formatMessageFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1048576).toFixed(1)} MB`
}

function getMessageSpreadsheetSummary(file: FileAttachment) {
  const schema = file.spreadsheetSchema
  if (!schema?.sheets.length) return null
  const totalRows = schema.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0)
  const totalColumns = schema.sheets.reduce((sum, sheet) => sum + sheet.columnCount, 0)
  return `${schema.sheets.length} 表 / ${totalRows} 行 / ${totalColumns} 列`
}

function handleExternalAnchorClick(event: React.MouseEvent<HTMLAnchorElement>, rawUrl?: string | null) {
  event.preventDefault()
  openExternalUrl(rawUrl ?? '')
}

function transformMarkdownUrl(url: string) {
  if (/^data:image\//i.test(url)) {
    return url
  }

  return url
}

function MessageImage({
  image,
  isUser,
  onContinueEdit,
}: {
  image: ImageAttachment
  isUser: boolean
  onContinueEdit?: (image: ImageAttachment) => void
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null)
  const imageSrc = fallbackSrc ?? image.url ?? image.base64 ?? ''

  useEffect(() => {
    setFallbackSrc(null)
  }, [image.url, image.base64])

  const handleImageLoadError = async () => {
    if (!image.url || fallbackSrc || !window.electronAPI?.readImage) return
    const result = await window.electronAPI.readImage(image.url)
    if (result.ok && result.dataUrl) {
      setFallbackSrc(result.dataUrl)
      return
    }
    setStatus(result.message || '图片加载失败')
    setTimeout(() => setStatus(null), 2500)
  }

  const handleOpen = async () => {
    if (image.isGenerating || !imageSrc) return
    if (window.electronAPI?.openImage) {
      const result = await window.electronAPI.openImage(imageSrc, image.name)
      if (!result.ok) {
        setStatus(result.message || '打开图片失败')
        setTimeout(() => setStatus(null), 2500)
      }
      return
    }

    const opened = window.open()
    if (opened) {
      opened.document.write(`<img src="${imageSrc}" alt="${image.name}" style="max-width:100%;height:auto;display:block;margin:0 auto;" />`)
      opened.document.title = image.name
    }
  }

  const handleSave = async () => {
    if (image.isGenerating || !imageSrc) return
    if (window.electronAPI?.saveImage) {
      const result = await window.electronAPI.saveImage(imageSrc, image.name)
      setStatus(result.message || (result.ok ? '已保存图片' : '保存图片失败'))
      setTimeout(() => setStatus(null), 2500)
      return
    }

    const link = document.createElement('a')
    link.href = imageSrc
    link.download = image.name
    link.click()
  }

  if (image.isGenerating) {
    return (
      <div className="relative flex h-[220px] w-[220px] items-center justify-center overflow-hidden rounded-xl border border-fuchsia-300/20 bg-surface-900/60">
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-fuchsia-500/20 via-primary-500/10 to-cyan-400/20" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.14),transparent_45%)] animate-ping" />
        <Sparkles size={34} className="relative z-10 text-fuchsia-200 drop-shadow" />
        <span className="absolute bottom-3 left-0 right-0 z-10 text-center text-xs text-fuchsia-100/80">
          图片生成中...
        </span>
      </div>
    )
  }

  return (
    <div className="group/image relative inline-flex flex-col gap-1">
      <button onClick={handleOpen} className="block text-left" title="打开图片">
        <img
          src={imageSrc}
          alt={image.name}
          onError={() => void handleImageLoadError()}
          className={isUser
            ? 'max-w-[200px] max-h-[200px] rounded-lg object-cover border border-surface-600/30 cursor-pointer hover:opacity-90 transition-opacity'
            : 'max-w-[360px] max-h-[360px] rounded-xl object-contain border border-surface-600/30 cursor-pointer hover:opacity-90 transition-opacity bg-surface-900/40'}
        />
      </button>
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover/image:opacity-100 transition-opacity">
        {!isUser && onContinueEdit && (
          <button
            onClick={() => onContinueEdit({ ...image, base64: fallbackSrc ?? image.base64 })}
            className="px-2 py-1.5 rounded-lg bg-fuchsia-600/90 hover:bg-fuchsia-500 text-white text-xs shadow-lg backdrop-blur-sm"
            title="基于这张图继续修改"
          >
            继续修改
          </button>
        )}
        <button
          onClick={handleOpen}
          className="p-1.5 rounded-lg bg-surface-900/80 hover:bg-surface-800 text-surface-200 shadow-lg backdrop-blur-sm"
          title="打开图片"
        >
          <ExternalLink size={14} />
        </button>
        <button
          onClick={handleSave}
          className="p-1.5 rounded-lg bg-surface-900/80 hover:bg-surface-800 text-surface-200 shadow-lg backdrop-blur-sm"
          title="保存图片"
        >
          <Download size={14} />
        </button>
      </div>
      {status && (
        <span className="max-w-[240px] truncate text-[11px] text-surface-400">
          {status}
        </span>
      )}
    </div>
  )
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group rounded-lg overflow-hidden my-2">
      <div className="flex items-center justify-between px-4 py-1.5 bg-surface-800/90 border-b border-surface-700/50">
        <span className="text-xs text-surface-400 font-mono">{language || 'text'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-surface-400 hover:text-surface-200 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '1em',
          background: 'rgba(15, 23, 42, 0.8)',
          fontSize: '0.95em',
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  )
}

function inferMarkdownFileName(content: string) {
  const headingMatch = content.match(/^#{1,3}\s+(.+)$/m)
  const baseName = headingMatch?.[1] ?? content.split(/\r?\n/).find((line) => line.trim()) ?? 'conversation-doc'
  return baseName.slice(0, 40).trim() || 'conversation-doc'
}


function unwrapOuterMarkdownFence(content: string) {
  const openingMatch = content.match(MARKDOWN_WRAPPER_RE)
  if (!openingMatch) return content

  let unwrapped = content.slice(openingMatch[0].length)
  if (TRAILING_FENCE_RE.test(unwrapped)) {
    unwrapped = unwrapped.replace(TRAILING_FENCE_RE, '')
  }

  return unwrapped
}

/** Parse citation markers [1], [2] and convert them to clickable links. */
function parseCitationsInText(text: string, sources: { url: string }[] = [], keyPrefix = 'citation'): ReactNode[] {
  const parts = text.split(CITATION_RE)
  
  return parts.map((part, index) => {
    const match = part.match(/\[(\d+)\]/)
    if (!match) return part
    
    const citationIndex = parseInt(match[1]) - 1
    const url = sources[citationIndex]?.url
    const normalizedUrl = normalizeExternalUrl(url)
    
    if (!url) return part
    
    return (
      <a
        key={`${keyPrefix}-${index}`}
        href={normalizedUrl ?? url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-400 hover:text-primary-300 hover:underline mx-0.5 transition-colors"
        title={normalizedUrl ?? url}
        onClick={(event) => handleExternalAnchorClick(event, normalizedUrl ?? url)}
      >
        {part}
      </a>
    )
  })
}

/** Walk React markdown output and replace citation markers without flattening inline markdown nodes. */
function injectCitations(children: ReactNode, sources: { url: string }[] = [], keyPrefix = 'node'): ReactNode {
  return Children.map(children, (child, index) => {
    const childKey = `${keyPrefix}-${index}`

    if (typeof child === 'string' || typeof child === 'number') {
      return parseCitationsInText(String(child), sources, childKey)
    }

    if (!isValidElement(child)) {
      return child
    }

    if (typeof child.type === 'string' && SKIP_CITATION_TAGS.has(child.type)) {
      return child
    }

    const props = child.props as { children?: ReactNode }
    if (props.children == null) {
      return child
    }

    return cloneElement(
      child,
      undefined,
      injectCitations(props.children, sources, childKey)
    )
  })
}

function truncateCellText(children: ReactNode) {
  const fullText = Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        return String(child)
      }
      return ''
    })
    .join('')
    .trim()

  if (!fullText) {
    return { text: '', fullText: '', truncated: false }
  }

  if (fullText.length <= CELL_TEXT_PREVIEW_LENGTH) {
    return { text: fullText, fullText, truncated: false }
  }

  return {
    text: `${fullText.slice(0, CELL_TEXT_PREVIEW_LENGTH).trimEnd()}...`,
    fullText,
    truncated: true,
  }
}

function sliceTableRow(children: ReactNode, visibleColumns: number) {
  return Children.toArray(children).slice(0, visibleColumns)
}

function MarkdownTable({ children, sources }: { children: ReactNode; sources: { url: string }[] }) {
  const [expanded, setExpanded] = useState(false)

  const tableChildren = useMemo(() => {
    const nodes = Children.toArray(children)
    let totalColumns = 0

    const nextNodes = nodes.map((node, sectionIndex) => {
      if (!isValidElement(node)) {
        return node
      }

      const sectionProps = node.props as { children?: ReactNode }
      const rowNodes = Children.toArray(sectionProps.children)
      const firstRow = rowNodes.find((rowNode) => isValidElement(rowNode))
      if (firstRow && totalColumns === 0) {
        const firstRowProps = (firstRow as any).props as { children?: ReactNode }
        totalColumns = Children.toArray(firstRowProps.children).length
      }

      const nextRows = rowNodes.map((rowNode, rowIndex) => {
        if (!isValidElement(rowNode)) {
          return rowNode
        }

        const rowProps = rowNode.props as { children?: ReactNode }
        const cellNodes = expanded
          ? Children.toArray(rowProps.children)
          : sliceTableRow(rowProps.children, DEFAULT_PREVIEW_COLUMNS)

        return cloneElement(rowNode, { key: `table-row-${sectionIndex}-${rowIndex}` }, cellNodes)
      })

      return cloneElement(node, { key: `table-section-${sectionIndex}` }, nextRows)
    })

    return {
      nodes: nextNodes,
      totalColumns,
      hasHiddenColumns: totalColumns > DEFAULT_PREVIEW_COLUMNS,
    }
  }, [children, expanded])

  return (
    <div className="my-3 w-full">
      {tableChildren.hasHiddenColumns && (
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-surface-400">
          <span>默认预览前 {DEFAULT_PREVIEW_COLUMNS} 列</span>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="rounded-lg border border-surface-600/50 bg-surface-800/70 px-2.5 py-1 text-surface-200 transition hover:bg-surface-700/80"
          >
            {expanded ? '收起预览' : '查看完整表格'}
          </button>
        </div>
      )}
      <div className="w-full overflow-x-auto rounded-xl border border-surface-700/40 bg-surface-900/40">
        <table className="min-w-max border-collapse text-left text-sm">
          {tableChildren.nodes}
        </table>
      </div>
      {tableChildren.hasHiddenColumns && !expanded && (
        <p className="mt-2 text-xs text-surface-500">其余列已折叠，点击“查看完整表格”展开。</p>
      )}
    </div>
  )
}

function formatAssistantWorkEngine(engine?: AssistantWorkState['engine']) {
  if (!engine) return null
  return engine === 'tavily' ? 'Tavily' : 'Serper'
}

function AssistantThinkingState({ workState }: { workState?: AssistantWorkState }) {
  const engineLabel = formatAssistantWorkEngine(workState?.engine)
  const sourceCount = workState?.sourceCount
  const detailItems = [
    workState?.detail,
    engineLabel ? `搜索引擎：${engineLabel}` : null,
    sourceCount != null ? `来源：${sourceCount} 条` : null,
  ].filter(Boolean)

  return (
    <div className="assistant-thinking-state" aria-live="polite">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm text-surface-200">
          <span className="assistant-status-dot" aria-hidden="true" />
          <span className="truncate">{workState?.label ?? '正在组织回答'}</span>
          <div className="flex shrink-0 items-center gap-1" aria-hidden="true">
            <span className="typing-dot h-1.5 w-1.5 rounded-full bg-cyan-200/80" />
            <span className="typing-dot h-1.5 w-1.5 rounded-full bg-cyan-200/80" />
            <span className="typing-dot h-1.5 w-1.5 rounded-full bg-cyan-200/80" />
          </div>
        </div>
        {workState && (
          <span className="shrink-0 rounded-full border border-cyan-200/15 bg-cyan-300/10 px-2 py-0.5 text-[10px] text-cyan-100">
            检索中
          </span>
        )}
      </div>
      {detailItems.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {detailItems.map((item) => (
            <span
              key={item}
              className="rounded-md border border-surface-700/45 bg-surface-900/35 px-2 py-1 text-[11px] text-surface-400"
            >
              {item}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 space-y-2" aria-hidden="true">
        <div className="assistant-skeleton-line w-[78%]" />
        <div className="assistant-skeleton-line w-[58%]" />
      </div>
    </div>
  )
}

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming = false,
  workState,
  onContinueImageEdit,
  onOpenImagePreview,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [showCopyButton, setShowCopyButton] = useState(false)
  const [copiedMessage, setCopiedMessage] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const createDocumentFromContent = useWorkspaceStore((state) => state.createDocumentFromContent)

  const renderedContent = useMemo(
    () => unwrapOuterMarkdownFence(message.content),
    [message.content]
  )
  const hasMessageContent = message.content.trim().length > 0

  const markdownComponents = useMemo(() => {
    const createCitationContainer = (Tag: CitationContainerTag) =>
      function CitationContainer({ node, children, ...props }: any) {
        return (
          <Tag {...props}>
            {injectCitations(children, message.searchResults)}
          </Tag>
        )
      }

    return {
      code({ className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className || '')
        const value = String(children).replace(/\n$/, '')

        if (match) {
          if (match[1] === 'mermaid') {
            return <MermaidBlock chart={value} variant="dark" onOpenDiagram={onOpenImagePreview} />
          }
          return <CodeBlock language={match[1]} value={value} />
        }

        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      },
      a({ href, children, ...props }: any) {
        const normalizedHref = normalizeExternalUrl(href)

        return (
          <a
            {...props}
            href={normalizedHref ?? href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => handleExternalAnchorClick(event, normalizedHref ?? href)}
          >
            {children}
          </a>
        )
      },
      img({ src, alt, ...props }: any) {
        return (
          <img
            {...props}
            src={src}
            alt={alt ?? '图表预览'}
            className="my-3 w-full max-w-3xl rounded-xl border border-surface-700/40 bg-surface-900/60 p-2"
          />
        )
      },
      table({ children, ...props }: any) {
        return <MarkdownTable {...props} sources={message.searchResults ?? []}>{children}</MarkdownTable>
      },
      thead({ children, ...props }: any) {
        return <thead {...props} className="bg-surface-800/80">{children}</thead>
      },
      tbody({ children, ...props }: any) {
        return <tbody {...props} className="divide-y divide-surface-700/30">{children}</tbody>
      },
      tr({ children, ...props }: any) {
        return <tr {...props} className="align-top">{children}</tr>
      },
      th({ children, ...props }: any) {
        return (
          <th
            {...props}
            className="whitespace-nowrap border-r border-surface-700/40 px-3 py-2 font-medium text-surface-100 last:border-r-0"
          >
            {injectCitations(children, message.searchResults)}
          </th>
        )
      },
      td({ children, ...props }: any) {
        const { text, fullText, truncated } = truncateCellText(children)
        return (
          <td
            {...props}
            title={truncated ? fullText : undefined}
            className="min-w-[96px] max-w-[240px] border-r border-surface-700/30 px-3 py-2 whitespace-normal break-words text-surface-200 last:border-r-0"
          >
            {truncated ? text : injectCitations(children, message.searchResults)}
          </td>
        )
      },
      blockquote: createCitationContainer('blockquote'),
      h1: createCitationContainer('h1'),
      h2: createCitationContainer('h2'),
      h3: createCitationContainer('h3'),
      h4: createCitationContainer('h4'),
      h5: createCitationContainer('h5'),
      h6: createCitationContainer('h6'),
      li: createCitationContainer('li'),
      p: createCitationContainer('p'),
    }
  }, [message.searchResults, onOpenImagePreview])

  const handleCopyMessage = async () => {
    if (!hasMessageContent) return
    await navigator.clipboard.writeText(message.content)
    setCopiedMessage(true)
    setTimeout(() => setCopiedMessage(false), 2000)
  }

  const handleConvertToMarkdown = async () => {
    if (!hasMessageContent || isStreaming) return
    setIsConverting(true)
    try {
      const created = await createDocumentFromContent(renderedContent, inferMarkdownFileName(renderedContent))
      if (!created) {
        setCopiedMessage(false)
      }
    } finally {
      setIsConverting(false)
    }
  }

  const assistantActionsClassName = [
    'flex shrink-0 items-center gap-1.5 transition-opacity duration-200',
    showCopyButton || copiedMessage || isConverting
      ? 'opacity-100'
      : 'opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100',
  ].join(' ')
  const assistantBubbleClassName = [
    'assistant-bubble group/message relative max-w-[90%] overflow-hidden rounded-2xl border px-4 py-3 text-surface-200',
    'border-surface-700/40 bg-surface-800/50 shadow-[0_18px_45px_rgba(2,6,23,0.16),inset_0_1px_0_rgba(255,255,255,0.05)]',
    isStreaming ? 'is-streaming border-cyan-300/25' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={`flex gap-3 animate-fade-in ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          isUser
            ? 'bg-gradient-to-br from-primary-500 to-primary-700'
            : 'bg-gradient-to-br from-emerald-500/80 to-teal-600/80'
        }`}
      >
        {isUser ? (
          <User size={16} className="text-white" />
        ) : (
          <Bot size={16} className="text-white" />
        )}
      </div>

      {/* Content */}
      <div
        ref={contentRef}
        onMouseEnter={() => !isUser && setShowCopyButton(true)}
        onMouseLeave={() => {
          setShowCopyButton(false)
          setCopiedMessage(false)
        }}
        onFocus={() => !isUser && setShowCopyButton(true)}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget as Node | null
          if (isUser || (nextTarget && event.currentTarget.contains(nextTarget))) return
          setShowCopyButton(false)
          setCopiedMessage(false)
        }}
        className={isUser
          ? 'relative max-w-[75%] rounded-2xl border border-primary-500/20 bg-primary-600/20 px-4 py-3 text-surface-100'
          : assistantBubbleClassName}
      >
        {!isUser && (
          <div className="relative z-[1] mb-3 flex min-w-0 items-center justify-between gap-3 border-b border-white/5 pb-2">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md border ${
                isStreaming
                  ? 'border-cyan-200/20 bg-cyan-300/10 text-cyan-100'
                  : 'border-emerald-200/15 bg-emerald-300/10 text-emerald-100'
              }`}>
                <Bot size={13} />
              </span>
              <span className="font-medium text-surface-200">AI 助手</span>
              <span className="text-surface-600">/</span>
              <span className={isStreaming ? 'text-cyan-200' : 'text-surface-500'}>
                {isStreaming ? '回答中' : '已完成'}
              </span>
            </div>
            <div className={assistantActionsClassName}>
              <button
                type="button"
                onClick={() => void handleConvertToMarkdown()}
                disabled={isStreaming || isConverting || !hasMessageContent}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-surface-600/40 bg-surface-900/50 px-2.5 text-[11px] text-surface-300 transition hover:border-surface-500/60 hover:bg-surface-700/70 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-40"
                title={isStreaming ? '回答完成后可转为 Markdown 文档' : '转为 Markdown 文档'}
              >
                <FileText size={12} />
                {isConverting ? '转换中...' : '转为文档'}
              </button>
              <button
                type="button"
                onClick={handleCopyMessage}
                disabled={!hasMessageContent}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-surface-600/40 bg-surface-900/50 text-surface-300 transition hover:border-surface-500/60 hover:bg-surface-700/70 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-40"
                title={copiedMessage ? '已复制' : '复制消息'}
              >
                {copiedMessage ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}
        {isUser ? (
          <>
            {message.images && message.images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {message.images.map((img) => (
                  <MessageImage key={img.id} image={img} isUser />
                ))}
              </div>
            )}
            {message.files && message.files.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {message.files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 px-3 py-1.5 bg-primary-500/10 border border-primary-500/20 rounded-lg"
                  >
                    <FileText size={14} className="text-primary-400 shrink-0" />
                    <span className="text-xs text-primary-300 truncate max-w-[150px]">{file.name}</span>
                    <span className="text-[10px] text-primary-200/70">{file.fileType ?? 'file'}</span>
                    <span className="text-[10px] text-primary-200/60">{formatMessageFileSize(file.size)}</span>
                    {file.isTruncated && (
                      <span className="rounded-full bg-amber-300/10 px-1.5 py-0.5 text-[10px] text-amber-100">已压缩</span>
                    )}
                    {getMessageSpreadsheetSummary(file) && (
                      <span className="rounded-full bg-emerald-300/10 px-1.5 py-0.5 text-[10px] text-emerald-100">
                        {getMessageSpreadsheetSummary(file)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </>
        ) : message.content === '' ? (
          <AssistantThinkingState workState={workState} />
        ) : (
          <div className="relative z-[1]">
            {message.images && message.images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {message.images.map((img) => (
                  <MessageImage key={img.id} image={img} isUser={false} onContinueEdit={onContinueImageEdit} />
                ))}
              </div>
            )}
            <div className={`markdown-body text-sm ${isStreaming ? 'assistant-markdown-streaming' : ''}`}>
              <ReactMarkdown 
                remarkPlugins={[remarkGfm]} 
                components={markdownComponents}
                urlTransform={transformMarkdownUrl}
              >
                {renderedContent}
              </ReactMarkdown>
            </div>
            {message.searchResults && message.searchResults.length > 0 && (
              <SourcesPanel sources={message.searchResults} />
            )}
          </div>
        )}
      </div>
    </div>
  )
})

export default MessageBubble
