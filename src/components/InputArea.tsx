import { useState, useRef, useEffect } from 'react'
import { Send, Square, ImagePlus, Paperclip, X, FileText, Search } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import ModelSelector from './ModelSelector'
import { useChatStore } from '../store/chatStore'
import type { ImageAttachment, FileAttachment } from '../types'

interface InputAreaProps {
  onSend: (content: string, images: ImageAttachment[], files: FileAttachment[]) => void
  onStop: () => void
  isStreaming: boolean
  disabled: boolean
}

export default function InputArea({ onSend, onStop, isStreaming, disabled }: InputAreaProps) {
  const { searchEnabled, setSearchEnabled, settings } = useChatStore()
  const [input, setInput] = useState('')
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [files, setFiles] = useState<FileAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isStreaming])

  const adjustHeight = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const handleSend = () => {
    const trimmed = input.trim()
    if ((!trimmed && images.length === 0 && files.length === 0) || disabled) return
    onSend(trimmed, images, files)
    setInput('')
    setImages([])
    setFiles([])
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

  const addImageFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result as string
      setImages((prev) => [...prev, { id: uuidv4(), base64, name: file.name }])
    }
    reader.readAsDataURL(file)
  }

  const addTextFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const content = reader.result as string
      setFiles((prev) => [
        ...prev,
        { id: uuidv4(), name: file.name, size: file.size, content },
      ])
    }
    reader.readAsText(file)
  }

  const processFiles = (fileList: FileList | File[]) => {
    Array.from(fileList).forEach((file) => {
      if (file.type.startsWith('image/')) {
        addImageFile(file)
      } else {
        addTextFile(file)
      }
    })
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList) return
    Array.from(fileList).forEach((file) => {
      if (file.type.startsWith('image/')) addImageFile(file)
    })
    e.target.value = ''
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList) return
    processFiles(fileList)
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
        addImageFile(file)
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
        <div className="glass-panel rounded-xl p-2">
          {/* Model selector row */}
          <div className="flex items-center px-1 pb-1.5 mb-1 border-b border-surface-700/30">
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
              placeholder="输入消息... (Enter 发送, Shift+Enter 换行, 可拖拽文件)"
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
                disabled={(!input.trim() && images.length === 0 && files.length === 0) || disabled}
                className="shrink-0 p-2 bg-primary-600 hover:bg-primary-500 text-white
                           rounded-lg transition-all duration-200 active:scale-95
                           disabled:opacity-30 disabled:cursor-not-allowed"
                title="发送"
              >
                <Send size={18} />
              </button>
            )}
          </div>
        </div>
        <p className="text-[11px] text-surface-500 text-center mt-2">
          AI 可能会犯错，请核实重要信息
        </p>
      </div>
    </div>
  )
}
