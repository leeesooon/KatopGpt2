import { Clipboard, Cpu, FilePlus2, GitCompareArrows, Loader2, PenLine, RotateCcw, Rows3, ScanText, Search, Sparkles, Square, Trash2 } from 'lucide-react'
import type { DocumentAgentMode, DocumentSelection, WorkspaceDocument } from '../types'
import type { RunnableDocumentAgentMode } from './useDocumentAgentRunner'

interface DocumentSuggestionView {
  content: string
  title: string
  createdAt: number
  mode: DocumentAgentMode
}

type SuggestionApplyMode = 'replace-document' | 'append-document' | 'replace-selection'

interface DocumentAssistantModelOption {
  value: string
  label: string
}

interface DocumentAssistantPanelProps {
  activeDocument: WorkspaceDocument | null
  selection: DocumentSelection | null
  latestSuggestion: DocumentSuggestionView | null
  selectedMode: RunnableDocumentAgentMode
  instruction: string
  streamingContent: string
  hasActiveRun: boolean
  hasApiConfig: boolean
  canRetry: boolean
  modelOptions: DocumentAssistantModelOption[]
  activeModelValue: string
  searchEnabled: boolean
  searchAvailable: boolean
  searchEngineLabel: string
  onModelChange: (value: string) => void
  onSearchEnabledChange: (enabled: boolean) => void
  onModeChange: (mode: RunnableDocumentAgentMode) => void
  onInstructionChange: (instruction: string) => void
  onRun: () => void
  onStop: () => void
  onRetry: () => void
  onApplySuggestion: (mode: SuggestionApplyMode) => void
  onClearSuggestion: () => void
  onUpdateSuggestion: (content: string) => void
  onCreateFromSuggestion: () => void
}

interface DiffLine {
  value: string
  type: 'same' | 'removed' | 'added'
}

const ASSISTANT_MODES: Array<{
  mode: RunnableDocumentAgentMode
  label: string
  hint: string
  icon: typeof FilePlus2
}> = [
  { mode: 'create', label: '初稿', hint: '生成新的 Markdown 初稿', icon: FilePlus2 },
  { mode: 'rewrite', label: '改写', hint: '改写当前选区', icon: PenLine },
  { mode: 'expand', label: '扩写', hint: '生成增量补充内容', icon: Rows3 },
  { mode: 'summarize', label: '总结', hint: '总结当前文档', icon: ScanText },
]

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

function getModeDisabledReason(
  mode: RunnableDocumentAgentMode,
  activeDocument: WorkspaceDocument | null,
  selection: DocumentSelection | null
) {
  if (mode !== 'create' && !activeDocument) return '请先打开或新建文档'
  if (mode === 'rewrite' && !selection?.text.trim()) return '请先选中文本'
  return null
}

