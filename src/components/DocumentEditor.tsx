import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { EditorSelection, EditorState, RangeSetBuilder } from '@codemirror/state'
import type { Extension, SelectionRange } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  highlightActiveLine,
  keymap,
  placeholder,
} from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { DocumentSelection } from '../types'

export interface DocumentEditorHandle {
  focus: () => void
  focusLine: (line: number) => void
  scrollToProgress: (progress: number) => void
  getScrollProgress: () => number
}

interface DocumentEditorProps {
  content: string
  onChange: (content: string) => void
  onSelectionChange: (selection: DocumentSelection | null) => void
  onCursorLineChange?: (line: number) => void
  onScroll?: (progress: number) => void
  onSave?: () => void
  onPasteImage?: (image: File) => Promise<string>
}

interface DecorationEntry {
  from: number
  to: number
  decoration: Decoration
}

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, class: 'cm-md-heading-token cm-md-heading-token-1' },
  { tag: tags.heading2, class: 'cm-md-heading-token cm-md-heading-token-2' },
  { tag: tags.heading3, class: 'cm-md-heading-token cm-md-heading-token-3' },
  { tag: tags.strong, class: 'cm-md-strong' },
  { tag: tags.emphasis, class: 'cm-md-emphasis' },
  { tag: tags.monospace, class: 'cm-md-inline-code' },
  { tag: tags.link, class: 'cm-md-link' },
  { tag: tags.quote, class: 'cm-md-quote-token' },
  { tag: tags.meta, class: 'cm-md-meta' },
  { tag: tags.keyword, class: 'cm-md-keyword' },
  { tag: tags.atom, class: 'cm-md-atom' },
])

function getCursorLine(content: string, cursorIndex: number) {
  return content.slice(0, cursorIndex).split(/\r?\n/).length - 1
}

function getScrollProgress(view: EditorView) {
  const scrollDOM = view.scrollDOM
  const maxScroll = scrollDOM.scrollHeight - scrollDOM.clientHeight
  return maxScroll > 0 ? scrollDOM.scrollTop / maxScroll : 0
}

function addReplace(entries: DecorationEntry[], from: number, to: number) {
  if (to <= from) return
  entries.push({ from, to, decoration: Decoration.replace({}) })
}

function addMark(entries: DecorationEntry[], from: number, to: number, className: string) {
  if (to <= from) return
  entries.push({ from, to, decoration: Decoration.mark({ class: className }) })
}

function addInlineDecorations(entries: DecorationEntry[], lineFrom: number, text: string, shouldHideSyntax: boolean) {
  const patterns: Array<{
    regex: RegExp
    className: string
    markerSize: number
  }> = [
    { regex: /\*\*([^*\n]+?)\*\*/g, className: 'cm-md-strong', markerSize: 2 },
    { regex: /~~([^~\n]+?)~~/g, className: 'cm-md-strikethrough', markerSize: 2 },
    { regex: /`([^`\n]+?)`/g, className: 'cm-md-inline-code', markerSize: 1 },
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      if (match.index == null) continue
      const start = lineFrom + match.index
      const contentStart = start + pattern.markerSize
      const contentEnd = contentStart + match[1].length
      const end = start + match[0].length
      addMark(entries, contentStart, contentEnd, pattern.className)
      if (shouldHideSyntax) {
        addReplace(entries, start, contentStart)
        addReplace(entries, contentEnd, end)
      }
    }
  }

  for (const match of text.matchAll(/(^|[^*])\*([^*\n]+?)\*/g)) {
    if (match.index == null) continue
    const markerStart = lineFrom + match.index + match[1].length
    const contentStart = markerStart + 1
    const contentEnd = contentStart + match[2].length
    const markerEnd = contentEnd + 1
    addMark(entries, contentStart, contentEnd, 'cm-md-emphasis')
    if (shouldHideSyntax) {
      addReplace(entries, markerStart, contentStart)
      addReplace(entries, contentEnd, markerEnd)
    }
  }

  for (const match of text.matchAll(/(!?)\[([^\]]+?)\]\(([^)]+?)\)/g)) {
    if (match.index == null) continue
    const start = lineFrom + match.index
    const startMarkerLength = match[1] ? 2 : 1
    const contentStart = start + startMarkerLength
    const contentEnd = contentStart + match[2].length
    const end = start + match[0].length
    addMark(entries, contentStart, contentEnd, match[1] ? 'cm-md-image-link' : 'cm-md-link')
    if (shouldHideSyntax) {
      addReplace(entries, start, contentStart)
      addReplace(entries, contentEnd, end)
    }
  }
}

function buildLivePreviewDecorations(view: EditorView) {
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number
  const entries: DecorationEntry[] = []
  const lineCount = view.state.doc.lines
  let isInFence = false

  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber)
    const text = line.text
    const isActiveLine = line.number === activeLine
    const shouldHideSyntax = !isActiveLine
    const headingMatch = /^(#{1,6})(\s+)(.*)$/.exec(text)
    const fenceMatch = /^\s*(```|~~~)/.exec(text)

    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6)
      entries.push({
        from: line.from,
        to: line.from,
        decoration: Decoration.line({ class: `cm-md-heading-line cm-md-heading-${level}` }),
      })
      if (shouldHideSyntax) {
        addReplace(entries, line.from, line.from + headingMatch[1].length + headingMatch[2].length)
      }
    }

    if (/^\s*>/.test(text)) {
      entries.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-md-quote-line' }) })
      if (shouldHideSyntax) {
        const markerMatch = /^(\s*>+\s?)/.exec(text)
        if (markerMatch) addReplace(entries, line.from, line.from + markerMatch[1].length)
      }
    }

    if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(text)) {
      entries.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-md-task-line' }) })
    } else if (/^\s*([-*+] |\d+\.\s+)/.test(text)) {
      entries.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-md-list-line' }) })
    }

    if (isInFence || fenceMatch) {
      entries.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: fenceMatch ? 'cm-md-code-fence-line' : 'cm-md-code-block-line' }) })
    }

    if (!isInFence && !fenceMatch) {
      addInlineDecorations(entries, line.from, text, shouldHideSyntax)
    }

    if (fenceMatch) {
      isInFence = !isInFence
    }
  }

  entries.sort((left, right) => left.from - right.from || left.to - right.to)
  const builder = new RangeSetBuilder<Decoration>()
  for (const entry of entries) {
    builder.add(entry.from, entry.to, entry.decoration)
  }
  return builder.finish()
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLivePreviewDecorations(update.view)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  }
)

