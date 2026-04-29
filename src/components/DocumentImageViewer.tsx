import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { Minus, RotateCcw, Plus, X } from 'lucide-react'
import type { WorkspaceImageViewPayload } from './workspaceMarkdown'

interface DocumentImageViewerProps {
  image: WorkspaceImageViewPayload | null
  scale: number
  offset: { x: number; y: number }
  onScaleChange: (scale: number) => void
  onOffsetChange: (offset: { x: number; y: number }) => void
  onClose: () => void
}

const DRAG_THRESHOLD = 4

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getPanBounds(
  scale: number,
  stageSize: { width: number; height: number },
  imageSize: { width: number; height: number }
) {
  if (!stageSize.width || !stageSize.height || !imageSize.width || !imageSize.height) {
    return { maxX: 0, maxY: 0 }
  }

  const scaledWidth = imageSize.width * scale
  const scaledHeight = imageSize.height * scale

  return {
    maxX: Math.max(0, (scaledWidth - stageSize.width) / 2),
    maxY: Math.max(0, (scaledHeight - stageSize.height) / 2),
  }
}

function clampViewerOffset(
  nextOffset: { x: number; y: number },
  scale: number,
  stageSize: { width: number; height: number },
  imageSize: { width: number; height: number }
) {
  const { maxX, maxY } = getPanBounds(scale, stageSize, imageSize)

  if (!stageSize.width || !stageSize.height || !imageSize.width || !imageSize.height) {
    return { x: 0, y: 0 }
  }

  return {
    x: maxX > 0 ? clampValue(nextOffset.x, -maxX, maxX) : 0,
    y: maxY > 0 ? clampValue(nextOffset.y, -maxY, maxY) : 0,
  }
}

export default function DocumentImageViewer({
  image,
  scale,
  offset,
  onScaleChange,
  onOffsetChange,
  onClose,
}: DocumentImageViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)
  const suppressBackdropCloseRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!image) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [image, onClose])

  useEffect(() => {
    if (!image) return

    const measure = () => {
      const stage = stageRef.current
      const currentImage = imageRef.current

      setStageSize({
        width: stage?.clientWidth ?? 0,
        height: stage?.clientHeight ?? 0,
      })
      setImageSize({
        width: currentImage?.offsetWidth ?? 0,
        height: currentImage?.offsetHeight ?? 0,
      })
    }

    measure()

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measure())
      : null

    if (stageRef.current) observer?.observe(stageRef.current)
    if (imageRef.current) observer?.observe(imageRef.current)
    window.addEventListener('resize', measure)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [image])

  useEffect(() => {
    if (!image) return
    const nextOffset = clampViewerOffset(offset, scale, stageSize, imageSize)
    if (nextOffset.x !== offset.x || nextOffset.y !== offset.y) {
      onOffsetChange(nextOffset)
    }
  }, [image, imageSize, offset.x, offset.y, onOffsetChange, scale, stageSize])

  useEffect(() => {
    if (!image) return
    suppressBackdropCloseRef.current = false
    dragRef.current = null
    setIsDragging(false)
  }, [image])

  if (!image) return null
  if (typeof document === 'undefined') return null

  const { maxX, maxY } = getPanBounds(scale, stageSize, imageSize)
  const canPan = maxX > 0 || maxY > 0

  const handleBackdropClick = () => {
    if (suppressBackdropCloseRef.current) {
      suppressBackdropCloseRef.current = false
      return
    }
    onClose()
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canPan || event.button !== 0) return

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      moved: false,
    }
    suppressBackdropCloseRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return

    const deltaX = event.clientX - dragRef.current.startX
    const deltaY = event.clientY - dragRef.current.startY

    if (!dragRef.current.moved) {
      const distance = Math.hypot(deltaX, deltaY)
      if (distance < DRAG_THRESHOLD) return
      dragRef.current.moved = true
      suppressBackdropCloseRef.current = true
      setIsDragging(true)
    }

    onOffsetChange(
      clampViewerOffset(
        {
          x: dragRef.current.originX + deltaX,
          y: dragRef.current.originY + deltaY,
        },
        scale,
        stageSize,
        imageSize
      )
    )
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    suppressBackdropCloseRef.current = dragRef.current.moved
    dragRef.current = null
    setIsDragging(false)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    onScaleChange(scale + (event.deltaY < 0 ? 0.25 : -0.25))
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[#020617]/82 px-4 py-6 backdrop-blur-md"
      onClick={handleBackdropClick}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_30%),radial-gradient(circle_at_20%_80%,rgba(245,158,11,0.1),transparent_25%)]" />
      <div
        className="relative z-10 flex h-full w-full max-w-7xl flex-col gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-[#0b1421]/88 px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-surface-100">{image.title}</div>
            <div className="mt-1 text-xs text-surface-500">滚轮缩放，按住拖拽查看细节，Esc 关闭</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onScaleChange(scale - 0.25)}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-surface-200 transition hover:bg-white/10 hover:text-white"
              title="缩小"
            >
              <Minus size={16} />
            </button>
            <button
              onClick={() => onScaleChange(scale + 0.25)}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-surface-200 transition hover:bg-white/10 hover:text-white"
              title="放大"
            >
              <Plus size={16} />
            </button>
            <button
              onClick={() => {
                onScaleChange(1)
                onOffsetChange({ x: 0, y: 0 })
              }}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-surface-200 transition hover:bg-white/10 hover:text-white"
              title="重置"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-surface-200 transition hover:bg-white/10 hover:text-white"
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div
          ref={stageRef}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[30px] border border-white/10 bg-[#08111d]/88 shadow-[0_24px_90px_rgba(0,0,0,0.4)]"
        >
          <div
            className={`flex h-full w-full items-center justify-center overflow-hidden ${canPan ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onWheel={handleWheel}
            style={{ touchAction: 'none' }}
          >
            <img
              ref={imageRef}
              src={image.src}
              alt={image.alt}
              draggable={false}
              className="max-h-full max-w-full select-none object-contain"
              onLoad={() => {
                setImageSize({
                  width: imageRef.current?.offsetWidth ?? 0,
                  height: imageRef.current?.offsetHeight ?? 0,
                })
              }}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 140ms ease-out',
                willChange: canPan ? 'transform' : undefined,
              }}
            />
          </div>

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-[#0b1421]/88 px-3 py-1.5 text-xs text-surface-200 shadow-[0_12px_28px_rgba(0,0,0,0.3)]">
            {Math.round(scale * 100)}%
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
