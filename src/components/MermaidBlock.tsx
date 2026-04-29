import { useEffect, useMemo, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { AlertTriangle, Copy, Check, Download, Image as ImageIcon, Maximize2 } from 'lucide-react'
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

type ImageCopyStatus = 'idle' | 'copied' | 'compatible' | 'error'

const MERMAID_SVG_FILE_NAME = 'mermaid-diagram.svg'

function buildMermaidImagePayload(svg: string): WorkspaceImageViewPayload {
  return {
    src: '',
    alt: 'Mermaid 图表',
    title: 'Mermaid 图表',
    svg,
  }
}

function createSvgBlob(svg: string) {
  return new Blob([svg], { type: 'image/svg+xml' })
}

function getSvgSize(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const svgElement = doc.documentElement
  const viewBox = svgElement.getAttribute('viewBox')

  if (viewBox) {
    const [, , width, height] = viewBox.split(/\s+/).map(Number)
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height }
    }
  }

  const parseSize = (value: string | null) => {
    if (!value) return 0
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const width = parseSize(svgElement.getAttribute('width'))
  const height = parseSize(svgElement.getAttribute('height'))

  return {
    width: width > 0 ? width : 1200,
    height: height > 0 ? height : 800,
  }
}

async function svgToPngBlob(svg: string) {
  const svgBlob = createSvgBlob(svg)
  const objectUrl = URL.createObjectURL(svgBlob)

  try {
    const image = new Image()
    const { width, height } = getSvgSize(svg)
    const scale = Math.min(3, Math.max(1, window.devicePixelRatio || 1))

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('SVG 图片转换失败'))
      image.src = objectUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * scale)
    canvas.height = Math.ceil(height * scale)

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('当前环境不支持图片转换')
    }

    context.setTransform(scale, 0, 0, scale, 0, 0)
    context.drawImage(image, 0, 0, width, height)

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('PNG 图片生成失败'))
        }
      }, 'image/png')
    })

    return pngBlob
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function copyMermaidImage(svg: string) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前环境不支持复制图片')
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/svg+xml': createSvgBlob(svg),
      }),
    ])
    return 'svg'
  } catch {
    const pngBlob = await svgToPngBlob(svg)
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': pngBlob,
      }),
    ])
    return 'png'
  }
}

function downloadMermaidSvg(svg: string) {
  const objectUrl = URL.createObjectURL(createSvgBlob(svg))
  const link = document.createElement('a')

  link.href = objectUrl
  link.download = MERMAID_SVG_FILE_NAME
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

export default function MermaidBlock({ chart, variant = 'dark', onOpenDiagram }: MermaidBlockProps) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sourceCopied, setSourceCopied] = useState(false)
  const [imageCopyStatus, setImageCopyStatus] = useState<ImageCopyStatus>('idle')
  const [downloaded, setDownloaded] = useState(false)
  const feedbackTimerRef = useRef<number | null>(null)

  const chartId = useMemo(() => `mermaid-${Math.random().toString(36).slice(2, 10)}`, [])
  const canOpenDiagram = Boolean(svg && !error && onOpenDiagram)
  const canUseRenderedSvg = Boolean(svg && !error)

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
          setImageCopyStatus('idle')
          setDownloaded(false)
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

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current)
      }
    }
  }, [])

  const resetFeedbackLater = () => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current)
    }

    feedbackTimerRef.current = window.setTimeout(() => {
      setSourceCopied(false)
      setImageCopyStatus('idle')
      setDownloaded(false)
      feedbackTimerRef.current = null
    }, 1800)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(chart)
    setSourceCopied(true)
    resetFeedbackLater()
  }

  const handleCopyImage = async () => {
    if (!svg || error) return

    try {
      const result = await copyMermaidImage(svg)
      setImageCopyStatus(result === 'svg' ? 'copied' : 'compatible')
    } catch {
      setImageCopyStatus('error')
    }
    resetFeedbackLater()
  }

  const handleDownloadSvg = () => {
    if (!svg || error) return
    downloadMermaidSvg(svg)
    setDownloaded(true)
    resetFeedbackLater()
  }

  const handleOpenDiagram = () => {
    if (!svg || error) return
    onOpenDiagram?.(buildMermaidImagePayload(svg))
  }

  const imageCopyLabel = imageCopyStatus === 'copied'
    ? '已复制图片'
    : imageCopyStatus === 'compatible'
      ? '已兼容复制'
      : imageCopyStatus === 'error'
        ? '复制失败'
        : '复制图片'

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
          {canUseRenderedSvg && (
            <>
              <button
                onClick={handleCopyImage}
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition ${variant === 'paper' ? 'hover:bg-[#e7dbc4] text-[#6b5b43]' : 'hover:bg-white/10 text-surface-300'}`}
                title={imageCopyStatus === 'compatible' ? '已按 PNG 兼容模式复制' : '复制渲染后的图表'}
              >
                {imageCopyStatus === 'copied' || imageCopyStatus === 'compatible' ? <Check size={12} /> : <ImageIcon size={12} />}
                {imageCopyLabel}
              </button>
              <button
                onClick={handleDownloadSvg}
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition ${variant === 'paper' ? 'hover:bg-[#e7dbc4] text-[#6b5b43]' : 'hover:bg-white/10 text-surface-300'}`}
                title="下载渲染后的 SVG"
              >
                {downloaded ? <Check size={12} /> : <Download size={12} />}
                {downloaded ? '已下载' : '下载 SVG'}
              </button>
            </>
          )}
          <button onClick={handleCopy} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition ${variant === 'paper' ? 'hover:bg-[#e7dbc4] text-[#6b5b43]' : 'hover:bg-white/10 text-surface-300'}`}>
            {sourceCopied ? <Check size={12} /> : <Copy size={12} />}
            {sourceCopied ? '已复制' : '复制源码'}
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
