import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  Code2,
  Cpu,
  Download,
  FileText,
  GripVertical,
  Layers3,
  Loader2,
  Paperclip,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  Square,
  Wand2,
  X,
} from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import {
  clampSlideCount,
  generatePresentationCodeDeck,
} from '../services/presentationPlanner'
import { resolveApiConfig } from '../types'
import type {
  PresentationCodeArtifact,
  PresentationCodeDiagnostic,
  PresentationCodeRequest,
  PresentationPreviewSlide,
  PresentationRenderToolsStatus,
  PresentationThemeId,
} from '../types'
import { FILE_INPUT_ACCEPT } from './inputAreaAttachments'
import { useAttachmentProcessor } from './useAttachmentProcessor'

const THEME_OPTIONS: Array<{ id: PresentationThemeId; label: string; hint: string; swatches: string[] }> = [
  { id: 'executive-midnight', label: '午夜商务', hint: '深色封面、冷静高对比', swatches: ['#1E2761', '#CADCFC', '#FFFFFF'] },
  { id: 'warm-terra', label: '陶土叙事', hint: '温暖、咨询报告感', swatches: ['#B85042', '#E7E8D1', '#A7BEAE'] },
  { id: 'teal-trust', label: '青绿信任', hint: '科技、增长、产品发布', swatches: ['#028090', '#00A896', '#02C39A'] },
  { id: 'forest-moss', label: '森林苔原', hint: '稳健、长期主义、组织能力', swatches: ['#2C5F2D', '#97BC62', '#F5F5F5'] },
  { id: 'coral-energy', label: '珊瑚动能', hint: '增长、发布会、强行动号召', swatches: ['#F96167', '#F9E795', '#2F3C7E'] },
  { id: 'charcoal-minimal', label: '炭黑极简', hint: '克制、咨询、黑白编辑感', swatches: ['#36454F', '#F2F2F2', '#212121'] },
  { id: 'berry-cream', label: '莓果奶油', hint: '品牌、内容、温和高级感', swatches: ['#6D2E46', '#A26769', '#ECE2D0'] },
]

const PPT_CODE_TRUST_KEY = 'katopgpt:pptCodeTrusted'

function getDiagnosticTone(level: PresentationCodeDiagnostic['level']) {
  if (level === 'error') return 'border-rose-300/25 bg-rose-400/10 text-rose-100'
  if (level === 'warning') return 'border-amber-300/25 bg-amber-300/10 text-amber-100'
  return 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100'
}

function readTrustedCodeExecutionFlag() {
  try {
    return localStorage.getItem(PPT_CODE_TRUST_KEY) === 'true'
  } catch {
    return false
  }
}

function writeTrustedCodeExecutionFlag() {
  try {
    localStorage.setItem(PPT_CODE_TRUST_KEY, 'true')
  } catch {
    // Local storage can be unavailable in restricted environments.
  }
}

function getCodeSummary(code: string) {
  const lines = code.split(/\r?\n/)
  return {
    lineCount: lines.length,
    preview: lines.slice(0, 90).join('\n'),
    isTruncated: lines.length > 90,
  }
}

function formatRunFailureForRepair(result: {
  errorMessage?: string
  message?: string
  diagnostics?: PresentationCodeDiagnostic[]
} | null) {
  const diagnostics = result?.diagnostics
    ?.map((diagnostic, index) => `${index + 1}. [${diagnostic.level}] ${diagnostic.message}`)
    .join('\n')

  return [
    result?.errorMessage || result?.message || '代码执行失败',
    diagnostics ? `diagnostics:\n${diagnostics}` : '',
  ].filter(Boolean).join('\n\n')
}

function getPresentationQualityWarnings(diagnostics: PresentationCodeDiagnostic[] | undefined) {
  const qualityPatterns = [
    '主体内容覆盖率偏低',
    '缺少 SVG',
    '缺少语义矢量图',
    '可见内容偏少',
    '大块留白',
  ]
  return (diagnostics ?? []).filter((diagnostic) =>
    diagnostic.level === 'warning'
    && qualityPatterns.some((pattern) => diagnostic.message.includes(pattern))
  )
}

