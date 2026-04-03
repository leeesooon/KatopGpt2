import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Square, ImagePlus, Paperclip, X, FileText, Search, Loader2, BookOpenText, SquareArrowOutUpRight, Download } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import ModelSelector from './ModelSelector'
import { useChatStore } from '../store/chatStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import type { DocumentAgentMode, ImageAttachment, FileAttachment } from '../types'

const EXTRACTABLE_DOCUMENT_EXTENSIONS = ['.pptx', '.pdf', '.docx', '.xlsx', '.csv']

const EXTRACTABLE_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]

const FILE_INPUT_ACCEPT = '.txt,.md,.markdown,.json,.csv,.pdf,.pptx,.docx,.xlsx'

function looksLikeBinaryText(content: string) {
  if (!content) return false

  const sample = content.slice(0, 4000)
  let suspiciousChars = 0

  for (const char of sample) {
    const code = char.charCodeAt(0)
    const isAllowedControl = code === 9 || code === 10 || code === 13
    const isSuspiciousControl = code === 0 || (code < 32 && !isAllowedControl)
    if (isSuspiciousControl || char === '\u0000' || char === '\u001a' || char === '\u0003') {
      suspiciousChars += 1
    }
  }

  return suspiciousChars > Math.max(8, sample.length * 0.02)
}

function getFileExtension(fileName: string) {
  const lastDotIndex = fileName.lastIndexOf('.')
  return lastDotIndex >= 0 ? fileName.slice(lastDotIndex).toLowerCase() : ''
}

function isExtractableDocument(file: File) {
  const extension = getFileExtension(file.name)
  if (EXTRACTABLE_DOCUMENT_EXTENSIONS.includes(extension)) {
    return true
  }

  return EXTRACTABLE_DOCUMENT_MIME_TYPES.includes(file.type)
}

interface InputAreaProps {
  onSend: (content: string, images: ImageAttachment[], files: FileAttachment[]) => void
  onStop: () => void
  onExportSpreadsheet?: () => void
  hasSpreadsheetSession?: boolean
  spreadsheetName?: string | null
  isExportingSpreadsheet?: boolean
  isStreaming: boolean
  disabled: boolean
  contextStats: {
    messageCount: number
    messageChars: number
  }
}

