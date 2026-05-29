import { useCallback, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { FileAttachment, ImageAttachment } from '../types'
import {
  buildAttachmentContentFields,
  formatFileSize,
  isExtractableDocument,
  looksLikeBinaryText,
  validateAttachmentBatch,
  validateAttachmentFile,
} from './inputAreaAttachments'

export type AttachmentTaskStatus = 'queued' | 'reading' | 'extracting' | 'ready' | 'error'

export interface AttachmentTask {
  id: string
  file: File
  name: string
  size: number
  status: AttachmentTaskStatus
  message?: string
  error?: string
  attachmentId?: string
}

interface UseAttachmentProcessorOptions {
  isImageMode: boolean
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
    reader.readAsDataURL(file)
  })
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
    reader.readAsText(file)
  })
}

function readFileAsArrayBuffer(file: File) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
    reader.readAsArrayBuffer(file)
  })
}

function createTask(file: File): AttachmentTask {
  return {
    id: uuidv4(),
    file,
    name: file.name,
    size: file.size,
    status: 'queued',
    message: '等待处理',
  }
}

export function useAttachmentProcessor({ isImageMode }: UseAttachmentProcessorOptions) {
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [files, setFiles] = useState<FileAttachment[]>([])
  const [attachmentTasks, setAttachmentTasks] = useState<AttachmentTask[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  const activeTaskCount = attachmentTasks.filter((task) => task.status === 'queued' || task.status === 'reading' || task.status === 'extracting').length
  const isProcessingFiles = activeTaskCount > 0

  const currentAttachmentCount = useMemo(
    () => images.length + files.length + activeTaskCount,
    [activeTaskCount, files.length, images.length]
  )

  const updateTask = useCallback((taskId: string, patch: Partial<AttachmentTask>) => {
    setAttachmentTasks((currentTasks) => currentTasks.map((task) => (
      task.id === taskId ? { ...task, ...patch } : task
    )))
  }, [])

  const addImageFile = useCallback(async (file: File, taskId?: string) => {
    updateTask(taskId ?? '', { status: 'reading', message: '正在读取图片' })
    const base64 = await readFileAsDataUrl(file)
    const nextImage = { id: uuidv4(), base64, name: file.name }
    setImages((prev) => [...prev, nextImage])
    updateTask(taskId ?? '', {
      status: 'ready',
      message: '已添加图片',
      attachmentId: nextImage.id,
    })
  }, [isImageMode, updateTask])

  const addTextFile = useCallback(async (file: File, taskId: string) => {
    updateTask(taskId, { status: 'reading', message: '正在读取文本' })
    const content = await readFileAsText(file)
    if (looksLikeBinaryText(content)) {
      throw new Error('该文件看起来是二进制内容，请使用可解析的文本文件或表格文件（.csv/.xlsx）')
    }

    const attachment: FileAttachment = {
      id: uuidv4(),
      name: file.name,
      size: file.size,
      content,
      fileType: 'text',
      ...buildAttachmentContentFields(content),
    }

    setFiles((prev) => [...prev, attachment])
    updateTask(taskId, {
      status: 'ready',
      message: attachment.isTruncated ? '已添加，内容已压缩' : '已添加文本',
      attachmentId: attachment.id,
    })
  }, [updateTask])

  const addExtractedDocumentFile = useCallback(async (file: File, taskId: string) => {
    if (!window.electronAPI?.extractDocumentText) {
      throw new Error('当前环境暂不支持自动提取该文档，请使用桌面版应用')
    }

    updateTask(taskId, { status: 'reading', message: '正在读取文件' })
    const data = await readFileAsArrayBuffer(file)
    updateTask(taskId, { status: 'extracting', message: '正在提取文档文本' })
    const result = await window.electronAPI.extractDocumentText({
      fileName: file.name,
      mimeType: file.type,
      data,
    })

    if (!result.ok || !result.content) {
      throw new Error(result.error ?? '自动提取文本失败')
    }

    const content = result.content
    const attachment: FileAttachment = {
      id: uuidv4(),
      name: file.name,
      size: file.size,
      content,
      fileType: result.fileType,
      spreadsheetSessionId: result.spreadsheetSessionId,
      spreadsheetSchema: result.spreadsheetSchema,
      ...buildAttachmentContentFields(content),
    }

    setFiles((prev) => [...prev, attachment])
    updateTask(taskId, {
      status: 'ready',
      message: attachment.isTruncated ? '已提取，内容已压缩' : '已提取文档',
      attachmentId: attachment.id,
    })
  }, [updateTask])

  const processSingleTask = useCallback(async (task: AttachmentTask) => {
    const validationError = validateAttachmentFile(task.file)
    if (validationError) {
      updateTask(task.id, { status: 'error', error: validationError, message: '处理失败' })
      setAttachmentError(`${task.name}：${validationError}`)
      return
    }

    setAttachmentError(null)

    try {
      if (task.file.type.startsWith('image/')) {
        await addImageFile(task.file, task.id)
      } else if (isExtractableDocument(task.file)) {
        await addExtractedDocumentFile(task.file, task.id)
      } else {
        await addTextFile(task.file, task.id)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `处理文件失败：${task.name}`
      updateTask(task.id, { status: 'error', error: message, message: '处理失败' })
      setAttachmentError(`${task.name}：${message}`)
    }
  }, [addExtractedDocumentFile, addImageFile, addTextFile, updateTask])

  const processFiles = useCallback((fileList: FileList | File[]) => {
    const incomingFiles = Array.from(fileList)
    const batchError = validateAttachmentBatch(incomingFiles, currentAttachmentCount)
    if (batchError) {
      setAttachmentError(batchError)
      return
    }

    const tasks = incomingFiles.map(createTask)
    setAttachmentTasks((currentTasks) => [...currentTasks, ...tasks])
    tasks.forEach((task) => void processSingleTask(task))
  }, [currentAttachmentCount, processSingleTask])

  const processImageFiles = useCallback((fileList: FileList | File[]) => {
    const imageFiles = Array.from(fileList).filter((file) => file.type.startsWith('image/'))
    processFiles(imageFiles)
  }, [processFiles])

  const retryTask = useCallback((taskId: string) => {
    const task = attachmentTasks.find((item) => item.id === taskId)
    if (!task || task.status !== 'error') return
    const batchError = validateAttachmentBatch([task.file], images.length + files.length + activeTaskCount)
    if (batchError) {
      setAttachmentError(batchError)
      return
    }
    updateTask(taskId, { status: 'queued', error: undefined, message: '等待重试' })
    void processSingleTask({ ...task, status: 'queued', error: undefined, message: '等待重试' })
  }, [activeTaskCount, attachmentTasks, files.length, images.length, processSingleTask, updateTask])

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
    setAttachmentTasks((currentTasks) => currentTasks.filter((task) => task.attachmentId !== id))
  }, [])

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((file) => file.id !== id))
    setAttachmentTasks((currentTasks) => currentTasks.filter((task) => task.attachmentId !== id))
  }, [])

  const removeTask = useCallback((taskId: string) => {
    setAttachmentTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId))
  }, [])

  const addImageAttachment = useCallback((image: ImageAttachment) => {
    setImages((prev) => [...prev, image])
  }, [])

  const clearAttachments = useCallback(() => {
    setImages([])
    setFiles([])
    setAttachmentTasks([])
    setAttachmentError(null)
  }, [])

  const clearFiles = useCallback(() => {
    setFiles([])
    setAttachmentTasks((currentTasks) => currentTasks.filter((task) => task.file.type.startsWith('image/')))
  }, [])

  const clearImages = useCallback(() => {
    setImages([])
    setAttachmentTasks((currentTasks) => currentTasks.filter((task) => !task.file.type.startsWith('image/')))
  }, [])

  return {
    images,
    files,
    attachmentTasks,
    attachmentError,
    isProcessingFiles,
    activeTaskCount,
    addImageFile,
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
  }
}
