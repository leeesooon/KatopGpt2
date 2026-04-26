import { useCallback, useState } from 'react'
import { useChatStore } from '../store/chatStore'
import type { ImageAttachment, FileAttachment } from '../types'
import { findLatestSpreadsheetAttachment } from './chatViewUtils'

interface UseChatSideActionsOptions {
  activeConversationId: string | null
  messages: Array<{ files?: FileAttachment[] }>
  createConversation: ReturnType<typeof useChatStore.getState>['createConversation']
  addMessage: ReturnType<typeof useChatStore.getState>['addMessage']
  setInputMode: (mode: 'image') => void
  setImageReferenceDraft: (image: ImageAttachment) => void
}

export function useChatSideActions({
  activeConversationId,
  messages,
  createConversation,
  addMessage,
  setInputMode,
  setImageReferenceDraft,
}: UseChatSideActionsOptions) {
  const [isExportingSpreadsheet, setIsExportingSpreadsheet] = useState(false)
  const latestSpreadsheet = findLatestSpreadsheetAttachment(messages, [])

  const handleExportSpreadsheet = useCallback(async () => {
    if (!latestSpreadsheet?.spreadsheetSessionId || !window.electronAPI?.exportSpreadsheetSession || isExportingSpreadsheet) {
      return
    }

    setIsExportingSpreadsheet(true)
    try {
      const exportResult = await window.electronAPI.exportSpreadsheetSession(latestSpreadsheet.spreadsheetSessionId)
      const convId = activeConversationId ?? createConversation()
      addMessage(convId, {
        role: 'assistant',
        content: exportResult.message,
      })
    } finally {
      setIsExportingSpreadsheet(false)
    }
  }, [activeConversationId, addMessage, createConversation, isExportingSpreadsheet, latestSpreadsheet])

  const handleContinueImageEdit = useCallback(async (image: ImageAttachment) => {
    let base64 = image.base64
    if (!base64 && image.url && window.electronAPI?.readImage) {
      const result = await window.electronAPI.readImage(image.url)
      if (result.ok && result.dataUrl) {
        base64 = result.dataUrl
      }
    }

    if (!base64) {
      const convId = activeConversationId ?? createConversation()
      addMessage(convId, {
        role: 'assistant',
        content: '读取参考图失败，请先保存图片后重新上传。',
        metadata: { kind: 'image_generation' },
      })
      return
    }

    setInputMode('image')
    setImageReferenceDraft({
      id: `reference-${Date.now()}`,
      base64,
      name: image.name || `reference-${Date.now()}.png`,
    })
  }, [activeConversationId, addMessage, createConversation, setImageReferenceDraft, setInputMode])

  return {
    handleContinueImageEdit,
    handleExportSpreadsheet,
    isExportingSpreadsheet,
    latestSpreadsheet,
  }
}
