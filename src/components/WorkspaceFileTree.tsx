import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, FileText, FolderOpen, MoreHorizontal, PanelLeftClose, Pencil, Plus, Trash2 } from 'lucide-react'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

interface WorkspaceFileTreeProps {
  filePaths: string[]
  activePath: string | null
  pendingRenamePath?: string | null
  onSelect: (relativePath: string) => void
  onCreate: (relativePath: string) => Promise<boolean>
  onRename: (oldRelativePath: string, newRelativePath: string) => Promise<boolean>
  onDelete: (relativePath: string) => Promise<boolean>
  onCollapse?: () => void
}

function buildTree(filePaths: string[]) {
  const root: FileNode = { name: '', path: '', type: 'directory', children: [] }

  for (const filePath of filePaths) {
    const segments = filePath.split('/').filter(Boolean)
    let cursor = root

    segments.forEach((segment, index) => {
      const currentPath = segments.slice(0, index + 1).join('/')
      const isFile = index === segments.length - 1
      const currentChildren = cursor.children ?? []
      let existingNode = currentChildren.find((node) => node.name === segment)

      if (!existingNode) {
        existingNode = {
          name: segment,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          children: isFile ? undefined : [],
        }
        currentChildren.push(existingNode)
        currentChildren.sort((left, right) => {
          if (left.type !== right.type) {
            return left.type === 'directory' ? -1 : 1
          }
          return left.name.localeCompare(right.name, 'zh-CN')
        })
        cursor.children = currentChildren
      }

      cursor = existingNode
    })
  }

  return root.children ?? []
}

function FileActionsMenu({
  onRename,
  onDelete,
}: {
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <div className="absolute right-0 top-9 z-20 w-32 overflow-hidden rounded-2xl border border-white/10 bg-[#111827]/95 p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.35)] backdrop-blur-md">
      <button
        onClick={onRename}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-surface-200 transition hover:bg-white/10"
      >
        <Pencil size={14} />
        重命名
      </button>
      <button
        onClick={onDelete}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-200 transition hover:bg-rose-400/10"
      >
        <Trash2 size={14} />
        删除
      </button>
    </div>
  )
}

