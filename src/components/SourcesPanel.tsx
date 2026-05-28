import { useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import type { SearchResult } from '../types'
import { normalizeExternalUrl, openExternalUrl } from '../utils/externalLinks'

interface SourcesPanelProps {
  sources: SearchResult[]
}

const DEFAULT_VISIBLE_SOURCE_COUNT = 2

export default function SourcesPanel({ sources }: SourcesPanelProps) {
  const [expanded, setExpanded] = useState(false)

  if (!sources || sources.length === 0) return null

  const hasHiddenSources = sources.length > DEFAULT_VISIBLE_SOURCE_COUNT
  const visibleSources = expanded || !hasHiddenSources
    ? sources
    : sources.slice(0, DEFAULT_VISIBLE_SOURCE_COUNT)
  const hiddenSourceCount = sources.length - DEFAULT_VISIBLE_SOURCE_COUNT

  return (
    <div className="mt-4 border-t border-surface-700/35 pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-surface-300">来源</h3>
          <span className="rounded-full border border-surface-700/50 bg-surface-900/40 px-1.5 py-0.5 text-[10px] text-surface-500">
            {sources.length} 条
          </span>
        </div>
        {hasHiddenSources && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-surface-700/50 bg-surface-900/35 px-2 text-[10px] text-surface-400 transition hover:border-primary-300/25 hover:bg-primary-300/10 hover:text-primary-100"
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                <ChevronUp size={12} />
                收起
              </>
            ) : (
              <>
                <ChevronDown size={12} />
                展开 {hiddenSourceCount} 条
              </>
            )}
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {visibleSources.map((source, i) => {
          const normalizedUrl = normalizeExternalUrl(source.url)

          return (
            <li
              key={i}
              className="group/source flex items-start gap-2 rounded-lg border border-white/5 bg-surface-900/30 px-2.5 py-2 transition-colors hover:border-surface-600/40 hover:bg-surface-800/50"
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-primary-300/15 bg-primary-300/10 text-[10px] font-medium text-primary-200">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                {normalizedUrl ? (
                  <a
                    href={normalizedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-1 text-xs text-surface-200 transition-colors hover:text-primary-200"
                    onClick={(event) => {
                      event.preventDefault()
                      openExternalUrl(normalizedUrl)
                    }}
                  >
                    <span className="line-clamp-1 flex-1 break-words">{source.title || normalizedUrl}</span>
                    <ExternalLink size={12} className="mt-0.5 shrink-0 text-surface-500 opacity-0 transition-opacity group-hover/source:opacity-100" />
                  </a>
                ) : (
                  <div className="line-clamp-1 break-words text-xs text-surface-200">
                    {source.title || '知识资料'}
                  </div>
                )}
                {source.snippet && (
                  <p className="mt-1 line-clamp-1 break-words text-[11px] text-surface-500">{source.snippet}</p>
                )}
                {source.date && (
                  <p className="mt-0.5 text-[10px] text-surface-600">{source.date}</p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
