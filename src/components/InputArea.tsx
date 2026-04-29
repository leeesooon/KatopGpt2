import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Send, Square, ImagePlus, Paperclip, X, FileText, Search, Loader2,
  SquareArrowOutUpRight, Download, Sparkles, ChevronUp, Check, SlidersHorizontal,
} from 'lucide-react'
import ModelSelector from './ModelSelector'
import RoleAvatar from './RoleAvatar'
import { useChatStore } from '../store/chatStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { buildAssistantSystemPrompt, resolveAssistantProfile } from '../services/assistantProfiles'
import type { AssistantProfile, ChatInputMode, DocumentAgentMode, ImageAttachment, FileAttachment } from '../types'
import {
  FILE_INPUT_ACCEPT,
  IMAGE_PROMPT_PRESETS,
} from './inputAreaAttachments'
import { useAttachmentProcessor } from './useAttachmentProcessor'

interface InputAreaProps {
  onSend: (
    content: string,
    images: ImageAttachment[],
    files: FileAttachment[],
    options?: {
      imageSeries?: {
        enabled: boolean
        count: number
        mode: 'template_parallel' | 'sequential'
      }
    }
  ) => void
  onStop: () => void
  onExportSpreadsheet?: () => void
  imageReferenceDraft?: ImageAttachment | null
  onConsumeImageReferenceDraft?: () => void
  inputMode: ChatInputMode
  onInputModeChange: (mode: ChatInputMode) => void
  hasSpreadsheetSession?: boolean
  spreadsheetName?: string | null
  isExportingSpreadsheet?: boolean
  isStreaming: boolean
  isImageGenerating?: boolean
  disabled: boolean
  contextStats: {
    messageCount: number
    messageChars: number
  }
  activeAssistantProfileId?: string | null
  onRoleSelected?: (profile: AssistantProfile) => void
}

