import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  BookOpenText,
  FileText,
  FolderOpen,
  GripVertical,
  Info,
  ListTree,
  PanelLeftOpen,
  PanelsTopLeft,
  Save,
  Sparkles,
  SquareArrowOutUpRight,
  X,
} from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import type { DocumentAgentMode, DocumentEditorMode } from '../types'
import WorkspaceFileTree from './WorkspaceFileTree'
import DocumentEditor from './DocumentEditor'
import type { DocumentEditorHandle } from './DocumentEditor'
import ImageZoomViewer from './ImageZoomViewer'
import DocumentPreview from './DocumentPreview'
import DocumentAssistantPanel from './DocumentAssistantPanel'
import DocumentOutline, { buildMarkdownOutline } from './DocumentOutline'
import { useWorkspaceAutoSave } from './useWorkspaceAutoSave'
import { useDocumentAgentRunner } from './useDocumentAgentRunner'
import type { RunnableDocumentAgentMode } from './useDocumentAgentRunner'
import type { WorkspaceImageViewPayload } from './workspaceMarkdown'

const MODE_LABELS: Record<DocumentEditorMode, string> = {
  write: '编辑',
  preview: '预览',
  split: '分栏',
}

type SideTab = 'assistant' | 'outline' | 'info'

const IMAGE_SCALE_MIN = 0.5
const IMAGE_SCALE_MAX = 4

function clampImageScale(scale: number) {
  return Math.min(IMAGE_SCALE_MAX, Math.max(IMAGE_SCALE_MIN, Math.round(scale * 100) / 100))
}

function buildComposerDraft(mode: DocumentAgentMode, documentTitle?: string) {
  if (mode === 'create') return '请帮我生成一份 Markdown 初稿，主题是：'
  if (mode === 'rewrite') return '请改写我当前选中的内容，风格要求：'
  if (mode === 'expand') return `请为当前文档《${documentTitle ?? '当前文档'}》增量补充一段内容，重点补充：`
  return `请为当前文档《${documentTitle ?? '当前文档'}》增量补充一段内容，重点补充：`
}

function getDocumentStats(content: string) {
  return {
    lines: content ? content.split(/\r?\n/).length : 1,
    words: content.trim() ? content.trim().split(/\s+/).length : 0,
    characters: content.length,
    headings: buildMarkdownOutline(content).length,
  }
}

function formatTime(timestamp?: number) {
  if (!timestamp) return '暂无'
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`读取图片失败：${file.name}`))
    reader.readAsDataURL(file)
  })
}

function getPathTitle(relativePath: string | null) {
  if (!relativePath) return null
  const segments = relativePath.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? null
}

interface DocumentWorkspaceProps {
  standalone?: boolean
}

