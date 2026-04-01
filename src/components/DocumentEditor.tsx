import type { MutableRefObject } from 'react'
import { useMemo, useRef } from 'react'
import type { DocumentSelection } from '../types'

interface DocumentEditorProps {
  content: string
  onChange: (content: string) => void
  onSelectionChange: (selection: DocumentSelection | null) => void
  onScroll?: (progress: number) => void
  scrollRef?: MutableRefObject<HTMLTextAreaElement | null>
}

export default function DocumentEditor({ content, onChange, onSelectionChange, onScroll, scrollRef }: DocumentEditorProps) {
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = scrollRef ?? internalTextareaRef

  const stats = useMemo(() => {
    const characters = content.length
    const words = content.trim() ? content.trim().split(/\s+/).length : 0
    const lines = content ? content.split(/\r?\n/).length : 1

    return { characters, words, lines }
  }, [content])

  const emitSelection = (clearWhenEmpty: boolean = false) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = content.slice(start, end)

    if (start === end) {
      if (clearWhenEmpty) {
        onSelectionChange(null)
      }
      return
    }

    onSelectionChange({ start, end, text })
  }

  return (
    <div className="flex h-full flex-col rounded-[28px] border border-surface-700/40 bg-[#101827]/85 shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
      <div className="flex items-center justify-between border-b border-surface-700/40 px-5 py-3 text-[11px] uppercase tracking-[0.28em] text-surface-400">
        <span>Writing Deck</span>
        <div className="flex items-center gap-3 normal-case tracking-normal text-surface-500">
          <span>{stats.lines} 行</span>
          <span>{stats.words} 词</span>
          <span>{stats.characters} 字符</span>
          <span>选中后可点“改写选区”</span>
        </div>
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(event) => {
          onChange(event.target.value)
          onSelectionChange(null)
        }}
        onMouseUp={() => emitSelection(false)}
        onSelect={() => emitSelection(false)}
        onKeyUp={(event) => {
          if (event.key === 'Escape') {
            onSelectionChange(null)
            return
          }
          emitSelection(event.shiftKey || event.key.startsWith('Arrow'))
        }}
        spellCheck={false}
        placeholder="在这里写 Markdown，或让右下角的文档助手替你起草。"
        className="workspace-editor flex-1 resize-none bg-transparent px-5 py-5 text-[15px] leading-7 text-surface-100 outline-none placeholder:text-surface-500"
        onScroll={(event) => {
          const target = event.currentTarget
          const maxScroll = target.scrollHeight - target.clientHeight
          onScroll?.(maxScroll > 0 ? target.scrollTop / maxScroll : 0)
        }}
      />
    </div>
  )
}
