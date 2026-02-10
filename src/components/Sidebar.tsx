import React, { useState } from 'react'
import { Plus, MessageSquare, Trash2, Settings, Pencil, Check, X, Loader2 } from 'lucide-react'
import { useChatStore } from '../store/chatStore'

export default function Sidebar() {
  const {
    conversations,
    activeConversationId,
    createConversation,
    deleteConversation,
    setActiveConversation,
    setSettingsOpen,
    streamingConvIds,
    updateConversationTitle,
  } = useChatStore()

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const handleNew = () => {
    createConversation()
  }

  const startRename = (e: React.MouseEvent, convId: string, currentTitle: string) => {
    e.stopPropagation()
    setRenamingId(convId)
    setRenameValue(currentTitle)
  }

  const submitRename = () => {
    if (renamingId && renameValue.trim()) {
      updateConversationTitle(renamingId, renameValue.trim())
    }
    setRenamingId(null)
    setRenameValue('')
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  return (
    <div className="flex flex-col h-full w-64 bg-surface-900/50 border-r border-surface-800/50">
      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={handleNew}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          <span>新对话</span>
        </button>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {conversations.length === 0 && (
          <div className="text-center text-surface-500 text-xs mt-8 px-4">
            还没有对话，点击上方按钮开始
          </div>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => {
              if (renamingId !== conv.id) setActiveConversation(conv.id)
            }}
            className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 ${
              activeConversationId === conv.id
                ? 'bg-primary-600/15 text-primary-300 border border-primary-500/20'
                : 'text-surface-300 hover:bg-surface-800/60 border border-transparent'
            }`}
          >
            <MessageSquare
              size={15}
              className={`shrink-0 ${
                activeConversationId === conv.id
                  ? 'text-primary-400'
                  : 'text-surface-500'
              }`}
            />
            {renamingId === conv.id ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={submitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename()
                  if (e.key === 'Escape') cancelRename()
                }}
                className="flex-1 bg-surface-800 border border-primary-500/50 rounded px-2 py-1 text-sm text-surface-100 focus:outline-none"
                autoFocus
              />
            ) : (
              <span className="text-sm truncate flex-1">{conv.title}</span>
            )}
            {streamingConvIds.includes(conv.id) && (
              <Loader2 size={13} className="text-primary-400 animate-spin shrink-0" />
            )}
            <div className={`flex items-center gap-0.5 ${renamingId === conv.id ? '' : 'opacity-0 group-hover:opacity-100'}`}>
              <button
                onClick={(e) => {
                  if (renamingId === conv.id) {
                    submitRename()
                  } else {
                    startRename(e, conv.id, conv.title)
                  }
                }}
                className="p-1 hover:bg-surface-700/50 rounded transition-all"
              >
                {renamingId === conv.id ? (
                  <Check size={13} className="text-green-400" />
                ) : (
                  <Pencil size={13} className="text-surface-400 hover:text-surface-200" />
                )}
              </button>
              {renamingId === conv.id ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    cancelRename()
                  }}
                  className="p-1 hover:bg-red-500/20 rounded transition-all"
                >
                  <X size={13} className="text-surface-400 hover:text-red-400" />
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteConversation(conv.id)
                  }}
                  className="p-1 hover:bg-red-500/20 rounded transition-all"
                >
                  <Trash2 size={13} className="text-surface-400 hover:text-red-400" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Settings Button */}
      <div className="p-3 border-t border-surface-800/50">
        <button
          onClick={() => setSettingsOpen(true)}
          className="btn-ghost w-full flex items-center gap-2.5"
        >
          <Settings size={15} />
          <span className="text-sm">设置</span>
        </button>
      </div>
    </div>
  )
}