export default function InputArea({
  onSend,
  onStop,
  onExportSpreadsheet,
  hasSpreadsheetSession = false,
  spreadsheetName = null,
  isExportingSpreadsheet = false,
  isStreaming,
  disabled,
  contextStats,
}: InputAreaProps) {
  const { searchEnabled, setSearchEnabled, settings } = useChatStore()
  const {
    currentWorkspace,
    activeDocumentPath,
    documents,
    pendingAction,
    composerDraft,
    consumeComposerDraft,
    clearPendingAction,
    closeActiveDocument,
    cancelDocumentWorkflow,
    exitWorkspaceAssistant,
    isPanelVisible,
    setPanelVisible,
  } = useWorkspaceStore()
  const [input, setInput] = useState('')
  const [workspaceWindowOpen, setWorkspaceWindowOpen] = useState(false)
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [files, setFiles] = useState<FileAttachment[]>([])
  const [pendingFiles, setPendingFiles] = useState<string[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)
  const isProcessingFiles = pendingFiles.length > 0

  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isStreaming])

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

  const adjustHeight = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const handleSend = () => {
    const trimmed = input.trim()
    if ((!trimmed && images.length === 0 && files.length === 0) || disabled || isProcessingFiles) return
    onSend(trimmed, images, files)
    setInput('')
    setImages([])
    setFiles([])
    setAttachmentError(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isStreaming) return
      handleSend()
    }
  }

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
      reader.readAsDataURL(file)
    })

  const readFileAsText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
      reader.readAsText(file)
    })

  const readFileAsArrayBuffer = (file: File) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
      reader.readAsArrayBuffer(file)
    })

  const addImageFile = async (file: File) => {
    const base64 = await readFileAsDataUrl(file)
    setImages((prev) => [...prev, { id: uuidv4(), base64, name: file.name }])
  }

  const addTextFile = async (file: File) => {
    const content = await readFileAsText(file)
    if (looksLikeBinaryText(content)) {
      throw new Error('该文件看起来是二进制内容，请使用可解析的文本文件或表格文件（.csv/.xlsx）')
    }

    setFiles((prev) => [
      ...prev,
      { id: uuidv4(), name: file.name, size: file.size, content, fileType: 'text' },
    ])
  }

  const addExtractedDocumentFile = async (file: File) => {
    if (!window.electronAPI?.extractDocumentText) {
      throw new Error('当前环境暂不支持自动提取该文档，请使用桌面版应用')
    }

    const data = await readFileAsArrayBuffer(file)
    const result = await window.electronAPI.extractDocumentText({
      fileName: file.name,
      mimeType: file.type,
      data,
    })

    if (!result.ok || !result.content) {
      throw new Error(result.error ?? '自动提取文本失败')
    }

    const content = result.content

    setFiles((prev) => [
      ...prev,
      {
        id: uuidv4(),
        name: file.name,
        size: file.size,
        content,
        fileType: result.fileType,
        spreadsheetSessionId: result.spreadsheetSessionId,
        spreadsheetSchema: result.spreadsheetSchema,
      },
    ])
  }

  const processSingleFile = async (file: File) => {
    if (file.type.startsWith('image/')) {
      await addImageFile(file)
      return
    }

    setAttachmentError(null)
    setPendingFiles((prev) => [...prev, file.name])

    try {
      if (isExtractableDocument(file)) {
        await addExtractedDocumentFile(file)
      } else {
        await addTextFile(file)
      }
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : `处理文件失败：${file.name}`)
    } finally {
      setPendingFiles((prev) => {
        const index = prev.indexOf(file.name)
        if (index < 0) return prev
        return prev.filter((_, currentIndex) => currentIndex !== index)
      })
    }
  }

  const processFiles = async (fileList: FileList | File[]) => {
    for (const file of Array.from(fileList)) {
      await processSingleFile(file)
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList) return
    Array.from(fileList).forEach((file) => {
      if (file.type.startsWith('image/')) void addImageFile(file)
    })
    e.target.value = ''
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList) return
    void processFiles(fileList)
    e.target.value = ''
  }

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        void addImageFile(file)
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
      void processFiles(droppedFiles)
    }
  }

  const hasAttachments = images.length > 0 || files.length > 0
  const activeDocument = activeDocumentPath ? documents[activeDocumentPath] : null

  const actionLabelMap: Record<DocumentAgentMode, string> = {
    chat: '普通对话',
    create: '生成初稿',
    rewrite: '改写文档',
    expand: '扩写文档',
    summarize: '总结文档',
  }

  const placeholder = pendingAction === 'chat'
    ? '输入消息... (Enter 发送, Shift+Enter 换行, 可拖拽文件)'
    : `当前模式：${actionLabelMap[pendingAction]}，继续补充你的要求后发送`

  const contextIndicator = useMemo(() => {
    const draftChars = input.trim().length
    const systemChars = settings.systemPrompt.trim().length
    const totalChars = systemChars + contextStats.messageChars + draftChars
    const estimatedTokens = Math.max(1, Math.round(totalChars / 2))

    return {
      messageCount: contextStats.messageCount,
      totalChars,
      estimatedTokens,
    }
  }, [contextStats.messageChars, contextStats.messageCount, input, settings.systemPrompt])

  const isDocumentAssistantOpen = isPanelVisible || workspaceWindowOpen

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
          <button
            onClick={() => void handleToggleDocumentAssistant()}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
              isDocumentAssistantOpen
                ? 'border-amber-300/20 bg-amber-300/10 text-amber-100'
                : 'border-white/10 bg-white/5 text-surface-300 hover:bg-white/10 hover:text-white'
            }`}
            title={isDocumentAssistantOpen ? '关闭文档助手' : '打开文档助手'}
          >
            {isDocumentAssistantOpen ? <BookOpenText size={14} /> : <SquareArrowOutUpRight size={14} />}
            <span>{isDocumentAssistantOpen ? '文档助手已开启' : '打开文档助手'}</span>
          </button>
          {currentWorkspace && (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-surface-400">
              绑定到当前对话
            </span>
          )}
          {hasSpreadsheetSession && onExportSpreadsheet && (
            <button
              onClick={onExportSpreadsheet}
              disabled={disabled || isExportingSpreadsheet}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-50"
              title={spreadsheetName ? `导出当前表格：${spreadsheetName}` : '导出当前表格'}
            >
              {isExportingSpreadsheet ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>{isExportingSpreadsheet ? '导出中...' : '导出表格'}</span>
            </button>
          )}
        </div>
        <div className="glass-panel rounded-xl p-2">
          {/* Model selector row */}
          <div className="mb-1 flex items-center justify-between gap-2 border-b border-surface-700/30 px-1 pb-1.5">
            <ModelSelector />
            {currentWorkspace && (
              <div className="flex items-center gap-2 text-[11px] text-surface-400">
                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  <span>工作区: {currentWorkspace.name}</span>
                  <button
                    onClick={() => {
                      exitWorkspaceAssistant()
                    }}
                    className="rounded-full p-0.5 text-surface-500 transition hover:bg-white/10 hover:text-surface-100"
                    title="退出编写助手"
                  >
                    <X size={11} />
                  </button>
                </span>
                {activeDocument && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/15 bg-amber-300/10 px-2 py-1 text-amber-100/90">
                    <span>当前文档: {activeDocument.title}</span>
                    <button
                      onClick={closeActiveDocument}
                      className="rounded-full p-0.5 text-amber-100/60 transition hover:bg-amber-100/10 hover:text-amber-50"
                      title="关闭当前文档"
                    >
                      <X size={11} />
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>

          {pendingAction !== 'chat' && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-300/15 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
              <div>
                <span className="font-medium">文档模式:</span> {actionLabelMap[pendingAction]}
                {activeDocument && <span className="text-amber-100/70"> · {activeDocument.title}</span>}
              </div>
              <button onClick={clearPendingAction} className="rounded-full border border-amber-200/15 px-2 py-1 text-[11px] text-amber-100/80 transition hover:bg-amber-200/10">
                取消
              </button>
            </div>
          )}

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
            <div className="flex flex-wrap gap-2 px-2 py-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="relative group flex items-center gap-1.5 px-2.5 py-1.5
                             bg-surface-700/40 border border-surface-600/50 rounded-lg"
                >
                  <FileText size={14} className="text-primary-400 shrink-0" />
                  <span className="text-xs text-surface-300 truncate max-w-[120px]">{file.name}</span>
                  <span className="text-[10px] text-surface-500">
                    {file.size < 1024
                      ? `${file.size} B`
                      : file.size < 1048576
                        ? `${(file.size / 1024).toFixed(1)} KB`
                        : `${(file.size / 1048576).toFixed(1)} MB`}
                  </span>
                  <button
                    onClick={() => removeFile(file.id)}
                    className="ml-0.5 p-0.5 hover:bg-red-500/20 rounded transition-colors"
                  >
                    <X size={12} className="text-surface-400 hover:text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {isProcessingFiles && (
            <div className="flex items-center gap-2 px-2 pb-2 text-xs text-surface-400">
              <Loader2 size={14} className="animate-spin text-primary-400" />
              <span className="truncate">
                正在提取文档文本：
                {pendingFiles.length === 1 ? pendingFiles[0] : `${pendingFiles.length} 个文件`}
              </span>
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
                disabled={disabled || isStreaming}
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
              title="添加图片"
            >
              <ImagePlus size={18} />
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              className="hidden"
            />

            {/* File upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isStreaming}
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
                disabled={(!input.trim() && images.length === 0 && files.length === 0) || disabled || isProcessingFiles}
                className="shrink-0 p-2 bg-primary-600 hover:bg-primary-500 text-white
                           rounded-lg transition-all duration-200 active:scale-95
                           disabled:opacity-30 disabled:cursor-not-allowed"
                title={isProcessingFiles ? '请等待文档提取完成' : '发送'}
              >
                <Send size={18} />
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