function TreeBranch({
  node,
  activePath,
  depth,
  pendingRenamePath,
  onSelect,
  onRename,
  onDelete,
}: {
  node: FileNode
  activePath: string | null
  depth: number
  pendingRenamePath?: string | null
  onSelect: (relativePath: string) => void
  onRename: (oldRelativePath: string, newRelativePath: string) => Promise<boolean>
  onDelete: (relativePath: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(true)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(node.name)
  const [isBusy, setIsBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const indentStyle = { paddingLeft: `${depth * 12 + 10}px` }

  useEffect(() => {
    setRenameValue(node.name)
  }, [node.name])

  useEffect(() => {
    if (pendingRenamePath === node.path) {
      setIsMenuOpen(false)
      setIsRenaming(true)
    }
  }, [node.path, pendingRenamePath])

  useEffect(() => {
    if (!isMenuOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [isMenuOpen])

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-2 rounded-xl py-2 text-left text-sm text-surface-300 transition hover:bg-white/5"
          style={indentStyle}
        >
          <ChevronRight size={14} className={`text-surface-500 transition-transform ${open ? 'rotate-90' : ''}`} />
          <FolderOpen size={14} className="text-amber-300/80" />
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children?.map((child) => (
          <TreeBranch
            key={child.path}
            node={child}
            activePath={activePath}
            depth={depth + 1}
            onSelect={onSelect}
            pendingRenamePath={pendingRenamePath}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </div>
    )
  }

  const parentParts = node.path.split('/').slice(0, -1)
  const currentExtension = node.name.includes('.') ? node.name.slice(node.name.lastIndexOf('.')) : '.md'

  const handleRename = async () => {
    const nextName = renameValue.trim()
    if (!nextName || nextName === node.name) {
      setIsRenaming(false)
      return
    }

    setIsBusy(true)
    const normalizedFileName = /\.[a-z0-9]+$/i.test(nextName) ? nextName : `${nextName}${currentExtension}`
    const nextPath = [...parentParts, normalizedFileName].filter(Boolean).join('/')
    const renamed = await onRename(node.path, nextPath)
    setIsBusy(false)
    if (renamed) {
      setIsRenaming(false)
      setIsMenuOpen(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = window.confirm(`确定删除 “${node.name}” 吗？此操作不可撤销。`)
    if (!confirmed) return
    setIsBusy(true)
    const deleted = await onDelete(node.path)
    setIsBusy(false)
    if (deleted) {
      setIsMenuOpen(false)
    }
  }

  if (isRenaming) {
    return (
      <div className="relative" style={indentStyle}>
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/8 p-2">
          <input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleRename()
              }
              if (event.key === 'Escape') {
                setIsRenaming(false)
                setRenameValue(node.name)
              }
            }}
            className="input-field mb-2 h-9"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button onClick={() => void handleRename()} disabled={isBusy} className="btn-primary flex-1 py-1.5 text-xs">
              确认
            </button>
            <button
              onClick={() => {
                setIsRenaming(false)
                setRenameValue(node.name)
              }}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group relative" style={indentStyle}>
      <button
        onClick={() => onSelect(node.path)}
        className={`flex w-full items-center gap-2 rounded-xl py-2 pl-0 pr-10 text-left text-sm transition ${
          activePath === node.path
            ? 'bg-[#f59e0b]/12 text-amber-100 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)]'
            : 'text-surface-300 hover:bg-white/5'
        }`}
      >
        <FileText size={14} className={activePath === node.path ? 'text-amber-300' : 'text-surface-500'} />
        <span className="truncate">{node.name}</span>
      </button>

      <div ref={menuRef} className="absolute inset-y-0 right-1 flex items-center">
        <button
          onClick={(event) => {
            event.stopPropagation()
            setIsMenuOpen((value) => !value)
          }}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
            isMenuOpen || activePath === node.path
              ? 'bg-white/10 text-surface-200'
              : 'text-surface-500 opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-surface-200'
          }`}
          title="更多操作"
        >
          <MoreHorizontal size={14} />
        </button>

        {isMenuOpen && (
          <FileActionsMenu
            onRename={() => {
              setIsMenuOpen(false)
              setIsRenaming(true)
            }}
            onDelete={() => void handleDelete()}
          />
        )}
      </div>
    </div>
  )
}

export default function WorkspaceFileTree({ filePaths, activePath, pendingRenamePath, onSelect, onCreate, onRename, onDelete, onCollapse }: WorkspaceFileTreeProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const tree = useMemo(() => buildTree(filePaths), [filePaths])

  const handleCreate = async () => {
    const normalizedName = draftName.trim().replace(/\\/g, '/')
    if (!normalizedName) return
    const finalName = /\.md$/i.test(normalizedName) ? normalizedName : `${normalizedName}.md`
    const created = await onCreate(finalName)
    if (!created) return
    setDraftName('')
    setIsCreating(false)
  }

  return (
    <div className="flex h-full flex-col rounded-[26px] border border-surface-700/35 bg-[#0d1420]/88 p-3">
      <div className="mb-3 flex items-center justify-between px-1">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-surface-500">Workspace</div>
          <div className="mt-1 text-sm font-medium text-surface-200">文档树</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCreating((value) => !value)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-surface-300 transition hover:bg-white/10 hover:text-white"
            title="新建文档"
          >
            <Plus size={16} />
          </button>
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-surface-300 transition hover:bg-white/10 hover:text-white"
              title="收起工作区"
            >
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>
      </div>

      {isCreating && (
        <div className="mb-3 rounded-2xl border border-amber-400/20 bg-amber-400/8 p-2.5">
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleCreate()
              }
              if (event.key === 'Escape') {
                setIsCreating(false)
                setDraftName('')
              }
            }}
            placeholder="例如 docs/PRD.md"
            className="input-field mb-2 h-10"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button onClick={() => void handleCreate()} className="btn-primary flex-1 py-2">
              创建
            </button>
            <button
              onClick={() => {
                setIsCreating(false)
                setDraftName('')
              }}
              className="btn-ghost"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        {tree.length > 0 ? (
          <div className="space-y-1">
            {tree.map((node) => (
              <TreeBranch
                key={node.path}
                node={node}
                activePath={activePath}
                depth={0}
                onSelect={onSelect}
                pendingRenamePath={pendingRenamePath}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-center text-sm text-surface-500">
            当前工作区还没有 Markdown 文档，点击右上角创建一份。
          </div>
        )}
      </div>
    </div>
  )
}
