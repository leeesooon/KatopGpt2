import { useEffect, useState } from 'react'
import {
  X, Eye, EyeOff, CheckCircle, AlertCircle, Loader2,
  Plus, Trash2, ChevronDown, ChevronUp, Server, ImageIcon, Sparkles, Download,
} from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { testApiConnection } from '../services/chatApi'
import type {
  ApiProvider,
  ImageGenerationQuality,
  ImageGenerationSize,
  ModelConfig,
  PresentationRenderToolsStatus,
} from '../types'
import { openExternalUrl } from '../utils/externalLinks'

interface ProviderFormData {
  name: string
  baseUrl: string
  apiKey: string
  models: ModelConfig[]
  modelInput: string
}

interface ConnectionTestState {
  status: 'success' | 'error'
  message?: string
}

const imageSizeLabels: Record<ImageGenerationSize, string> = {
  '1024x1024': '1024×1024 方图',
  '1024x1536': '1024×1536 竖图',
  '1536x1024': '1536×1024 横图',
}

const imageSizeHints: Record<ImageGenerationSize, string> = {
  '1024x1024': '适合头像、图标、社媒配图',
  '1024x1536': '竖图比例，适合海报和手机封面',
  '1536x1024': '横图比例，适合横幅和桌面场景',
}

const imageQualityLabels: Record<ImageGenerationQuality, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
}

const imageQualityHints: Record<ImageGenerationQuality, string> = {
  auto: '自动（推荐）',
  low: '低质量通常更快',
  medium: '中等质量，速度和效果较均衡',
  high: '高质量可能明显变慢',
}

function emptyForm(): ProviderFormData {
  return { name: '', baseUrl: '', apiKey: '', models: [], modelInput: '' }
}

function fromProvider(p: ApiProvider): ProviderFormData {
  return { name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey, models: [...p.models], modelInput: '' }
}

