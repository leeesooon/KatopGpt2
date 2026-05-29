import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp, Cpu, Server, ImageIcon, Sparkles } from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import type { ChatInputMode } from '../types'
import {
  resolveConversationModelSelection,
  resolveImageGenerationModelSelection,
  supportsGeneralChat,
  supportsImageGeneration,
} from '../types'

interface ModelSelectorProps {
  mode: ChatInputMode
}

export default function ModelSelector({ mode }: ModelSelectorProps) {
  const {
    settings,
    conversations,
    activeConversationId,
    setConversationModelSelection,
    updateSettings,
  } = useChatStore()
  const { providers } = settings
  const isImageMode = mode === 'image'
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId)
  const activeModel = isImageMode
    ? resolveImageGenerationModelSelection(settings)
    : resolveConversationModelSelection(settings, activeConversation)

  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    setOpen(false)
  }, [mode, activeConversationId])

  const activeProvider = activeModel
    ? providers.find((p) => p.id === activeModel.providerId)
    : null
  const displayLabel = activeModel
    ? `${isImageMode ? '生图模型' : '本会话模型'} / ${activeProvider?.name ?? '?'} / ${activeModel.model}`
    : isImageMode ? '选择生图模型' : '选择本会话模型'

  const modelGroups = useMemo(() => providers
    .map((provider) => ({
      provider,
      models: provider.models.filter((model) =>
        isImageMode ? supportsImageGeneration(model) : supportsGeneralChat(model)
      ),
    }))
    .filter((group) => group.models.length > 0), [isImageMode, providers])

  const hasModels = modelGroups.some((group) => group.models.length > 0)
  const canOpen = hasModels && (isImageMode || Boolean(activeConversationId))
  const Icon = isImageMode ? Sparkles : Cpu

  return (
    <div className="relative z-[70]">
      <button
        ref={btnRef}
        onClick={() => canOpen && setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all duration-150
          ${canOpen
            ? 'hover:bg-surface-700/50 text-surface-300 hover:text-surface-100 cursor-pointer'
            : 'text-surface-500 cursor-default'
          }
          ${open ? 'bg-surface-700/50 text-surface-100' : ''}
        `}
      >
        <Icon size={13} className={activeModel ? (isImageMode ? 'text-fuchsia-300' : 'text-primary-400') : 'text-surface-500'} />
        <span className="font-mono truncate max-w-[200px]">{displayLabel}</span>
        {canOpen && (
          <ChevronUp
            size={12}
            className={`text-surface-400 transition-transform duration-200 ${open ? '' : 'rotate-180'}`}
          />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute bottom-full left-0 mb-2 w-72 max-h-80 overflow-y-auto
                     glass-panel rounded-xl shadow-2xl animate-slide-up z-[80]"
        >
          {modelGroups.map(({ provider, models }) => {
            return (
              <div key={provider.id}>
                <div className="sticky top-0 z-10 px-3 pt-2.5 pb-1 flex items-center gap-1.5 bg-surface-900/95 backdrop-blur-sm">
                  <Server size={11} className="text-surface-500" />
                  <span className="text-[11px] font-semibold text-surface-400 uppercase tracking-wider">
                    {provider.name}
                  </span>
                </div>
                {models.map((model) => {
                  const isActive =
                    activeModel?.providerId === provider.id && activeModel?.model === model.name
                  return (
                    <button
                      key={`${provider.id}-${model.name}`}
                      onClick={() => {
                        if (isImageMode) {
                          updateSettings({
                            imageGeneration: {
                              ...settings.imageGeneration,
                              providerId: provider.id,
                              model: model.name,
                            },
                          })
                        } else if (activeConversationId) {
                          setConversationModelSelection(activeConversationId, { providerId: provider.id, model: model.name })
                        }
                        setOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-sm font-mono transition-colors flex items-center gap-2
                        ${isActive
                          ? isImageMode
                            ? 'bg-fuchsia-500/15 text-fuchsia-200 border-l-2 border-fuchsia-400'
                            : 'bg-primary-600/15 text-primary-300 border-l-2 border-primary-500'
                          : 'text-surface-300 hover:bg-surface-700/40 border-l-2 border-transparent'
                        }
                      `}
                    >
                      <span className="flex-1 truncate">{model.name}</span>
                      {isImageMode ? (
                        <Sparkles size={12} className="text-fuchsia-300 shrink-0" />
                      ) : model.multimodal && (
                        <ImageIcon size={12} className="text-emerald-400 shrink-0" />
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