function scrollProgressExtension(onScrollRef: React.MutableRefObject<((progress: number) => void) | undefined>) {
  return ViewPlugin.fromClass(class {
    private view: EditorView
    private handleScroll: () => void

    constructor(view: EditorView) {
      this.view = view
      this.handleScroll = () => {
        onScrollRef.current?.(getScrollProgress(this.view))
      }
      view.scrollDOM.addEventListener('scroll', this.handleScroll)
    }

    destroy() {
      this.view.scrollDOM.removeEventListener('scroll', this.handleScroll)
    }
  })
}

function toggleWrap(view: EditorView, before: string, after = before) {
  const range = view.state.selection.main
  const from = Math.min(range.from, range.to)
  const to = Math.max(range.from, range.to)
  const selectedText = view.state.doc.sliceString(from, to)

  if (!selectedText) {
    view.dispatch({
      changes: { from, insert: `${before}${after}` },
      selection: EditorSelection.cursor(from + before.length),
      scrollIntoView: true,
    })
    return true
  }

  if (selectedText.startsWith(before) && selectedText.endsWith(after)) {
    view.dispatch({
      changes: [
        { from, to: from + before.length },
        { from: to - after.length, to },
      ],
      selection: EditorSelection.range(from, to - before.length - after.length),
      scrollIntoView: true,
    })
    return true
  }

  view.dispatch({
    changes: [
      { from, insert: before },
      { from: to, insert: after },
    ],
    selection: EditorSelection.range(from + before.length, to + before.length),
    scrollIntoView: true,
  })
  return true
}

function insertLink(view: EditorView) {
  const range = view.state.selection.main
  const from = Math.min(range.from, range.to)
  const to = Math.max(range.from, range.to)
  const selectedText = view.state.doc.sliceString(from, to) || '链接文本'
  const linkText = `[${selectedText}](https://)`
  const urlStart = from + selectedText.length + 3
  const urlEnd = urlStart + 'https://'.length

  view.dispatch({
    changes: { from, to, insert: linkText },
    selection: EditorSelection.range(urlStart, urlEnd),
    scrollIntoView: true,
  })
  return true
}

function emitEditorSelection(
  view: EditorView,
  onSelectionChange: (selection: DocumentSelection | null) => void,
  onCursorLineChange?: (line: number) => void
) {
  const range: SelectionRange = view.state.selection.main
  const from = Math.min(range.from, range.to)
  const to = Math.max(range.from, range.to)
  const headLine = view.state.doc.lineAt(range.head).number - 1
  onCursorLineChange?.(headLine)

  if (from === to) {
    onSelectionChange(null)
    return
  }

  onSelectionChange({
    start: from,
    end: to,
    text: view.state.doc.sliceString(from, to),
  })
}

