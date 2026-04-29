import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  Cpu,
  Download,
  FileText,
  GripVertical,
  Layers3,
  Loader2,
  Paperclip,
  RefreshCcw,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { auditPresentationDeck, clampSlideCount, generatePresentationDeck } from '../services/presentationPlanner'
import { resolveApiConfig } from '../types'
import type {
  FileAttachment,
  PresentationDeckSpec,
  PresentationQaIssue,
  PresentationSlideLayout,
  PresentationSlideSpec,
  PresentationThemeId,
} from '../types'
import { FILE_INPUT_ACCEPT } from './inputAreaAttachments'
import { useAttachmentProcessor } from './useAttachmentProcessor'

const THEME_OPTIONS: Array<{ id: PresentationThemeId; label: string; hint: string; swatches: string[] }> = [
  { id: 'executive-midnight', label: '午夜商务', hint: '深色封面、冷静高对比', swatches: ['#1E2761', '#CADCFC', '#FFFFFF'] },
  { id: 'warm-terra', label: '陶土叙事', hint: '温暖、咨询报告感', swatches: ['#B85042', '#E7E8D1', '#A7BEAE'] },
  { id: 'teal-trust', label: '青绿信任', hint: '科技、增长、产品发布', swatches: ['#028090', '#00A896', '#02C39A'] },
]

const LAYOUT_OPTIONS: Array<{ value: PresentationSlideLayout; label: string }> = [
  { value: 'cover', label: '封面' },
  { value: 'agenda', label: '目录' },
  { value: 'section', label: '章节' },
  { value: 'cards', label: '卡片' },
  { value: 'two_column', label: '双栏' },
  { value: 'timeline', label: '时间线' },
  { value: 'comparison', label: '对比' },
  { value: 'data_highlight', label: '数据强调' },
  { value: 'chart', label: '图表' },
  { value: 'closing', label: '结尾' },
]

const VISUAL_TYPE_LABELS = {
  shape: '形状视觉',
  icon_grid: '图标卡片',
  stat: '数字强调',
  chart: '图表',
  timeline: '时间线',
  comparison: '对比结构',
}

function getIssueTone(severity: PresentationQaIssue['severity']) {
  return severity === 'error'
    ? 'border-rose-300/25 bg-rose-400/10 text-rose-100'
    : 'border-amber-300/25 bg-amber-300/10 text-amber-100'
}

function slideDensity(slide: PresentationSlideSpec) {
  const chars = slide.title.length + slide.bullets.reduce((total, bullet) => total + bullet.length, 0)
  if (chars > 220) return '偏密'
  if (chars > 140) return '适中'
  return '轻量'
}

function buildEmptyDeck(topic: string, themeId: PresentationThemeId, slideCount: number): PresentationDeckSpec {
  const count = clampSlideCount(slideCount)
  const slides: PresentationSlideSpec[] = Array.from({ length: count }, (_, index) => {
    const layout = index === 0
      ? 'cover'
      : index === count - 1
        ? 'closing'
        : (['agenda', 'section', 'cards', 'two_column', 'timeline', 'comparison', 'data_highlight', 'chart'][index % 8] as PresentationSlideLayout)

    return {
      id: `slide-${index + 1}`,
      layout,
      title: index === 0 ? topic || '未命名 PPT' : `第 ${index + 1} 页`,
      bullets: ['请在这里补充核心观点'],
      speakerNotes: '',
      visual: {
        type: layout === 'chart' ? 'chart' : layout === 'data_highlight' ? 'stat' : layout === 'timeline' ? 'timeline' : 'shape',
        label: '结构化视觉',
        items: ['视觉元素'],
        stats: layout === 'data_highlight' ? [{ value: '3', label: '关键抓手' }] : undefined,
        chart: layout === 'chart'
          ? { type: 'bar', title: '关键维度对比', labels: ['维度 A', '维度 B', '维度 C'], values: [70, 58, 46] }
          : undefined,
      },
    }
  })

  return {
    title: topic || '未命名 PPT',
    themeId,
    slides,
  }
}

