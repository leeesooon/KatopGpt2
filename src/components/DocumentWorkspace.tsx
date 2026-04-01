import { useMemo, useRef, useState } from 'react'
import { ArrowLeftToLine, ArrowRightToLine, BookOpenText, FolderOpen, GripVertical, PanelLeftOpen, PanelsTopLeft, Save, Sparkles, SquareArrowOutUpRight, X } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspaceStore'
import type { DocumentAgentMode, DocumentEditorMode } from '../types'
import WorkspaceFileTree from './WorkspaceFileTree'
import DocumentEditor from './DocumentEditor'
import DocumentPreview from './DocumentPreview'
import AgentActionBar from './AgentActionBar'

const MODE_LABELS: Record<DocumentEditorMode, string> = {
  write: '编辑',
  preview: '预览',
  split: '分栏',
}

function buildComposerDraft(mode: DocumentAgentMode, documentTitle?: string) {
  if (mode === 'create') return '请帮我生成一份 Markdown 初稿，主题是：'
  if (mode === 'rewrite') return `请改写我当前选中的内容，风格要求：`
  if (mode === 'expand') return `请扩写当前文档《${documentTitle ?? '当前文档'}》，重点补充：`
  return `请总结当前文档《${documentTitle ?? '当前文档'}》，输出方向：`
}

interface DocumentWorkspaceProps {
  standalone?: boolean
}

