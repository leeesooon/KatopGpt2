import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, Check, CheckCircle, Copy, FileText, Loader2, Plus, RefreshCw, Sparkles,
  Trash2, Upload, X,
} from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import type { AssistantProfile, KnowledgeDocument } from '../types'
import { createKnowledgeDocument, resolveActiveAssistantProfile } from '../services/assistantProfiles'
import { ROLE_AVATAR_CATEGORIES, ROLE_AVATAR_DEFINITIONS } from '../services/roleAvatars'
import type { RoleAvatarCategory } from '../services/roleAvatars'
import RoleAvatar from './RoleAvatar'
import {
  buildAttachmentContentFields,
  formatFileSize,
  isExtractableDocument,
  looksLikeBinaryText,
  validateAttachmentFile,
} from './inputAreaAttachments'

type AssistantTab = 'profile' | 'knowledge'

interface ProfileForm {
  name: string
  description: string
  emoji: string
  avatarId?: string
  instructions: string
  tone: string
  outputFormat: string
  domainHints: string
  isVisible: boolean
}

interface UploadState {
  status: 'idle' | 'processing' | 'error'
  message?: string
}

interface SaveState {
  status: 'idle' | 'saved'
  message?: string
}

function profileToForm(profile: AssistantProfile): ProfileForm {
  return {
    name: profile.name,
    description: profile.description,
    emoji: profile.emoji,
    avatarId: profile.avatarId,
    instructions: profile.instructions,
    tone: profile.tone,
    outputFormat: profile.outputFormat,
    domainHints: profile.domainHints,
    isVisible: !profile.isHidden,
  }
}

function createEmptyForm(): ProfileForm {
  return {
    name: '我的助手',
    description: '描述这个助手适合处理什么任务。',
    emoji: '★',
    avatarId: 'assistant-general',
    instructions: '说明这个助手应该如何理解问题、遵守哪些规则、避免哪些行为。',
    tone: '清晰、直接、可执行。',
    outputFormat: '先给结论，再给必要步骤。',
    domainHints: '',
    isVisible: true,
  }
}

function createId() {
  return crypto.randomUUID()
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
    reader.readAsText(file)
  })
}

function readFileAsArrayBuffer(file: File) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
    reader.readAsArrayBuffer(file)
  })
}

async function extractKnowledgeContent(file: File) {
  if (isExtractableDocument(file)) {
    if (!window.electronAPI?.extractDocumentText) {
      throw new Error('当前环境暂不支持自动提取该文档，请使用桌面版应用')
    }

    const data = await readFileAsArrayBuffer(file)
    const result = await window.electronAPI.extractDocumentText({
      fileName: file.name,
      mimeType: file.type,
      data,
    })

    if (!result.ok || !result.content) {
      throw new Error(result.error ?? '自动提取文本失败')
    }

    return {
      content: result.content,
      fileType: result.fileType,
    }
  }

  const content = await readFileAsText(file)
  if (looksLikeBinaryText(content)) {
    throw new Error('该文件看起来是二进制内容，请上传可解析的文档或文本文件')
  }

  return {
    content,
    fileType: 'text' as const,
  }
}

