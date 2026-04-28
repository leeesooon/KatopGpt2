import type { MutableRefObject } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MermaidBlock from './MermaidBlock'

interface DocumentPreviewProps {
  content: string
  workspaceRootPath?: string
  onScroll?: (progress: number) => void
  scrollRef?: MutableRefObject<HTMLDivElement | null>
}

function isExternalOrDataUrl(url: string) {
  return /^(?:https?:|data:|blob:|katopgpt-)/i.test(url)
}

function buildWorkspaceImageUrl(workspaceRootPath: string | undefined, src: string | undefined) {
  if (!workspaceRootPath || !src || isExternalOrDataUrl(src) || src.startsWith('#')) return src
  return `katopgpt-workspace://asset?root=${encodeURIComponent(workspaceRootPath)}&path=${encodeURIComponent(src)}`
}

export default function DocumentPreview({ content, workspaceRootPath, onScroll, scrollRef }: DocumentPreviewProps) {
  const markdownComponents = {
    code({ className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const value = String(children).replace(/\n$/, '')

      if (match?.[1] === 'mermaid') {
        return <MermaidBlock chart={value} variant="paper" />
      }

      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    },
    img({ src, alt, ...props }: any) {
      return (
        <img
          {...props}
          src={buildWorkspaceImageUrl(workspaceRootPath, src)}
          alt={alt ?? '图片'}
          className="my-4 max-w-full rounded-xl border border-[#d6c8aa] bg-white/50 p-1"
        />
      )
    },
  }

  return (
    <div
      ref={scrollRef}
      className="workspace-preview h-full overflow-y-auto rounded-[28px] border border-surface-700/40 bg-[#111827]/70 px-6 py-6"
      onScroll={(event) => {
        const target = event.currentTarget
        const maxScroll = target.scrollHeight - target.clientHeight
        onScroll?.(maxScroll > 0 ? target.scrollTop / maxScroll : 0)
      }}
    >
      <div className="workspace-page mx-auto max-w-3xl rounded-[24px] border border-white/10 bg-[#f7f1e5] px-8 py-8 text-[#2e2416] shadow-[0_30px_80px_rgba(0,0,0,0.22)]">
        {content.trim() ? (
          <div className="markdown-body workspace-markdown text-[15px] leading-7">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex min-h-[360px] items-center justify-center text-center text-sm text-[#6b5b43]">
            当前文档还是空白，先在左侧编辑区输入内容，或使用底部的 AI 动作生成初稿。
          </div>
        )}
      </div>
    </div>
  )
}
