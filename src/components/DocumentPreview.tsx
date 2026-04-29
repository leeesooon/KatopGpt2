import { useEffect, useState, type ImgHTMLAttributes, type MutableRefObject } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MermaidBlock from './MermaidBlock'
import { resolveWorkspaceImagePayload } from './workspaceMarkdown'
import type { WorkspaceImageViewPayload } from './workspaceMarkdown'

interface DocumentPreviewProps {
  content: string
  workspaceRootPath?: string
  onScroll?: (progress: number) => void
  scrollRef?: MutableRefObject<HTMLDivElement | null>
  onImageOpen?: (image: WorkspaceImageViewPayload) => void
}

interface PreviewImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  workspaceRootPath?: string
  onImageOpen?: (image: WorkspaceImageViewPayload) => void
}

function PreviewImage({
  src,
  alt,
  workspaceRootPath,
  onImageOpen,
  ...props
}: PreviewImageProps) {
  const [isBroken, setIsBroken] = useState(false)
  const imagePayload = resolveWorkspaceImagePayload(workspaceRootPath, src, alt)

  useEffect(() => {
    setIsBroken(false)
  }, [src])

  return (
    <img
      {...props}
      src={imagePayload?.src}
      alt={imagePayload?.alt ?? alt ?? '图片'}
      className={`my-4 max-w-full rounded-xl border border-[#d6c8aa] bg-white/50 p-1 ${onImageOpen && !isBroken ? 'cursor-zoom-in transition hover:shadow-[0_16px_40px_rgba(120,53,15,0.16)]' : ''}`}
      onError={() => setIsBroken(true)}
      onClick={() => {
        if (!isBroken && imagePayload) {
          onImageOpen?.(imagePayload)
        }
      }}
    />
  )
}

export default function DocumentPreview({ content, workspaceRootPath, onScroll, scrollRef, onImageOpen }: DocumentPreviewProps) {
  const markdownComponents = {
    code({ className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const value = String(children).replace(/\n$/, '')

      if (match?.[1] === 'mermaid') {
        return <MermaidBlock chart={value} variant="paper" onOpenDiagram={onImageOpen} />
      }

      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    },
    img({ src, alt, ...props }: any) {
      return (
        <PreviewImage
          {...props}
          src={src}
          alt={alt}
          workspaceRootPath={workspaceRootPath}
          onImageOpen={onImageOpen}
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