export default function DocumentWorkspace({ standalone = false }: DocumentWorkspaceProps) {
  const chatSettings = useChatStore((state) => state.settings)
  const setActiveModel = useChatStore((state) => state.setActiveModel)
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false)
  const [treeWidth, setTreeWidth] = useState(220)
  const [sidePanelWidth, setSidePanelWidth] = useState(420)
  const [sideTab, setSideTab] = useState<SideTab>('assistant')
  const [assistantMode, setAssistantMode] = useState<RunnableDocumentAgentMode>('expand')
  const [assistantInstruction, setAssistantInstruction] = useState(() => buildComposerDraft('expand'))
  const [assistantSearchEnabled, setAssistantSearchEnabled] = useState(() => {
    const state = useChatStore.getState()
    return state.searchEnabled || state.settings.enableSearchByDefault
  })
  const [activeLine, setActiveLine] = useState<number | null>(null)
  const [viewerImage, setViewerImage] = useState<WorkspaceImageViewPayload | null>(null)
  const [viewerScale, setViewerScale] = useState(1)
  const [viewerOffset, setViewerOffset] = useState({ x: 0, y: 0 })
  const workspaceBodyRef = useRef<HTMLDivElement>(null)
  const editorScrollRef = useRef<DocumentEditorHandle>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const syncingScrollRef = useRef<'editor' | 'preview' | null>(null)
  const {
    currentWorkspace,
    filePaths,
    documents,
    activeDocumentPath,
    pendingRenamePath,
    isPanelVisible,
    panelWidth,
    editorMode,
    selection,
    latestSuggestion,
    streamingSuggestion,
    taskState,
    isWorkspaceLoading,
    isSaving,
    saveSource,
    error,
    openWorkspace,
    openDocument,
    updateActiveDocumentContent,
    saveDocument,
    saveActiveDocument,
    createDocument,
    createDocumentFromSuggestion,
    renameDocument,
    deleteDocument,
    setEditorMode,
    setPanelVisible,
    setPanelWidth,
    setSelection,
    applyLatestSuggestion,
    clearLatestSuggestion,
    updateLatestSuggestionContent,
  } = useWorkspaceStore()

  const activeDocument = activeDocumentPath ? documents[activeDocumentPath] ?? null : null
  const activeDocumentTitle = activeDocument?.title ?? getPathTitle(activeDocumentPath) ?? currentWorkspace?.name ?? '未打开文档'
  const assistantModelOptions = useMemo(() => chatSettings.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      value: `${provider.id}::${model.name}`,
      providerId: provider.id,
      providerName: provider.name,
      model: model.name,
      label: `${provider.name} / ${model.name}`,
    }))
  ), [chatSettings.providers])
  const activeAssistantModelValue = useMemo(() => {
    if (!chatSettings.activeModel) return ''
    return assistantModelOptions.find((option) =>
      option.providerId === chatSettings.activeModel?.providerId
      && option.model === chatSettings.activeModel?.model
    )?.value ?? ''
  }, [assistantModelOptions, chatSettings.activeModel])
  const assistantSearchApiKey = chatSettings.searchEngine === 'tavily'
    ? chatSettings.tavilyApiKey
    : chatSettings.serperApiKey
  const isAssistantSearchAvailable = Boolean(assistantSearchApiKey)
  const assistantSearchEngineLabel = chatSettings.searchEngine === 'tavily' ? 'Tavily' : 'Serper'
  const documentAgentRunner = useDocumentAgentRunner({
    activeDocument,
    selection,
    searchEnabled: assistantSearchEnabled && isAssistantSearchAvailable,
  })
  const documentStats = useMemo(() => getDocumentStats(activeDocument?.content ?? ''), [activeDocument?.content])
  useWorkspaceAutoSave({
    activeDocumentPath,
    activeDocument,
    isSaving,
    saveDocument,
  })

  const saveStatus = useMemo(() => {
    if (!activeDocument) return { label: '未打开文档', tone: 'text-surface-400 border-white/10 bg-white/5' }
    if (error) return { label: saveSource === 'auto' ? '自动保存失败' : '保存失败', tone: 'text-rose-200 border-rose-400/25 bg-rose-400/10' }
    if (isSaving) return { label: saveSource === 'auto' ? '自动保存中' : '保存中', tone: 'text-sky-200 border-sky-400/25 bg-sky-400/10' }
    if (activeDocument.isDirty) return { label: '未保存', tone: 'text-amber-200 border-amber-400/25 bg-amber-400/10' }
    return { label: saveSource === 'auto' ? '已自动保存' : '已保存', tone: 'text-emerald-200 border-emerald-400/25 bg-emerald-400/10' }
  }, [activeDocument, error, isSaving, saveSource])

  const statusTone = useMemo(() => {
    if (taskState.status === 'running') return 'text-sky-200 border-sky-400/25 bg-sky-400/10'
    if (taskState.status === 'failed') return 'text-rose-200 border-rose-400/25 bg-rose-400/10'
    if (taskState.status === 'ready') return 'text-emerald-200 border-emerald-400/25 bg-emerald-400/10'
    return 'text-surface-300 border-white/10 bg-white/5'
  }, [taskState.status])
  const isAssistantGenerating = documentAgentRunner.hasActiveRun && taskState.status === 'running'
  const assistantStreamingContent = documentAgentRunner.streamingContent || streamingSuggestion?.content || ''

  const handleAssistantModeChange = (mode: RunnableDocumentAgentMode) => {
    setSideTab('assistant')
    setAssistantMode(mode)
    setAssistantInstruction(buildComposerDraft(mode, activeDocument?.title))
  }

  const handleRunAssistant = () => {
    void documentAgentRunner.run(assistantMode, assistantInstruction)
  }

  const handleRetryAssistant = () => {
    void documentAgentRunner.retry()
  }

  const handleApplySuggestion = (mode: Parameters<typeof applyLatestSuggestion>[0]) => {
    documentAgentRunner.reset()
    applyLatestSuggestion(mode)
  }

  const handleClearSuggestion = () => {
    documentAgentRunner.reset()
    clearLatestSuggestion()
  }

  const handleAssistantModelChange = (value: string) => {
    const option = assistantModelOptions.find((item) => item.value === value)
    if (!option) return
    setActiveModel({ providerId: option.providerId, model: option.model })
  }

  const handleSelectDocument = (relativePath: string) => {
    documentAgentRunner.reset()
    void openDocument(relativePath)
  }

  const handleSwitchWorkspace = () => {
    documentAgentRunner.reset()
    void openWorkspace()
  }

  const handleCreateFromSuggestion = async () => {
    const rawName = window.prompt('请输入新文档文件名', `draft-${Date.now()}.md`)
    if (!rawName) return
    await createDocumentFromSuggestion(rawName)
  }

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

  const handleSidePanelResizeStart = () => {
    const container = workspaceBodyRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const maxWidth = Math.max(320, Math.round(containerRect.width * 0.5))

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = containerRect.right - event.clientX
      setSidePanelWidth(Math.max(280, Math.min(maxWidth, Math.round(nextWidth))))
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

    syncingScrollRef.current = source
    if (source === 'editor') {
      const target = previewScrollRef.current
      if (!target) return
      const maxScroll = target.scrollHeight - target.clientHeight
      target.scrollTop = maxScroll > 0 ? maxScroll * progress : 0
    } else {
      editorScrollRef.current?.scrollToProgress(progress)
    }

    window.requestAnimationFrame(() => {
      syncingScrollRef.current = null
    })
  }

  const handleJumpToLine = (line: number) => {
    setActiveLine(line)
    editorScrollRef.current?.focusLine(line)
  }

  const handleOpenImageViewer = useCallback((image: WorkspaceImageViewPayload) => {
    setViewerImage(image)
    setViewerScale(1)
    setViewerOffset({ x: 0, y: 0 })
  }, [])

  const handleCloseImageViewer = useCallback(() => {
    setViewerImage(null)
    setViewerScale(1)
    setViewerOffset({ x: 0, y: 0 })
  }, [])

  const handleImageScaleChange = useCallback((scale: number) => {
    const nextScale = clampImageScale(scale)
    setViewerScale(nextScale)
  }, [])

  const handlePasteImage = useCallback(async (image: File) => {
    if (!currentWorkspace || !activeDocumentPath || !window.electronAPI?.saveWorkspaceImage) {
      throw new Error('请先打开工作区和 Markdown 文档')
    }

    const dataUrl = await readFileAsDataUrl(image)
    const result = await window.electronAPI.saveWorkspaceImage(
      currentWorkspace.rootPath,
      activeDocumentPath,
      dataUrl,
      image.name
    )

    if (!result.ok || !result.markdown) {
      throw new Error(result.error ?? '图片写入失败，请确认工作区可写')
    }

    return result.markdown
  }, [activeDocumentPath, currentWorkspace])

  if (!currentWorkspace) {
    return (
      <aside
        className={`${isPanelVisible || standalone ? 'relative flex' : 'hidden'} ${standalone ? 'h-full w-full flex-1' : 'border-l border-white/8'} flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_38%),linear-gradient(180deg,#08111d_0%,#09131f_100%)] p-3`}
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
              <Sparkles size={12} /> Markdown Workspace
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-surface-50">让文档和对话一起工作</h2>
            <p className="mt-3 text-sm leading-6 text-surface-400">
              打开一个文件夹后，可以在这里编辑 Markdown、预览排版，并使用文档助手生成、改写和扩写内容。
            </p>
            <button onClick={() => void openWorkspace()} className="btn-primary mt-7 inline-flex items-center gap-2 rounded-2xl px-5 py-3">
              <FolderOpen size={17} /> 打开工作区
            </button>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside
      className={`${isPanelVisible || standalone ? 'relative flex' : 'hidden'} ${standalone ? 'h-full w-full flex-1' : 'border-l border-white/8'} flex-col overflow-hidden bg-[#07111d] p-3`}
      style={standalone ? undefined : { width: panelWidth, minWidth: 720 }}
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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(245,158,11,0.12),transparent_30%),radial-gradient(circle_at_100%_20%,rgba(56,189,248,0.1),transparent_28%)]" />
      <div className="relative flex h-full min-h-0 flex-col rounded-[30px] border border-white/10 bg-white/[0.035] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.28)]">
        <header className="mb-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-surface-500">
              <PanelsTopLeft size={13} /> 写作工作台
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-surface-50">
              {activeDocumentTitle}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-3 py-1.5 text-xs ${saveStatus.tone}`}>{saveStatus.label}</span>
            <span className={`hidden rounded-full border px-3 py-1.5 text-xs xl:inline-flex ${statusTone}`}>{taskState.title}</span>
            <button
              onClick={() => void saveActiveDocument()}
              disabled={!activeDocument || isSaving || !activeDocument.isDirty}
              className="btn-ghost flex h-10 items-center gap-2 rounded-2xl border border-white/10 px-3 text-xs disabled:opacity-40"
              title="保存当前文档"
            >
              <Save size={15} /> 保存
            </button>
            {!standalone ? (
              <button
                onClick={() => void handlePopout()}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-surface-300 transition hover:bg-white/10 hover:text-white"
                title="独立窗口打开"
              >
                <SquareArrowOutUpRight size={16} />
              </button>
            ) : (
              <button
                onClick={() => void handleDockBack()}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-surface-300 transition hover:bg-white/10 hover:text-white"
                title="收回主界面"
              >
                <ArrowLeftToLine size={16} />
              </button>
            )}
            {!standalone && (
              <button
                onClick={() => setPanelVisible(false)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-surface-300 transition hover:bg-white/10 hover:text-white"
                title="隐藏文档区"
              >
                <ArrowRightToLine size={16} />
              </button>
            )}
          </div>
        </header>

        <div ref={workspaceBodyRef} className="flex min-h-0 flex-1 overflow-hidden gap-4">
          {!isTreeCollapsed ? (
            <div className="relative min-h-0 shrink-0" style={{ width: treeWidth }}>
              <WorkspaceFileTree
                workspaceName={currentWorkspace.name}
                filePaths={filePaths}
                activePath={activeDocumentPath}
                pendingRenamePath={pendingRenamePath}
                onSelect={handleSelectDocument}
                onCreate={(relativePath) => createDocument(relativePath)}
                onRename={(oldPath, newPath) => renameDocument(oldPath, newPath)}
                onDelete={(relativePath) => deleteDocument(relativePath)}
                onSwitchWorkspace={handleSwitchWorkspace}
                onCollapse={() => setIsTreeCollapsed(true)}
              />
              <button
                onMouseDown={handleTreeResizeStart}
                className="absolute -right-2 top-0 flex h-full w-4 items-center justify-center text-surface-600 transition hover:text-amber-200"
                title="拖动调整文件树宽度"
              >
                <GripVertical size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsTreeCollapsed(false)}
              className="flex h-full w-11 shrink-0 items-start justify-center rounded-[22px] border border-white/10 bg-white/5 py-4 text-surface-300 transition hover:bg-white/10 hover:text-white"
              title="展开文件树"
            >
              <PanelLeftOpen size={17} />
            </button>
          )}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden gap-4">
            <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-3">
              <div className="flex items-center gap-2">
                {!isTreeCollapsed && (
                  <button onClick={() => setIsTreeCollapsed(true)} className="btn-ghost rounded-full border border-white/10 px-3 py-2 text-xs">
                    收起文件树
                  </button>
                )}
                <div className="flex rounded-full border border-white/10 bg-black/10 p-1">
                  {(Object.keys(MODE_LABELS) as DocumentEditorMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setEditorMode(mode)}
                      className={`rounded-full px-3 py-1.5 text-xs transition ${editorMode === mode ? 'bg-white/12 text-white' : 'text-surface-400 hover:text-white'}`}
                    >
                      {MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ml-auto hidden items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-1.5 text-[11px] text-surface-500 xl:flex">
                <Sparkles size={12} className="text-amber-200/70" />
                右侧 AI 建议中运行文档任务
              </div>
            </div>

            <div
              className="grid min-h-0 flex-1 overflow-hidden gap-4"
              style={{ gridTemplateColumns: editorMode === 'split' ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)' }}
            >
              {editorMode !== 'preview' && (
                <DocumentEditor
                  key={activeDocumentPath ?? 'empty-editor'}
                  ref={editorScrollRef}
                  content={activeDocument?.content ?? ''}
                  workspaceRootPath={currentWorkspace.rootPath}
                  onChange={updateActiveDocumentContent}
                  onSelectionChange={setSelection}
                  onCursorLineChange={setActiveLine}
                  onScroll={(progress) => syncScroll('editor', progress)}
                  onSave={() => void saveActiveDocument()}
                  onPasteImage={handlePasteImage}
                  onImageOpen={handleOpenImageViewer}
                />
              )}
              {editorMode !== 'write' && (
                <DocumentPreview
                  key={activeDocumentPath ?? 'empty-preview'}
                  content={activeDocument?.content ?? ''}
                  workspaceRootPath={currentWorkspace.rootPath}
                  scrollRef={previewScrollRef}
                  onScroll={(progress) => syncScroll('preview', progress)}
                  onImageOpen={handleOpenImageViewer}
                />
              )}
            </div>

            {(isWorkspaceLoading || error) && (
              <div className="flex items-center justify-between rounded-[20px] border border-white/10 bg-white/5 px-4 py-3 text-xs text-surface-400">
                <div className="flex items-center gap-2">
                  <PanelsTopLeft size={14} />
                  {isWorkspaceLoading ? '正在同步工作区内容...' : error}
                </div>
                {error && <button onClick={() => void openWorkspace()} className="btn-ghost px-2 py-1 text-xs">重新打开</button>}
              </div>
            )}
          </main>

          <section
            className="relative flex min-h-0 shrink-0 flex-col overflow-hidden gap-3"
            style={{ width: sidePanelWidth }}
          >
            <button
              onMouseDown={handleSidePanelResizeStart}
              className="absolute -left-3 top-0 z-10 flex h-full w-5 items-center justify-center text-surface-600 transition hover:text-sky-200"
              title="拖动调整右侧栏宽度"
            >
              <GripVertical size={14} />
            </button>
            <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
              {([
                ['assistant', Sparkles, 'AI 建议'],
                ['outline', ListTree, '大纲'],
                ['info', Info, '信息'],
              ] as const).map(([tab, Icon, label]) => (
                <button
                  key={tab}
                  onClick={() => setSideTab(tab)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs transition ${sideTab === tab ? 'bg-white/12 text-white' : 'text-surface-400 hover:text-white'}`}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1">
              {sideTab === 'assistant' && (
                <DocumentAssistantPanel
                  activeDocument={activeDocument}
                  selection={selection}
                  latestSuggestion={latestSuggestion}
                  selectedMode={assistantMode}
                  instruction={assistantInstruction}
                  streamingContent={assistantStreamingContent}
                  hasActiveRun={isAssistantGenerating || (taskState.status === 'running' && Boolean(streamingSuggestion))}
                  canStop={documentAgentRunner.hasActiveRun}
                  hasApiConfig={documentAgentRunner.hasApiConfig}
                  canRetry={documentAgentRunner.canRetry}
                  modelOptions={assistantModelOptions}
                  activeModelValue={activeAssistantModelValue}
                  searchEnabled={assistantSearchEnabled && isAssistantSearchAvailable}
                  searchAvailable={isAssistantSearchAvailable}
                  searchEngineLabel={assistantSearchEngineLabel}
                  onModelChange={handleAssistantModelChange}
                  onSearchEnabledChange={setAssistantSearchEnabled}
                  onModeChange={handleAssistantModeChange}
                  onInstructionChange={setAssistantInstruction}
                  onRun={handleRunAssistant}
                  onStop={documentAgentRunner.stop}
                  onRetry={handleRetryAssistant}
                  onApplySuggestion={handleApplySuggestion}
                  onClearSuggestion={handleClearSuggestion}
                  onUpdateSuggestion={updateLatestSuggestionContent}
                  onCreateFromSuggestion={handleCreateFromSuggestion}
                />
              )}
              {sideTab === 'outline' && (
                <DocumentOutline
                  content={activeDocument?.content ?? ''}
                  activeLine={activeLine}
                  onJumpToLine={handleJumpToLine}
                />
              )}
              {sideTab === 'info' && (
                <div className="flex h-full flex-col rounded-[28px] border border-white/10 bg-[#0b1421]/86 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.25)]">
                  <div className="flex items-center gap-2 text-sm font-medium text-surface-100">
                    <FileText size={16} className="text-emerald-200" /> 文档信息
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <div className="text-surface-500">行数</div>
                      <div className="mt-1 text-lg font-semibold text-surface-100">{documentStats.lines}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <div className="text-surface-500">字符</div>
                      <div className="mt-1 text-lg font-semibold text-surface-100">{documentStats.characters}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <div className="text-surface-500">词数</div>
                      <div className="mt-1 text-lg font-semibold text-surface-100">{documentStats.words}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <div className="text-surface-500">标题</div>
                      <div className="mt-1 text-lg font-semibold text-surface-100">{documentStats.headings}</div>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-surface-400">
                    <div>路径：{activeDocument?.relativePath ?? '未选择'}</div>
                    <div>最近加载：{formatTime(activeDocument?.lastLoadedAt)}</div>
                    <div>最近保存：{formatTime(activeDocument?.lastSavedAt)}</div>
                    <div>当前选区：{selection ? `${selection.text.length} 字符` : '无'}</div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      <ImageZoomViewer
        image={viewerImage}
        scale={viewerScale}
        offset={viewerOffset}
        onScaleChange={handleImageScaleChange}
        onOffsetChange={setViewerOffset}
        onClose={handleCloseImageViewer}
      />
    </aside>
  )
}