export default function SettingsModal() {
  const {
    settings, updateSettings, isSettingsOpen, setSettingsOpen,
    addProvider, updateProvider, deleteProvider,
  } = useChatStore()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editForms, setEditForms] = useState<Record<string, ProviderFormData>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestState>>({})

  // New provider form
  const [isAdding, setIsAdding] = useState(false)
  const [newForm, setNewForm] = useState<ProviderFormData>(emptyForm())
  const [newShowKey, setNewShowKey] = useState(false)

  // General settings
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt)
  const [temperature, setTemperature] = useState(settings.temperature)
  const [maxTokens, setMaxTokens] = useState(settings.maxTokens)
  const [contextWindowSize, setContextWindowSize] = useState(settings.contextWindowSize)
  const [searchEngine, setSearchEngine] = useState(settings.searchEngine)
  const [serperApiKey, setSerperApiKey] = useState(settings.serperApiKey)
  const [tavilyApiKey, setTavilyApiKey] = useState(settings.tavilyApiKey)
  const [enableSearchByDefault, setEnableSearchByDefault] = useState(settings.enableSearchByDefault)
  const [showSerperKey, setShowSerperKey] = useState(false)
  const [showTavilyKey, setShowTavilyKey] = useState(false)
  const [imageProviderId, setImageProviderId] = useState(settings.imageGeneration.providerId ?? '')
  const [imageModel, setImageModel] = useState(settings.imageGeneration.model ?? '')
  const [imagePlannerProviderId, setImagePlannerProviderId] = useState(settings.imageGeneration.plannerProviderId ?? '')
  const [imagePlannerModel, setImagePlannerModel] = useState(settings.imageGeneration.plannerModel ?? '')
  const [imageSize, setImageSize] = useState<ImageGenerationSize>(settings.imageGeneration.size)
  const [imageQuality, setImageQuality] = useState<ImageGenerationQuality>(settings.imageGeneration.quality)
  const [presentationToolsStatus, setPresentationToolsStatus] = useState<PresentationRenderToolsStatus | null>(null)
  const [isCheckingPresentationTools, setIsCheckingPresentationTools] = useState(false)
  const [isInstallingPresentationTools, setIsInstallingPresentationTools] = useState(false)
  const [presentationToolsMessage, setPresentationToolsMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isSettingsOpen) return
    void handleCheckPresentationTools()
  }, [isSettingsOpen])

  if (!isSettingsOpen) return null

  const getForm = (p: ApiProvider): ProviderFormData => {
    return editForms[p.id] ?? fromProvider(p)
  }

  const setForm = (id: string, form: ProviderFormData) => {
    setEditForms((prev) => ({ ...prev, [id]: form }))
  }

  const handleToggle = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
    } else {
      setExpandedId(id)
      const p = settings.providers.find((x) => x.id === id)
      if (p && !editForms[id]) {
        setForm(id, fromProvider(p))
      }
    }
  }

  const handleAddModel = (form: ProviderFormData, setFn: (f: ProviderFormData) => void) => {
    const modelName = form.modelInput.trim()
    if (!modelName || form.models.some((m) => m.name === modelName)) return
    setFn({ ...form, models: [...form.models, { name: modelName, multimodal: false, capabilities: { chat: true, vision: false, imageGeneration: false } }], modelInput: '' })
  }

  const handleRemoveModel = (form: ProviderFormData, setFn: (f: ProviderFormData) => void, modelName: string) => {
    setFn({ ...form, models: form.models.filter((m) => m.name !== modelName) })
  }

  const handleToggleMultimodal = (form: ProviderFormData, setFn: (f: ProviderFormData) => void, modelName: string) => {
    setFn({
      ...form,
      models: form.models.map((m) =>
        m.name === modelName ? {
          ...m,
          multimodal: !m.multimodal,
          capabilities: { ...m.capabilities, chat: true, vision: !m.multimodal },
        } : m
      ),
    })
  }

  const handleToggleImageGeneration = (form: ProviderFormData, setFn: (f: ProviderFormData) => void, modelName: string) => {
    setFn({
      ...form,
      models: form.models.map((m) =>
        m.name === modelName ? {
          ...m,
          capabilities: { ...m.capabilities, chat: true, imageGeneration: !(m.capabilities?.imageGeneration ?? false) },
        } : m
      ),
    })
  }

  const handleModelKeyDown = (e: React.KeyboardEvent, form: ProviderFormData, setFn: (f: ProviderFormData) => void) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddModel(form, setFn)
    }
  }

  const handleSaveProvider = (id: string) => {
    const form = editForms[id]
    if (!form) return
    updateProvider(id, {
      name: form.name,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      models: form.models,
    })
    setEditForms((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setExpandedId(null)
  }

  const handleAddProvider = () => {
    if (!newForm.name.trim() || !newForm.baseUrl.trim()) return
    addProvider({
      name: newForm.name.trim(),
      baseUrl: newForm.baseUrl.trim(),
      apiKey: newForm.apiKey.trim(),
      models: newForm.models,
    })
    setNewForm(emptyForm())
    setIsAdding(false)
  }

  const handleDeleteProvider = (id: string) => {
    deleteProvider(id)
    setExpandedId(null)
  }

  const handleTest = async (baseUrl: string, apiKey: string, key: string) => {
    setTesting((p) => ({ ...p, [key]: true }))
    setTestResults((p) => { const n = { ...p }; delete n[key]; return n })
    try {
      const result = await testApiConnection({ baseUrl, apiKey })
      setTestResults((p) => ({
        ...p,
        [key]: result.ok
          ? { status: 'success' }
          : { status: 'error', message: result.error ?? '连接失败' },
      }))
    } catch (error) {
      setTestResults((p) => ({
        ...p,
        [key]: {
          status: 'error',
          message: error instanceof Error ? error.message : '连接失败',
        },
      }))
    } finally {
      setTesting((p) => ({ ...p, [key]: false }))
    }
  }

  const handleSaveGeneral = () => {
    updateSettings({
      systemPrompt,
      temperature,
      maxTokens,
      contextWindowSize,
      searchEngine,
      serperApiKey,
      tavilyApiKey,
      enableSearchByDefault,
      imageGeneration: {
        providerId: imageProviderId || undefined,
        model: imageModel || undefined,
        plannerProviderId: imagePlannerProviderId || undefined,
        plannerModel: imagePlannerModel || undefined,
        size: imageSize,
        quality: imageQuality,
        count: 1,
      },
    })
    setSettingsOpen(false)
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setSettingsOpen(false)
  }

  const handleExternalLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    e.preventDefault()
    openExternalUrl(url)
  }

  async function handleCheckPresentationTools() {
    if (!window.electronAPI?.checkPresentationRenderTools) {
      setPresentationToolsStatus({
        ok: false,
        missing: ['soffice', 'pdftoppm'],
        message: '当前环境不是桌面版应用，无法检测或安装 PPT 渲染依赖。',
      })
      return
    }

    setIsCheckingPresentationTools(true)
    setPresentationToolsMessage(null)
    try {
      const result = await window.electronAPI.checkPresentationRenderTools()
      setPresentationToolsStatus(result)
    } catch (error) {
      setPresentationToolsMessage(error instanceof Error ? error.message : '检测 PPT 渲染依赖失败。')
    } finally {
      setIsCheckingPresentationTools(false)
    }
  }

  async function handleInstallPresentationTools() {
    if (!window.electronAPI?.installPresentationRenderTools) {
      setPresentationToolsMessage('当前环境暂不支持自动安装，请手动安装 LibreOffice 和 Poppler。')
      return
    }

    setIsInstallingPresentationTools(true)
    setPresentationToolsMessage('正在打开安装窗口，请按窗口提示授权并等待安装完成...')
    try {
      const result = await window.electronAPI.installPresentationRenderTools()
      if (result.status) {
        setPresentationToolsStatus(result.status)
      } else {
        await handleCheckPresentationTools()
      }
      setPresentationToolsMessage(result.started ? `${result.message}\n安装完成后请点击“重新检测”。` : result.message)
    } catch (error) {
      setPresentationToolsMessage(error instanceof Error ? error.message : '自动安装 PPT 渲染依赖失败。')
    } finally {
      setIsInstallingPresentationTools(false)
    }
  }

  const renderModelTags = (form: ProviderFormData, setFn: (f: ProviderFormData) => void) => (
    <div className="space-y-2">
      <label className="text-xs font-medium text-surface-400">模型列表</label>
      <div className="flex flex-wrap gap-1.5 min-h-[32px]">
        {form.models.map((model) => (
          <span
            key={model.name}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-600/15 border border-primary-500/25
                       text-primary-300 text-xs rounded-md font-mono"
          >
            {model.name}
            <button
              onClick={() => handleToggleMultimodal(form, setFn, model.name)}
              className={`ml-0.5 p-0.5 rounded transition-colors ${
                model.multimodal
                  ? 'text-emerald-400 hover:text-emerald-300'
                  : 'text-surface-500 hover:text-surface-300'
              }`}
              title={model.multimodal ? '多模态已开启' : '点击开启多模态'}
            >
              <ImageIcon size={11} />
            </button>
            <button
              onClick={() => handleToggleImageGeneration(form, setFn, model.name)}
              className={`ml-0.5 p-0.5 rounded transition-colors ${
                model.capabilities?.imageGeneration
                  ? 'text-fuchsia-400 hover:text-fuchsia-300'
                  : 'text-surface-500 hover:text-surface-300'
              }`}
              title={model.capabilities?.imageGeneration ? '生图已开启' : '点击开启生图'}
            >
              <Sparkles size={11} />
            </button>
            <button
              onClick={() => handleRemoveModel(form, setFn, model.name)}
              className="hover:text-red-400 transition-colors ml-0.5"
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={form.modelInput}
          onChange={(e) => setFn({ ...form, modelInput: e.target.value })}
          onKeyDown={(e) => handleModelKeyDown(e, form, setFn)}
          placeholder="输入模型名后回车添加，如 gpt-4o"
          className="input-field flex-1"
        />
        <button
          onClick={() => handleAddModel(form, setFn)}
          disabled={!form.modelInput.trim()}
          className="btn-ghost border border-surface-600/50 text-xs px-3 disabled:opacity-30"
        >
          添加
        </button>
      </div>
    </div>
  )

  const renderApiFields = (
    form: ProviderFormData,
    setFn: (f: ProviderFormData) => void,
    keyId: string,
  ) => {
    const testResult = testResults[keyId]

    return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-surface-400">名称</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setFn({ ...form, name: e.target.value })}
          placeholder="如：OpenAI、DeepSeek"
          className="input-field"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-surface-400">Base URL</label>
        <input
          type="text"
          value={form.baseUrl}
          onChange={(e) => setFn({ ...form, baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
          className="input-field"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-surface-400">API Key</label>
        <div className="relative">
          <input
            type={showKeys[keyId] || (keyId === '__new' && newShowKey) ? 'text' : 'password'}
            value={form.apiKey}
            onChange={(e) => setFn({ ...form, apiKey: e.target.value })}
            placeholder="sk-..."
            className="input-field pr-10"
          />
          <button
            onClick={() => {
              if (keyId === '__new') setNewShowKey(!newShowKey)
              else setShowKeys((p) => ({ ...p, [keyId]: !p[keyId] }))
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-surface-700/50 rounded transition-colors"
          >
            {(keyId === '__new' ? newShowKey : showKeys[keyId]) ? (
              <EyeOff size={14} className="text-surface-400" />
            ) : (
              <Eye size={14} className="text-surface-400" />
            )}
          </button>
        </div>
      </div>
      {renderModelTags(form, setFn)}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => handleTest(form.baseUrl, form.apiKey, keyId)}
          disabled={testing[keyId] || !form.apiKey.trim() || !form.baseUrl.trim()}
          className="btn-ghost border border-surface-600/50 flex items-center gap-2 text-xs disabled:opacity-40"
        >
          {testing[keyId] ? <Loader2 size={13} className="animate-spin" /> : null}
          测试连接
        </button>
        {testResult?.status === 'success' && (
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <CheckCircle size={13} /> 连接成功
          </span>
        )}
        {testResult?.status === 'error' && (
          <div className="flex flex-col gap-1 text-xs text-red-400 min-w-0">
            <span className="flex items-center gap-1">
              <AlertCircle size={13} /> 连接失败
            </span>
            {testResult.message && (
              <span className="text-[11px] text-red-300/80 break-all">
                {testResult.message}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={handleOverlayClick}
    >
      <div className="w-full max-w-2xl mx-4 glass-panel rounded-2xl shadow-2xl animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700/50">
          <h2 className="text-lg font-semibold text-surface-100">设置</h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="p-1.5 hover:bg-surface-700/50 rounded-lg transition-colors"
          >
            <X size={18} className="text-surface-400" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* === API Providers === */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
                API 服务商
              </h3>
              {!isAdding && (
                <button
                  onClick={() => setIsAdding(true)}
                  className="btn-ghost text-xs flex items-center gap-1 text-primary-400 hover:text-primary-300"
                >
                  <Plus size={14} /> 添加
                </button>
              )}
            </div>

            {/* Existing providers */}
            {settings.providers.map((p) => {
              const isExpanded = expandedId === p.id
              const form = getForm(p)
              return (
                <div
                  key={p.id}
                  className="border border-surface-700/50 rounded-xl overflow-hidden bg-surface-800/30"
                >
                  <button
                    onClick={() => handleToggle(p.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-700/20 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <Server size={15} className="text-primary-400" />
                      <span className="text-sm font-medium text-surface-200">{p.name}</span>
                      <span className="text-[11px] text-surface-500 font-mono">
                        {p.models.length} 个模型
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp size={15} className="text-surface-400" />
                    ) : (
                      <ChevronDown size={15} className="text-surface-400" />
                    )}
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-surface-700/30 space-y-3 animate-fade-in">
                      {renderApiFields(form, (f) => setForm(p.id, f), p.id)}
                      <div className="flex items-center justify-between pt-2">
                        <button
                          onClick={() => handleDeleteProvider(p.id)}
                          className="btn-ghost text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                        >
                          <Trash2 size={13} /> 删除
                        </button>
                        <div className="flex gap-2">
                          <button onClick={() => setExpandedId(null)} className="btn-ghost text-xs">
                            取消
                          </button>
                          <button
                            onClick={() => handleSaveProvider(p.id)}
                            disabled={!form.name.trim() || !form.baseUrl.trim()}
                            className="btn-primary text-xs px-3 py-1.5"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Add new provider form */}
            {isAdding && (
              <div className="border border-primary-500/30 rounded-xl p-4 bg-primary-600/5 space-y-3 animate-fade-in">
                <h4 className="text-sm font-medium text-primary-300">添加新服务商</h4>
                {renderApiFields(newForm, setNewForm, '__new')}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => { setIsAdding(false); setNewForm(emptyForm()) }}
                    className="btn-ghost text-xs"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleAddProvider}
                    disabled={!newForm.name.trim() || !newForm.baseUrl.trim()}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    添加
                  </button>
                </div>
              </div>
            )}

            {settings.providers.length === 0 && !isAdding && (
              <div className="text-center py-6 text-surface-500 text-sm">
                还没有配置 API 服务商，点击上方「添加」开始
              </div>
            )}

          </section>

          {/* === Web Search Settings === */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
              网络搜索
            </h3>

            {/* Search Engine Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-surface-400">搜索引擎</label>
              <select
                value={searchEngine}
                onChange={(e) => setSearchEngine(e.target.value as 'serper' | 'tavily')}
                className="input-field"
              >
                <option value="tavily">Tavily（推荐，免费1000次/月）</option>
                <option value="serper">Serper（免费2500次/月）</option>
              </select>
              <p className="text-[10px] text-surface-500">
                Tavily 专为 AI 优化，注册简单。Serper 提供 Google 搜索结果。
              </p>
            </div>

            {/* Tavily API Key */}
            {searchEngine === 'tavily' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-surface-400">Tavily API Key</label>
                <div className="relative">
                  <input
                    type={showTavilyKey ? 'text' : 'password'}
                    value={tavilyApiKey}
                    onChange={(e) => setTavilyApiKey(e.target.value)}
                    placeholder="输入 Tavily API Key"
                    className="input-field pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTavilyKey(!showTavilyKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-surface-700/50 rounded transition-colors"
                  >
                    {showTavilyKey ? <EyeOff size={14} className="text-surface-400" /> : <Eye size={14} className="text-surface-400" />}
                  </button>
                </div>
                <p className="text-[10px] text-surface-500">
                  免费额度：1000次/月。
                  <a
                    href="https://tavily.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-400 hover:underline ml-1"
                    onClick={(e) => handleExternalLinkClick(e, 'https://tavily.com')}
                  >
                    获取 API Key
                  </a>
                </p>
              </div>
            )}

            {/* Serper API Key */}
            {searchEngine === 'serper' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-surface-400">Serper API Key</label>
                <div className="relative">
                  <input
                    type={showSerperKey ? 'text' : 'password'}
                    value={serperApiKey}
                    onChange={(e) => setSerperApiKey(e.target.value)}
                    placeholder="输入 Serper API Key"
                    className="input-field pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSerperKey(!showSerperKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-surface-700/50 rounded transition-colors"
                  >
                    {showSerperKey ? <EyeOff size={14} className="text-surface-400" /> : <Eye size={14} className="text-surface-400" />}
                  </button>
                </div>
                <p className="text-[10px] text-surface-500">
                  免费额度：2500次/月。
                  <a
                    href="https://serper.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-400 hover:underline ml-1"
                    onClick={(e) => handleExternalLinkClick(e, 'https://serper.dev')}
                  >
                    获取 API Key
                  </a>
                </p>
              </div>
            )}

            {/* Enable Search by Default */}
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <label className="text-xs font-medium text-surface-400">默认启用网络搜索</label>
                <p className="text-[10px] text-surface-500 mt-0.5">
                  自动检测需要搜索的问题并联网查询
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEnableSearchByDefault(!enableSearchByDefault)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  enableSearchByDefault ? 'bg-primary-500' : 'bg-surface-600'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    enableSearchByDefault ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
              PPT 助手依赖
            </h3>
            <div className={`rounded-2xl border p-4 ${
              presentationToolsStatus?.ok
                ? 'border-emerald-300/20 bg-emerald-400/10'
                : 'border-amber-300/20 bg-amber-400/10'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                  presentationToolsStatus?.ok
                    ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
                    : 'border-amber-300/25 bg-amber-300/10 text-amber-100'
                }`}>
                  {isCheckingPresentationTools || isInstallingPresentationTools
                    ? <Loader2 size={16} className="animate-spin" />
                    : presentationToolsStatus?.ok
                      ? <CheckCircle size={16} />
                      : <AlertCircle size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-surface-100">
                    真实预览与高质量导出
                  </div>
                  <p className="mt-1 text-xs leading-5 text-surface-400">
                    {presentationToolsStatus
                      ? presentationToolsStatus.message
                      : '正在检测 LibreOffice soffice 和 Poppler pdftoppm...'}
                  </p>
                  {presentationToolsStatus && (presentationToolsStatus.sofficePath || presentationToolsStatus.pdftoppmPath) && (
                    <div className="mt-2 space-y-1 text-[11px] text-surface-500">
                      {presentationToolsStatus.sofficePath && (
                        <div className="truncate">soffice：{presentationToolsStatus.sofficePath}</div>
                      )}
                      {presentationToolsStatus.pdftoppmPath && (
                        <div className="truncate">pdftoppm：{presentationToolsStatus.pdftoppmPath}</div>
                      )}
                    </div>
                  )}
                  {presentationToolsMessage && (
                    <div className="mt-2 rounded-xl border border-white/10 bg-black/20 px-2 py-1.5 text-xs leading-5 text-surface-300">
                      {presentationToolsMessage}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => void handleCheckPresentationTools()}
                  disabled={isCheckingPresentationTools || isInstallingPresentationTools}
                  className="btn-ghost border border-surface-600/50 text-xs disabled:opacity-40"
                >
                  重新检测
                </button>
                <button
                  onClick={() => void handleInstallPresentationTools()}
                  disabled={isInstallingPresentationTools || presentationToolsStatus?.ok === true}
                  className="btn-primary inline-flex items-center gap-2 text-xs disabled:opacity-40"
                >
                  {isInstallingPresentationTools ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  一键安装依赖
                </button>
              </div>
              <p className="mt-2 text-[10px] leading-4 text-surface-500">
                Windows 下会打开 PowerShell，并使用 winget 安装固定包：TheDocumentFoundation.LibreOffice 和 oschwartz10612.Poppler；安装器可能按系统策略请求管理员授权。
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
              生图模式
            </h3>
            <div className={`rounded-xl border px-3 py-2.5 ${
              imageQuality === 'high'
                ? 'border-amber-300/25 bg-amber-300/10'
                : 'border-fuchsia-300/15 bg-fuchsia-300/10'
            }`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-surface-100">
                  当前生图参数：尺寸 {imageSizeLabels[imageSize]} / 质量 {imageQualityLabels[imageQuality]}
                </span>
                <span className={imageQuality === 'high' ? 'text-amber-200' : 'text-surface-400'}>
                  {imageQualityHints[imageQuality]}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-surface-500">
                {imageSizeHints[imageSize]}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-surface-400">生图服务商</label>
                <select
                  value={imageProviderId}
                  onChange={(e) => {
                    setImageProviderId(e.target.value)
                    setImageModel('')
                  }}
                  className="input-field"
                >
                  <option value="">自动选择已开启生图的模型</option>
                  {settings.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-surface-400">生图模型</label>
                <select
                  value={imageModel}
                  onChange={(e) => setImageModel(e.target.value)}
                  className="input-field"
                >
                  <option value="">自动选择</option>
                  {(settings.providers.find((provider) => provider.id === imageProviderId)?.models ?? [])
                    .map((model) => <option key={model.name} value={model.name}>{model.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-surface-400">章节总结服务商</label>
                <select
                  value={imagePlannerProviderId}
                  onChange={(e) => {
                    setImagePlannerProviderId(e.target.value)
                    setImagePlannerModel('')
                  }}
                  className="input-field"
                >
                  <option value="">使用当前聊天模型</option>
                  {settings.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-surface-400">章节总结模型</label>
                <select
                  value={imagePlannerModel}
                  onChange={(e) => setImagePlannerModel(e.target.value)}
                  className="input-field"
                >
                  <option value="">使用当前聊天模型</option>
                  {(settings.providers.find((provider) => provider.id === imagePlannerProviderId)?.models ?? [])
                    .filter((model) => model.capabilities?.chat ?? true)
                    .map((model) => <option key={model.name} value={model.name}>{model.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-surface-400">图片尺寸</label>
                <select value={imageSize} onChange={(e) => setImageSize(e.target.value as ImageGenerationSize)} className="input-field">
                  <option value="1024x1024">1024×1024 方图</option>
                  <option value="1024x1536">1024×1536 竖图</option>
                  <option value="1536x1024">1536×1024 横图</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-surface-400">图片质量</label>
                <select value={imageQuality} onChange={(e) => setImageQuality(e.target.value as ImageGenerationQuality)} className="input-field">
                  <option value="auto">自动（推荐）</option>
                  <option value="low">低（更快）</option>
                  <option value="medium">中</option>
                  <option value="high">高（更慢）</option>
                </select>
              </div>
            </div>
            <p className="text-[10px] text-surface-500">
              使用 OpenAI 兼容的 /images/generations 接口。连续多图会用“章节总结模型”拆分网页和主题；未配置时使用当前聊天模型。
            </p>
          </section>

          {/* === General Parameters === */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
              模型参数
            </h3>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-surface-400">系统提示词</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
                placeholder="You are a helpful assistant."
                className="input-field resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-surface-400">Temperature</label>
                <span className="text-xs text-surface-500 font-mono">
                  {temperature.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-primary-500"
              />
              <div className="flex justify-between text-[10px] text-surface-500">
                <span>精确</span>
                <span>创意</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-surface-400">最大 Tokens</label>
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value) || 0)}
                min={0}
                max={128000}
                className="input-field"
              />
              <p className="text-[10px] text-surface-500">
                设为 0 则不限制，由 API 根据模型上下文长度自动决定
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-surface-400">上下文窗口（消息条数）</label>
                <span className="text-xs text-surface-500 font-mono">
                  {contextWindowSize}
                </span>
              </div>
              <input
                type="range"
                min="2"
                max="100"
                step="2"
                value={contextWindowSize}
                onChange={(e) => setContextWindowSize(parseInt(e.target.value))}
                className="w-full accent-primary-500"
              />
              <div className="flex justify-between text-[10px] text-surface-500">
                <span>省 Token</span>
                <span>多上下文</span>
              </div>
              <p className="text-[10px] text-surface-500">
                发送 API 请求时仅携带最近 N 条消息，更早的历史仍保留在本地
              </p>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-surface-700/50">
          <button onClick={() => setSettingsOpen(false)} className="btn-ghost">
            取消
          </button>
          <button onClick={handleSaveGeneral} className="btn-primary">
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