function updateSlide(deck: PresentationDeckSpec, index: number, updater: (slide: PresentationSlideSpec) => PresentationSlideSpec) {
  return {
    ...deck,
    slides: deck.slides.map((slide, slideIndex) => slideIndex === index ? updater(slide) : slide),
  }
}

function getSlideIssues(issues: PresentationQaIssue[], slideIndex: number) {
  return issues.filter((issue) => issue.slideIndex === slideIndex)
}

interface PresentationWorkspaceProps {
  standalone?: boolean
}

export default function PresentationWorkspace({ standalone = false }: PresentationWorkspaceProps) {
  const {
    settings,
    isPresentationWorkspaceOpen,
    setPresentationWorkspaceOpen,
    setActiveModel,
  } = useChatStore()
  const [panelWidth, setPanelWidth] = useState(900)
  const [topic, setTopic] = useState('年度经营复盘与增长策略')
  const [audience, setAudience] = useState('管理层、业务负责人')
  const [goal, setGoal] = useState('讲清现状、问题、策略和下一步行动')
  const [slideCount, setSlideCount] = useState(8)
  const [themeId, setThemeId] = useState<PresentationThemeId>('executive-midnight')
  const [deck, setDeck] = useState<PresentationDeckSpec | null>(null)
  const [selectedSlideIndex, setSelectedSlideIndex] = useState(0)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    files,
    attachmentTasks,
    attachmentError,
    isProcessingFiles,
    processFiles,
    retryTask,
    removeTask,
    removeFile,
    clearFiles,
    setAttachmentError,
    formatFileSize,
  } = useAttachmentProcessor({ isImageMode: false })

  const modelOptions = useMemo(() => settings.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      value: `${provider.id}::${model.name}`,
      providerId: provider.id,
      providerName: provider.name,
      model: model.name,
      label: `${provider.name} / ${model.name}`,
    }))
  ), [settings.providers])

  const activeModelValue = useMemo(() => {
    if (!settings.activeModel) return ''
    return modelOptions.find((option) =>
      option.providerId === settings.activeModel?.providerId
      && option.model === settings.activeModel?.model
    )?.value ?? ''
  }, [modelOptions, settings.activeModel])

  const issues = useMemo(() => deck ? auditPresentationDeck(deck) : [], [deck])
  const selectedSlide = deck?.slides[selectedSlideIndex] ?? null
  const selectedSlideIssues = selectedSlide ? getSlideIssues(issues, selectedSlideIndex) : []
  const blockingIssueCount = issues.filter((issue) => issue.severity === 'error').length
  const pendingAttachmentTasks = attachmentTasks.filter((task) => task.status !== 'ready')

  const handleResizeStart = () => {
    const handlePointerMove = (event: PointerEvent) => {
      setPanelWidth(Math.max(720, Math.min(1240, window.innerWidth - event.clientX)))
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
  }

  const handleClose = async () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    if (standalone && window.electronAPI?.closePresentationWindow) {
      await window.electronAPI.closePresentationWindow()
      return
    }
    setPresentationWorkspaceOpen(false)
  }

  const handleModelChange = (value: string) => {
    const option = modelOptions.find((item) => item.value === value)
    if (!option) return
    setActiveModel({ providerId: option.providerId, model: option.model })
  }

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    if (!fileList) return
    processFiles(fileList)
    event.target.value = ''
  }

  const runDeckGeneration = async (mode: 'deck' | 'slide') => {
    const apiConfig = resolveApiConfig(settings.providers, settings.activeModel)
    if (!apiConfig) {
      setErrorMessage('请先在设置中配置可用的聊天模型。')
      return
    }

    const cleanTopic = topic.trim()
    if (!cleanTopic) {
      setErrorMessage('请先输入 PPT 主题。')
      return
    }

    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    setIsGenerating(true)
    setErrorMessage(null)
    setStatusMessage(mode === 'slide' ? '正在重新生成当前页...' : '正在生成 PPT 大纲...')

    try {
      const currentSlide = deck?.slides[selectedSlideIndex]
      const prompt = mode === 'slide' && currentSlide
        ? `${cleanTopic}\n\n请重点重写第 ${selectedSlideIndex + 1} 页《${currentSlide.title}》，保持整套 PPT 结构一致。`
        : cleanTopic
      const result = await generatePresentationDeck({
        config: apiConfig,
        topic: prompt,
        audience,
        goal,
        slideCount,
        themeId,
        files,
        signal: abortController.signal,
      })

      if (mode === 'slide' && deck && result.deck.slides[selectedSlideIndex]) {
        setDeck(updateSlide(deck, selectedSlideIndex, () => result.deck.slides[selectedSlideIndex]))
      } else {
        setDeck(result.deck)
        setSelectedSlideIndex(0)
      }
      setStatusMessage(result.issues.length > 0
        ? `已生成，发现 ${result.issues.length} 个轻量 QA 提醒。`
        : '已生成可导出的 PPT 结构。')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatusMessage('已停止生成。')
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'PPT 生成失败。')
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
      setIsGenerating(false)
    }
  }

  const handleStop = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsGenerating(false)
  }

  const handleCreateBlank = () => {
    const nextDeck = buildEmptyDeck(topic.trim(), themeId, slideCount)
    setDeck(nextDeck)
    setSelectedSlideIndex(0)
    setErrorMessage(null)
    setStatusMessage('已创建空白 PPT 结构，可手动编辑后导出。')
  }

  const handleExport = async () => {
    if (!deck) {
      setErrorMessage('请先生成或创建 PPT 结构。')
      return
    }
    const latestIssues = auditPresentationDeck(deck)
    const latestBlockingIssues = latestIssues.filter((issue) => issue.severity === 'error')
    if (latestBlockingIssues.length > 0) {
      setErrorMessage(`还有 ${latestBlockingIssues.length} 个阻塞问题，请先修复后再导出。`)
      return
    }
    if (!window.electronAPI?.exportPresentationDeck) {
      setErrorMessage('当前环境暂不支持导出 PPTX，请使用桌面版应用。')
      return
    }

    setIsExporting(true)
    setErrorMessage(null)
    setStatusMessage('正在导出 PPTX...')

    try {
      const result = await window.electronAPI.exportPresentationDeck({ deck })
      if (!result.ok) {
        setErrorMessage(result.message)
        return
      }
      setStatusMessage(result.message)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导出 PPTX 失败。')
    } finally {
      setIsExporting(false)
    }
  }

  const patchDeck = (patch: Partial<PresentationDeckSpec>) => {
    setDeck((currentDeck) => currentDeck ? { ...currentDeck, ...patch } : currentDeck)
  }

  const patchSelectedSlide = (patch: Partial<PresentationSlideSpec>) => {
    if (!deck || !selectedSlide) return
    setDeck(updateSlide(deck, selectedSlideIndex, (slide) => ({ ...slide, ...patch })))
  }

  const patchSelectedVisualLabel = (label: string) => {
    if (!deck || !selectedSlide) return
    setDeck(updateSlide(deck, selectedSlideIndex, (slide) => ({
      ...slide,
      visual: { ...slide.visual, label },
    })))
  }

  const updateSelectedBullet = (bulletIndex: number, value: string) => {
    if (!deck || !selectedSlide) return
    setDeck(updateSlide(deck, selectedSlideIndex, (slide) => ({
      ...slide,
      bullets: slide.bullets.map((bullet, index) => index === bulletIndex ? value : bullet),
    })))
  }

  const addSelectedBullet = () => {
    if (!deck || !selectedSlide) return
    setDeck(updateSlide(deck, selectedSlideIndex, (slide) => ({
      ...slide,
      bullets: [...slide.bullets, '新增要点'].slice(0, 6),
    })))
  }

  const removeSelectedBullet = (bulletIndex: number) => {
    if (!deck || !selectedSlide) return
    setDeck(updateSlide(deck, selectedSlideIndex, (slide) => ({
      ...slide,
      bullets: slide.bullets.filter((_, index) => index !== bulletIndex),
    })))
  }

  if (!standalone && !isPresentationWorkspaceOpen) {
    return null
  }

  return (
    <aside
      className={`${standalone ? 'h-full w-full flex-1' : 'shrink-0 border-l border-white/8'} relative flex flex-col overflow-hidden bg-[#070b13] p-3`}
      style={standalone ? undefined : { width: panelWidth, minWidth: 720 }}
    >
      {!standalone && (
        <button
          onMouseDown={handleResizeStart}
          className="absolute left-0 top-0 z-20 flex h-full w-3 -translate-x-1/2 items-center justify-center text-surface-600 transition hover:text-cyan-200"
          title="拖动调整 PPT 助手宽度"
        >
          <GripVertical size={16} />
        </button>
      )}

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(20,184,166,0.2),transparent_28%),radial-gradient(circle_at_100%_12%,rgba(248,113,113,0.12),transparent_24%),linear-gradient(135deg,rgba(255,255,255,0.035),transparent_38%)]" />
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.035] shadow-[0_28px_100px_rgba(0,0,0,0.34)]">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-cyan-200/70">
              <Layers3 size={13} /> Presentation Studio
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-surface-50">
              {deck?.title || 'PPT 助手'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {issues.length > 0 && (
              <span className={`hidden rounded-full border px-3 py-1.5 text-xs xl:inline-flex ${blockingIssueCount > 0 ? 'border-rose-300/25 bg-rose-400/10 text-rose-100' : 'border-amber-300/25 bg-amber-300/10 text-amber-100'}`}>
                QA {issues.length}
              </span>
            )}
            <button
              onClick={() => void runDeckGeneration('deck')}
              disabled={isGenerating || isProcessingFiles}
              className="btn-primary inline-flex h-10 items-center gap-2 rounded-2xl bg-cyan-600 px-3 text-xs hover:bg-cyan-500 disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              生成大纲
            </button>
            <button
              onClick={() => void runDeckGeneration('slide')}
              disabled={!deck || isGenerating || isProcessingFiles}
              className="btn-ghost inline-flex h-10 items-center gap-2 rounded-2xl border border-white/10 px-3 text-xs disabled:opacity-40"
            >
              <RefreshCcw size={14} />
              重写当前页
            </button>
            {isGenerating ? (
              <button
                onClick={handleStop}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-300/25 bg-rose-400/10 text-rose-100 transition hover:bg-rose-400/20"
                title="停止生成"
              >
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={() => void handleExport()}
                disabled={!deck || isExporting}
                className="flex h-10 items-center gap-2 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-3 text-xs text-emerald-100 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                导出 PPTX
              </button>
            )}
            <button
              onClick={() => void handleClose()}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-surface-300 transition hover:bg-white/10 hover:text-white"
              title={standalone ? '关闭窗口' : '关闭 PPT 助手'}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_300px] gap-3 p-3">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#09111d]/86">
            <div className="border-b border-white/10 px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-surface-100">
                <Sparkles size={15} className="text-cyan-200" /> 项目设置
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <label className="block text-xs text-surface-400">
                PPT 主题
                <textarea
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  className="mt-1 min-h-[76px] w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm leading-5 text-surface-100 outline-none transition focus:border-cyan-300/35"
                  placeholder="例如：年度经营复盘与增长策略"
                />
              </label>

              <label className="block text-xs text-surface-400">
                受众
                <input
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-surface-100 outline-none transition focus:border-cyan-300/35"
                />
              </label>

              <label className="block text-xs text-surface-400">
                沟通目标
                <textarea
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  className="mt-1 min-h-[62px] w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm leading-5 text-surface-100 outline-none transition focus:border-cyan-300/35"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-surface-400">
                  页数
                  <input
                    type="number"
                    min={3}
                    max={20}
                    value={slideCount}
                    onChange={(event) => setSlideCount(clampSlideCount(Number(event.target.value)))}
                    className="mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-surface-100 outline-none transition focus:border-cyan-300/35"
                  />
                </label>
                <label className="text-xs text-surface-400">
                  模型
                  <select
                    value={activeModelValue}
                    onChange={(event) => handleModelChange(event.target.value)}
                    className="mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-2 py-2 text-xs text-surface-100 outline-none transition focus:border-cyan-300/35"
                  >
                    <option value="" className="bg-surface-900">未选择</option>
                    {modelOptions.map((option) => (
                      <option key={option.value} value={option.value} className="bg-surface-900">
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-surface-400">视觉主题</div>
                {THEME_OPTIONS.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => {
                      setThemeId(theme.id)
                      if (deck) patchDeck({ themeId: theme.id })
                    }}
                    className={`w-full rounded-2xl border px-3 py-2 text-left transition ${
                      themeId === theme.id
                        ? 'border-cyan-300/35 bg-cyan-300/10 text-cyan-50'
                        : 'border-white/10 bg-white/[0.03] text-surface-300 hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{theme.label}</span>
                      <span className="flex gap-1">
                        {theme.swatches.map((color) => (
                          <span key={color} className="h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: color }} />
                        ))}
                      </span>
                    </span>
                    <span className="mt-1 block text-[11px] text-surface-500">{theme.hint}</span>
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-surface-200">
                    <Paperclip size={13} className="text-cyan-200" /> 参考资料
                  </div>
                  {files.length > 0 && (
                    <button onClick={clearFiles} className="text-[11px] text-surface-500 transition hover:text-rose-200">清空</button>
                  )}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessingFiles}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-300/25 bg-cyan-300/5 px-3 py-2 text-xs text-cyan-100 transition hover:bg-cyan-300/10 disabled:opacity-50"
                >
                  <Paperclip size={13} /> 添加资料
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={FILE_INPUT_ACCEPT}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="mt-2 space-y-1.5">
                  {files.map((file) => (
                    <div key={file.id} className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/18 px-2 py-1.5 text-xs text-surface-300">
                      <FileText size={12} className="shrink-0 text-cyan-200" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="text-[10px] text-surface-500">{formatFileSize(file.size)}</span>
                      <button onClick={() => removeFile(file.id)} className="text-surface-500 transition hover:text-rose-200">
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  {pendingAttachmentTasks.map((task) => (
                    <div key={task.id} className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/18 px-2 py-1.5 text-xs text-surface-400">
                      {task.status === 'error' ? <AlertTriangle size={12} className="text-rose-300" /> : <Loader2 size={12} className="animate-spin text-cyan-200" />}
                      <span className="min-w-0 flex-1 truncate">{task.name} · {task.message ?? task.status}</span>
                      {task.status === 'error' && (
                        <button onClick={() => retryTask(task.id)} className="text-[11px] text-cyan-100">重试</button>
                      )}
                      <button onClick={() => removeTask(task.id)} className="text-surface-500 transition hover:text-rose-200">
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
                {(attachmentError || errorMessage) && (
                  <div className="mt-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-2 py-1.5 text-xs leading-5 text-rose-100">
                    {attachmentError || errorMessage}
                  </div>
                )}
                {attachmentError && (
                  <button onClick={() => setAttachmentError(null)} className="mt-1 text-[11px] text-surface-500 transition hover:text-surface-200">关闭附件错误</button>
                )}
              </div>

              <button
                onClick={handleCreateBlank}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-surface-200 transition hover:bg-white/[0.08]"
              >
                创建空白结构
              </button>
            </div>
          </section>

          <main className="flex min-h-0 flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#0b101a]/80">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-surface-100">逐页结构预览</div>
                <div className="mt-0.5 text-xs text-surface-500">
                  {deck ? `${deck.slides.length} 页 · ${THEME_OPTIONS.find((item) => item.id === deck.themeId)?.label}` : '尚未生成'}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-surface-400">
                <Cpu size={13} className="text-cyan-200/80" />
                {activeModelValue ? modelOptions.find((option) => option.value === activeModelValue)?.label : '未选择模型'}
              </div>
            </div>

            {!deck ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
                <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] border border-cyan-300/20 bg-cyan-300/10 shadow-[0_20px_70px_rgba(20,184,166,0.18)]">
                  <Layers3 size={34} className="text-cyan-100" />
                </div>
                <h3 className="text-xl font-semibold text-surface-50">从资料生成一套可导出的 PPTX</h3>
                <p className="mt-3 max-w-md text-sm leading-6 text-surface-400">
                  V1 使用内置主题和 PPT 原生形状，不自动生图、不套用外部模板。生成后可逐页微调标题、要点和备注。
                </p>
                <button
                  onClick={() => void runDeckGeneration('deck')}
                  disabled={isGenerating || isProcessingFiles}
                  className="btn-primary mt-6 inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-5 py-3 hover:bg-cyan-500"
                >
                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                  生成 PPT 大纲
                </button>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  {deck.slides.map((slide, index) => {
                    const slideIssues = getSlideIssues(issues, index)
                    const isSelected = selectedSlideIndex === index
                    return (
                      <button
                        key={slide.id}
                        onClick={() => setSelectedSlideIndex(index)}
                        className={`group relative overflow-hidden rounded-[22px] border p-3 text-left transition ${
                          isSelected
                            ? 'border-cyan-300/45 bg-cyan-300/10 shadow-[0_18px_55px_rgba(20,184,166,0.12)]'
                            : 'border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]'
                        }`}
                      >
                        <div
                          className="absolute inset-x-0 top-0 h-1"
                          style={{ background: `linear-gradient(90deg, ${THEME_OPTIONS.find((item) => item.id === deck.themeId)?.swatches.join(', ')})` }}
                        />
                        <div className="flex items-start justify-between gap-2">
                          <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-surface-400">
                            {String(index + 1).padStart(2, '0')} · {LAYOUT_OPTIONS.find((item) => item.value === slide.layout)?.label}
                          </span>
                          {slideIssues.length > 0 && (
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${slideIssues.some((issue) => issue.severity === 'error') ? 'bg-rose-400/15 text-rose-100' : 'bg-amber-300/15 text-amber-100'}`}>
                              {slideIssues.length}
                            </span>
                          )}
                        </div>
                        <h4 className="mt-3 line-clamp-2 min-h-[40px] text-sm font-semibold leading-5 text-surface-100">
                          {slide.title}
                        </h4>
                        <div className="mt-3 rounded-2xl border border-white/8 bg-black/16 p-2">
                          <div className="mb-2 flex items-center justify-between text-[10px] text-surface-500">
                            <span>{VISUAL_TYPE_LABELS[slide.visual.type]}</span>
                            <span>{slideDensity(slide)}</span>
                          </div>
                          <div className="space-y-1">
                            {slide.bullets.slice(0, 3).map((bullet, bulletIndex) => (
                              <div key={`${slide.id}-${bulletIndex}`} className="truncate text-[11px] leading-5 text-surface-400">
                                {bullet}
                              </div>
                            ))}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </main>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#09111d]/86">
            <div className="border-b border-white/10 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-surface-100">当前页编辑</div>
                {selectedSlide && (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-surface-400">
                    {selectedSlideIndex + 1}/{deck?.slides.length}
                  </span>
                )}
              </div>
            </div>

            {!selectedSlide ? (
              <div className="flex flex-1 items-center justify-center px-4 text-center text-sm leading-6 text-surface-500">
                生成 PPT 后，可在这里编辑当前页。
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                <label className="block text-xs text-surface-400">
                  整套标题
                  <input
                    value={deck?.title ?? ''}
                    onChange={(event) => patchDeck({ title: event.target.value })}
                    className="mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-surface-100 outline-none transition focus:border-cyan-300/35"
                  />
                </label>
                <label className="block text-xs text-surface-400">
                  页面布局
                  <select
                    value={selectedSlide.layout}
                    onChange={(event) => patchSelectedSlide({ layout: event.target.value as PresentationSlideLayout })}
                    className="mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-surface-100 outline-none transition focus:border-cyan-300/35"
                  >
                    {LAYOUT_OPTIONS.map((layout) => (
                      <option key={layout.value} value={layout.value} className="bg-surface-900">
                        {layout.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-surface-400">
                  页面标题
                  <textarea
                    value={selectedSlide.title}
                    onChange={(event) => patchSelectedSlide({ title: event.target.value })}
                    className="mt-1 min-h-[64px] w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm leading-5 text-surface-100 outline-none transition focus:border-cyan-300/35"
                  />
                </label>
                <label className="block text-xs text-surface-400">
                  副标题
                  <input
                    value={selectedSlide.subtitle ?? ''}
                    onChange={(event) => patchSelectedSlide({ subtitle: event.target.value })}
                    className="mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-surface-100 outline-none transition focus:border-cyan-300/35"
                  />
                </label>
                <label className="block text-xs text-surface-400">
                  视觉说明
                  <input
                    value={selectedSlide.visual.label ?? ''}
                    onChange={(event) => patchSelectedVisualLabel(event.target.value)}
                    className="mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-surface-100 outline-none transition focus:border-cyan-300/35"
                  />
                </label>

                <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-surface-200">页面要点</div>
                    <button
                      onClick={addSelectedBullet}
                      disabled={selectedSlide.bullets.length >= 6}
                      className="text-[11px] text-cyan-100 transition hover:text-cyan-50 disabled:text-surface-600"
                    >
                      添加
                    </button>
                  </div>
                  {selectedSlide.bullets.map((bullet, bulletIndex) => (
                    <div key={`${selectedSlide.id}-edit-${bulletIndex}`} className="flex gap-2">
                      <textarea
                        value={bullet}
                        onChange={(event) => updateSelectedBullet(bulletIndex, event.target.value)}
                        className="min-h-[42px] flex-1 resize-none rounded-xl border border-white/10 bg-black/20 px-2 py-1.5 text-xs leading-5 text-surface-100 outline-none transition focus:border-cyan-300/35"
                      />
                      <button
                        onClick={() => removeSelectedBullet(bulletIndex)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 text-surface-500 transition hover:bg-rose-400/10 hover:text-rose-100"
                        title="删除要点"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                <label className="block text-xs text-surface-400">
                  演讲备注
                  <textarea
                    value={selectedSlide.speakerNotes ?? ''}
                    onChange={(event) => patchSelectedSlide({ speakerNotes: event.target.value })}
                    className="mt-1 min-h-[116px] w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm leading-5 text-surface-100 outline-none transition focus:border-cyan-300/35"
                  />
                </label>

                {selectedSlideIssues.length > 0 && (
                  <div className="space-y-1.5">
                    {selectedSlideIssues.map((issue, index) => (
                      <div key={`${issue.message}-${index}`} className={`rounded-xl border px-2 py-1.5 text-xs leading-5 ${getIssueTone(issue.severity)}`}>
                        {issue.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(statusMessage || errorMessage) && (
              <div className="border-t border-white/10 p-3">
                <div className={`rounded-2xl border px-3 py-2 text-xs leading-5 ${
                  errorMessage
                    ? 'border-rose-300/25 bg-rose-400/10 text-rose-100'
                    : 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100'
                }`}>
                  {errorMessage || statusMessage}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </aside>
  )
}
