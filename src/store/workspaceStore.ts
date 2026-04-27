import { create } from 'zustand'
import type { StateCreator } from 'zustand'
import type {
  DocumentAgentMode,
  DocumentEditorMode,
  DocumentSelection,
  WorkspaceDocument,
  WorkspaceHandle,
} from '../types'
import { useChatStore } from './chatStore'

type TaskStatus = 'idle' | 'running' | 'ready' | 'failed'
type SuggestionApplyMode = 'replace-document' | 'append-document' | 'replace-selection'

interface ComposerDraft {
  text: string
  nonce: number
}

interface DocumentSuggestion {
  content: string
  sourceMessageId?: string
  title: string
  createdAt: number
  mode: DocumentAgentMode
}

interface TaskState {
  status: TaskStatus
  title: string
  message: string
}

interface WorkspaceSession {
  currentWorkspace: WorkspaceHandle | null
  filePaths: string[]
  documents: Record<string, WorkspaceDocument>
  activeDocumentPath: string | null
  pendingRenamePath: string | null
  isPanelVisible: boolean
  panelWidth: number
  editorMode: DocumentEditorMode
  selection: DocumentSelection | null
  pendingAction: DocumentAgentMode
  composerDraft: ComposerDraft | null
  latestSuggestion: DocumentSuggestion | null
  taskState: TaskState
  isWorkspaceLoading: boolean
  isSaving: boolean
  error: string | null
}

interface WorkspaceState extends WorkspaceSession {
  activeConversationId: string | null
  sessions: Record<string, WorkspaceSession>
  openWorkspace: () => Promise<void>
  openDocument: (relativePath: string) => Promise<void>
  closeActiveDocument: () => void
  refreshWorkspace: () => Promise<void>
  updateActiveDocumentContent: (content: string) => void
  saveActiveDocument: () => Promise<void>
  createDocument: (relativePath: string, initialContent?: string) => Promise<boolean>
  createDocumentFromContent: (content: string, suggestedName?: string) => Promise<boolean>
  createDocumentFromSuggestion: (relativePath: string) => Promise<void>
  renameDocument: (oldRelativePath: string, newRelativePath: string) => Promise<boolean>
  deleteDocument: (relativePath: string) => Promise<boolean>
  setEditorMode: (mode: DocumentEditorMode) => void
  setPanelVisible: (visible: boolean) => void
  togglePanelVisibility: () => void
  setPanelWidth: (width: number) => void
  setSelection: (selection: DocumentSelection | null) => void
  queueComposerDraft: (mode: DocumentAgentMode, text: string) => void
  clearPendingAction: () => void
  consumeComposerDraft: () => void
  startTask: (title: string) => void
  completeTask: (content: string, mode: DocumentAgentMode, sourceMessageId?: string, title?: string) => void
  failTask: (message: string, title?: string) => void
  clearTaskState: () => void
  applyLatestSuggestion: (mode: SuggestionApplyMode) => void
  clearLatestSuggestion: () => void
  updateLatestSuggestionContent: (content: string) => void
  cancelDocumentWorkflow: () => void
  exitWorkspaceAssistant: () => void
  switchConversationSession: (conversationId: string | null) => void
  pruneSessions: (conversationIds: string[]) => void
}

interface WorkspaceSyncState {
  activeConversationId: string | null
  sessions: Record<string, WorkspaceSession>
}

type WorkspaceSessionPatch = Partial<WorkspaceSession> | ((session: WorkspaceSession) => Partial<WorkspaceSession>)
type WorkspaceSet = Parameters<StateCreator<WorkspaceState>>[0]

const EMPTY_TASK_STATE: TaskState = {
  status: 'idle',
  title: '文档助手待命中',
  message: '打开工作区后，可以生成 Markdown 初稿或改写当前文档。',
}

function createEmptySession(): WorkspaceSession {
  return {
    currentWorkspace: null,
    filePaths: [],
    documents: {},
    activeDocumentPath: null,
    pendingRenamePath: null,
    isPanelVisible: false,
    panelWidth: 672,
    editorMode: 'write',
    selection: null,
    pendingAction: 'chat',
    composerDraft: null,
    latestSuggestion: null,
    taskState: EMPTY_TASK_STATE,
    isWorkspaceLoading: false,
    isSaving: false,
    error: null,
  }
}

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