export default function InputArea({
  onSend,
  onStop,
  onExportSpreadsheet,
  imageReferenceDraft = null,
  onConsumeImageReferenceDraft,
  inputMode,
  onInputModeChange,
  hasSpreadsheetSession = false,
  spreadsheetName = null,
  isExportingSpreadsheet = false,
  isStreaming,
  isImageGenerating = false,
  disabled,
  contextStats,
  activeAssistantProfileId,
  onRoleSelected,
}: InputAreaProps) {
  const {
    searchEnabled,
    setSearchEnabled,
    settings,
    setAssistantProfilesOpen,
  } = useChatStore()
  const {
    pendingAction,
    composerDraft,
    consumeComposerDraft,
    isPanelVisible,
    setPanelVisible,
  } = useWorkspaceStore()
  const [input, setInput] = useState('')
  const [workspaceWindowOpen, setWorkspaceWindowOpen] = useState(false)
  const [isPromptPanelOpen, setIsPromptPanelOpen] = useState(false)
  const [isImageSeriesMode, setIsImageSeriesMode] = useState(false)
  const [imageSeriesCount, setImageSeriesCount] = useState(4)
  const [imageSeriesMode, setImageSeriesMode] = useState<'template_parallel' | 'sequential'>('template_parallel')
  const [isDragOver, setIsDragOver] = useState(false)
  const [isRoleSelectorOpen, setIsRoleSelectorOpen] = useState(false)
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const roleSelectorRef = useRef<HTMLDivElement>(null)
  const dragCounterRef = useRef(0)
  const previousInputModeRef = useRef<ChatInputMode>(inputMode)
  const isImageMode = inputMode === 'image'
  const {
    images,
    files,
    attachmentTasks,
    attachmentError,
    isProcessingFiles,
    processFiles,
    processImageFiles,
    retryTask,
    removeTask,
    addImageAttachment,
    removeImage,
    removeFile,
    clearAttachments,
    clearFiles,
    clearImages,
    setAttachmentError,
    formatFileSize,
  } = useAttachmentProcessor({ isImageMode })

  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isStreaming])

  useEffect(() => {
    const enteredImageMode = previousInputModeRef.current !== 'image' && isImageMode
    previousInputModeRef.current = inputMode
    if (isImageMode) {
      if (enteredImageMode && !imageReferenceDraft) {
        clearImages()
      }
      clearFiles()
      setAttachmentError(null)
    }
  }, [clearFiles, clearImages, imageReferenceDraft, inputMode, isImageMode, setAttachmentError])

  useEffect(() => {
    if (!imageReferenceDraft) return
    clearAttachments()
    addImageAttachment(imageReferenceDraft)
    setAttachmentError('已添加参考图，请输入修改要求')
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
    onConsumeImageReferenceDraft?.()
  }, [addImageAttachment, clearAttachments, imageReferenceDraft, onConsumeImageReferenceDraft, setAttachmentError])

  useEffect(() => {
    if (!composerDraft) return
    setInput((currentInput) => currentInput.trim() ? currentInput : composerDraft.text)
    requestAnimationFrame(() => {
      adjustHeight()
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(composerDraft.text.length, composerDraft.text.length)
    })
    consumeComposerDraft()
  }, [composerDraft, consumeComposerDraft])

  useEffect(() => {
    if (!window.electronAPI?.getWorkspaceWindowState) return

    let listenerId: number | null = null

    void window.electronAPI.getWorkspaceWindowState().then((state) => setWorkspaceWindowOpen(state.open))
    listenerId = window.electronAPI.subscribeWorkspaceWindowState((state) => setWorkspaceWindowOpen(state.open))

    return () => {
      if (listenerId !== null) {
        window.electronAPI?.unsubscribeWorkspaceWindowState(listenerId)
      }
    }
  }, [])

  useEffect(() => {
    if (!isRoleSelectorOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!roleSelectorRef.current?.contains(event.target as Node)) {
        setIsRoleSelectorOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isRoleSelectorOpen])

  const adjustHeight = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const handleSend = () => {
    const trimmed = input.trim()
    if (isImageMode && (!trimmed || disabled || isProcessingFiles)) return
    if ((!trimmed && images.length === 0 && files.length === 0) || disabled || isProcessingFiles) return
    onSend(trimmed, images, files, {
      imageSeries: {
        enabled: isImageMode && isImageSeriesMode,
        count: imageSeriesCount,
        mode: imageSeriesMode,
      },
    })
    setInput('')
    clearAttachments()
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const appendPromptPreset = (preset: string) => {
    setInput((current) => {
      const separator = current.trim() ? '，' : ''
      return `${current}${separator}${preset}`
    })
    requestAnimationFrame(() => {
      adjustHeight()
      textareaRef.current?.focus()
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isStreaming) return
      handleSend()
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList) return
    processImageFiles(fileList)
    e.target.value = ''
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList) return
    processFiles(fileList)
    e.target.value = ''
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        processImageFiles([file])
      }
    }
  }

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragOver(false)

    const droppedFiles = e.dataTransfer.files
    if (droppedFiles.length > 0) {
      processFiles(droppedFiles)
    }
  }

  const hasAttachments = images.length > 0 || files.length > 0
  const actionLabelMap: Record<DocumentAgentMode, string> = {
    chat: '普通对话',
    create: '生成初稿',
    rewrite: '改写文档',
    expand: '扩写文档',
    summarize: '总结文档',
  }

  const placeholder = pendingAction === 'chat'
    ? isImageMode
      ? '描述你想生成或修改的图片... (Enter 生成, Shift+Enter 换行)'
      : '输入消息... (Enter 发送, Shift+Enter 换行, 可拖拽文件)'
    : `当前模式：${actionLabelMap[pendingAction]}，继续补充你的要求后发送`

  const contextIndicator = useMemo(() => {
    const draftChars = input.trim().length
    const systemChars = buildAssistantSystemPrompt(settings, undefined, activeAssistantProfileId).trim().length
    const totalChars = systemChars + contextStats.messageChars + draftChars
    const estimatedTokens = Math.max(1, Math.round(totalChars / 2))

    return {
      messageCount: contextStats.messageCount,
      totalChars,
      estimatedTokens,
    }
  }, [activeAssistantProfileId, contextStats.messageChars, contextStats.messageCount, input, settings])

  const isDocumentAssistantOpen = isPanelVisible || workspaceWindowOpen
  const activeAssistant = resolveAssistantProfile(settings, activeAssistantProfileId)
  const visibleAssistantProfiles = settings.assistantProfiles.filter((profile) => !profile.isHidden)
  const enabledKnowledgeCount = activeAssistant?.knowledgeDocuments.filter((document) => document.enabled).length ?? 0

  const handleSelectRole = (profileId: string) => {
    const selectedProfile = visibleAssistantProfiles.find((profile) => profile.id === profileId)
    setIsRoleSelectorOpen(false)
    if (selectedProfile) {
      onRoleSelected?.(selectedProfile)
    }
  }

  const handleToggleDocumentAssistant = async () => {
    if (isDocumentAssistantOpen) {
      if (workspaceWindowOpen && window.electronAPI?.closeWorkspaceWindow) {
        await window.electronAPI.closeWorkspaceWindow()
      }
      setPanelVisible(false)
      return
    }

    if (window.electronAPI?.openWorkspaceWindow) {
      await window.electronAPI.openWorkspaceWindow()
      setPanelVisible(false)
      return
    }

    setPanelVisible(true)
  }

  const pendingAttachmentTasks = attachmentTasks.filter((task) => task.status !== 'ready')

  const getTaskStatusText = (status: string) => {
    if (status === 'queued') return '等待处理'
    if (status === 'reading') return '读取中'
    if (status === 'extracting') return '提取中'
    if (status === 'error') return '失败'
    return '已完成'
  }

  const getSpreadsheetSummary = (file: FileAttachment) => {
    const schema = file.spreadsheetSchema
    if (!schema?.sheets.length) return null
    const totalRows = schema.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0)
    const totalColumns = schema.sheets.reduce((sum, sheet) => sum + sheet.columnCount, 0)
    return `${schema.sheets.length} 个工作表 / ${totalRows} 行 / ${totalColumns} 列`
  }

  return (
    <div
      className="border-t border-surface-800/50 bg-surface-900/30 p-4 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-20 bg-primary-600/10 border-2 border-dashed border-primary-400/50
                        rounded-xl flex items-center justify-center backdrop-blur-sm animate-fade-in">
          <div className="text-center">
            <Paperclip size={32} className="text-primary-400 mx-auto mb-2" />
            <p className="text-primary-300 text-sm font-medium">松开以添加文件</p>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto">
        <div className="mb-2 flex items-center gap-2">
          {!isImageMode && activeAssistant && (
            <div ref={roleSelectorRef} className="relative">
              {isRoleSelectorOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-2xl border border-amber-300/20 bg-surface-950/95 shadow-2xl shadow-black/35 backdrop-blur-xl animate-slide-up">
                  <div className="border-b border-white/8 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-amber-100">选择角色</p>
                      <button
                        onClick={() => {
                          setAssistantProfilesOpen(true)
                          setIsRoleSelectorOpen(false)
                        }}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-surface-400 transition hover:bg-white/10 hover:text-white"
                      >
                        <SlidersHorizontal size={12} />
                        配置
                      </button>
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto p-2">
                    {visibleAssistantProfiles.map((profile) => {
                      const isActiveRole = profile.id === activeAssistant.id
                      const profileKnowledgeCount = profile.knowledgeDocuments.filter((document) => document.enabled).length

                      return (
                        <button
                          key={profile.id}
                          onClick={() => handleSelectRole(profile.id)}
                          className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                            isActiveRole
                              ? 'bg-amber-300/12 text-amber-50'
                              : 'text-surface-300 hover:bg-white/[0.06] hover:text-white'
                          }`}
                        >
                          <RoleAvatar avatarId={profile.avatarId} emoji={profile.emoji} size="xs" className="mt-0.5" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{profile.name}</span>
                              {isActiveRole && <Check size={13} className="shrink-0 text-amber-200" />}
                            </span>
                            <span className="mt-0.5 line-clamp-1 text-[11px] text-surface-500">
                              {profileKnowledgeCount > 0
                                ? `${profile.description || '自定义角色'} · ${profileKnowledgeCount} 个知识资料`
                                : profile.description || '自定义角色'}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <button
                onClick={() => setIsRoleSelectorOpen((open) => !open)}
                className={`group/role inline-flex h-8 items-center overflow-hidden rounded-full border border-amber-300/20 bg-amber-300/10 text-xs text-amber-50 transition-[max-width,border-color,background-color,box-shadow] duration-200 hover:max-w-[224px] hover:border-amber-200/30 hover:bg-amber-300/15 focus-visible:max-w-[224px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/25 ${
                  isRoleSelectorOpen ? 'max-w-[224px]' : 'max-w-8'
                }`}
                title={`角色：${activeAssistant.name}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                  <RoleAvatar avatarId={activeAssistant.avatarId} emoji={activeAssistant.emoji} size="xs" />
                </span>
                <span className={`flex w-max min-w-0 items-center gap-1.5 pr-2 transition-opacity duration-200 ${
                  isRoleSelectorOpen
                    ? 'opacity-100'
                    : 'opacity-0 group-hover/role:opacity-100 group-focus-visible/role:opacity-100'
                }`}>
                  <span className="max-w-[132px] truncate">角色：{activeAssistant.name}</span>
                  {enabledKnowledgeCount > 0 && (
                    <span className="shrink-0 text-amber-200/80">+{enabledKnowledgeCount} 资料</span>
                  )}
                  <ChevronUp size={13} className={`shrink-0 text-amber-200/80 transition ${isRoleSelectorOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>
            </div>
          )}
          <div className="inline-flex h-8 items-center rounded-full border border-white/10 bg-white/5 p-0.5 text-xs">
            <button
              onClick={() => onInputModeChange('chat')}
              disabled={isStreaming}
              className={`h-7 rounded-full px-3 transition disabled:opacity-50 ${
                !isImageMode ? 'bg-primary-500/20 text-primary-200' : 'text-surface-400 hover:text-white'
              }`}
              title="切换到聊天模式"
            >
              聊天
            </button>
            <button
              onClick={() => onInputModeChange('image')}
              disabled={isStreaming}
              className={`inline-flex h-7 items-center gap-1 rounded-full px-3 transition disabled:opacity-50 ${
                isImageMode ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'text-surface-400 hover:text-white'
              }`}
              title="切换到生图模式"
            >
              <Sparkles size={12} />
              生图
            </button>
          </div>
          {!isDocumentAssistantOpen && (
            <button
              onClick={() => void handleToggleDocumentAssistant()}
              disabled={isImageMode}
              className="inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-xs text-surface-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title="打开文档助手"
            >
              <SquareArrowOutUpRight size={14} />
              <span>打开文档助手</span>
            </button>
          )}
          {!isImageMode && hasSpreadsheetSession && onExportSpreadsheet && (
            <button
              onClick={onExportSpreadsheet}
              disabled={disabled || isExportingSpreadsheet}
              className="inline-flex h-8 items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 text-xs text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-50"
              title={spreadsheetName ? `导出当前表格：${spreadsheetName}` : '导出当前表格'}
            >
              {isExportingSpreadsheet ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>{isExportingSpreadsheet ? '导出中...' : '导出表格'}</span>
            </button>
          )}
          {isImageMode && (
            <>
              <button
                onClick={() => setIsImageSeriesMode((enabled) => !enabled)}
                disabled={isStreaming}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                  isImageSeriesMode
                    ? 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100'
                    : 'border-white/10 bg-white/5 text-surface-300 hover:bg-white/10 hover:text-white'
                }`}
                title="连续生成多张章节图片"
              >
                <Sparkles size={14} />
                连续多图
              </button>
              {isImageSeriesMode && (
                <>
                  <select
                    value={imageSeriesCount}
                    onChange={(event) => setImageSeriesCount(Number(event.target.value))}
                    disabled={isStreaming}
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-surface-200 outline-none transition disabled:opacity-50"
                    title="连续多图张数"
                  >
                    {[2, 3, 4, 5, 6, 7, 8].map((count) => (
                      <option key={count} value={count}>{count} 张</option>
                    ))}
                  </select>
                  <select
                    value={imageSeriesMode}
                    onChange={(event) => setImageSeriesMode(event.target.value as 'template_parallel' | 'sequential')}
                    disabled={isStreaming}
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-surface-200 outline-none transition disabled:opacity-50"
                    title="连续多图生成模式"
                  >
                    <option value="template_parallel">首图模板（较快）</option>
                    <option value="sequential">真串行（更稳）</option>
                  </select>
                </>
              )}
              <button
                onClick={() => setIsPromptPanelOpen((open) => !open)}
                disabled={isStreaming}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                  isPromptPanelOpen
                    ? 'border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-100'
                    : 'border-white/10 bg-white/5 text-surface-300 hover:bg-white/10 hover:text-white'
                }`}
                title="打开提示词增强面板"
              >
                <Sparkles size={14} />
                提示词增强
              </button>
            </>
          )}
        </div>
        {isImageMode && isPromptPanelOpen && (
          <div className="mb-2 rounded-xl border border-fuchsia-300/15 bg-fuchsia-950/10 p-3 shadow-lg shadow-fuchsia-950/10">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-fuchsia-100">点击标签追加到提示词</p>
              <button
                onClick={() => setIsPromptPanelOpen(false)}
                className="rounded-full p-1 text-surface-400 transition hover:bg-white/10 hover:text-white"
                title="关闭提示词增强"
              >
                <X size={13} />
              </button>
            </div>
            <div className="space-y-2">
              {IMAGE_PROMPT_PRESETS.map((presetGroup) => (
                <div key={presetGroup.group} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-10 shrink-0 text-[11px] text-surface-500">{presetGroup.group}</span>
                  {presetGroup.items.map((item) => (
                    <button
                      key={item}
                      onClick={() => appendPromptPreset(item)}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-surface-300 transition hover:border-fuchsia-300/30 hover:bg-fuchsia-300/10 hover:text-fuchsia-100"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="glass-panel rounded-xl p-2">
          {/* Model selector row */}
          <div className="mb-1 flex items-center justify-between gap-2 border-b border-surface-700/30 px-1 pb-1.5">
            <ModelSelector />
          </div>

          {/* Image previews */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 py-2">
              {images.map((img) => (
                <div key={img.id} className="relative group shrink-0">
                  <img
                    src={img.base64}
                    alt={img.name}
                    className="h-16 w-16 object-cover rounded-lg border border-surface-600/50"
                  />
                  <button
                    onClick={() => removeImage(img.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-surface-800 border border-surface-600
                               rounded-full flex items-center justify-center
                               opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/30"
                  >
                    <X size={10} className="text-surface-300" />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-surface-300
                                  text-center truncate px-0.5 rounded-b-lg">
                    {img.name}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* File previews */}
          {files.length > 0 && (
            <div className="space-y-2 px-2 py-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="rounded-lg border border-surface-600/50 bg-surface-700/40 px-2.5 py-2"
                >
                  <div className="flex items-center gap-1.5">
                    <FileText size={14} className="text-primary-400 shrink-0" />
                    <span className="text-xs text-surface-300 truncate max-w-[150px]">{file.name}</span>
                    <span className="text-[10px] text-surface-500">{formatFileSize(file.size)}</span>
                    {file.isTruncated && (
                      <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-1.5 py-0.5 text-[10px] text-amber-100">
                        已压缩
                      </span>
                    )}
                    {file.spreadsheetSchema && (
                      <button
                        onClick={() => setExpandedFileId((currentId) => currentId === file.id ? null : file.id)}
                        className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-1.5 py-0.5 text-[10px] text-emerald-100 transition hover:bg-emerald-300/15"
                        title="查看表格结构"
                      >
                        {getSpreadsheetSummary(file) ?? '表格预览'}
                      </button>
                    )}
                    <button
                      onClick={() => removeFile(file.id)}
                      className="ml-auto p-0.5 hover:bg-red-500/20 rounded transition-colors"
                      title="移除文件"
                    >
                      <X size={12} className="text-surface-400 hover:text-red-400" />
                    </button>
                  </div>
                  {file.validationWarning && (
                    <div className="mt-1 text-[10px] text-amber-200/80">{file.validationWarning}</div>
                  )}
                  {expandedFileId === file.id && file.spreadsheetSchema && (
                    <div className="mt-2 space-y-1 rounded-lg border border-white/8 bg-black/15 p-2 text-[10px] text-surface-300">
                      {file.spreadsheetSchema.sheets.slice(0, 4).map((sheet) => (
                        <div key={sheet.name}>
                          <span className="text-surface-100">{sheet.name}</span>
                          <span className="text-surface-500"> · {sheet.rowCount} 行 / {sheet.columnCount} 列</span>
                          <div className="mt-0.5 truncate text-surface-400">
                            {sheet.columns.slice(0, 8).map((column) => column.name).join('、') || '未识别列名'}
                            {sheet.columns.length > 8 ? '…' : ''}
                          </div>
                        </div>
                      ))}
                      {file.spreadsheetSchema.sheets.length > 4 && (
                        <div className="text-surface-500">还有 {file.spreadsheetSchema.sheets.length - 4} 个工作表未展开</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {pendingAttachmentTasks.length > 0 && (
            <div className="space-y-1 px-2 pb-2">
              {pendingAttachmentTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1.5 text-xs text-surface-400">
                  {task.status === 'error' ? (
                    <span className="h-2 w-2 rounded-full bg-red-400" />
                  ) : (
                    <Loader2 size={14} className="animate-spin text-primary-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {task.name} · {getTaskStatusText(task.status)}
                    {task.error ? `：${task.error}` : task.message ? `：${task.message}` : ''}
                  </span>
                  <span className="text-[10px] text-surface-500">{formatFileSize(task.size)}</span>
                  {task.status === 'error' && (
                    <button
                      onClick={() => retryTask(task.id)}
                      className="rounded px-1.5 py-0.5 text-[10px] text-primary-200 transition hover:bg-primary-500/20"
                    >
                      重试
                    </button>
                  )}
                  <button
                    onClick={() => removeTask(task.id)}
                    className="rounded p-0.5 transition hover:bg-red-500/20"
                    title="移除任务"
                  >
                    <X size={11} className="text-surface-500 hover:text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {attachmentError && (
            <div className="px-2 pb-2 text-xs text-red-400 break-all">
              {attachmentError}
            </div>
          )}

          {/* Input row */}
          <div className="flex items-end gap-2">
            {/* Search toggle button */}
            {(settings.serperApiKey || settings.tavilyApiKey) && (
              <button
                onClick={() => setSearchEnabled(!searchEnabled)}
                disabled={disabled || isStreaming || isImageMode}
                className={`shrink-0 p-2 rounded-lg transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed ${
                  searchEnabled
                    ? 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'
                    : 'hover:bg-surface-700/50 text-surface-400 hover:text-surface-200'
                }`}
                title={searchEnabled ? '已启用网络搜索' : '点击启用网络搜索'}
              >
                <Search size={18} />
              </button>
            )}


            {/* Image upload button */}
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={disabled || isStreaming}
              className="shrink-0 p-2 hover:bg-surface-700/50 text-surface-400 hover:text-surface-200
                         rounded-lg transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
              title={isImageMode ? '添加参考图（仅保留 1 张）' : '添加图片'}
            >
              <ImagePlus size={18} />
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple={!isImageMode}
              onChange={handleImageSelect}
              className="hidden"
            />

            {/* File upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isStreaming || isImageMode}
              className="shrink-0 p-2 hover:bg-surface-700/50 text-surface-400 hover:text-surface-200
                         rounded-lg transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
              title="添加文件"
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_INPUT_ACCEPT}
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                adjustHeight()
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              rows={1}
              disabled={disabled}
              className="flex-1 bg-transparent text-surface-100 placeholder-surface-500 text-sm
                         resize-none outline-none px-2 py-1.5 max-h-[200px] leading-relaxed"
            />
            {isStreaming ? (
              <button
                onClick={onStop}
                className="shrink-0 p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400
                           rounded-lg transition-all duration-200 active:scale-95"
                title="停止生成"
              >
                <Square size={18} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={(isImageMode ? !input.trim() : (!input.trim() && images.length === 0 && files.length === 0)) || disabled || isProcessingFiles}
                className="shrink-0 p-2 bg-primary-600 hover:bg-primary-500 text-white
                           rounded-lg transition-all duration-200 active:scale-95
                           disabled:opacity-30 disabled:cursor-not-allowed"
                title={isProcessingFiles ? '请等待文档提取完成' : isImageMode ? '生成图片' : '发送'}
              >
                {isImageMode ? <Sparkles size={18} /> : <Send size={18} />}
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-surface-500">
          <div className="truncate">
            当前上下文约 {contextIndicator.estimatedTokens} tokens / {contextIndicator.totalChars} chars / {contextIndicator.messageCount} 条消息
          </div>
          <p className="text-right">AI 可能会犯错，请核实重要信息</p>
        </div>
      </div>
    </div>
  )
}