export default function DocumentWorkspace({ standalone = false }: DocumentWorkspaceProps) {
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false)
  const [treeWidth, setTreeWidth] = useState(220)
  const workspaceBodyRef = useRef<HTMLDivElement>(null)
  const editorScrollRef = useRef<HTMLTextAreaElement>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const syncingScrollRef = useRef<'editor' | 'preview' | null>(null)
  const {
    currentWorkspace,
    filePaths,
    documents,
    activeDocumentPath,
    isPanelVisible,
    panelWidth,
    editorMode,
    selection,
    latestSuggestion,
    taskState,
    isWorkspaceLoading,
    isSaving,
    error,
    openWorkspace,
    openDocument,
    updateActiveDocumentContent,
    saveActiveDocument,
    createDocument,
    createDocumentFromSuggestion,
    renameDocument,
    deleteDocument,
    setEditorMode,
    setPanelVisible,
    setPanelWidth,
    setSelection,
    queueComposerDraft,
    applyLatestSuggestion,
    clearLatestSuggestion,
    updateLatestSuggestionContent,
  } = useWorkspaceStore()

  const activeDocument = activeDocumentPath ? documents[activeDocumentPath] ?? null : null

  const statusTone = useMemo(() => {
    if (taskState.status === 'running') return 'text-sky-200 border-sky-400/25 bg-sky-400/10'
    if (taskState.status === 'failed') return 'text-rose-200 border-rose-400/25 bg-rose-400/10'
    if (taskState.status === 'ready') return 'text-emerald-200 border-emerald-400/25 bg-emerald-400/10'
    return 'text-surface-300 border-white/10 bg-white/5'
  }, [taskState.status])

  const handleAction = (mode: DocumentAgentMode) => {
    queueComposerDraft(mode, buildComposerDraft(mode, activeDocument?.title))
  }

  const handleCreateFromSuggestion = async () => {
    const rawName = window.prompt('请输入新文档文件名', `draft-${Date.now()}.md`)
    if (!rawName) return
    await createDocumentFromSuggestion(rawName)
  }

  const isRewriteSuggestion = latestSuggestion?.mode === 'rewrite'

  const handleResizeStart = () => {
    const handlePointerMove = (event: PointerEvent) => {
      setPanelWidth(window.innerWidth - event.clientX)
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
  }

  const handlePopout = async () => {
    if (!window.electronAPI?.openWorkspaceWindow) return
    await window.electronAPI.openWorkspaceWindow()
    setPanelVisible(false)
  }

  const handleDockBack = async () => {
    setPanelVisible(true)
    if (window.electronAPI?.closeWorkspaceWindow) {
      await window.electronAPI.closeWorkspaceWindow()
    }
  }

  const handleStandaloneClose = async () => {
    if (window.electronAPI?.closeWorkspaceWindow) {
      await window.electronAPI.closeWorkspaceWindow()
    }
  }

  const handleTreeResizeStart = () => {
    const container = workspaceBodyRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = event.clientX - containerRect.left - 16
      setTreeWidth(Math.max(160, Math.min(320, Math.round(nextWidth))))
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
  }

  const syncScroll = (source: 'editor' | 'preview', progress: number) => {
    if (editorMode !== 'split') return
    if (syncingScrollRef.current && syncingScrollRef.current !== source) return

    const target = source === 'editor' ? previewScrollRef.current : editorScrollRef.current
    if (!target) return

    syncingScrollRef.current = source
    const maxScroll = target.scrollHeight - target.clientHeight
    target.scrollTop = maxScroll > 0 ? maxScroll * progress : 0

    window.requestAnimationFrame(() => {
      syncingScrollRef.current = null
    })
  }

  if (!currentWorkspace) {
    return (
      <aside
        className={`${isPanelVisible || standalone ? 'relative flex' : 'hidden'} flex-col overflow-hidden ${standalone ? '' : 'border-l border-white/8'} bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_38%),linear-gradient(180deg,#08111d_0%,#09131f_100%)] p-3`}
        style={standalone ? undefined : { width: panelWidth, minWidth: 480 }}
      >
        {!standalone && (
          <button
            onMouseDown={handleResizeStart}
            className="absolute left-0 top-0 flex h-full w-3 -translate-x-1/2 items-center justify-center text-surface-600 transition hover:text-amber-200"
            title="拖动调整文档面板宽度"
          >
            <GripVertical size={16} />
          </button>
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(56,189,248,0.12),transparent_25%)]" />
        {standalone ? (
          <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
            <button
              onClick={() => void handleDockBack()}
              className="flex h-10 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 text-surface-200 transition hover:bg-white/10 hover:text-white"
              title="收回主界面"
            >
              <ArrowLeftToLine size={16} />
              <span className="text-xs">收回主界面</span>
            </button>
            <button
              onClick={() => void handleStandaloneClose()}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-surface-300 transition hover:bg-white/10 hover:text-white"
              title="关闭独立窗口"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setPanelVisible(false)}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-surface-300 transition hover:bg-white/10 hover:text-white"
            title="隐藏文档区"
          >
            <ArrowRightToLine size={16} />
          </button>
        )}
        <div className="relative flex h-full flex-col items-center justify-center rounded-[28px] border border-white/10 px-8 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[28px] border border-amber-400/20 bg-amber-400/10 shadow-[0_16px_60px_rgba(245,158,11,0.18)]">
            <BookOpenText size={34} className="text-amber-200" />
          </div>
          <div className="max-w-md">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-surface-400">
              <Sparkles size={12} /> Markdown Workspace MVP
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-surface-50">让聊天真正落到文档里</h2>
            <p className="mt-4 text-sm leading-7 text-surface-400">
              打开一个本地工作区后，你可以一边和模型对话，一边生成、改写、扩写 Markdown 文档，并把结果安全地应用回文件。
            </p>
          </div>

          <div className="mt-8 grid w-full max-w-lg grid-cols-2 gap-3 text-left text-sm text-surface-300">
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <div className="mb-2 text-xs uppercase tracking-[0.24em] text-amber-200/70">Write</div>
              从一句话生成 PRD、周报、会议纪要等 Markdown 初稿。
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <div className="mb-2 text-xs uppercase tracking-[0.24em] text-sky-200/70">Refine</div>
              对当前文档或选中段落做扩写、总结和风格改写。
            </div>
          </div>

          <button onClick={() => void openWorkspace()} className="btn-primary mt-8 inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm shadow-[0_18px_48px_rgba(59,130,246,0.24)]">
            <FolderOpen size={17} />
            打开文档工作区
          </button>
          {error && <p className="mt-4 max-w-md text-xs text-rose-300">{error}</p>}
        </div>
      </aside>
    )
  }

  return (
    <aside
      className={`${isPanelVisible || standalone ? 'relative flex' : 'hidden'} flex-col overflow-hidden ${standalone ? 'flex-1' : 'border-l border-white/8'} bg-[linear-gradient(180deg,#08111b_0%,#09111b_26%,#0b1624_100%)] p-3`}
      style={standalone ? undefined : { width: panelWidth, minWidth: 480 }}
    >
      {!standalone && (
        <button
          onMouseDown={handleResizeStart}
          className="absolute left-0 top-0 z-20 flex h-full w-3 -translate-x-1/2 items-center justify-center text-surface-600 transition hover:text-amber-200"
          title="拖动调整文档面板宽度"
        >
          <GripVertical size={16} />
        </button>
      )}
      <div className="flex h-full flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,17,27,0.96),rgba(9,17,27,0.9))] shadow-[0_22px_55px_rgba(0,0,0,0.28)]">
      <div className="border-b border-white/8 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-surface-500">Workspace</div>
            <div className="mt-1 flex items-center gap-2 text-surface-100">
              <span className="text-lg font-semibold">{currentWorkspace.name}</span>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-surface-400">{filePaths.length} docs</span>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start">
            <button
              onClick={() => setIsTreeCollapsed((value) => !value)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-surface-300 transition hover:bg-white/10 hover:text-white"
              title="展开工作区"
            >
              <PanelLeftOpen size={15} />
            </button>
            {!standalone && (
              <button
                onClick={() => void handlePopout()}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-surface-300 transition hover:bg-white/10 hover:text-white"
                title="悬浮为独立窗口"
              >
                <SquareArrowOutUpRight size={15} />
              </button>
            )}
            {standalone && (
              <button
                onClick={() => void handleDockBack()}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-surface-300 transition hover:bg-white/10 hover:text-white"
                title="收回主界面"
              >
                <ArrowLeftToLine size={15} />
              </button>
            )}
            <AgentActionBar
              onAction={handleAction}
              hasActiveDocument={Boolean(activeDocument)}
              hasSelection={Boolean(selection?.text)}
            />
            {(['write', 'preview', 'split'] as DocumentEditorMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setEditorMode(mode)}
                className={`rounded-full px-3 py-1.5 text-xs transition ${editorMode === mode ? 'bg-white text-surface-900' : 'border border-white/10 bg-white/5 text-surface-300 hover:bg-white/10'}`}
              >
                {MODE_LABELS[mode]}
              </button>
            ))}
            <button
              onClick={() => void saveActiveDocument()}
              disabled={!activeDocument || !activeDocument.isDirty || isSaving}
              className="btn-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs disabled:shadow-none"
            >
              <Save size={14} />
              {isSaving ? '保存中' : '保存'}
            </button>
            {!standalone && (
              <button
                onClick={() => setPanelVisible(false)}
                className="btn-ghost inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs"
                title="隐藏文档区"
              >
                <ArrowRightToLine size={14} />
                隐藏
              </button>
            )}
          </div>
        </div>

        {(taskState.status === 'failed' || !activeDocument) && (
          <p className="mt-4 text-xs text-surface-500">
            {activeDocument ? taskState.message : '从左侧文档树里选择一个 Markdown 文档开始编辑'}
          </p>
        )}
      </div>

      <div ref={workspaceBodyRef} className="flex min-h-0 flex-1 gap-4 px-4 py-4">
        {!isTreeCollapsed && (
          <>
          <div className="shrink-0 min-h-0" style={{ width: treeWidth }}>
            <WorkspaceFileTree
              filePaths={filePaths}
              activePath={activeDocumentPath}
              onSelect={(relativePath) => void openDocument(relativePath)}
              onCreate={(relativePath) => createDocument(relativePath, '')}
              onRename={renameDocument}
              onDelete={deleteDocument}
              onCollapse={() => setIsTreeCollapsed(true)}
            />
          </div>
          <button
            onMouseDown={handleTreeResizeStart}
            className="-ml-2 flex w-2 shrink-0 cursor-col-resize items-center justify-center rounded-full text-surface-600 transition hover:bg-white/5 hover:text-amber-200"
            title="拖动调整工作区列表宽度"
          >
            <GripVertical size={14} />
          </button>
          </>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="grid min-h-0 flex-1 gap-4" style={{ gridTemplateColumns: editorMode === 'split' ? '1fr 1fr' : '1fr' }}>
            {editorMode !== 'preview' && (
              <DocumentEditor
                content={activeDocument?.content ?? ''}
                onChange={updateActiveDocumentContent}
                onSelectionChange={setSelection}
                scrollRef={editorScrollRef}
                onScroll={(progress) => syncScroll('editor', progress)}
              />
            )}
            {editorMode !== 'write' && (
              <DocumentPreview
                content={activeDocument?.content ?? ''}
                scrollRef={previewScrollRef}
                onScroll={(progress) => syncScroll('preview', progress)}
              />
            )}
          </div>

          {latestSuggestion && (
            <div className="rounded-[24px] border border-emerald-400/20 bg-emerald-400/8 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.26em] text-emerald-200/70">Latest Suggestion</div>
                  <div className="mt-1 text-sm font-medium text-surface-100">{latestSuggestion.title}</div>
                </div>
                <button onClick={clearLatestSuggestion} className="btn-ghost px-2 py-1 text-xs">
                  清除
                </button>
              </div>
              <textarea
                value={latestSuggestion.content}
                onChange={(event) => updateLatestSuggestionContent(event.target.value)}
                className="mt-3 min-h-[160px] w-full resize-y rounded-2xl border border-white/10 bg-[#08111b]/55 px-4 py-3 text-sm leading-6 text-surface-200 outline-none transition focus:border-emerald-300/30 focus:bg-[#08111b]/75"
                placeholder="你可以先微调 AI 改写结果，再决定是否替换。"
              />
              <div className="mt-4 flex flex-wrap gap-2">
                {isRewriteSuggestion ? (
                  <>
                    <button
                      onClick={() => applyLatestSuggestion('replace-selection')}
                      disabled={!selection}
                      className="btn-primary rounded-full px-4 py-2 text-xs disabled:opacity-40"
                    >
                      确认替换
                    </button>
                    <button onClick={clearLatestSuggestion} className="btn-ghost rounded-full border border-white/10 px-4 py-2 text-xs">
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => applyLatestSuggestion('replace-document')} className="btn-primary rounded-full px-4 py-2 text-xs">
                      替换全文
                    </button>
                    <button onClick={() => applyLatestSuggestion('append-document')} className="btn-ghost rounded-full border border-white/10 px-4 py-2 text-xs">
                      追加文末
                    </button>
                    <button onClick={() => void handleCreateFromSuggestion()} className="btn-ghost rounded-full border border-white/10 px-4 py-2 text-xs">
                      新建文档
                    </button>
                    <button onClick={clearLatestSuggestion} className="btn-ghost rounded-full border border-white/10 px-4 py-2 text-xs">
                      取消
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {(isWorkspaceLoading || error) && (
            <div className="flex items-center justify-between rounded-[20px] border border-white/10 bg-white/5 px-4 py-3 text-xs text-surface-400">
              <div className="flex items-center gap-2">
                <PanelsTopLeft size={14} />
                {isWorkspaceLoading ? '正在同步工作区内容...' : error}
              </div>
              {error && <button onClick={() => void openWorkspace()} className="btn-ghost px-2 py-1 text-xs">重新打开</button>}
            </div>
          )}
        </div>
      </div>
      </div>
    </aside>
  )
}