const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(function DocumentEditor({
  content,
  onChange,
  onSelectionChange,
  onCursorLineChange,
  onScroll,
  onSave,
  onPasteImage,
}, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isApplyingExternalUpdateRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onCursorLineChangeRef = useRef(onCursorLineChange)
  const onScrollRef = useRef(onScroll)
  const onSaveRef = useRef(onSave)
  const onPasteImageRef = useRef(onPasteImage)
  const [pasteError, setPasteError] = useState<string | null>(null)

  const stats = useMemo(() => {
    const characters = content.length
    const words = content.trim() ? content.trim().split(/\s+/).length : 0
    const lines = content ? content.split(/\r?\n/).length : 1

    return { characters, words, lines }
  }, [content])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    onCursorLineChangeRef.current = onCursorLineChange
  }, [onCursorLineChange])

  useEffect(() => {
    onScrollRef.current = onScroll
  }, [onScroll])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    onPasteImageRef.current = onPasteImage
  }, [onPasteImage])

  useImperativeHandle(ref, () => ({
    focus: () => {
      viewRef.current?.focus()
    },
    focusLine: (line) => {
      const view = viewRef.current
      if (!view) return
      const lineNumber = Math.min(Math.max(line + 1, 1), view.state.doc.lines)
      const targetLine = view.state.doc.line(lineNumber)
      view.dispatch({
        selection: EditorSelection.cursor(targetLine.from),
        effects: EditorView.scrollIntoView(targetLine.from, { y: 'center' }),
      })
      view.focus()
    },
    scrollToProgress: (progress) => {
      const view = viewRef.current
      if (!view) return
      const maxScroll = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight
      view.scrollDOM.scrollTop = maxScroll > 0 ? maxScroll * progress : 0
    },
    getScrollProgress: () => {
      const view = viewRef.current
      return view ? getScrollProgress(view) : 0
    },
  }), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || viewRef.current) return

    const extensions: Extension[] = [
      history(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(markdownHighlightStyle),
      EditorState.tabSize.of(2),
      EditorView.lineWrapping,
      highlightActiveLine(),
      placeholder('在这里写 Markdown，或使用文档助手生成初稿。'),
      livePreviewPlugin,
      scrollProgressExtension(onScrollRef),
      EditorView.domEventHandlers({
        paste: (event, view) => {
          const imageFile = Array.from(event.clipboardData?.files ?? [])
            .find((file) => file.type.startsWith('image/'))
          if (!imageFile || !onPasteImageRef.current) return false

          event.preventDefault()
          void onPasteImageRef.current(imageFile)
            .then((markdown) => {
              if (!markdown) return
              const range = view.state.selection.main
              const from = Math.min(range.from, range.to)
              const to = Math.max(range.from, range.to)
              const before = from > 0 && !/\n$/.test(view.state.doc.sliceString(Math.max(0, from - 1), from)) ? '\n\n' : ''
              const after = to < view.state.doc.length && !/^\n/.test(view.state.doc.sliceString(to, Math.min(view.state.doc.length, to + 1))) ? '\n\n' : ''
              const insertText = `${before}${markdown}${after}`
              view.dispatch({
                changes: { from, to, insert: insertText },
                selection: EditorSelection.cursor(from + insertText.length),
                scrollIntoView: true,
              })
              setPasteError(null)
            })
            .catch((error) => {
              setPasteError(error instanceof Error ? error.message : '图片写入失败，请确认工作区可写')
              setTimeout(() => setPasteError(null), 4000)
            })
          return true
        },
      }),
      keymap.of([
        {
          key: 'Mod-b',
          run: (view) => toggleWrap(view, '**'),
        },
        {
          key: 'Mod-i',
          run: (view) => toggleWrap(view, '*'),
        },
        {
          key: 'Mod-k',
          run: insertLink,
        },
        {
          key: 'Mod-s',
          run: () => {
            onSaveRef.current?.()
            return true
          },
        },
        { key: 'Tab', run: indentMore },
        { key: 'Shift-Tab', run: indentLess },
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !isApplyingExternalUpdateRef.current) {
          onChangeRef.current(update.state.doc.toString())
        }
        if (update.selectionSet || update.docChanged || update.focusChanged) {
          emitEditorSelection(update.view, onSelectionChangeRef.current, onCursorLineChangeRef.current)
        }
      }),
    ]

    const state = EditorState.create({ doc: content, extensions })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    emitEditorSelection(view, onSelectionChangeRef.current, onCursorLineChangeRef.current)

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentContent = view.state.doc.toString()
    if (currentContent === content) return

    isApplyingExternalUpdateRef.current = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    })
    isApplyingExternalUpdateRef.current = false
  }, [content])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-surface-700/40 bg-[#101827]/85 shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
      <div className="flex shrink-0 items-center justify-between border-b border-surface-700/40 px-5 py-3 text-[11px] uppercase tracking-[0.28em] text-surface-400">
        <span>Live Preview</span>
        <div className="flex items-center gap-3 normal-case tracking-normal text-surface-500">
          {pasteError && <span className="text-rose-300">{pasteError}</span>}
          <span>{stats.lines} 行</span>
          <span>{stats.words} 词</span>
          <span>{stats.characters} 字符</span>
          <span>当前行显示 Markdown 源码</span>
        </div>
      </div>
      <div ref={hostRef} className="workspace-codemirror h-full min-h-0 flex-1" />
    </div>
  )
})

export default DocumentEditor
