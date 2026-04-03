import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check, User, Bot, FileText } from 'lucide-react'
import type { Message } from '../types'
import SourcesPanel from './SourcesPanel'
import { normalizeExternalUrl, openExternalUrl } from '../utils/externalLinks'
import MermaidBlock from './MermaidBlock'
import { useWorkspaceStore } from '../store/workspaceStore'

interface MessageBubbleProps {
  message: Message
}

type CitationContainerTag = 'blockquote' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'li' | 'p' | 'td' | 'th'

const MARKDOWN_WRAPPER_RE = /^\s*```[ \t]*(?:markdown|md)\s*\r?\n/i
const TRAILING_FENCE_RE = /\r?\n```[ \t]*$/
const CITATION_RE = /(\[\d+\])/g
const SKIP_CITATION_TAGS = new Set(['a', 'code', 'pre'])

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

const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
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
            return <MermaidBlock chart={value} variant="dark" />
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
      blockquote: createCitationContainer('blockquote'),
      h1: createCitationContainer('h1'),
      h2: createCitationContainer('h2'),
      h3: createCitationContainer('h3'),
      h4: createCitationContainer('h4'),
      h5: createCitationContainer('h5'),
      h6: createCitationContainer('h6'),
      li: createCitationContainer('li'),
      p: createCitationContainer('p'),
      td: createCitationContainer('td'),
      th: createCitationContainer('th'),
    }
  }, [message.searchResults])

  const handleCopyMessage = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopiedMessage(true)
    setTimeout(() => setCopiedMessage(false), 2000)
  }

  const handleConvertToMarkdown = async () => {
    if (!message.content.trim()) return
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
        className={`relative max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-primary-600/20 border border-primary-500/20 text-surface-100'
            : 'bg-surface-800/50 border border-surface-700/30 text-surface-200'
        }`}
      >
        {/* 复制按钮 - 仅在 AI 消息上显示 */}
        {!isUser && showCopyButton && message.content && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
            <button
              onClick={() => void handleConvertToMarkdown()}
              disabled={isConverting}
              className="px-2.5 py-1.5 rounded-lg bg-surface-700/80 hover:bg-surface-600/80 text-surface-300 hover:text-surface-100 transition-all opacity-90 hover:opacity-100 backdrop-blur-sm text-xs disabled:opacity-50"
              title="转为 Markdown 文档"
            >
              {isConverting ? '转换中...' : '转为文档'}
            </button>
            <button
              onClick={handleCopyMessage}
              className="p-1.5 rounded-lg bg-surface-700/80 hover:bg-surface-600/80 text-surface-300 hover:text-surface-100 transition-all opacity-90 hover:opacity-100 backdrop-blur-sm"
              title={copiedMessage ? '已复制' : '复制消息'}
            >
              {copiedMessage ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        )}
        {isUser ? (
          <>
            {message.images && message.images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {message.images.map((img) => (
                  <img
                    key={img.id}
                    src={img.base64}
                    alt={img.name}
                    className="max-w-[200px] max-h-[200px] rounded-lg object-cover border border-surface-600/30 cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => window.open(img.base64, '_blank')}
                  />
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
                  </div>
                ))}
              </div>
            )}
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </>
        ) : message.content === '' ? (
          <div className="flex items-center gap-1.5 py-0.5">
            <div className="typing-dot w-2 h-2 rounded-full bg-surface-400" />
            <div className="typing-dot w-2 h-2 rounded-full bg-surface-400" />
            <div className="typing-dot w-2 h-2 rounded-full bg-surface-400" />
          </div>
        ) : (
          <>
            <div className="markdown-body text-sm">
              <ReactMarkdown 
                remarkPlugins={[remarkGfm]} 
                components={markdownComponents}
                urlTransform={transformMarkdownUrl}
              >
                {renderedContent}
              </ReactMarkdown>
            </div>
            {message.searchResults && message.searchResults.length > 0 && (
              <>
                <SourcesPanel sources={message.searchResults} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
})

export default MessageBubble
