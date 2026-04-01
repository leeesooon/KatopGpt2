import { Feather, FilePlus2, PenLine, Rows3, ScanText } from 'lucide-react'
import type { DocumentAgentMode } from '../types'

interface AgentActionBarProps {
  onAction: (mode: DocumentAgentMode) => void
  hasActiveDocument: boolean
  hasSelection: boolean
}

const ACTIONS: Array<{
  mode: DocumentAgentMode
  label: string
  hint: string
  icon: typeof Feather
}> = [
  { mode: 'create', label: '生成初稿', hint: '从一句话起草 Markdown', icon: FilePlus2 },
  { mode: 'expand', label: '扩写文档', hint: '补全结构和细节', icon: Rows3 },
  { mode: 'rewrite', label: '改写选区', hint: '润色当前段落', icon: PenLine },
  { mode: 'summarize', label: '总结文档', hint: '整理摘要和要点', icon: ScanText },
]

export default function AgentActionBar({ onAction, hasActiveDocument, hasSelection }: AgentActionBarProps) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-1.5 backdrop-blur-sm">
      {ACTIONS.map((action) => {
        const Icon = action.icon
        const disabled = !hasActiveDocument && action.mode !== 'create'
          ? true
          : action.mode === 'rewrite' && !hasSelection

        return (
          <button
            key={action.mode}
            onClick={() => onAction(action.mode)}
            disabled={disabled}
            title={`${action.label} - ${action.hint}`}
            className="group flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-surface-300 transition hover:border-white/10 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Icon size={16} className="transition group-hover:scale-105" />
          </button>
        )
      })}
    </div>
  )
}
