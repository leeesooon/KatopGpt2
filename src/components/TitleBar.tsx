import { Minus, X, Copy } from 'lucide-react'
import katopLogo from '../assets/katop-logo.png'

export default function TitleBar() {
  const handleMinimize = () => window.electronAPI?.minimize()
  const handleMaximize = () => window.electronAPI?.maximize()
  const handleClose = () => window.electronAPI?.close()

  return (
    <div className="drag-region flex items-center justify-between h-9 bg-surface-950 border-b border-surface-800/50 px-3 select-none shrink-0">
      <div className="flex items-center gap-2 no-drag">
        <img src={katopLogo} alt="KatopGPT" className="w-4 h-4 object-contain" />
        <span className="text-xs font-semibold text-surface-300 tracking-wide">KatopGPT</span>
      </div>

      <div className="flex items-center no-drag">
        <button
          onClick={handleMinimize}
          className="p-1.5 hover:bg-surface-700/60 rounded transition-colors"
        >
          <Minus size={13} className="text-surface-400" />
        </button>
        <button
          onClick={handleMaximize}
          className="p-1.5 hover:bg-surface-700/60 rounded transition-colors"
        >
          <Copy size={11} className="text-surface-400" />
        </button>
        <button
          onClick={handleClose}
          className="p-1.5 hover:bg-red-500/80 rounded transition-colors group"
        >
          <X size={13} className="text-surface-400 group-hover:text-white" />
        </button>
      </div>
    </div>
  )
}
