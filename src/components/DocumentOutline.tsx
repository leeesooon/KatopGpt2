import { BookOpenText, Hash } from 'lucide-react'

export interface OutlineItem {
  id: string
  title: string
  level: number
  line: number
}

interface DocumentOutlineProps {
  content: string
  activeLine?: number | null
  onJumpToLine: (line: number) => void
}

export function buildMarkdownOutline(content: string): OutlineItem[] {
  const lines = content.split(/\r?\n/)
  const outline: OutlineItem[] = []
  let isInFence = false

  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      isInFence = !isInFence
      return
    }
    if (isInFence) return

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) return

    const title = match[2].trim()
    if (!title) return

    outline.push({
      id: `${index}-${title}`,
      title,
      level: match[1].length,
      line: index,
    })
  })

  return outline
}

export default function DocumentOutline({ content, activeLine, onJumpToLine }: DocumentOutlineProps) {
  const outline = buildMarkdownOutline(content)
  const activeItem = outline
    .filter((item) => activeLine == null || item.line <= activeLine)
    .at(-1)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0b1421]/86 shadow-[0_24px_70px_rgba(0,0,0,0.25)]">
      <div className="border-b border-white/10 px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-surface-100">
          <BookOpenText size={16} className="text-sky-200" />
          文档大纲
        </div>
        <p className="mt-2 text-xs leading-5 text-surface-400">根据 Markdown 标题自动生成，点击可跳转到对应章节。</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {outline.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-xs leading-5 text-surface-500">
            <Hash size={24} className="mb-3 text-surface-600" />
            添加 Markdown 标题后会在这里显示大纲。
          </div>
        ) : (
          <div className="space-y-1">
            {outline.map((item) => {
              const isActive = activeItem?.id === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => onJumpToLine(item.line)}
                  className={`w-full rounded-2xl px-3 py-2 text-left text-xs leading-5 transition ${
                    isActive
                      ? 'border border-sky-300/20 bg-sky-300/10 text-sky-100'
                      : 'border border-transparent text-surface-400 hover:border-white/10 hover:bg-white/5 hover:text-surface-100'
                  }`}
                  style={{ paddingLeft: `${12 + (item.level - 1) * 12}px` }}
                >
                  <span className="mr-2 text-surface-600">H{item.level}</span>
                  {item.title}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
