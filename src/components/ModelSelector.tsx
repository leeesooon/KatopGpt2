import { useState, useRef, useEffect } from 'react'
import { ChevronUp, Cpu, Server, ImageIcon } from 'lucide-react'
import { useChatStore } from '../store/chatStore'

export default function ModelSelector() {
  const { settings, setActiveModel } = useChatStore()
  const { providers, activeModel } = settings

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

  // Resolve display label
  const activeProvider = activeModel
    ? providers.find((p) => p.id === activeModel.providerId)
    : null
  const displayLabel = activeModel
    ? `${activeProvider?.name ?? '?'} / ${activeModel.model}`
    : '选择模型'

  const allModels = providers.flatMap((p) =>
    p.models.map((m) => ({ providerId: p.id, providerName: p.name, model: m.name, multimodal: m.multimodal }))
  )

  const hasModels = allModels.length > 0

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => hasModels && setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all duration-150
          ${hasModels
            ? 'hover:bg-surface-700/50 text-surface-300 hover:text-surface-100 cursor-pointer'
            : 'text-surface-500 cursor-default'
          }
          ${open ? 'bg-surface-700/50 text-surface-100' : ''}
        `}
      >
        <Cpu size={13} className={activeModel ? 'text-primary-400' : 'text-surface-500'} />
        <span className="font-mono truncate max-w-[200px]">{displayLabel}</span>
        {hasModels && (
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
                     glass-panel rounded-xl shadow-2xl animate-slide-up z-50"
        >
          {providers.map((provider) => {
            if (provider.models.length === 0) return null
            return (
              <div key={provider.id}>
                {/* Provider header */}
                <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5 sticky top-0 bg-surface-900/95 backdrop-blur-sm">
                  <Server size={11} className="text-surface-500" />
                  <span className="text-[11px] font-semibold text-surface-400 uppercase tracking-wider">
                    {provider.name}
                  </span>
                </div>
                {/* Models */}
                {provider.models.map((model) => {
                  const isActive =
                    activeModel?.providerId === provider.id && activeModel?.model === model.name
                  return (
                    <button
                      key={`${provider.id}-${model.name}`}
                      onClick={() => {
                        setActiveModel({ providerId: provider.id, model: model.name })
                        setOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-sm font-mono transition-colors flex items-center gap-2
                        ${isActive
                          ? 'bg-primary-600/15 text-primary-300 border-l-2 border-primary-500'
                          : 'text-surface-300 hover:bg-surface-700/40 border-l-2 border-transparent'
                        }
                      `}
                    >
                      <span className="flex-1 truncate">{model.name}</span>
                      {model.multimodal && (
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