function formatQualityWarningsForRepair(diagnostics: PresentationCodeDiagnostic[]) {
  return formatRunFailureForRepair({
    message: '真实预览已生成，但画面质量审计提示页面偏空，请补充语义矢量图、卡片网格、流程/案例/练习组件并提升主体内容覆盖率。',
    diagnostics,
  })
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
  const [topic, setTopic] = useState('AI 工具高效使用培训')
  const [audience, setAudience] = useState('学习者、团队成员')
  const [goal, setGoal] = useState('讲清概念、步骤、案例和练习总结')
  const [slideCount, setSlideCount] = useState(8)
  const [themeId, setThemeId] = useState<PresentationThemeId>('executive-midnight')
  const [artifact, setArtifact] = useState<PresentationCodeArtifact | null>(null)
  const [codeInput, setCodeInput] = useState<PresentationCodeRequest | null>(null)
  const [codeSessionId, setCodeSessionId] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<PresentationCodeDiagnostic[]>([])
  const [isArtifactStale, setIsArtifactStale] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastRunOutput, setLastRunOutput] = useState<{ stdout?: string; stderr?: string } | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isInstallingRenderTools, setIsInstallingRenderTools] = useState(false)
  const [renderToolsStatus, setRenderToolsStatus] = useState<PresentationRenderToolsStatus | null>(null)
  const [previewSlides, setPreviewSlides] = useState<PresentationPreviewSlide[]>([])
  const [hasTrustedNodeExecution, setHasTrustedNodeExecution] = useState(readTrustedCodeExecutionFlag)
  const abortControllerRef = useRef<AbortController | null>(null)
  const lastFileSignatureRef = useRef<string | null>(null)
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

  const pendingAttachmentTasks = attachmentTasks.filter((task) => task.status !== 'ready')
  const themeOption = THEME_OPTIONS.find((item) => item.id === themeId) ?? THEME_OPTIONS[0]
  const codeSummary = artifact ? getCodeSummary(artifact.code) : null
  const isBusy = isGenerating || isPreviewing || isExporting
  const fileSignature = useMemo(() =>
    files.map((file) => `${file.id}:${file.name}:${file.content.length}`).join('|'),
  [files])

  useEffect(() => {
    let isCancelled = false

    const checkRenderTools = async () => {
      if (!window.electronAPI?.checkPresentationRenderTools) {
        setRenderToolsStatus({
          ok: false,
          missing: ['soffice', 'pdftoppm'],
          message: '当前环境不是桌面版应用，无法检测 LibreOffice/Poppler，也不能生成真实预览。',
        })
        return
      }

      try {
        const result = await window.electronAPI.checkPresentationRenderTools()
        if (!isCancelled) {
          setRenderToolsStatus(result)
        }
      } catch (error) {
        if (!isCancelled) {
          setRenderToolsStatus({
            ok: false,
            missing: ['soffice', 'pdftoppm'],
            message: error instanceof Error ? error.message : '检测 PPT 渲染依赖失败。',
          })
        }
      }
    }

    void checkRenderTools()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (lastFileSignatureRef.current === null) {
      lastFileSignatureRef.current = fileSignature
      return
    }
    if (lastFileSignatureRef.current === fileSignature) return
    lastFileSignatureRef.current = fileSignature
    if (!artifact) return
    setIsArtifactStale(true)
    setCodeSessionId(null)
  }, [artifact, fileSignature])

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

  const handleThemeChange = (nextThemeId: PresentationThemeId) => {
    setThemeId(nextThemeId)
    if (!artifact) return
    setIsArtifactStale(true)
    setCodeSessionId(null)
    setPreviewSlides([])
    setStatusMessage('视觉主题已变更，请重新生成以应用新的代码版式。')
  }

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    if (!fileList) return
    processFiles(fileList)
    event.target.value = ''
  }

  const handleInstallRenderTools = async () => {
    if (!window.electronAPI?.installPresentationRenderTools) {
      setErrorMessage('当前环境暂不支持自动安装，请手动安装 LibreOffice 和 Poppler。')
      return
    }

    setIsInstallingRenderTools(true)
    setErrorMessage(null)
    setStatusMessage('正在打开安装窗口，请按窗口提示授权并等待安装完成...')

    try {
      const result = await window.electronAPI.installPresentationRenderTools()
      if (result.status) {
        setRenderToolsStatus(result.status)
      } else if (window.electronAPI?.checkPresentationRenderTools) {
        setRenderToolsStatus(await window.electronAPI.checkPresentationRenderTools())
      }
      if (result.ok || result.started) {
        setStatusMessage(result.message)
      } else {
        setErrorMessage(result.message)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '自动安装 PPT 依赖失败。')
    } finally {
      setIsInstallingRenderTools(false)
    }
  }

  const confirmTrustedExecution = () => {
    if (hasTrustedNodeExecution) return true

    const accepted = window.confirm(
      'PPT Agent 将执行模型生成的本地 Node.js 代码来创建 PPTX。\n\n' +
      '这不是浏览器沙箱，代码理论上具备本机 Node 能力。请仅在你信任当前模型、主题和资料时继续。\n\n' +
      '是否启用本地信任模式？'
    )
    if (!accepted) return false

    writeTrustedCodeExecutionFlag()
    setHasTrustedNodeExecution(true)
    return true
  }

  const runCodeArtifact = async (
    nextArtifact: PresentationCodeArtifact,
    nextInput: PresentationCodeRequest,
    showError = true
  ) => {
    if (!window.electronAPI?.runPresentationCodeDeck) {
      if (showError) setErrorMessage('当前环境暂不支持运行 PPT Agent 代码，请使用桌面版应用。')
      return null
    }

    const result = await window.electronAPI.runPresentationCodeDeck({
      artifact: {
        ...nextArtifact,
        trustedNodeExecution: true,
      },
      input: nextInput,
    })

    setLastRunOutput({ stdout: result.stdout, stderr: result.stderr })
    setDiagnostics(result.diagnostics ?? [])

    if (result.ok) {
      setPreviewSlides(result.slides ?? [])
      setCodeSessionId(result.sessionId ?? null)
      setStatusMessage(result.message)
      setErrorMessage(null)
    } else {
      setPreviewSlides([])
      setCodeSessionId(null)
      if (showError) {
        setErrorMessage(result.errorMessage || result.message)
      }
    }

    return result
  }

  const handleGenerate = async () => {
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

    if (!window.electronAPI?.runPresentationCodeDeck) {
      setErrorMessage('当前环境暂不支持运行 PPT Agent 代码，请使用桌面版应用。')
      return
    }

    if (renderToolsStatus?.ok === false) {
      setErrorMessage(renderToolsStatus.message)
      return
    }

    if (!confirmTrustedExecution()) {
      setErrorMessage('已取消本地代码执行，未生成 PPT。')
      return
    }

    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    setIsGenerating(true)
    setErrorMessage(null)
    setStatusMessage('正在让 PPT Agent 编写生成代码...')
    setDiagnostics([])
    setLastRunOutput(null)
    setCodeSessionId(null)

    try {
      const first = await generatePresentationCodeDeck({
        config: apiConfig,
        topic: cleanTopic,
        audience,
        goal,
        slideCount,
        themeId,
        files,
        signal: abortController.signal,
      })

      setArtifact(first.artifact)
      setCodeInput(first.input)
      setIsArtifactStale(false)
      setStatusMessage('代码已生成，正在执行并渲染真实预览...')

      const firstRun = await runCodeArtifact(first.artifact, first.input, false)
      const qualityWarnings = getPresentationQualityWarnings(firstRun?.diagnostics)
      if (firstRun?.ok && qualityWarnings.length === 0) return

      setStatusMessage(firstRun?.ok
        ? '真实预览发现画面偏空，正在自动补充语义矢量图和版式密度...'
        : '首次执行失败，正在让模型自动修复一次...')
      const repaired = await generatePresentationCodeDeck({
        config: apiConfig,
        topic: cleanTopic,
        audience,
        goal,
        slideCount,
        themeId,
        files,
        previousCode: first.artifact.code,
        failureMessage: firstRun?.ok
          ? formatQualityWarningsForRepair(qualityWarnings)
          : formatRunFailureForRepair(firstRun),
        stdout: firstRun?.stdout,
        stderr: firstRun?.stderr,
        signal: abortController.signal,
      })

      setArtifact(repaired.artifact)
      setCodeInput(repaired.input)
      setIsArtifactStale(false)
      setStatusMessage('修复代码已生成，正在重新执行真实预览...')

      const secondRun = await runCodeArtifact(repaired.artifact, repaired.input, true)
      if (!secondRun?.ok) {
        if (firstRun?.ok) {
          setArtifact(first.artifact)
          setCodeInput(first.input)
          setPreviewSlides(firstRun.slides ?? [])
          setCodeSessionId(firstRun.sessionId ?? null)
          setDiagnostics(firstRun.diagnostics ?? [])
          setLastRunOutput({ stdout: firstRun.stdout, stderr: firstRun.stderr })
          setStatusMessage('自动质量修复失败，已恢复首次可用预览。')
        }
        setErrorMessage(`自动修复后仍失败：${secondRun?.errorMessage || secondRun?.message || '未知错误'}`)
      } else {
        const repairedQualityWarnings = getPresentationQualityWarnings(secondRun.diagnostics)
        if (repairedQualityWarnings.length > 0) {
          setStatusMessage(`已生成真实预览，但仍有 ${repairedQualityWarnings.length} 条画面密度提醒，可按诊断继续优化。`)
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatusMessage('已停止生成。')
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'PPT Agent 生成失败。')
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
      setIsGenerating(false)
    }
  }

  const handlePreview = async () => {
    if (!artifact || !codeInput) {
      setErrorMessage('请先生成 PPT Agent 代码。')
      return
    }
    if (isArtifactStale) {
      setErrorMessage('当前输入已变更，请重新生成后再预览。')
      return
    }
    if (!confirmTrustedExecution()) {
      setErrorMessage('已取消本地代码执行。')
      return
    }

    setIsPreviewing(true)
    setErrorMessage(null)
    setStatusMessage('正在重新执行代码并生成真实预览...')

    try {
      await runCodeArtifact(artifact, codeInput, true)
    } catch (error) {
      setPreviewSlides([])
      setCodeSessionId(null)
      setErrorMessage(error instanceof Error ? error.message : '生成真实预览失败。')
    } finally {
      setIsPreviewing(false)
    }
  }

  const handleExport = async () => {
    if (!artifact || !codeInput) {
      setErrorMessage('请先生成 PPT。')
      return
    }
    if (isArtifactStale) {
      setErrorMessage('当前输入已变更，请重新生成后再导出。')
      return
    }
    if (!window.electronAPI?.exportPresentationCodeDeck) {
      setErrorMessage('当前环境暂不支持导出 PPTX，请使用桌面版应用。')
      return
    }

    setIsExporting(true)
    setErrorMessage(null)

    try {
      let sessionId = codeSessionId
      if (!sessionId) {
        if (!confirmTrustedExecution()) {
          setErrorMessage('已取消本地代码执行。')
          return
        }
        setStatusMessage('没有可导出的预览会话，正在先生成真实预览...')
        const runResult = await runCodeArtifact(artifact, codeInput, true)
        sessionId = runResult?.sessionId ?? null
      }

      if (!sessionId) {
        setErrorMessage('没有可导出的预览会话，请重新生成或真实预览。')
        return
      }

      setStatusMessage('正在导出与当前预览一致的 PPTX...')
      const result = await window.electronAPI.exportPresentationCodeDeck({
        sessionId,
        title: artifact.title || topic,
      })
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

  const handleStop = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsGenerating(false)
  }

  const handleClearResult = () => {
    setArtifact(null)
    setCodeInput(null)
    setCodeSessionId(null)
    setDiagnostics([])
    setPreviewSlides([])
    setLastRunOutput(null)
    setIsArtifactStale(false)
    setErrorMessage(null)
    setStatusMessage('已清空当前 PPT Agent 结果。')
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
              <Layers3 size={13} /> PPT Agent
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-surface-50">
              {artifact?.title || 'PPT 助手'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className={`hidden rounded-full border px-3 py-1.5 text-xs xl:inline-flex ${
              isArtifactStale
                ? 'border-amber-300/25 bg-amber-300/10 text-amber-100'
                : hasTrustedNodeExecution
                ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100'
                : 'border-amber-300/25 bg-amber-300/10 text-amber-100'
            }`}>
              {isArtifactStale
                ? '输入已变更'
                : hasTrustedNodeExecution ? '本地信任模式已启用' : '需确认信任模式'}
            </span>
            <button
              onClick={() => void handleGenerate()}
              disabled={isBusy || isProcessingFiles}
              className="btn-primary inline-flex h-10 items-center gap-2 rounded-2xl bg-cyan-600 px-3 text-xs hover:bg-cyan-500 disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              生成 PPT
            </button>
            <button
              onClick={() => void handleGenerate()}
              disabled={!artifact || isBusy || isProcessingFiles}
              className="btn-ghost inline-flex h-10 items-center gap-2 rounded-2xl border border-white/10 px-3 text-xs disabled:opacity-40"
            >
              <RefreshCcw size={14} />
              重新生成
            </button>
            <button
              onClick={() => void handlePreview()}
              disabled={!artifact || isArtifactStale || isBusy}
              className="btn-ghost inline-flex h-10 items-center gap-2 rounded-2xl border border-white/10 px-3 text-xs disabled:opacity-40"
              title={renderToolsStatus?.message ?? '重新执行代码并生成真实缩略图'}
            >
              {isPreviewing ? <Loader2 size={14} className="animate-spin" /> : <Cpu size={14} />}
              真实预览
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
                disabled={!artifact || isArtifactStale || isExporting || isPreviewing}
                className={`flex h-10 items-center gap-2 rounded-2xl border px-3 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  codeSessionId
                    ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15'
                    : 'border-amber-300/25 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15'
                }`}
                title={codeSessionId ? '导出当前预览 session 的 PPTX' : '导出前会先生成真实预览 session'}
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

        <div className="grid min-h-0 flex-1 grid-cols-[270px_minmax(0,1fr)_320px] gap-3 p-3">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#09111d]/86">
            <div className="border-b border-white/10 px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-surface-100">
                <Sparkles size={15} className="text-cyan-200" /> 项目设置
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <div className={`rounded-2xl border px-3 py-2 text-xs leading-5 ${
                renderToolsStatus?.ok
                  ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
                  : 'border-amber-300/20 bg-amber-400/10 text-amber-100'
              }`}>
                <div>
                  {renderToolsStatus
                    ? renderToolsStatus.message
                    : '正在检测 LibreOffice 和 Poppler 渲染依赖...'}
                </div>
                {renderToolsStatus?.ok === false && window.electronAPI?.installPresentationRenderTools && (
                  <button
                    onClick={() => void handleInstallRenderTools()}
                    disabled={isInstallingRenderTools}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-amber-200/25 bg-amber-200/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-50 transition hover:bg-amber-200/15 disabled:opacity-50"
                  >
                    {isInstallingRenderTools ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    一键安装依赖
                  </button>
                )}
              </div>

              <label className="block text-xs text-surface-400">
                PPT 主题
                <textarea
                  value={topic}
                  onChange={(event) => {
                    setTopic(event.target.value)
                    if (artifact) setIsArtifactStale(true)
                    setCodeSessionId(null)
                  }}
                  className="mt-1 min-h-[76px] w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm leading-5 text-surface-100 outline-none transition focus:border-cyan-300/35"
                  placeholder="例如：AI 工具高效使用培训"
                />
              </label>

              <label className="block text-xs text-surface-400">
                受众
                <input
                  value={audience}
                  onChange={(event) => {
                    setAudience(event.target.value)
                    if (artifact) setIsArtifactStale(true)
                    setCodeSessionId(null)
                  }}
                  className="mt-1 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-surface-100 outline-none transition focus:border-cyan-300/35"
                />
              </label>

              <label className="block text-xs text-surface-400">
                沟通目标
                <textarea
                  value={goal}
                  onChange={(event) => {
                    setGoal(event.target.value)
                    if (artifact) setIsArtifactStale(true)
                    setCodeSessionId(null)
                  }}
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
                    onChange={(event) => {
                      setSlideCount(clampSlideCount(Number(event.target.value)))
                      if (artifact) setIsArtifactStale(true)
                      setCodeSessionId(null)
                    }}
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
                    onClick={() => handleThemeChange(theme.id)}
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
                onClick={handleClearResult}
                disabled={!artifact && previewSlides.length === 0}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-surface-200 transition hover:bg-white/[0.08] disabled:opacity-40"
              >
                清空当前结果
              </button>
            </div>
          </section>

          <main className="flex min-h-0 flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#0b101a]/80">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-surface-100">真实预览</div>
                <div className="mt-0.5 text-xs text-surface-500">
                  {artifact
                    ? `${codeInput?.slideCount ?? slideCount} 页 · ${themeOption.label} · ${isArtifactStale ? '输入已变更' : previewSlides.length > 0 ? `${previewSlides.length} 张预览` : '等待渲染'}`
                    : '尚未生成'}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-surface-400">
                <Cpu size={13} className="text-cyan-200/80" />
                {activeModelValue ? modelOptions.find((option) => option.value === activeModelValue)?.label : '未选择模型'}
              </div>
            </div>

            {!artifact ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
                <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] border border-cyan-300/20 bg-cyan-300/10 shadow-[0_20px_70px_rgba(20,184,166,0.18)]">
                  <Code2 size={34} className="text-cyan-100" />
                </div>
                <h3 className="text-xl font-semibold text-surface-50">用 PPT Agent 生成可执行代码</h3>
                <p className="mt-3 max-w-md text-sm leading-6 text-surface-400">
                  模型会编写本地 Node.js 代码生成 PPTX，Electron 执行后用真实渲染链路预览；首次运行需要确认信任模式。
                </p>
                <button
                  onClick={() => void handleGenerate()}
                  disabled={isBusy || isProcessingFiles}
                  className="btn-primary mt-6 inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-5 py-3 hover:bg-cyan-500 disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                  生成 PPT
                </button>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {previewSlides.length === 0 ? (
                  <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[26px] border border-dashed border-white/12 bg-white/[0.025] px-8 text-center">
                    {isGenerating || isPreviewing ? (
                      <Loader2 size={34} className="mb-4 animate-spin text-cyan-100" />
                    ) : (
                      <Cpu size={34} className="mb-4 text-cyan-100" />
                    )}
                    <div className="text-base font-medium text-surface-100">
                      {isGenerating || isPreviewing ? '正在生成真实预览' : '还没有真实预览'}
                    </div>
                    <p className="mt-2 max-w-md text-sm leading-6 text-surface-500">
                      预览和导出会使用同一个运行 session。代码或渲染失败时，系统会自动让模型修复一次。
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                    {previewSlides.map((slide) => (
                      <div
                        key={slide.index}
                        className="group relative overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.035] p-3 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
                      >
                        <div
                          className="absolute inset-x-0 top-0 h-1"
                          style={{ background: `linear-gradient(90deg, ${themeOption.swatches.join(', ')})` }}
                        />
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-surface-400">
                            {String(slide.index + 1).padStart(2, '0')}
                          </span>
                          <span className="text-[10px] text-surface-500">真实渲染</span>
                        </div>
                        <div className="aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black/24">
                          <img
                            src={slide.dataUrl}
                            alt={`第 ${slide.index + 1} 页真实预览`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </main>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#09111d]/86">
            <div className="border-b border-white/10 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-surface-100">运行状态</div>
                {codeSessionId && (
                  <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-100">
                    可导出
                  </span>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <div className={`rounded-2xl border px-3 py-2 text-xs leading-5 ${
                hasTrustedNodeExecution
                  ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
                  : 'border-amber-300/20 bg-amber-400/10 text-amber-100'
              }`}>
                <div className="flex items-start gap-2">
                  <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                  <span>
                    {hasTrustedNodeExecution
                      ? '本地信任模式已确认。模型代码会在临时目录执行，预览成功后才能导出。'
                      : '首次运行前会弹窗确认本地 Node 信任模式。'}
                  </span>
                </div>
              </div>

              {artifact && codeSummary && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-surface-200">
                      <Code2 size={13} className="text-cyan-200" /> 代码产物
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-surface-500">
                      {codeSummary.lineCount} 行
                    </span>
                  </div>
                  {artifact.notes && (
                    <p className="mt-2 text-xs leading-5 text-surface-400">{artifact.notes}</p>
                  )}
                  <pre className="mt-3 max-h-64 overflow-auto rounded-2xl border border-white/8 bg-black/30 p-3 text-[10px] leading-4 text-surface-300">
                    {codeSummary.preview}
                    {codeSummary.isTruncated ? '\n\n...代码较长，已折叠后续内容。' : ''}
                  </pre>
                </div>
              )}

              {codeInput && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-surface-400">
                  <div className="mb-2 font-medium text-surface-200">输入摘要</div>
                  {isArtifactStale && (
                    <div className="mb-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-2 py-1.5 text-amber-100">
                      当前设置或资料已变更，需要重新生成后才能预览或导出。
                    </div>
                  )}
                  <div>主题：{codeInput.topic}</div>
                  <div>页数：{codeInput.slideCount}</div>
                  <div>主题风格：{THEME_OPTIONS.find((item) => item.id === codeInput.themeId)?.label ?? codeInput.themeId}</div>
                  <div>参考资料：{codeInput.files.length} 个</div>
                </div>
              )}

              {diagnostics.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-surface-200">诊断</div>
                  {diagnostics.map((diagnostic, index) => (
                    <div key={`${diagnostic.message}-${index}`} className={`rounded-xl border px-2 py-1.5 text-xs leading-5 ${getDiagnosticTone(diagnostic.level)}`}>
                      {diagnostic.message}
                    </div>
                  ))}
                </div>
              )}

              {(lastRunOutput?.stderr || lastRunOutput?.stdout) && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-2 text-xs font-medium text-surface-200">运行输出</div>
                  {lastRunOutput.stderr && (
                    <pre className="mb-2 max-h-36 overflow-auto rounded-xl border border-rose-300/15 bg-rose-400/10 p-2 text-[10px] leading-4 text-rose-100">
                      {lastRunOutput.stderr}
                    </pre>
                  )}
                  {lastRunOutput.stdout && (
                    <pre className="max-h-36 overflow-auto rounded-xl border border-white/8 bg-black/24 p-2 text-[10px] leading-4 text-surface-300">
                      {lastRunOutput.stdout}
                    </pre>
                  )}
                </div>
              )}
            </div>

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
