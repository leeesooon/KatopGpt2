import type { DocumentAgentMode, DocumentSelection, WorkspaceDocument } from '../types'

interface BuildDocumentPromptOptions {
  mode: DocumentAgentMode
  userPrompt: string
  document: WorkspaceDocument | null
  selection: DocumentSelection | null
}

interface DocumentTaskDescriptor {
  prompt: string
  title: string
}

function quoteBlock(label: string, content: string) {
  return `## ${label}\n\n${content.trim()}`
}

export function buildDocumentTaskPrompt({
  mode,
  userPrompt,
  document,
  selection,
}: BuildDocumentPromptOptions): DocumentTaskDescriptor {
  const cleanPrompt = userPrompt.trim()
  const documentTitle = document?.title ?? '未命名文档'
  const documentContent = document?.content.trim() ?? ''
  const hasSelection = Boolean(selection?.text.trim())

  if (mode === 'chat') {
    return {
      prompt: cleanPrompt,
      title: '普通对话',
    }
  }

  const contextSections = [
    '你现在是一个中文 Markdown 文档代理。',
    '请直接输出可用的 Markdown 结果，不要添加多余解释，不要使用代码围栏包裹正文。',
    cleanPrompt ? quoteBlock('用户要求', cleanPrompt) : '',
    document ? quoteBlock('当前文档标题', documentTitle) : '',
    documentContent ? quoteBlock('当前文档内容', documentContent) : '',
  ].filter(Boolean)

  if (mode === 'create') {
    return {
      title: '生成 Markdown 初稿',
      prompt: [
        ...contextSections,
        '## 任务\n\n请根据用户要求生成一份结构清晰、可直接保存的 Markdown 文档初稿。需要有明确标题、分节、小标题和要点列表。',
      ].join('\n\n'),
    }
  }

  if (mode === 'rewrite') {
    const rewriteTask = hasSelection
      ? [
          '## 任务',
          '',
          '请只改写“当前选中内容”本身，输出时必须严格遵守以下要求：',
          '1. 只输出改写后的段落正文，不要添加标题、说明、前言、总结、注释或代码围栏。',
          '2. 不要输出“以下是改写结果”“修改说明”“优化版本”等提示语。',
          '3. 不要复述整篇文档，只返回这个选中片段改写后的最终内容。',
          '4. 保持原有 Markdown 语义；如果选中内容本身是列表、引用或普通段落，就按原结构返回。',
          '5. 如果用户要求不明确，也只输出可直接替换选区的版本，不要提问。',
        ].join('\n')
      : '## 任务\n\n请基于当前文档进行改写，保持 Markdown 结构自然、表达更清晰。输出只包含最终可替换的 Markdown 内容。'

    return {
      title: hasSelection ? '改写选中内容' : '改写当前文档',
      prompt: [
        ...contextSections,
        hasSelection ? quoteBlock('当前选中内容', selection!.text) : '',
        rewriteTask,
      ].filter(Boolean).join('\n\n'),
    }
  }

  if (mode === 'expand') {
    return {
      title: '扩写当前文档',
      prompt: [
        ...contextSections,
        '## 任务\n\n请在保留原有结构和语气的基础上扩写当前文档，使其更完整、更可执行。输出完整 Markdown 成稿。',
      ].join('\n\n'),
    }
  }

  return {
    title: '总结当前文档',
    prompt: [
      ...contextSections,
      '## 任务\n\n请把当前文档总结成一份结构化 Markdown 摘要，包含核心结论、关键要点、待补充项。',
    ].join('\n\n'),
  }
}