export default function DocumentAssistantPanel({
  activeDocument,
  selection,
  latestSuggestion,
  selectedMode,
  instruction,
  streamingContent,
  hasActiveRun,
  hasApiConfig,
  canRetry,
  modelOptions,
  activeModelValue,
  searchEnabled,
  searchAvailable,
  searchEngineLabel,
  onModelChange,
  onSearchEnabledChange,
  onModeChange,
  onInstructionChange,
  onRun,
  onStop,
  onRetry,
  onApplySuggestion,
  onClearSuggestion,
  onUpdateSuggestion,
  onCreateFromSuggestion,
}: DocumentAssistantPanelProps) {
  const isRewriteSuggestion = latestSuggestion?.mode === 'rewrite'
  const isExpandSuggestion = latestSuggestion?.mode === 'expand'
  const originalText = isRewriteSuggestion ? selection?.text ?? '' : activeDocument?.content ?? ''
  const diffLines = latestSuggestion ? buildLineDiff(originalText, latestSuggestion.content) : []
  const selectedModeDisabledReason = getModeDisabledReason(selectedMode, activeDocument, selection)
  const runDisabledReason = !hasApiConfig
    ? '请先在设置中配置可用的聊天模型'
    : selectedModeDisabledReason
  const hasBlockingRun = hasActiveRun && !latestSuggestion
  const hasVisibleDraft = Boolean(streamingContent.trim())
  const canRun = !hasBlockingRun && !runDisabledReason
  const hasStreamingDraft = hasBlockingRun && hasVisibleDraft
  const isWaitingForDraft = hasBlockingRun && !hasVisibleDraft
  const primaryApplyMode: SuggestionApplyMode = isRewriteSuggestion
    ? 'replace-selection'
    : isExpandSuggestion && selection
      ? 'replace-selection'
      : isExpandSuggestion
        ? 'append-document'
        : 'replace-document'
  const primaryApplyLabel = isRewriteSuggestion
    ? '替换选区'
    : isExpandSuggestion && selection
      ? '插入选区后'
      : isExpandSuggestion
        ? '追加扩写'
        : '替换全文'
  const isPrimaryApplyDisabled = hasBlockingRun || (primaryApplyMode === 'replace-selection' && !selection)

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
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-surface-400">
            <Cpu size={13} className={activeModelValue ? 'text-primary-300' : 'text-surface-600'} />
            <span className="shrink-0 text-surface-500">模型</span>
            <select
              value={activeModelValue}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={hasBlockingRun || modelOptions.length === 0}
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-surface-200 outline-none disabled:text-surface-600"
              title="选择文档助手使用的模型"
            >
              <option value="" className="bg-surface-900 text-surface-300">选择模型</option>
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value} className="bg-surface-900 text-surface-200">
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => onSearchEnabledChange(!searchEnabled)}
            disabled={hasBlockingRun || !searchAvailable}
            className={`flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-35 ${
              searchEnabled
                ? 'border-sky-300/30 bg-sky-300/12 text-sky-100'
                : 'border-white/10 bg-white/[0.04] text-surface-400 hover:border-white/20 hover:text-surface-100'
            }`}
            title={searchAvailable ? `${searchEngineLabel} 联网搜索` : `请先配置 ${searchEngineLabel} API Key`}
          >
            <Search size={13} />
            联网
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
        <div className="shrink-0 rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.025))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="mb-2 flex items-center justify-between text-[11px] text-surface-500">
              <span className="uppercase tracking-[0.24em]">任务</span>
              {selection && <span>{selection.text.length} 字符选区</span>}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {ASSISTANT_MODES.map((action) => {
                const disabledReason = getModeDisabledReason(action.mode, activeDocument, selection)
                const isSelected = selectedMode === action.mode
                const Icon = action.icon

                return (
                  <button
                    key={action.mode}
                    onClick={() => onModeChange(action.mode)}
                    disabled={hasBlockingRun || Boolean(disabledReason)}
                    title={disabledReason ?? action.hint}
                    aria-label={action.label}
                    className={`flex h-8 items-center justify-center rounded-xl border px-2 transition disabled:cursor-not-allowed disabled:opacity-35 ${
                      isSelected
                        ? 'border-amber-200/35 bg-amber-200/12 text-amber-50 shadow-[0_0_0_1px_rgba(251,191,36,0.08)]'
                        : 'border-white/10 bg-black/12 text-surface-400 hover:border-white/20 hover:bg-white/[0.05] hover:text-white'
                    }`}
                  >
                    <Icon size={12} className={isSelected ? 'text-amber-100' : 'text-surface-500'} />
                    <span className="sr-only">{action.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="mt-3 flex min-h-[96px] overflow-hidden rounded-2xl border border-white/10 bg-[#08111b]/75 transition focus-within:border-amber-300/30 focus-within:bg-[#08111b]">
              <textarea
                value={instruction}
                onChange={(event) => onInstructionChange(event.target.value)}
                disabled={hasBlockingRun}
                className="min-h-[96px] flex-1 resize-none bg-transparent px-3 py-2 text-xs leading-5 text-surface-200 outline-none placeholder:text-surface-600 disabled:opacity-70"
                placeholder="输入这次文档任务的具体要求。"
              />
              <div className="flex w-11 shrink-0 flex-col border-l border-white/10 bg-black/10">
                {hasBlockingRun ? (
                  <button
                    onClick={onStop}
                    className="flex flex-1 items-center justify-center text-rose-100 transition hover:bg-rose-400/10"
                    title="停止生成"
                    aria-label="停止生成"
                  >
                    <Square size={14} fill="currentColor" />
                  </button>
                ) : (
                  <>
                    <button
                      onClick={onRun}
                      disabled={!canRun}
                      title={runDisabledReason ?? '运行'}
                      aria-label="运行"
                      className="flex flex-1 items-center justify-center border-b border-white/10 bg-primary-600 text-white transition hover:bg-primary-500 disabled:bg-white/[0.03] disabled:text-surface-600 disabled:hover:bg-white/[0.03]"
                    >
                      <Sparkles size={15} />
                    </button>
                    <button
                      onClick={onRetry}
                      disabled={!canRetry}
                      className="flex flex-1 items-center justify-center text-surface-400 transition hover:bg-white/[0.06] hover:text-surface-100 disabled:text-surface-700 disabled:hover:bg-transparent"
                      title={canRetry ? '重试' : '暂无可重试的任务'}
                      aria-label="重试"
                    >
                      <RotateCcw size={15} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {runDisabledReason && (
              <div className="mt-2 text-xs leading-5 text-amber-100/75">{runDisabledReason}</div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {isWaitingForDraft ? (
              <div className="flex h-full min-h-[220px] flex-col justify-center rounded-3xl border border-sky-300/15 bg-sky-300/5 px-4 text-center">
                <Loader2 size={18} className="mx-auto mb-3 animate-spin text-sky-100" />
                <h3 className="text-sm font-medium text-surface-100">正在等待模型返回内容</h3>
                <p className="mt-2 text-xs leading-5 text-surface-400">
                  如果长时间没有输出，可以点击右侧停止按钮结束本次任务。
                </p>
              </div>
            ) : hasStreamingDraft ? (
              <div className="flex h-full min-h-[220px] flex-col rounded-3xl border border-sky-300/15 bg-sky-300/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-sky-100">
                <Loader2 size={13} className="animate-spin" />
                正在生成草稿
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-black/15 px-3 py-2 text-sm leading-6 text-surface-200">
                {streamingContent}
              </div>
            </div>
            ) : !latestSuggestion ? (
            <div className="flex h-full min-h-[220px] flex-col justify-center rounded-3xl border border-white/10 bg-black/10 px-4 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-amber-300/20 bg-amber-300/10">
                <FilePlus2 size={24} className="text-amber-200" />
              </div>
              <h3 className="text-sm font-medium text-surface-100">还没有 AI 建议</h3>
              <p className="mt-2 text-xs leading-5 text-surface-400">
                在这里选择任务并直接运行，结果不会写入聊天记录。
              </p>
            </div>
            ) : (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-200/70">AI Suggestion</div>
                  <div className="mt-1 text-sm font-medium text-surface-100">{latestSuggestion.title}</div>
                  <div className="mt-1 text-xs text-surface-500">生成于 {formatCreatedAt(latestSuggestion.createdAt)}</div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 pt-1">
                  <button
                    onClick={() => onApplySuggestion(primaryApplyMode)}
                    disabled={isPrimaryApplyDisabled}
                    className="btn-primary h-8 min-w-[76px] justify-center rounded-xl px-2 text-[11px] leading-none disabled:opacity-40"
                  >
                    {primaryApplyLabel}
                  </button>
                  {!isRewriteSuggestion && !isExpandSuggestion && (
                    <button
                      disabled={hasBlockingRun}
                      onClick={() => onApplySuggestion('append-document')}
                      className="btn-ghost h-8 min-w-[76px] justify-center rounded-xl border border-white/10 px-2 text-[11px] leading-none disabled:opacity-40"
                    >
                      追加末尾
                    </button>
                  )}
                  <button
                    disabled={hasBlockingRun}
                    onClick={onCreateFromSuggestion}
                    className="btn-ghost h-8 min-w-[76px] justify-center rounded-xl border border-white/10 px-2 text-[11px] leading-none disabled:opacity-40"
                  >
                    新建文档
                  </button>
                  <button
                    disabled={hasBlockingRun}
                    onClick={() => void handleCopySuggestion()}
                    className="btn-ghost h-8 w-8 justify-center rounded-xl border border-white/10 p-0 disabled:opacity-40"
                    title="复制"
                    aria-label="复制"
                  >
                    <Clipboard size={11} />
                  </button>
                  <button
                    disabled={hasBlockingRun}
                    onClick={onClearSuggestion}
                    className="btn-ghost h-8 w-8 justify-center rounded-xl border border-white/10 p-0 text-rose-100 disabled:opacity-40"
                    title="放弃"
                    aria-label="放弃"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
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
                disabled={hasBlockingRun}
                className="min-h-[180px] flex-1 resize-none rounded-3xl border border-white/10 bg-[#08111b]/70 px-4 py-3 text-sm leading-6 text-surface-200 outline-none transition focus:border-emerald-300/30 focus:bg-[#08111b]"
                placeholder="可以先微调 AI 建议，再决定如何应用。"
              />

            </div>
            )}
          </div>
      </div>
    </div>
  )
}