function titleFromPath(relativePath: string) {
  const parts = normalizeRelativePath(relativePath).split('/')
  return parts[parts.length - 1] || '未命名文档'
}

function sortRelativePaths(filePaths: string[]) {
  return [...filePaths].sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

function createUntitledDocumentPath(filePaths: string[]) {
  const existingPaths = new Set(filePaths.map((filePath) => normalizeRelativePath(filePath)))
  const baseName = '待命名'
  let candidate = `${baseName}.md`
  let index = 2

  while (existingPaths.has(candidate)) {
    candidate = `${baseName}-${index}.md`
    index += 1
  }

  return candidate
}

function getAdjacentDocumentPath(filePaths: string[], targetPath: string) {
  const currentIndex = filePaths.indexOf(targetPath)
  if (currentIndex < 0) return filePaths[0] ?? null
  return filePaths[currentIndex + 1] ?? filePaths[currentIndex - 1] ?? null
}

function sanitizeDocumentSuggestion(content: string) {
  return content
    .replace(/\f/g, '')
    .replace(/\u0000/g, '')
    .replace(/(?:\[(?:\d+)\])+$/gm, '')
    .replace(/(?:\[(?:\d+)\])+(?=\s|$|[，。；、,.])/g, '')
    .replace(/【\d+(?::\d+)?†[^】]*】/g, '')
    .trim()
}

function getActiveConversationId() {
  return useChatStore.getState().activeConversationId
}

function resolveSession(state: WorkspaceState, conversationId: string | null) {
  if (!conversationId) return createEmptySession()
  return state.sessions[conversationId] ?? createEmptySession()
}

function setSessionState(set: WorkspaceSet, patch: WorkspaceSessionPatch) {
  set((state) => {
    const conversationId = getActiveConversationId() ?? state.activeConversationId
    const currentSession = resolveSession(state, conversationId)
    const partial = typeof patch === 'function' ? patch(currentSession) : patch
    const nextSession: WorkspaceSession = { ...currentSession, ...partial }

    if (!conversationId) {
      return {
        activeConversationId: null,
        ...nextSession,
      }
    }

    return {
      activeConversationId: conversationId,
      ...nextSession,
      sessions: {
        ...state.sessions,
        [conversationId]: nextSession,
      },
    }
  })
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...createEmptySession(),
  activeConversationId: getActiveConversationId(),
  sessions: {},

  openWorkspace: async () => {
    if (!window.electronAPI?.selectWorkspace) {
      setSessionState(set, { error: '当前环境暂不支持本地工作区，请使用桌面版应用。' })
      return
    }

    setSessionState(set, { isWorkspaceLoading: true, error: null })

    try {
      const workspace = await window.electronAPI.selectWorkspace()
      if (!workspace) {
        setSessionState(set, { isWorkspaceLoading: false })
        return
      }

      const filePaths = await window.electronAPI.listWorkspaceDocuments(workspace.rootPath)
      setSessionState(set, {
        currentWorkspace: workspace,
        filePaths,
        documents: {},
        activeDocumentPath: filePaths[0] ?? null,
        pendingRenamePath: null,
        selection: null,
        latestSuggestion: null,
        isWorkspaceLoading: false,
      })

      if (filePaths[0]) {
        await get().openDocument(filePaths[0])
      }
    } catch (error) {
      setSessionState(set, {
        isWorkspaceLoading: false,
        error: error instanceof Error ? error.message : '打开工作区失败',
      })
    }
  },

  refreshWorkspace: async () => {
    const { currentWorkspace, activeDocumentPath } = get()
    if (!currentWorkspace || !window.electronAPI?.listWorkspaceDocuments) return

    const filePaths = await window.electronAPI.listWorkspaceDocuments(currentWorkspace.rootPath)
    setSessionState(set, {
      filePaths,
      activeDocumentPath: activeDocumentPath && filePaths.includes(activeDocumentPath)
        ? activeDocumentPath
        : filePaths[0] ?? null,
    })
  },

  openDocument: async (relativePath) => {
    const { currentWorkspace, documents } = get()
    if (!currentWorkspace || !window.electronAPI?.readWorkspaceDocument) return

    const normalizedPath = normalizeRelativePath(relativePath)
    const cachedDocument = documents[normalizedPath]
    if (cachedDocument) {
      setSessionState(set, { activeDocumentPath: normalizedPath, selection: null, error: null })
      return
    }

    setSessionState(set, { isWorkspaceLoading: true, error: null })

    try {
      const content = await window.electronAPI.readWorkspaceDocument(currentWorkspace.rootPath, normalizedPath)
      const now = Date.now()
      setSessionState(set, (session) => ({
        isWorkspaceLoading: false,
        activeDocumentPath: normalizedPath,
        selection: null,
        documents: {
          ...session.documents,
          [normalizedPath]: {
            relativePath: normalizedPath,
            title: titleFromPath(normalizedPath),
            content,
            isDirty: false,
            lastLoadedAt: now,
            lastSavedAt: now,
          },
        },
      }))
    } catch (error) {
      setSessionState(set, {
        isWorkspaceLoading: false,
        error: error instanceof Error ? error.message : '读取文档失败',
      })
    }
  },

  closeActiveDocument: () => setSessionState(set, {
    activeDocumentPath: null,
    selection: null,
    latestSuggestion: null,
    pendingAction: 'chat',
    taskState: EMPTY_TASK_STATE,
  }),

  updateActiveDocumentContent: (content) => {
    const activeDocumentPath = get().activeDocumentPath
    if (!activeDocumentPath) return

    setSessionState(set, (session) => {
      const document = session.documents[activeDocumentPath]
      if (!document) return {}

      return {
        documents: {
          ...session.documents,
          [activeDocumentPath]: {
            ...document,
            content,
            isDirty: true,
          },
        },
      }
    })
  },

  saveActiveDocument: async () => {
    const { currentWorkspace, activeDocumentPath, documents } = get()
    if (!currentWorkspace || !activeDocumentPath || !window.electronAPI?.writeWorkspaceDocument) return

    const document = documents[activeDocumentPath]
    if (!document) return

    setSessionState(set, { isSaving: true, error: null })

    try {
      await window.electronAPI.writeWorkspaceDocument(currentWorkspace.rootPath, activeDocumentPath, document.content)
      setSessionState(set, (session) => ({
        isSaving: false,
        documents: {
          ...session.documents,
          [activeDocumentPath]: {
            ...session.documents[activeDocumentPath],
            isDirty: false,
            lastSavedAt: Date.now(),
          },
        },
      }))
    } catch (error) {
      setSessionState(set, {
        isSaving: false,
        error: error instanceof Error ? error.message : '保存文档失败',
      })
    }
  },

  createDocument: async (relativePath, initialContent = '') => {
    const workspace = get().currentWorkspace
    if (!workspace || !window.electronAPI?.createWorkspaceDocument) return false

    const normalizedPath = normalizeRelativePath(relativePath)
    if (!normalizedPath) return false

    setSessionState(set, { isSaving: true, error: null })

    try {
      await window.electronAPI.createWorkspaceDocument(workspace.rootPath, normalizedPath, initialContent)
      const now = Date.now()
      setSessionState(set, (session) => ({
        isSaving: false,
        filePaths: Array.from(new Set([...session.filePaths, normalizedPath])).sort((left, right) => left.localeCompare(right, 'zh-CN')),
        activeDocumentPath: normalizedPath,
        selection: null,
        documents: {
          ...session.documents,
          [normalizedPath]: {
            relativePath: normalizedPath,
            title: titleFromPath(normalizedPath),
            content: initialContent,
            isDirty: false,
            lastLoadedAt: now,
            lastSavedAt: now,
          },
        },
      }))
      return true
    } catch (error) {
      setSessionState(set, {
        isSaving: false,
        error: error instanceof Error ? error.message : '创建文档失败',
      })
      return false
    }
  },

  createDocumentFromContent: async (content, _suggestedName) => {
    const shouldOpenWorkspaceWindow = Boolean(window.electronAPI?.openWorkspaceWindow)
    const ensureWorkspace = async () => {
      if (get().currentWorkspace) return true
      await get().openWorkspace()
      return Boolean(get().currentWorkspace)
    }

    const workspaceReady = await ensureWorkspace()
    if (!workspaceReady) return false

    const untitledPath = createUntitledDocumentPath(get().filePaths)
    const created = await get().createDocument(untitledPath, content)
    if (!created) return false

    const createdDocument = get().documents[untitledPath]
    const createdAt = Date.now()

    setSessionState(set, {
      pendingRenamePath: untitledPath,
      documents: {
        ...get().documents,
        [untitledPath]: createdDocument
          ? {
              ...createdDocument,
              content,
              isDirty: false,
              isPendingNaming: true,
              pendingInitialContent: content,
            }
          : {
              relativePath: untitledPath,
              title: titleFromPath(untitledPath),
              content,
              isDirty: false,
              lastLoadedAt: createdAt,
              lastSavedAt: createdAt,
              isPendingNaming: true,
              pendingInitialContent: content,
            },
      },
      taskState: {
        status: 'ready',
        title: '已创建待命名文档',
        message: shouldOpenWorkspaceWindow
          ? '内容已写入临时文档，请在独立文档窗口左侧文档树中完成命名。'
          : '内容已写入临时文档，请先在左侧文档树中完成命名。',
      },
      isPanelVisible: !shouldOpenWorkspaceWindow,
    })

    if (shouldOpenWorkspaceWindow) {
      try {
        await window.electronAPI?.openWorkspaceWindow()
        setSessionState(set, { isPanelVisible: false })
      } catch (error) {
        setSessionState(set, {
          isPanelVisible: true,
          error: error instanceof Error ? error.message : '打开文档助手窗口失败',
        })
      }
    }

    return true
  },

  createDocumentFromSuggestion: async (relativePath) => {
    const suggestion = get().latestSuggestion
    if (!suggestion) return
    await get().createDocument(relativePath, suggestion.content)
    setSessionState(set, {
      latestSuggestion: null,
      taskState: {
        status: 'ready',
        title: '建议已保存为新文档',
        message: '已创建新文档，如需继续修改可以直接在编辑器中处理。',
      },
    })
  },

  renameDocument: async (oldRelativePath, newRelativePath) => {
    const workspace = get().currentWorkspace
    if (!workspace || !window.electronAPI?.renameWorkspaceDocument) return false

    const normalizedOldPath = normalizeRelativePath(oldRelativePath)
    const normalizedNewPath = normalizeRelativePath(newRelativePath)
    if (!normalizedOldPath || !normalizedNewPath) return false

    setSessionState(set, { isSaving: true, error: null })

    try {
      const existingDocument = get().documents[normalizedOldPath]
      const pendingInitialContent = typeof existingDocument?.pendingInitialContent === 'string'
        ? existingDocument.pendingInitialContent
        : null
      const shouldWritePendingContent = Boolean(existingDocument?.isPendingNaming && pendingInitialContent !== null && window.electronAPI?.writeWorkspaceDocument)

      await window.electronAPI.renameWorkspaceDocument(workspace.rootPath, normalizedOldPath, normalizedNewPath)
      if (shouldWritePendingContent && pendingInitialContent !== null) {
        await window.electronAPI.writeWorkspaceDocument(workspace.rootPath, normalizedNewPath, pendingInitialContent)
      }

      const completedAt = Date.now()
      setSessionState(set, (session) => {
        const existingDocument = session.documents[normalizedOldPath]
        const nextDocuments = { ...session.documents }

        if (existingDocument) {
          delete nextDocuments[normalizedOldPath]
          nextDocuments[normalizedNewPath] = {
            ...existingDocument,
            relativePath: normalizedNewPath,
            title: titleFromPath(normalizedNewPath),
            content: shouldWritePendingContent && pendingInitialContent !== null ? pendingInitialContent : existingDocument.content,
            isDirty: shouldWritePendingContent ? false : existingDocument.isDirty,
            isPendingNaming: false,
            pendingInitialContent: undefined,
            lastLoadedAt: shouldWritePendingContent ? completedAt : existingDocument.lastLoadedAt,
            lastSavedAt: shouldWritePendingContent ? completedAt : existingDocument.lastSavedAt,
          }
        }

        const nextMessage = shouldWritePendingContent
          ? `已完成命名并写入 ${titleFromPath(normalizedNewPath)}。`
          : `${titleFromPath(normalizedOldPath)} 已更新为 ${titleFromPath(normalizedNewPath)}。`

        const nextTitle = shouldWritePendingContent ? '文档已创建' : '文档已重命名'

        return {
          isSaving: false,
          pendingRenamePath: session.pendingRenamePath === normalizedOldPath ? null : session.pendingRenamePath,
          filePaths: sortRelativePaths(session.filePaths.map((filePath) => filePath === normalizedOldPath ? normalizedNewPath : filePath)),
          activeDocumentPath: session.activeDocumentPath === normalizedOldPath ? normalizedNewPath : session.activeDocumentPath,
          documents: nextDocuments,
          taskState: {
            status: 'ready',
            title: nextTitle,
            message: nextMessage,
          },
        }
      })
      return true
    } catch (error) {
      setSessionState(set, {
        isSaving: false,
        error: error instanceof Error ? error.message : '重命名文档失败',
      })
      return false
    }
  },

  deleteDocument: async (relativePath) => {
    const workspace = get().currentWorkspace
    if (!workspace || !window.electronAPI?.deleteWorkspaceDocument) return false

    const normalizedPath = normalizeRelativePath(relativePath)
    if (!normalizedPath) return false

    setSessionState(set, { isSaving: true, error: null })

    try {
      await window.electronAPI.deleteWorkspaceDocument(workspace.rootPath, normalizedPath)
      setSessionState(set, (session) => {
        const nextFilePaths = session.filePaths.filter((filePath) => filePath !== normalizedPath)
        const nextDocuments = { ...session.documents }
        delete nextDocuments[normalizedPath]

        const nextActiveDocumentPath = session.activeDocumentPath === normalizedPath
          ? getAdjacentDocumentPath(nextFilePaths, normalizedPath)
          : session.activeDocumentPath

        return {
          isSaving: false,
          filePaths: nextFilePaths,
          activeDocumentPath: nextActiveDocumentPath,
          selection: session.activeDocumentPath === normalizedPath ? null : session.selection,
          latestSuggestion: session.activeDocumentPath === normalizedPath ? null : session.latestSuggestion,
          documents: nextDocuments,
          taskState: {
            status: 'ready',
            title: '文档已删除',
            message: `${titleFromPath(normalizedPath)} 已从当前工作区移除。`,
          },
        }
      })
      return true
    } catch (error) {
      setSessionState(set, {
        isSaving: false,
        error: error instanceof Error ? error.message : '删除文档失败',
      })
      return false
    }
  },

  setEditorMode: (mode) => setSessionState(set, { editorMode: mode }),
  setPanelVisible: (visible) => setSessionState(set, { isPanelVisible: visible }),
  togglePanelVisibility: () => setSessionState(set, (session) => ({ isPanelVisible: !session.isPanelVisible })),
  setPanelWidth: (width) => setSessionState(set, { panelWidth: Math.max(480, Math.min(980, Math.round(width))) }),
  setSelection: (selection) => setSessionState(set, { selection }),

  queueComposerDraft: (mode, text) => setSessionState(set, (session) => ({
    pendingAction: mode,
    composerDraft: {
      text,
      nonce: (session.composerDraft?.nonce ?? 0) + 1,
    },
  })),

  clearPendingAction: () => setSessionState(set, { pendingAction: 'chat' }),
  consumeComposerDraft: () => setSessionState(set, { composerDraft: null }),

  startTask: (title) => setSessionState(set, {
    pendingAction: 'chat',
    taskState: {
      status: 'running',
      title,
      message: '正在为当前文档生成建议...',
    },
  }),

  completeTask: (content, mode, sourceMessageId, title) => setSessionState(set, {
    latestSuggestion: {
      content: sanitizeDocumentSuggestion(content),
      sourceMessageId,
      title: title ?? '最新 AI 建议',
      createdAt: Date.now(),
      mode,
    },
    taskState: {
      status: 'ready',
      title: title ?? '文档建议已生成',
      message: mode === 'rewrite'
        ? '请确认是否替换当前选区，确认后建议卡片会自动收起。'
        : '可以将结果替换到当前文档、追加到末尾，或新建为独立文档。',
    },
  }),

  failTask: (message, title) => setSessionState(set, {
    taskState: {
      status: 'failed',
      title: title ?? '文档任务失败',
      message,
    },
    pendingAction: 'chat',
  }),

  clearTaskState: () => setSessionState(set, { taskState: EMPTY_TASK_STATE }),

  applyLatestSuggestion: (mode) => {
    const { latestSuggestion, activeDocumentPath, documents, selection } = get()
    if (!latestSuggestion || !activeDocumentPath) return

    const document = documents[activeDocumentPath]
    if (!document) return

    let nextContent = document.content

    if (mode === 'replace-document') {
      nextContent = latestSuggestion.content
    } else if (mode === 'append-document') {
      nextContent = `${document.content.trimEnd()}\n\n${latestSuggestion.content.trim()}`.trim()
    } else if (mode === 'replace-selection') {
      if (!selection || selection.start === selection.end) return
      nextContent = `${document.content.slice(0, selection.start)}${latestSuggestion.content}${document.content.slice(selection.end)}`
    }

    setSessionState(set, (session) => ({
      documents: {
        ...session.documents,
        [activeDocumentPath]: {
          ...document,
          content: nextContent,
          isDirty: true,
        },
      },
      taskState: {
        status: 'ready',
        title: session.taskState.title,
        message: mode === 'replace-document'
          ? '建议已写入当前文档，别忘了保存。'
          : mode === 'append-document'
            ? '建议已追加到当前文档末尾，别忘了保存。'
            : '建议已替换当前选区，别忘了保存。',
      },
      latestSuggestion: null,
    }))
  },

  clearLatestSuggestion: () => setSessionState(set, {
    latestSuggestion: null,
    taskState: EMPTY_TASK_STATE,
  }),

  updateLatestSuggestionContent: (content) => setSessionState(set, (session) => ({
    latestSuggestion: session.latestSuggestion
      ? {
          ...session.latestSuggestion,
          content,
        }
      : null,
  })),

  cancelDocumentWorkflow: () => setSessionState(set, {
    pendingAction: 'chat',
    composerDraft: null,
    latestSuggestion: null,
    selection: null,
    taskState: EMPTY_TASK_STATE,
  }),

  exitWorkspaceAssistant: () => setSessionState(set, {
    ...createEmptySession(),
    isPanelVisible: false,
  }),

  switchConversationSession: (conversationId) => set((state) => {
    const nextSession = resolveSession(state, conversationId)
    return {
      activeConversationId: conversationId,
      ...nextSession,
    }
  }),

  pruneSessions: (conversationIds) => set((state) => {
    const allowedIds = new Set(conversationIds)
    const sessions = Object.fromEntries(
      Object.entries(state.sessions).filter(([conversationId]) => allowedIds.has(conversationId))
    )
    return { sessions }
  }),
}))

