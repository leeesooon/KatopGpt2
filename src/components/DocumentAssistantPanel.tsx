import { Clipboard, FilePlus2, GitCompareArrows, Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { DocumentAgentMode, DocumentSelection, WorkspaceDocument } from '../types'

interface DocumentSuggestionView {
  content: string
  title: string
  createdAt: number
  mode: DocumentAgentMode
}

interface TaskStateView {
  status: 'idle' | 'running' | 'ready' | 'failed'
  title: string
  message: string
}

type SuggestionApplyMode = 'replace-document' | 'append-document' | 'replace-selection'

interface DocumentAssistantPanelProps {
  activeDocument: WorkspaceDocument | null
  selection: DocumentSelection | null
  latestSuggestion: DocumentSuggestionView | null
  taskState: TaskStateView
  onApplySuggestion: (mode: SuggestionApplyMode) => void
  onClearSuggestion: () => void
  onUpdateSuggestion: (content: string) => void
  onCreateFromSuggestion: () => void
}

interface DiffLine {
  value: string
  type: 'same' | 'removed' | 'added'
}

function buildLineDiff(original: string, suggestion: string): DiffLine[] {
  const originalLines = original.split(/\r?\n/)
  const suggestionLines = suggestion.split(/\r?\n/)
  const maxLength = Math.max(originalLines.length, suggestionLines.length)
  const lines: DiffLine[] = []

  for (let index = 0; index < maxLength; index += 1) {
    const originalLine = originalLines[index]
    const suggestionLine = suggestionLines[index]

    if (originalLine === suggestionLine && originalLine !== undefined) {
      lines.push({ value: originalLine || ' ', type: 'same' })
      continue
    }

    if (originalLine !== undefined) {
      lines.push({ value: originalLine || ' ', type: 'removed' })
    }
    if (suggestionLine !== undefined) {
      lines.push({ value: suggestionLine || ' ', type: 'added' })
    }
  }

  return lines.slice(0, 120)
}

function formatCreatedAt(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export default function DocumentAssistantPanel({
  activeDocument,
  selection,
  latestSuggestion,
  taskState,
  onApplySuggestion,
  onClearSuggestion,
  onUpdateSuggestion,
  onCreateFromSuggestion,
}: DocumentAssistantPanelProps) {
  const isRewriteSuggestion = latestSuggestion?.mode === 'rewrite'
  const originalText = isRewriteSuggestion ? selection?.text ?? '' : activeDocument?.content ?? ''
  const diffLines = latestSuggestion ? buildLineDiff(originalText, latestSuggestion.content) : []

  const handleCopySuggestion = async () => {
    if (!latestSuggestion?.content || !navigator.clipboard) return
    await navigator.clipboard.writeText(latestSuggestion.content)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0b1421]/86 shadow-[0_24px_70px_rgba(0,0,0,0.25)]">
      <div className="border-b border-white/10 px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-surface-100">
          <Sparkles size={16} className="text-amber-200" />
          文档助手
        </div>
        <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs leading-5 text-surface-400">
          {taskState.status === 'running' && (
            <span className="inline-flex items-center gap-2 text-sky-200">
              <Loader2 size={13} className="animate-spin" />
              {taskState.message}
            </span>
          )}
          {taskState.status !== 'running' && taskState.message}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!latestSuggestion ? (
          <div className="flex min-h-full flex-col justify-center text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-amber-300/20 bg-amber-300/10">
              <FilePlus2 size={24} className="text-amber-200" />
            </div>
            <h3 className="text-sm font-medium text-surface-100">还没有 AI 建议</h3>
            <p className="mt-2 text-xs leading-5 text-surface-400">
              使用底部快捷动作生成初稿、扩写文档、总结内容，或选中文字后改写选区。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-200/70">AI Suggestion</div>
              <div className="mt-1 text-sm font-medium text-surface-100">{latestSuggestion.title}</div>
              <div className="mt-1 text-xs text-surface-500">生成于 {formatCreatedAt(latestSuggestion.createdAt)}</div>
            </div>

            {isRewriteSuggestion && originalText && (
              <div className="rounded-2xl border border-white/10 bg-black/15">
                <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-surface-300">
                  <GitCompareArrows size={14} /> 原文 / 建议对比
                </div>
                <div className="max-h-56 overflow-y-auto p-2 font-mono text-[11px] leading-5">
                  {diffLines.map((line, index) => (
                    <div
                      key={`${line.type}-${index}`}
                      className={
                        line.type === 'added'
                          ? 'rounded bg-emerald-400/10 px-2 text-emerald-100'
                          : line.type === 'removed'
                            ? 'rounded bg-rose-400/10 px-2 text-rose-100 line-through decoration-rose-300/50'
                            : 'px-2 text-surface-400'
                      }
                    >
                      <span className="mr-2 text-surface-500">{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</span>
                      {line.value}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <textarea
              value={latestSuggestion.content}
              onChange={(event) => onUpdateSuggestion(event.target.value)}
              className="min-h-[220px] w-full resize-y rounded-2xl border border-white/10 bg-[#08111b]/70 px-4 py-3 text-sm leading-6 text-surface-200 outline-none transition focus:border-emerald-300/30 focus:bg-[#08111b]"
              placeholder="可以先微调 AI 建议，再决定如何应用。"
            />
          </div>
        )}
      </div>

      {latestSuggestion && (
        <div className="border-t border-white/10 px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            {isRewriteSuggestion ? (
              <button
                onClick={() => onApplySuggestion('replace-selection')}
                disabled={!selection}
                className="btn-primary col-span-2 rounded-full px-4 py-2 text-xs disabled:opacity-40"
              >
                替换选区
              </button>
            ) : (
              <>
                <button onClick={() => onApplySuggestion('replace-document')} className="btn-primary rounded-full px-4 py-2 text-xs">
                  替换全文
                </button>
                <button onClick={() => onApplySuggestion('append-document')} className="btn-ghost rounded-full border border-white/10 px-4 py-2 text-xs">
                  追加末尾
                </button>
                <button onClick={onCreateFromSuggestion} className="btn-ghost rounded-full border border-white/10 px-4 py-2 text-xs">
                  新建文档
                </button>
              </>
            )}
            <button onClick={() => void handleCopySuggestion()} className="btn-ghost rounded-full border border-white/10 px-4 py-2 text-xs">
              <Clipboard size={13} /> 复制
            </button>
            <button onClick={onClearSuggestion} className="btn-ghost rounded-full border border-white/10 px-4 py-2 text-xs text-rose-100">
              <Trash2 size={13} /> 放弃
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