export default function AssistantProfileModal() {
  const {
    settings,
    isAssistantProfilesOpen,
    setAssistantProfilesOpen,
    createAssistantProfile,
    updateAssistantProfile,
    duplicateAssistantProfile,
    deleteAssistantProfile,
    resetAssistantProfile,
    setDefaultAssistantProfile,
    addKnowledgeDocument,
    updateKnowledgeDocument,
    deleteKnowledgeDocument,
  } = useChatStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<AssistantTab>('profile')
  const [selectedProfileId, setSelectedProfileId] = useState(() => resolveActiveAssistantProfile(settings)?.id ?? 'builtin-general')
  const [drafts, setDrafts] = useState<Record<string, ProfileForm>>({})
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' })
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })
  const [avatarCategory, setAvatarCategory] = useState<RoleAvatarCategory>('common')
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false)

  const allProfiles = settings.assistantProfiles
  const selectedProfile = allProfiles.find((profile) => profile.id === selectedProfileId)
    ?? resolveActiveAssistantProfile(settings)
    ?? allProfiles[0]
  const selectedForm = selectedProfile
    ? drafts[selectedProfile.id] ?? profileToForm(selectedProfile)
    : createEmptyForm()
  const defaultProfile = resolveActiveAssistantProfile(settings)
  const builtInProfiles = allProfiles.filter((profile) => profile.isBuiltIn)
  const customProfiles = allProfiles.filter((profile) => !profile.isBuiltIn)
  const avatarOptions = useMemo(
    () => ROLE_AVATAR_DEFINITIONS.filter((avatar) => avatar.category === avatarCategory),
    [avatarCategory]
  )

  const knowledgeStats = useMemo(() => {
    if (!selectedProfile) return { enabledCount: 0, chunkCount: 0 }
    return selectedProfile.knowledgeDocuments.reduce(
      (stats, document) => ({
        enabledCount: stats.enabledCount + (document.enabled ? 1 : 0),
        chunkCount: stats.chunkCount + (document.enabled ? document.chunks.length : 0),
      }),
      { enabledCount: 0, chunkCount: 0 }
    )
  }, [selectedProfile])

  useEffect(() => {
    if (saveState.status !== 'saved') return
    const timeoutId = window.setTimeout(() => {
      setSaveState({ status: 'idle' })
    }, 1600)
    return () => window.clearTimeout(timeoutId)
  }, [saveState.status])

  if (!isAssistantProfilesOpen) return null

  const setSelectedForm = (form: ProfileForm) => {
    if (!selectedProfile) return
    setDrafts((current) => ({ ...current, [selectedProfile.id]: form }))
  }

  const handleOverlayClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      setAssistantProfilesOpen(false)
    }
  }

  const handleSaveProfile = () => {
    if (!selectedProfile) return
    const { isVisible, ...profileUpdates } = selectedForm
    updateAssistantProfile(selectedProfile.id, {
      ...profileUpdates,
      isHidden: !isVisible,
    })
    setDrafts((current) => {
      const next = { ...current }
      delete next[selectedProfile.id]
      return next
    })
    setSaveState({ status: 'saved', message: '配置已保存' })
  }

  const handleCreateProfile = () => {
    const { isVisible, ...emptyProfile } = createEmptyForm()
    const newId = createAssistantProfile({
      ...emptyProfile,
      isDefault: false,
      isBuiltIn: false,
      isHidden: !isVisible,
    })
    setSelectedProfileId(newId)
    setActiveTab('profile')
    setIsAvatarPickerOpen(false)
  }

  const handleDuplicateProfile = () => {
    if (!selectedProfile) return
    const newId = duplicateAssistantProfile(selectedProfile.id)
    if (newId) {
      setSelectedProfileId(newId)
      setActiveTab('profile')
    }
  }

  const handleDeleteProfile = () => {
    if (!selectedProfile) return
    deleteAssistantProfile(selectedProfile.id)
    const fallback = allProfiles.find((profile) => profile.id !== selectedProfile.id && profile.isDefault && !profile.isHidden)
      ?? allProfiles.find((profile) => profile.id !== selectedProfile.id && !profile.isHidden)
    setSelectedProfileId(fallback?.id ?? 'builtin-general')
  }

  const handleSetDefaultProfile = (profileId: string) => {
    setDefaultAssistantProfile(profileId)
    setSelectedProfileId(profileId)
    setSaveState({ status: 'saved', message: '已设为默认角色' })
  }

  const handleFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!selectedProfile || files.length === 0) return

    for (const file of files) {
      const validationError = validateAttachmentFile(file)
      if (validationError) {
        setUploadState({ status: 'error', message: `${file.name}：${validationError}` })
        continue
      }

      try {
        setUploadState({ status: 'processing', message: `正在处理 ${file.name}` })
        const extracted = await extractKnowledgeContent(file)
        const fields = buildAttachmentContentFields(extracted.content)
        const document = createKnowledgeDocument(
          createId(),
          file.name,
          file.size,
          fields.contextContent,
          extracted.fileType
        )
        addKnowledgeDocument(selectedProfile.id, document)
        setUploadState({
          status: 'idle',
          message: document.chunks.length > 0
            ? `已添加 ${file.name}，生成 ${document.chunks.length} 个知识片段`
            : `已添加 ${file.name}`,
        })
      } catch (error) {
        setUploadState({
          status: 'error',
          message: error instanceof Error ? `${file.name}：${error.message}` : `${file.name}：处理失败`,
        })
      }
    }
  }

  const renderProfileButton = (profile: AssistantProfile) => {
    const isSelected = selectedProfile?.id === profile.id
    const isDefault = defaultProfile?.id === profile.id
    return (
      <button
        key={profile.id}
        onClick={() => {
          setSelectedProfileId(profile.id)
          setIsAvatarPickerOpen(false)
        }}
        className={`group w-full rounded-xl border px-3 py-2.5 text-left transition ${
          isSelected
            ? 'border-primary-400/35 bg-primary-500/12'
            : profile.isHidden
              ? 'border-white/5 bg-white/[0.015] opacity-60 hover:border-white/10 hover:bg-white/[0.04]'
              : 'border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]'
        }`}
      >
        <div className="flex items-start gap-2.5">
          <RoleAvatar avatarId={profile.avatarId} emoji={profile.emoji} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-surface-100">{profile.name}</span>
              {isDefault && <Check size={13} className="shrink-0 text-emerald-300" />}
              {profile.isHidden && (
                <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-surface-500">
                  已隐藏
                </span>
              )}
            </span>
            <span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-surface-500">
              {profile.description || '未填写简介'}
            </span>
          </span>
        </div>
      </button>
    )
  }

  const renderField = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options?: { rows?: number; placeholder?: string }
  ) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-surface-400">{label}</label>
      {options?.rows ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={options.rows}
          placeholder={options.placeholder}
          className="input-field resize-none"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={options?.placeholder}
          className="input-field"
        />
      )}
    </div>
  )

  const renderAvatarPicker = () => (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setIsAvatarPickerOpen((open) => !open)}
          className="rounded-2xl border border-amber-300/20 bg-black/20 p-2 transition hover:border-amber-200/40 hover:bg-amber-300/10"
          title="打开头像选择"
        >
          <RoleAvatar avatarId={selectedForm.avatarId} emoji={selectedForm.emoji} size="lg" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-surface-300">头像选择</div>
              <div className="mt-0.5 text-[11px] text-surface-500">
                使用可爱动物头像；也可以清除预设后改用自定义标识。
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsAvatarPickerOpen((open) => !open)}
              className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-surface-300 transition hover:bg-white/10 hover:text-white"
            >
              {isAvatarPickerOpen ? '收起' : '选择头像'}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-[108px_1fr] gap-3">
            {renderField('自定义标识', selectedForm.emoji, (emoji) => setSelectedForm({ ...selectedForm, emoji }), {
              placeholder: 'emoji 或短文字',
            })}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-surface-400">回退规则</label>
              <div className="flex h-10 items-center justify-between rounded-lg border border-surface-600/50 bg-surface-800/50 px-3 text-xs text-surface-400">
                <span className="truncate">
                  {selectedForm.avatarId ? '当前优先显示预设头像' : '当前使用自定义标识'}
                </span>
                {selectedForm.avatarId && (
                  <button
                    type="button"
                    onClick={() => setSelectedForm({ ...selectedForm, avatarId: undefined })}
                    className="shrink-0 text-amber-200 transition hover:text-amber-100"
                  >
                    改用标识
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isAvatarPickerOpen && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {ROLE_AVATAR_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setAvatarCategory(category.id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  avatarCategory === category.id
                    ? 'border-amber-300/30 bg-amber-300/12 text-amber-100'
                    : 'border-white/10 bg-white/[0.03] text-surface-400 hover:bg-white/8 hover:text-white'
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {avatarOptions.map((avatar) => {
              const isSelected = selectedForm.avatarId === avatar.id
              return (
                <button
                  key={avatar.id}
                  type="button"
                  onClick={() => setSelectedForm({ ...selectedForm, avatarId: avatar.id })}
                  className={`group rounded-2xl border p-2 text-center transition ${
                    isSelected
                      ? 'border-amber-300/60 bg-amber-300/12 shadow-lg shadow-amber-950/25'
                      : 'border-white/8 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.06]'
                  }`}
                  title={avatar.name}
                >
                  <RoleAvatar avatarId={avatar.id} size="md" className="mx-auto" />
                  <div className={`mt-1 truncate text-[10px] ${isSelected ? 'text-amber-100' : 'text-surface-500 group-hover:text-surface-300'}`}>
                    {avatar.name}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  const renderKnowledgeDocument = (document: KnowledgeDocument) => (
    <div key={document.id} className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg border border-cyan-300/15 bg-cyan-300/10 p-2 text-cyan-100">
          <FileText size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-surface-100">{document.name}</p>
              <p className="mt-0.5 text-[11px] text-surface-500">
                {formatFileSize(document.size)} · {document.chunks.length} 个片段
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => updateKnowledgeDocument(selectedProfile!.id, document.id, { enabled: !document.enabled })}
                className={`rounded-full px-2 py-1 text-[11px] transition ${
                  document.enabled
                    ? 'bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/15'
                    : 'bg-surface-700/50 text-surface-400 hover:text-surface-200'
                }`}
              >
                {document.enabled ? '已启用' : '已停用'}
              </button>
              <button
                onClick={() => deleteKnowledgeDocument(selectedProfile!.id, document.id)}
                className="rounded-lg p-1.5 text-surface-500 transition hover:bg-red-500/15 hover:text-red-300"
                title="删除知识资料"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-surface-400">
            {document.chunks[0]?.content ?? '未提取到可用文本'}
          </p>
        </div>
      </div>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
      onClick={handleOverlayClick}
    >
      <div className="glass-panel flex h-[82vh] w-full max-w-5xl overflow-hidden rounded-2xl shadow-2xl animate-slide-up">
        <aside className="flex w-72 shrink-0 flex-col border-r border-surface-700/50 bg-surface-950/25">
          <div className="border-b border-surface-700/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-surface-100">定制助手</h2>
                <p className="mt-1 text-xs text-surface-500">选择角色、配置规则和知识资料</p>
              </div>
              <button
                onClick={() => setAssistantProfilesOpen(false)}
                className="rounded-lg p-1.5 text-surface-400 transition hover:bg-white/10 hover:text-white"
              >
                <X size={17} />
              </button>
            </div>
            <button
              onClick={handleCreateProfile}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-primary-400/25 bg-primary-500/12 px-3 py-2 text-sm text-primary-100 transition hover:bg-primary-500/18"
            >
              <Plus size={15} />
              新建助手
            </button>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto p-3">
            <section className="space-y-2">
              <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-surface-500">常用角色</h3>
              {builtInProfiles.map(renderProfileButton)}
            </section>
            <section className="space-y-2">
              <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-surface-500">我的角色</h3>
              {customProfiles.length > 0 ? customProfiles.map(renderProfileButton) : (
                <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-surface-500">
                  还没有自定义角色
                </p>
              )}
            </section>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {selectedProfile ? (
            <>
              <header className="border-b border-surface-700/50 px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <RoleAvatar
                        avatarId={selectedForm.avatarId}
                        emoji={selectedForm.emoji || selectedProfile.emoji}
                        size="md"
                      />
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold text-surface-100">{selectedForm.name || selectedProfile.name}</h3>
                        <p className="truncate text-xs text-surface-500">
                          {selectedProfile.isBuiltIn ? '内置常用角色，可自定义配置' : '自定义角色'}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => handleSetDefaultProfile(selectedProfile.id)}
                      className="btn-primary flex items-center gap-2"
                    >
                      <Check size={14} />
                      {defaultProfile?.id === selectedProfile.id ? '默认角色' : '设为默认'}
                    </button>
                    <button onClick={handleDuplicateProfile} className="btn-ghost flex items-center gap-2">
                      <Copy size={14} />
                      复制
                    </button>
                    {selectedProfile.isBuiltIn && (
                      <button onClick={() => resetAssistantProfile(selectedProfile.id)} className="btn-ghost flex items-center gap-2">
                        <RefreshCw size={14} />
                        恢复默认
                      </button>
                    )}
                    <button onClick={handleDeleteProfile} className="btn-ghost flex items-center gap-2 text-red-300 hover:text-red-200">
                      <Trash2 size={14} />
                      删除
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  {[
                    ['profile', Sparkles, '角色设置'],
                    ['knowledge', BookOpen, '知识资料'],
                  ].map(([tab, Icon, label]) => (
                    <button
                      key={tab as string}
                      onClick={() => setActiveTab(tab as AssistantTab)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                        activeTab === tab
                          ? 'border-primary-300/25 bg-primary-300/10 text-primary-100'
                          : 'border-white/10 bg-white/5 text-surface-400 hover:text-white'
                      }`}
                    >
                      <Icon size={14} />
                      {label as string}
                    </button>
                  ))}
                </div>
              </header>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {activeTab === 'profile' ? (
                  <div className="mx-auto max-w-3xl space-y-4">
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                      <div>
                        <div className="text-xs font-medium text-surface-300">在角色选择中显示</div>
                        <div className="mt-0.5 text-[11px] text-surface-500">
                          关闭后不会出现在聊天输入区的角色列表，但仍可在这里恢复。
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedForm({ ...selectedForm, isVisible: !selectedForm.isVisible })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          selectedForm.isVisible ? 'bg-primary-500' : 'bg-surface-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            selectedForm.isVisible ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                    {renderAvatarPicker()}
                    {renderField('助手名称', selectedForm.name, (name) => setSelectedForm({ ...selectedForm, name }))}
                    {renderField('简介', selectedForm.description, (description) => setSelectedForm({ ...selectedForm, description }), {
                      placeholder: '说明这个助手适合处理什么任务',
                    })}
                    {renderField('核心指令', selectedForm.instructions, (instructions) => setSelectedForm({ ...selectedForm, instructions }), {
                      rows: 6,
                      placeholder: '这个助手应该遵守的核心规则',
                    })}
                    {renderField('回复语气', selectedForm.tone, (tone) => setSelectedForm({ ...selectedForm, tone }))}
                    {renderField('输出格式偏好', selectedForm.outputFormat, (outputFormat) => setSelectedForm({ ...selectedForm, outputFormat }))}
                    {renderField('专业领域/背景提示', selectedForm.domainHints, (domainHints) => setSelectedForm({ ...selectedForm, domainHints }), {
                      rows: 3,
                      placeholder: '可填写行业、项目背景、术语偏好等',
                    })}
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl space-y-4">
                    <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/8 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="text-sm font-semibold text-cyan-50">助手知识资料</h4>
                          <p className="mt-1 text-xs leading-5 text-surface-400">
                            上传领域资料后，聊天时会自动检索相关片段注入上下文。适合长期背景资料；临时文件仍建议直接拖到输入框。
                          </p>
                          <p className="mt-2 text-[11px] text-surface-500">
                            已启用 {knowledgeStats.enabledCount} 个文件 / {knowledgeStats.chunkCount} 个片段
                          </p>
                        </div>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadState.status === 'processing'}
                          className="btn-primary flex shrink-0 items-center gap-2 disabled:opacity-50"
                        >
                          {uploadState.status === 'processing' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                          上传资料
                        </button>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".txt,.md,.markdown,.json,.csv,.pdf,.pptx,.docx,.xlsx"
                        onChange={handleFilesSelected}
                        className="hidden"
                      />
                      {uploadState.message && (
                        <p className={`mt-3 text-xs ${uploadState.status === 'error' ? 'text-red-300' : 'text-surface-400'}`}>
                          {uploadState.message}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      {selectedProfile.knowledgeDocuments.length > 0
                        ? selectedProfile.knowledgeDocuments.map(renderKnowledgeDocument)
                        : (
                            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-12 text-center">
                              <BookOpen size={26} className="mx-auto mb-3 text-surface-500" />
                              <p className="text-sm text-surface-400">还没有知识资料</p>
                              <p className="mt-1 text-xs text-surface-500">上传 PDF、Word、PPT 或文本文件后即可作为长期知识使用。</p>
                            </div>
                          )}
                    </div>
                  </div>
                )}
              </div>

              <footer className="flex items-center justify-between border-t border-surface-700/50 px-6 py-4">
                <div className="text-xs text-surface-500">
                  默认角色：{defaultProfile?.name ?? '未选择助手'}
                  {saveState.status === 'saved' && (
                    <span className="ml-3 inline-flex items-center gap-1 text-emerald-300">
                      <CheckCircle size={13} />
                      {saveState.message ?? '已保存'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setAssistantProfilesOpen(false)} className="btn-ghost">关闭</button>
                  {activeTab === 'profile' && (
                    <button
                      onClick={handleSaveProfile}
                      disabled={!selectedForm.name.trim()}
                      className="btn-primary disabled:opacity-50"
                    >
                      保存配置
                    </button>
                  )}
                </div>
              </footer>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-surface-500">
              暂无可用助手
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
