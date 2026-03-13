import { ExternalLink } from 'lucide-react'
import type { SearchResult } from '../types'

interface SourcesPanelProps {
  sources: SearchResult[]
}

export default function SourcesPanel({ sources }: SourcesPanelProps) {
  if (!sources || sources.length === 0) return null

  return (
    <div className="border-t border-surface-700/50 mt-4 pt-4">
      <h3 className="font-semibold text-sm text-surface-400 mb-2">来源</h3>
      <ul className="space-y-2">
        {sources.map((source, i) => (
          <li key={i} className="flex items-start gap-2 group">
            <span className="text-surface-500 text-xs mt-0.5 shrink-0">[{i + 1}]</span>
            <div className="flex-1 min-w-0">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary-400 hover:text-primary-300 hover:underline 
                           line-clamp-2 break-words transition-colors flex items-start gap-1"
              >
                <span className="flex-1">{source.title || source.url}</span>
                <ExternalLink size={12} className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
              {source.date && (
                <p className="text-xs text-surface-500 mt-0.5">{source.date}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
