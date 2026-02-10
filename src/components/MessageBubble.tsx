import { useMemo, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check, User, Bot, FileText } from 'lucide-react'
import { useState } from 'react'
import type { Message } from '../types'

interface MessageBubbleProps {
  message: Message
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

const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  const markdownComponents = useMemo(
    () => ({
      code({ className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className || '')
        const value = String(children).replace(/\n$/, '')

        if (match) {
          return <CodeBlock language={match[1]} value={value} />
        }

        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      },
    }),
    []
  )

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
        className={`max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-primary-600/20 border border-primary-500/20 text-surface-100'
            : 'bg-surface-800/50 border border-surface-700/30 text-surface-200'
        }`}
      >
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
          <div className="markdown-body text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
})

export default MessageBubble