if (typeof window !== 'undefined') {
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel('katop-workspace-store')
    const sourceId = `workspace-${Math.random().toString(36).slice(2, 10)}`
    let isApplyingRemoteState = false

    const pickSyncState = (state: WorkspaceState): WorkspaceSyncState => ({
      activeConversationId: state.activeConversationId,
      sessions: state.sessions,
    })

    const applySyncState = (syncState: WorkspaceSyncState) => {
      isApplyingRemoteState = true
      useWorkspaceStore.setState((state) => {
        const nextConversationId = syncState.activeConversationId
        const nextSession = nextConversationId && syncState.sessions[nextConversationId]
          ? syncState.sessions[nextConversationId]
          : createEmptySession()

        return {
          activeConversationId: nextConversationId,
          sessions: syncState.sessions,
          ...nextSession,
        }
      })
      queueMicrotask(() => {
        isApplyingRemoteState = false
      })
    }

    channel.addEventListener('message', (event) => {
      const message = event.data as
        | { type: 'snapshot'; sourceId: string; payload: WorkspaceSyncState }
        | { type: 'request'; sourceId: string }

      if (!message || message.sourceId === sourceId) return

      if (message.type === 'request') {
        channel.postMessage({
          type: 'snapshot',
          sourceId,
          payload: pickSyncState(useWorkspaceStore.getState()),
        })
        return
      }

      if (message.type === 'snapshot') {
        applySyncState(message.payload)
      }
    })

    useWorkspaceStore.subscribe((state) => {
      if (isApplyingRemoteState) return
      channel.postMessage({
        type: 'snapshot',
        sourceId,
        payload: pickSyncState(state),
      })
    })

    setTimeout(() => {
      channel.postMessage({ type: 'request', sourceId })
    }, 0)
  }

  let lastConversationId = getActiveConversationId()

  useChatStore.subscribe((chatState) => {
    const nextConversationId = chatState.activeConversationId
    if (nextConversationId !== lastConversationId) {
      lastConversationId = nextConversationId
      useWorkspaceStore.getState().switchConversationSession(nextConversationId)
    }

    useWorkspaceStore.getState().pruneSessions(chatState.conversations.map((conversation) => conversation.id))
  })
}
