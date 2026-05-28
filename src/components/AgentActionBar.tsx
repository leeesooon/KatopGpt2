import { Feather, FilePlus2, PenLine, Rows3 } from 'lucide-react'
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
  { mode: 'rewrite', label: '改写选区', hint: '润色当前选中的内容', icon: PenLine },
  { mode: 'expand', label: '扩写文档', hint: '补全结构和细节', icon: Rows3 },
]

function getDisabledReason(mode: DocumentAgentMode, hasActiveDocument: boolean, hasSelection: boolean) {
  if (!hasActiveDocument && mode !== 'create') return '请先打开或新建文档'
  if (mode === 'rewrite' && !hasSelection) return '请先选中文本'
  return null
}

export default function AgentActionBar({ onAction, hasActiveDocument, hasSelection }: AgentActionBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[22px] border border-white/10 bg-white/5 p-1.5 backdrop-blur-sm">
      {ACTIONS.map((action) => {
        const Icon = action.icon
        const disabledReason = getDisabledReason(action.mode, hasActiveDocument, hasSelection)
        const disabled = Boolean(disabledReason)

        return (
          <button
            key={action.mode}
            onClick={() => onAction(action.mode)}
            disabled={disabled}
            title={disabledReason ?? `${action.label} - ${action.hint}`}
            className="group flex h-9 items-center gap-2 rounded-full border border-white/8 px-3 text-xs text-surface-300 transition hover:border-amber-200/20 hover:bg-amber-200/10 hover:text-white disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:opacity-35"
          >
            <Icon size={15} className="transition group-hover:scale-105" />
            <span>{action.label}</span>
          </button>
        )
      })}
    </div>
  )
}
