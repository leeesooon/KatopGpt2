import { useCallback, useEffect, useRef } from 'react'
import type { WorkspaceDocument } from '../types'
import { useWorkspaceStore } from '../store/workspaceStore'

const AUTO_SAVE_DELAY_MS = 1500

interface UseWorkspaceAutoSaveOptions {
  activeDocumentPath: string | null
  activeDocument: WorkspaceDocument | null
  isSaving: boolean
  saveDocument: (relativePath: string, source?: 'manual' | 'auto') => Promise<void>
}

function canSaveDocument(document: WorkspaceDocument | null | undefined) {
  return Boolean(
    document
    && document.isDirty
    && !document.isPendingNaming
    && window.electronAPI?.writeWorkspaceDocument
  )
}

export function useWorkspaceAutoSave({
  activeDocumentPath,
  activeDocument,
  isSaving,
  saveDocument,
}: UseWorkspaceAutoSaveOptions) {
  const latestPathRef = useRef<string | null>(activeDocumentPath)
  const saveDocumentRef = useRef(saveDocument)
  const previousPathRef = useRef<string | null>(activeDocumentPath)

  useEffect(() => {
    saveDocumentRef.current = saveDocument
  }, [saveDocument])

  useEffect(() => {
    latestPathRef.current = activeDocumentPath
  }, [activeDocumentPath])

  const flushPath = useCallback((relativePath: string | null) => {
    if (!relativePath) return
    const state = useWorkspaceStore.getState()
    const document = state.documents[relativePath]
    if (!canSaveDocument(document)) return
    void saveDocumentRef.current(relativePath, 'auto')
  }, [])

  useEffect(() => {
    if (!activeDocumentPath || !canSaveDocument(activeDocument) || isSaving) return
    if (typeof document !== 'undefined' && !document.hasFocus()) return

    const timer = window.setTimeout(() => {
      flushPath(activeDocumentPath)
    }, AUTO_SAVE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [
    activeDocument?.content,
    activeDocument?.isDirty,
    activeDocument?.isPendingNaming,
    activeDocument?.revision,
    activeDocumentPath,
    flushPath,
    isSaving,
  ])

  useEffect(() => {
    const previousPath = previousPathRef.current
    if (previousPath && previousPath !== activeDocumentPath) {
      flushPath(previousPath)
    }
    previousPathRef.current = activeDocumentPath
  }, [activeDocumentPath, flushPath])

  useEffect(() => {
    const flushCurrent = () => {
      flushPath(latestPathRef.current)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushCurrent()
      }
    }

    window.addEventListener('blur', flushCurrent)
    window.addEventListener('pagehide', flushCurrent)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      flushCurrent()
      window.removeEventListener('blur', flushCurrent)
      window.removeEventListener('pagehide', flushCurrent)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [flushPath])
}
