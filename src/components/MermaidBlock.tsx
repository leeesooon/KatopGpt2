import { useEffect, useMemo, useState } from 'react'
import mermaid from 'mermaid'
import { AlertTriangle, Copy, Check, Maximize2 } from 'lucide-react'
import type { WorkspaceImageViewPayload } from './workspaceMarkdown'

let mermaidInitialized = false

function ensureMermaidInitialized() {
  if (mermaidInitialized) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    fontFamily: 'IBM Plex Sans, Noto Sans SC, sans-serif',
    themeVariables: {
      primaryColor: '#1f2937',
      primaryTextColor: '#f8fafc',
      primaryBorderColor: '#64748b',
      lineColor: '#94a3b8',
      secondaryColor: '#0f172a',
      tertiaryColor: '#111827',
      background: '#0b1220',
      mainBkg: '#111827',
      secondBkg: '#1e293b',
      tertiaryBkg: '#0f172a',
      clusterBkg: '#172033',
      clusterBorder: '#475569',
      edgeLabelBackground: '#0f172a',
      textColor: '#e2e8f0',
      noteBkgColor: '#1e293b',
      noteTextColor: '#e2e8f0',
      noteBorderColor: '#64748b',
      actorBorder: '#64748b',
      actorBkg: '#111827',
      actorTextColor: '#f8fafc',
      actorLineColor: '#94a3b8',
      signalColor: '#cbd5e1',
      signalTextColor: '#e2e8f0',
      labelBoxBkgColor: '#111827',
      labelBoxBorderColor: '#475569',
      labelTextColor: '#f8fafc',
    },
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis',
    },
  })
  mermaidInitialized = true
}

interface MermaidBlockProps {
  chart: string
  variant?: 'dark' | 'paper'
  onOpenDiagram?: (image: WorkspaceImageViewPayload) => void
}

function buildMermaidImagePayload(svg: string): WorkspaceImageViewPayload {
  return {
    src: '',
    alt: 'Mermaid 图表',
    title: 'Mermaid 图表',
    svg,
  }
}

export default function MermaidBlock({ chart, variant = 'dark', onOpenDiagram }: MermaidBlockProps) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const chartId = useMemo(() => `mermaid-${Math.random().toString(36).slice(2, 10)}`, [])
  const canOpenDiagram = Boolean(svg && !error && onOpenDiagram)

  useEffect(() => {
    let cancelled = false

    async function renderChart() {
      ensureMermaidInitialized()
      setError(null)
      setSvg('')

      try {
        const { svg: renderedSvg } = await mermaid.render(chartId, chart)
        if (!cancelled) {
          setSvg(renderedSvg)
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg('')
          setError(renderError instanceof Error ? renderError.message : 'Mermaid 图表渲染失败')
        }
      }
    }

    void renderChart()

    return () => {
      cancelled = true
    }
  }, [chart, chartId])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(chart)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleOpenDiagram = () => {
    if (!svg || error) return
    onOpenDiagram?.(buildMermaidImagePayload(svg))
  }

  return (
    <div className={`mermaid-shell my-3 overflow-hidden rounded-2xl border ${variant === 'paper' ? 'border-[#c9b792] bg-[#f3ead9]' : 'border-surface-700/60 bg-[#0b1220]/90'}`}>
      <div className={`flex items-center justify-between border-b px-4 py-2 text-xs ${variant === 'paper' ? 'border-[#d8c7a3] text-[#6b5b43]' : 'border-surface-700/60 text-surface-400'}`}>
        <span className="font-mono uppercase tracking-[0.22em]">Mermaid</span>
        <div className="flex items-center gap-1.5">
          {canOpenDiagram && (
            <button
              onClick={handleOpenDiagram}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition ${variant === 'paper' ? 'hover:bg-[#e7dbc4] text-[#6b5b43]' : 'hover:bg-white/10 text-surface-300'}`}
              title="打开图表"
            >
              <Maximize2 size={13} />
            </button>
          )}
          <button onClick={handleCopy} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition ${variant === 'paper' ? 'hover:bg-[#e7dbc4] text-[#6b5b43]' : 'hover:bg-white/10 text-surface-300'}`}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '已复制' : '复制源码'}
          </button>
        </div>
      </div>

      {error ? (
        <div className={`flex items-start gap-2 px-4 py-4 text-sm ${variant === 'paper' ? 'text-[#7c2d12]' : 'text-amber-200'}`}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Mermaid 语法有误</div>
            <div className="mt-1 whitespace-pre-wrap break-all opacity-80">{error}</div>
          </div>
        </div>
      ) : (
        <div
          className={`mermaid-stage overflow-x-auto px-3 py-4 ${canOpenDiagram ? 'cursor-zoom-in' : ''} ${variant === 'paper' ? 'bg-[#f7f0e2]' : 'bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_35%),#0b1220]'}`}
          onClick={canOpenDiagram ? handleOpenDiagram : undefined}
        >
          {svg ? (
            <div className="mermaid-diagram min-w-max" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className={`text-sm ${variant === 'paper' ? 'text-[#6b5b43]' : 'text-surface-400'}`}>正在渲染图表...</div>
          )}
        </div>
      )}
    </div>
  )
}
